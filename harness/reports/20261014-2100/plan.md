# Plan — Corrida 20261014-2100 (REQ-TIE + REQ-WEB)

Alcance: REQ-TIE (AC-TIE-1..15) y REQ-WEB (AC-WEB-1..7). REQ-POR queda fuera: defaults fijos de tienda y oferta preparada pero tolerante a que `tienda_ofertas` no exista.

## 0. Hallazgos del código que condicionan el diseño
- `src/index.js` importa `App` estático. Hay que convertirlo en un selector de entry con dos `React.lazy` (tienda / app interna).
- No hay router ni Testing Library. Los tests de UI usan `createRoot` + `act` (`src/pages/Configuracion.test.js`). Se sigue ese patrón y no se agregan dependencias.
- Los pedidos sincronizan por `synced:false` + `pedidoToRemoteRow` (update de la fila entera) en `syncService.js:403`. `mapPedidoRemoto` es tolerante a columnas faltantes.
- `isPedidoOculto` (`src/utils/pedidos.js`) es el filtro común de Armado, Facturación, Orden, Lista, Resumen, Reportes, pdfGen y `esFacturadoActivo` (comisiones).
- Las RPC admin usan el patrón `(p_admin_id, p_admin_pin)` con PIN verificado en el servidor (`comisionesService.credencialesAdmin`).
- **La app interna entra a Supabase con la anon key** (002, línea 4). Revocar `select` a `anon` en `productos/clientes/pedidos/vendedores/movimientos_stock` rompería la app interna (ver Riesgo R1).

## 1. Modelo de datos

### IndexedDB (`src/db/index.js`): `DB_VERSION` 7 → 8, solo aditivo
| Store | Cambio | Clave |
|---|---|---|
| `pedidos` | campos nuevos opcionales: `origen` ('interna' por defecto si falta), `webEstado`, `webContacto`, `webRevisadoPor`, `webRevisadoAt`, `webMotivoRechazo`, `idempotencia`. Sin índice nuevo y sin migrar registros (si falta `origen`, es un pedido interno) | `id` (igual que hoy) |
| `pedidosWebAcciones` (nuevo) | cola de aceptar/rechazar offline: `{id, pedidoRemoteId, tipo:'aceptar'/'rechazar', clienteId, clienteNombre, zona, vendedor, items, total, motivo, por, at, pendingSync:true, resultado:null/'ok'/'ya_resuelto'/'error', detalle}`. Índice `pedidoRemoteId` (no único) | `id` = `crypto.randomUUID()` |

Las acciones web van en un store aparte, no en el pedido, para no marcar `synced:false`: si no, el push genérico subiría la fila entera.

### Supabase (`supabase/migrations/008_tienda.sql`)
| Objeto | Detalle |
|---|---|
| `pedidos` + columnas | `origen text not null default 'interna'`, `web_estado text` (check por_revisar/aceptado/rechazado), `web_contacto jsonb`, `web_revisado_por text`, `web_revisado_at timestamptz`, `web_motivo_rechazo text`, `idempotencia uuid unique`, `web_accion_id uuid` (la última acción que resolvió el pedido) |
| trigger `tg_pedidos_web_guard` | si `current_user in ('anon','authenticated')`: en INSERT fuerza `origen='interna'` y anula `web_*`; en UPDATE de una fila con `origen='web'` y `web_estado<>'aceptado'` devuelve OLD (no se pisa; el sync genérico no se traba); en cualquier UPDATE conserva OLD.web_* y OLD.origen |
| `tienda_config` | fila única `id=1`: `permitir_sin_stock bool default false`, `limite_por_hora int default 5`, `max_renglones int default 150`, `max_unidades_renglon int`, `max_total numeric`. RLS on, revoke all a anon/authenticated |
| `tienda_secretos` | `sal text` (generada con `gen_random_bytes`), solo la usa el definer |
| `vendedores_tienda_tokens` | `token text pk` (32 bytes de `gen_random_bytes`, base64url), `vendedor_id`, `creado_at`, `revocado_at`. Revoke all |
| `tienda_intentos` | `id uuid`, `origen_hash text` (sha256 de ip+sal), `creado_at`, índice `(origen_hash, creado_at)`. Revoke all |
| RPC `tienda_catalogo()` | anon. Devuelve las columnas de AC-TIE-3; `disponible` = suma de `movimientos_stock` > 0 o `permitir_sin_stock`. Filtra `visible_tienda`, no borrado, `precio>0`. Precio = oferta vigente solo si `to_regclass('public.tienda_ofertas')` no es null (EXECUTE dinámico); si no, `precio` |
| RPC `tienda_crear_pedido(p jsonb)` | anon. Orden: idempotencia → honeypot → topes → límite/hora → recálculo → comparación con lo visto → insert. Fecha `(now() at time zone 'America/Argentina/Buenos_Aires')::date` |
| RPC `admin_resolver_pedido_web(p_admin_id, p_admin_pin, p_pedido_id, p_accion_id uuid, p_tipo, p_datos jsonb)` | `select ... for update`, transición atómica (ver §4) |
| RPC `admin_token_tienda(p_admin_id, p_admin_pin, p_vendedor_id, p_regenerar bool)` y `admin_listar_tokens_tienda(p_admin_id, p_admin_pin)` | regenerar = `revocado_at=now()` del anterior + insert nuevo |
| Todas | `security definer`, `set search_path = public, pg_temp`, `revoke all ... from public`, `grant execute` a anon solo para `tienda_catalogo` y `tienda_crear_pedido`; admin_* a anon/authenticated (con PIN, igual que hoy) |

### Mapeo UI → interno → remoto
| UI | Interno (pedido) | Remoto |
|---|---|---|
| Nombre o razón social / Teléfono / Dirección / Ciudad / CP / Provincia / CUIT / Observaciones | `webContacto.{nombre,telefono,direccion,ciudad,cp,provincia,cuit,observaciones}` | `web_contacto` jsonb |
| (se completa al aceptar) | `clienteNombre` = contacto.nombre hasta vincular | `cliente_nombre` |
| Estado bandeja | `webEstado` | `web_estado` |
| Vendedor del link | `vendedor` (nombre, como hoy) | `vendedor` |
| Renglón | `items[] {productoId, nombre, cantidad (unidades), precio, subtotal, bultos?, bultoX?, bultoNombre?}` | `items` |

## 2. Decisión AC-TIE-9 (unidad/bulto)
**Se unifica en unidades: un renglón por producto.** Motivo: los items internos se indexan por `productoId` (`mapaPrevios`, `congelarBultosItems`, `validarMultiplosItems`). Dos renglones del mismo producto romperían Facturación/Armado.
- En el carrito, la línea guarda `unidades`. En `ambos`, el selector "Unidad / Display x16" solo cambia el paso del +/− y lo que se suma. En `bulto` el paso es `bultoX`.
- Se muestra "48 u. (3 Display)" si las unidades son múltiplo, o "20 u. (1 Display + 4 u.)" si no.
- Al RPC se manda `{productoId, cantidad: unidades, modo:'unidad'}`. Por compatibilidad con AC-TIE-13, el servidor igual acepta `modo:'bulto'` (multiplica por `bultoX`) y suma los renglones repetidos del mismo producto.
- El servidor congela `bultos/bultoX/bultoNombre` igual que `congelarBultosRenglon`.

## 3. Cómo los pedidos web por revisar no entran al flujo ni mueven stock (AC-WEB-1)
1. `isPedidoOculto(p)` pasa a devolver true también si `p.origen==='web' && p.webEstado!=='aceptado'`. Eso cubre Armado, Facturación, Orden, Lista, Resumen, Reportes, pdf y Comisiones (`esFacturadoActivo`) sin tocar cada pantalla. Además se agrega `esPedidoWebPendiente(p)`.
2. `aplicarStockPedido` (`stockService.js:45`) devuelve `[]` si el pedido es web y no está aceptado. Es un segundo cerrojo aunque alguien lo intente facturar.
3. Servidor: el trigger impide que un dispositivo pase a `facturado` un web por revisar, porque devuelve OLD.
4. El cleanup de `pullPedidosByFecha` ya saltea los ocultos: no se borran localmente (no se pierde nada).
5. Una aceptación offline **no** lo hace visible hasta que el servidor confirma (supuesto S3).

## 4. Doble aceptación resuelta en el servidor (AC-WEB-6)
- `admin_resolver_pedido_web`: verifica el PIN y hace `select ... for update` del pedido.
  - Si `web_estado='por_revisar'`: aplica (cliente_id, cliente_nombre, zona, vendedor, items, total, `web_estado`, revisado_por/at, motivo, `web_accion_id=p_accion_id`) y devuelve `{ok:true}`.
  - Si ya está resuelto y `web_accion_id = p_accion_id`: devuelve `{ok:true, repetido:true}` (reintento idempotente).
  - Si no: devuelve `{ok:false, motivo:'ya_resuelto', estado, revisado_por, cliente_id}` y **no** toca nada.
- Cliente (`syncPedidosWeb`): si llega `ok`, marca la acción como `resultado:'ok'` y limpia `pendingSync` **solo de esa acción**. Si llega `ya_resuelto`, se marca `resultado:'ya_resuelto'`, no se reintenta y se muestra un aviso en la bandeja ("Lo resolvió X"). Después hace pull del pedido.
- Aceptar con un cliente nuevo: el cliente se da de alta con el flujo de REQ-CLI (pendingSync). La acción espera a que el cliente esté subido, porque `syncClientes` corre antes que los pedidos.
- La acción necesita el PIN del admin para subir: se pide en la bandeja y vive en memoria de la sesión, nunca en IndexedDB ni en localStorage.

## 5. Funciones puras de dominio
`src/domain/tienda.js` (importa solo `unidadVenta`, `validacion`, `clientes`; nada de `utils/`, `db`, `sync`):
| Firma | Contrato |
|---|---|
| `aCentavos(n) → int|null` | NaN, null, texto o negativo → null; redondeo half-up |
| `precioVigente(prod, ofertas=[], hoyISO) → {precio, enOferta}` | la oferta vale de `desde` a `hasta` inclusive; vencida → precio base |
| `unidadesRenglon({cantidad, modo}, prod) → int|null` | 'bulto' × bultoX; rechaza modos no permitidos por `ventaPor` |
| `validarRenglon(linea, prod, cfg) → {ok, errores[]}` | minimoVenta, múltiplo si `ventaPor='bulto'`, tope de unidades, disponible/permitir sin stock |
| `calcularCarrito(lineas, catalogoById, cfg, hoyISO) → {renglones[{productoId, unidades, bultos, resto, precio, subtotal}], total, errores, totalUnidades}` | todo en centavos; dedup por productoId; tope 150 renglones y total máximo |
| `compararConServidor(visto, recalculado) → {cambio:bool, diffs[]}` | precio, disponibilidad o regla distintos → cambio |
| `textoBulto(prod) → "Display x16 · $14.400"|null` | AC-TIE-7 |
| `normalizarBusqueda(s)`, `coincide(prod, q) → bool`, `puntaje(prod, q) → number` | sin tildes ni mayúsculas, tokens en cualquier orden, sobre nombre/código/marca |
| `filtrarCatalogo(cat, {q, rubros[], marcas[], orden}) → {items, contadores:{rubros, marcas}}` | AC-TIE-5/6 |
| `filtrosDesdeQuery(search)` / `filtrosAQuery(f)` | ida y vuelta estable |
| `rutaTienda(pathname, search, {esHostTienda}) → {vista:'catalogo'|'producto'|'carrito'|'checkout'|'confirmacion', id?, token?}` | host de tienda: toda ruta → tienda |
| `esHostTienda(hostname, envHosts) → bool` / `esEntradaTienda(location, envHosts) → bool` | `/tienda`, `/tienda/*` o un host listado |
| `validarCheckout(form) → {ok, errores{campo}, datos}` | obligatorios, CUIT con `validarCuit`, obs ≤500, provincia de `PROVINCIAS` |
| `serializarCarrito(c, now)` / `restaurarCarrito(raw, now) → carrito|null` | descarta >7 días o JSON roto |
| `armarPayloadPedido(carrito, contacto, token, idem) → objeto` | forma de AC-TIE-13 + `precioVisto` por renglón y honeypot |

`src/domain/pedidosWeb.js`:
| Firma | Contrato |
|---|---|
| `esPedidoWebPendiente(p)` / `estadoBandeja(p, acciones)` | por_revisar / aceptado / rechazado / pendiente de subir |
| `sugerirClientes(contacto, clientes, max=5) → [{cliente, score, motivos[]}]` | CUIT exacto > teléfono (solo dígitos, últimos 8) > nombre normalizado (tokens); orden por score, desempate por nombre |
| `vendedorAlAceptar(pedido, cliente, elegido) → {vendedor|null, requiereElegir}` | link → ficha → admin |
| `validarAccionWeb(tipo, datos) → {ok, errores}` | rechazar: motivo obligatorio (3..300); aceptar: clienteId y vendedor |
| `clienteDesdeContacto(contacto) → form REQ-CLI precargado` | sin código (lo carga el admin) |
| `pedidoWebFromRemote(r, local)` / `accionWebToRpc(a, cred)` | tolerante a columnas faltantes |
| `filtrarHistorialWeb(pedidos, estado)` | AC-WEB-5 |

## 6. Archivos en orden
| # | Archivo | Acción | REQ/AC |
|---|---|---|---|
| 1 | `src/domain/tienda.js` + `__tests__/tienda.carrito.test.js`, `tienda.busqueda.test.js`, `tienda.checkout.test.js`, `tienda.ruta.test.js` | crear | TIE-1,5,6,7,9,10,11,12,13,15 |
| 2 | `src/domain/__fixtures__/tiendaCasos.js` | crear: casos compartidos (Dos Corazones 1→16u/$14.400, 3→48u/$43.200, centavos, oferta en el borde) que usan el dominio y el test del SQL | TIE-11 |
| 3 | `src/domain/pedidosWeb.js` + `__tests__/pedidosWeb.test.js` | crear | WEB-1,3,4,5,6 |
| 4 | `src/utils/pedidos.js` | modificar `isPedidoOculto` | WEB-1 |
| 5 | `supabase/migrations/008_tienda.sql` + `src/domain/__tests__/migracion008.sql.test.js` | crear | TIE-3,13,15, WEB-4..7 |
| 6 | `src/index.js` (selector de entry + 2 `React.lazy`, `Suspense`) | modificar | TIE-1,2 |
| 7 | `src/tienda/TiendaApp.js`, `tiendaApi.js` (solo `lib/supabase` + rpc), `useCarrito.js`, `Catalogo.js`, `Filtros.js`, `TarjetaProducto.js`, `DetalleProducto.js`, `Carrito.js`, `Checkout.js`, `Confirmacion.js`, `tienda.css` | crear | TIE-1..15 |
| 8 | `src/tienda/__tests__/aislamiento.test.js` | crear (grafo de imports estático) | TIE-1 |
| 9 | `src/tienda/__tests__/*.ui.test.js` (catalogo, carrito, checkout, confirmacion) | crear | TIE-4..14 |
| 10 | `src/db/index.js` v8 + `src/db/__tests__/migracionV8.test.js` | modificar | WEB-6 |
| 11 | `src/sync/syncService.js`: `mapPedidoRemoto` lee origen/web_*; `syncPedidosWeb({cred})` y `pullPedidosWebPorRevisar()` (filtro `web_estado='por_revisar'`, sin límite de fecha) | modificar | WEB-1,6 |
| 12 | `src/services/stockService.js` (cerrojo en `aplicarStockPedido`) | modificar | WEB-1 |
| 13 | `src/services/pedidosWebService.js` (encola la acción, credencial en memoria, llama a sync) | crear | WEB-4,5,6 |
| 14 | `src/pages/PedidosWeb.js` + `PedidosWeb.test.js`; `src/App.js` (pestaña admin + contador) | crear/modificar | WEB-1..5 |
| 15 | `src/services/tiendaLinksService.js` + sección en `src/pages/Configuracion.js` (vendedores: generar/copiar/regenerar) | crear/modificar | WEB-7 |
| 16 | tests de regresión: `src/services/__tests__/pedidosWeb.regresion.test.js` | crear | WEB-1, regresión |

## 7. Entry de la tienda y aislamiento (AC-TIE-1/2)
- `src/index.js`: `esEntradaTienda(window.location, process.env.REACT_APP_TIENDA_HOSTS)`. Si es tienda: carga `lazy(() => import('./tienda/TiendaApp'))`, quita `<link rel=manifest>`, hace `preventDefault` en `beforeinstallprompt`, pone `document.title` y el favicon de la tienda. Si no: carga `lazy(() => import('./App'))` igual que hoy. La limpieza de SW y caches existente se mantiene, y nunca se registra un SW en la tienda.
- `index.js` no puede importar estáticamente nada interno: solo `domain/tienda` (`esEntradaTienda`).
- Rutas propias con `history.pushState`: `/tienda`, `/tienda/p/:id`, `/tienda/carrito`, `/tienda/checkout`. En un host de tienda, cualquier ruta muestra la tienda.
- **Verificación:**
  - (a) Test Jest `aislamiento.test.js`: recorre el grafo de imports desde `src/tienda/TiendaApp.js` (regex de `import`/`require`, resolviendo rutas relativas) y falla si alcanza `src/db`, `src/sync`, `src/services/sesion`, `src/pages`, `src/hooks`, `src/App` o `src/utils/pdfGen`. También verifica que `src/index.js` no importa estático `./App`.
  - (b) Test UI: con hostname de tienda y `pathname=/facturacion` se renderiza la tienda, y el mock de `./App` nunca se llama.
  - (c) Opcional en el gate: después de `build`, buscar en `build/static/js/*.chunk.js` el chunk de la tienda y verificar que no contenga `indexedDB.open`.

## 8. Riesgos de concurrencia offline / multidispositivo
| Riesgo | Mitigación |
|---|---|
| Doble clic o reintento en checkout | `idempotencia` uuid del navegador, único en el servidor; la respuesta se repite |
| Precio manipulado en el navegador | el servidor recalcula todo; `precioVisto` solo se usa para detectar cambios |
| Dos admins resuelven el mismo pedido | `for update` + transición solo desde `por_revisar` + `web_accion_id` (§4) |
| Push genérico pisa columnas web | `pedidoToRemoteRow` no incluye `web_*`; el trigger conserva OLD |
| Facturar un web por revisar o mover stock | `isPedidoOculto`, cerrojo en `aplicarStockPedido` y trigger |
| Acción offline con cliente nuevo sin subir | la acción espera a que el cliente tenga id remoto; `pendingSync` se limpia solo con ok |
| Stock en la tienda | solo el booleano `disponible` derivado del ledger; nunca se escribe stock |
| Token de vendedor enumerable | 256 bits aleatorios; tabla revocada; token inválido = link general con la misma respuesta (no filtra si existe) |

## 9. Riesgos abiertos
- **R1 (BLOQUEANTE parcial de AC-TIE-3):** la app interna usa la anon key para leer y escribir `productos/clientes/pedidos/vendedores/movimientos_stock`. La 008 **no** puede revocarle ese acceso sin romperla (regla dura 2). En esta corrida: las tablas nuevas quedan sin acceso para anon, la tienda nunca usa `.from()` (test), y el auditor documenta el pendiente: mover la app interna a un rol autenticado (Supabase Auth o JWT propio) para poder revocar a anon. Mientras tanto, `web_contacto` (datos personales) queda legible con la anon key, igual que `clientes` hoy. Escalar al dueño.
- R2: IP para el límite por hora: se toma `x-forwarded-for` de `request.headers`. Si falta, se usa el hash de un string vacío (bucket común, más restrictivo).

## 10. Supuestos (opción conservadora)
- S1: Solo el admin ve y acepta pedidos web (A confirmar). Sin notificaciones.
- S2: Honeypot lleno → `{ok:false, motivo:'invalido'}` genérico, sin crear el pedido.
- S3: Una aceptación offline queda "pendiente de subir" y no entra a Armado/Facturación hasta que el servidor la confirma.
- S4: Las ediciones de renglones antes de aceptar se mandan dentro de la acción de aceptar (no por el push genérico). Usan `validarMultiplosItems(..., {permiso:1, pantalla:'facturacion'})` (AC-VTA-3).
- S5: `disponible` no descuenta los pedidos web por revisar (no mueven stock).
- S6: Sin dependencias nuevas (ni router ni Testing Library): tests con `createRoot` + `act`.
- S7: El número de pedido que se muestra es `pedidos.id` remoto.
- S8: Cada línea del carrito guarda `precioVisto`; si el precio cambió, el carrito corregido reemplaza al local solo cuando el cliente acepta.

## 11. Plan de pruebas (AC → test)
| AC | Test | Tipo |
|---|---|---|
| TIE-1 | `tienda/__tests__/aislamiento.test.js`, `tienda.ruta.test.js`, `entry.ui.test.js` (host de tienda nunca renderiza App) | estático + unidad + UI |
| TIE-2 | `entry.ui.test.js` (title, sin manifest, `beforeinstallprompt` bloqueado, sin registrar SW) | UI |
| TIE-3 | `migracion008.sql.test.js` (columnas que devuelve, filtros, revoke/grant, sin costo/ganancia/stock) + auditor | SQL estático + seguridad |
| TIE-4 | `catalogo.ui.test.js` (encabezado, contador, clases de grilla) + revisión manual a 360 px | UI + manual |
| TIE-5/6 | `tienda.busqueda.test.js` (tildes, orden de palabras, combinaciones, query ida y vuelta) + `catalogo.ui.test.js` (debounce, panel en mobile, sin rpc por tecla) | unidad + UI |
| TIE-7/8 | `tienda.carrito.test.js` (`textoBulto`) + `catalogo.ui.test.js` (Sin stock deshabilitado, detalle) | unidad + UI |
| TIE-9/10/11 | `tienda.carrito.test.js` con `tiendaCasos.js` (Dos Corazones, ambos, mínimo, múltiplos, centavos, NaN/negativos/null, totales grandes, oferta en el borde) + `carrito.ui.test.js` (agregar/cambiar/quitar, persistencia, 7 días, localStorage que tira error) | unidad + UI |
| TIE-12 | `tienda.checkout.test.js` + `checkout.ui.test.js` (errores por campo, se recuerda) | unidad + UI |
| TIE-13 | `migracion008.sql.test.js` (recálculo, idempotencia, fecha AR, `origen/web_estado`) + `checkout.ui.test.js` (carrito corregido) | SQL + UI |
| TIE-14 | `confirmacion.ui.test.js` (vacía el carrito; error de red conserva el carrito) | UI |
| TIE-15 | `migracion008.sql.test.js` (límite/hora, honeypot, topes, hash con sal) + `tienda.carrito.test.js` (topes del cliente) | SQL + unidad |
| WEB-1 | `pedidosWeb.regresion.test.js` (`isPedidoOculto`, comisiones, `aplicarStockPedido`=[], pedidos viejos sin `origen`) + `PedidosWeb.test.js` (contador) | unidad + servicio |
| WEB-2 | `PedidosWeb.test.js` (contacto, renglones con bultos, edición con AC-VTA-3) | UI |
| WEB-3 | `pedidosWeb.test.js` (`sugerirClientes`, orden) + `PedidosWeb.test.js` (crear cliente precargado) | unidad + UI |
| WEB-4/5 | `pedidosWeb.test.js` (`vendedorAlAceptar`, `validarAccionWeb`, historial) + `PedidosWeb.test.js` | unidad + UI |
| WEB-6 | `migracionV8.test.js` (store nuevo, no borra datos), `pedidosWebSync.test.js` (pendingSync limpia solo ok, `ya_resuelto`, reintento repetido) + SQL (`for update`, `web_accion_id`) | IDB + servicio + SQL |
| WEB-7 | `tiendaLinks.test.js` (regenerar invalida, token inválido = general) + SQL (`gen_random_bytes`, revoke) | servicio + SQL |

Gates: `CI=true npx react-scripts test --watchAll=false`, `npx react-scripts build`, `node harness/gates/run-gates.mjs`.
Pasos manuales: aplicar la 008 en el SQL editor, definir `REACT_APP_TIENDA_HOSTS` y rebuild, configurar el DNS del host de la tienda hacia el mismo deploy.
