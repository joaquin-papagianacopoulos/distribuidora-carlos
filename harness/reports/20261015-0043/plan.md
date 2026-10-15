# Plan — RUN 20261015-0043 (REQ-PBU, REQ-MIN, REQ-SST, REQ-HPR)

Base: SPEC "Decisiones de negocio", "Lote operación — principios" y los 4 REQ. Rama `feature/lote-operacion`.

## 1. Lo que ya existe (cambio mínimo)
- `avisosItemPedido` (domain/productos.js:160) ya avisa mínimo y stock, sin bloquear; solo se usa en NuevoPedido.
- `STOCK_POLICY='advertir'` + `decidirFacturacion` → Facturación ya pide `confirm` y deja facturar con stock negativo (Facturacion.js:730-740). Stock.js ya pinta `s < 0` en rojo (línea 79). REQ-SST es casi todo texto + Armado.
- `validarMultiplosItems(items, productosById, {permiso, pantalla, previos})` (unidadVenta.js) es el patrón a copiar para mínimos.
- `renglonNuevo` (bultos.js:64) es el único constructor de renglón: ahí se congelan precios y cantidad inicial.
- Escritura local de productos: solo `addProductoLocal` / `updateProducto` (db/index.js:180/238), llamadas desde Configuracion.js:71/74 (Excel) y 241/244 (formulario). `putProducto` (imagen/marca en syncService) no toca precios; `putProductosBatch` es el pull remoto.
- Tienda: `tienda_catalogo` (versión vigente en 009), `tienda_crear_pedido` (008, recalcula precio/mínimo/múltiplo en servidor), `src/domain/tienda.js` (`precioVigente`, `minimoDe`, `calcularCarrito`, `compararConServidor`), fixture compartido `src/domain/__fixtures__/tiendaCasos.js`.
- ATENCIÓN nombre: `unidadVenta.precioBulto(precioUnit, bultoX)` ya existe (= precio del bulto entero). El campo nuevo `producto.precioBulto` es precio POR UNIDAD. No renombrar la función; en código nuevo usar `precioAplicado`.

## 2. Modelo de datos
### IndexedDB — `DB_VERSION` 8 → 9 (solo se AGREGA)
| Store | keyPath | Índices | Notas |
|---|---|---|---|
| `cambiosPrecio` (nuevo) | `id` (UUID `crypto.randomUUID()`) | `productoId`, `fecha` (no únicos) | inmutable; `pendingSync:true` al crear |
| `productos` | sin cambio de schema | — | campo nuevo `precioBulto` (default 0 si falta) |

Registro `cambiosPrecio`: `{ id, productoId, codigo, nombre, rubro, precioAnterior|null, precioNuevo, precioBultoAnterior|null, precioBultoNuevo, fecha 'YYYY-MM-DD' (hora AR), creadoEn ISO, usuarioId, usuarioNombre, pendingSync }`. Snapshot de código/nombre/rubro para que el PDF funcione aunque el producto se borre.

Renglón de pedido (aditivo, sin migración): `precioPorBulto: bool`, `precioBultoOriginal: number` (congelado al crear el renglón), `precioManual: bool` (lo setea cualquier edición manual de precio/descuento).

### Supabase — migración `supabase/migrations/010_lote_operacion_precios.sql`
Idempotente, `begin/commit`, prerrequisitos estáticos (007 y 009 aplicadas), sin `drop`.
1. `alter table productos add column if not exists precio_bulto numeric(14,2) not null default 0` + check `>= 0` (vía `do $$` si no existe).
2. `create or replace admin_guardar_productos` (misma firma de 007): en la rama `extras` suma `precio_bulto` (validado `>= 0`, `<= 999999999999`). Rama básica sin cambio (el CSV viejo no pisa).
3. Helpers SQL (revoke de anon como `tienda_precio_vigente` en 008):
   - `tienda_precio_aplicado(p_precio numeric, p_precio_bulto numeric, p_bulto_x int, p_unidades numeric) returns numeric`
   - `tienda_minimo_efectivo(p_minimo int, p_venta_por text, p_bulto_x int) returns int`
4. `create or replace tienda_catalogo()` = versión 009 + `'precioBulto'` (solo si aplica, si no `null`) y `'minimoVenta'` = mínimo efectivo.
5. `create or replace tienda_crear_pedido(jsonb)` = copia textual de 008 con diff mínimo: `v_min` = `tienda_minimo_efectivo(...)`; `v_precio` = `tienda_precio_aplicado(precio_vigente, precio_bulto, bulto_x, v_u)`; renglón agrega `precioOriginal` y `precioPorBulto`. El chequeo `precioVisto` existente rechaza carritos manipulados (AC-PBU-4).
6. Tabla `cambios_precio` (id uuid pk, producto_id text, codigo, nombre, rubro, precio_anterior/nuevo, precio_bulto_anterior/nuevo numeric(14,2), fecha date, creado_en timestamptz, usuario_id text, usuario_nombre text, recibido_en timestamptz default now()); índice `(fecha)`. RLS on; `revoke insert, update, delete ... from anon, authenticated`; `grant select` a anon/authenticated.
7. RPC `admin_registrar_cambios_precio(p_admin_id text, p_admin_pin text, p_filas jsonb) returns jsonb` — patrón 007 (PIN + admin activo, ≤500 filas, `insert ... on conflict (id) do nothing`), responde `{ok, aceptados:[uuid], rechazados:[{id,motivo}]}`.

### Mapeo UI → interno → remoto
| UI | Interno | Remoto |
|---|---|---|
| "Precio por unidad" (antes "Precio venta 1") | `precio` | `precio` |
| "Precio por unidad llevando bulto" | `precioBulto` | `precio_bulto` |
| "Mínimo venta" | `minimoVenta` | `minimo_venta` |
| Tienda "Llevando el display: $800 c/u" | catálogo `precioBulto` | `tienda_catalogo().precioBulto` |
| Cambio de precio | `cambiosPrecio.*` camelCase | `cambios_precio.*` snake_case |

## 3. Funciones puras de dominio (`src/domain/`)
`src/domain/precios.js` (nuevo):
- `precioAplicado(producto, cantidad) → { precio, porBulto }` — `bx = normalizarBultoX(bultoX)`; si `bx > 1`, `precioBulto > 0`, `cantidad >= bx` ⇒ `min(precio, precioBulto)`, `porBulto:true`; si no `precio`. Redondeo a centavos. (AC-PBU-5)
- `precioAplicadoRenglon(item, cantidad) → item` — usa precios CONGELADOS del renglón (`precioOriginal`, `precioBultoOriginal`); si `esPrecioManual(item)` lo devuelve igual. (AC-PBU-3)
- `esPrecioManual(item) → bool` — `precioManual` o `descuentoPct != null` o (`precio !== precioOriginal` y `!precioPorBulto`). Reemplaza la detección "Precio modificado" de NuevoPedido:107 y Facturacion:128/1094.
- `precioBaseRenglon(item) → number` — base para descuentos % (precio aplicado sin manual).
- `avisoPrecioBulto(precio, precioBulto) → string|null` — aviso no bloqueante (AC-PBU-1).
- `cambioDePrecio(previo, nuevo, { usuario, now, genId }) → registro|null` — null si `precio` y `precioBulto` no cambian (comparación en centavos); alta ⇒ `precioAnterior:null`. (AC-HPR-1)
- `resumirCambiosPrecio(cambios, { desde, hasta }) → filas[]` — agrupa por producto: primer anterior, último nuevo (por `creadoEn`, desempate `id`), `variacionPct` (null si anterior null/0), orden rubro→nombre. (AC-HPR-2)
- `filasPdfSoloPrecioNuevo(filas, productosById) → filas[]` (AC-HPR-3).
- `cambioPrecioToRemote` / `cambioPrecioFromRemote`.

`src/domain/minimos.js` (nuevo):
- `minimoEfectivo(producto) → int` — mínimo ≤1/vacío ⇒ 1; si `ventaPorEfectivo==='bulto'` y `bx>1` ⇒ `ceil(min/bx)*bx`. (AC-MIN-3)
- `cantidadInicialConMinimo(producto) → number` = `max(cantidadInicialRenglon, minimoEfectivo)`. (AC-MIN-1)
- `puedeGuardarBajoMinimo(permiso, pantalla) → 'no'|'confirmar'` — nuevoPedido/tienda/armado ⇒ `no`; facturacion+admin ⇒ `confirmar`.
- `validarMinimosItems(items, productosById, { permiso, pantalla, previos }) → { errores:[{productoId, minimo}], requiereConfirmacion }` — ignora eliminados/tachados y renglones legacy que ya estaban bajo el mínimo en `previos`. (AC-MIN-1/2)

`src/domain/stock.js` (modificar, aditivo):
- `avisoSinStock(cantidad, disponible) → 'Sin stock (hay N)'|null`; `avisosItemPedido` lo usa en vez de "Stock disponible: N".
- `resumenSinStock(faltantes) → string` — "N productos quedan con stock negativo" + detalle. (AC-SST-1)
- `stockParaAviso(stockMap, productoId, cantidadYaDescontada=0) → number` — en pedido facturado suma lo ya descontado.

`src/domain/tienda.js`: `calcularCarrito`, `minimoDe`, `unidadesIniciales` usan `precioAplicado`/`minimoEfectivo`; `textoPrecioBulto(prod) → "Llevando el display: $800 c/u"|null`.

## 4. Archivos, en orden
1. `src/domain/precios.js` + tests — REQ-PBU, REQ-HPR
2. `src/domain/minimos.js` + tests — REQ-MIN
3. `src/domain/stock.js`, `src/domain/productos.js` (label "Precio por unidad", campo `precioBulto` en `CAMPOS_PRODUCTO`/`validarProducto`, `precio_bulto` en from/toRemote nuevo `productoPreciosToRemote`, `avisosItemPedido`) — REQ-PBU, REQ-SST
4. `src/domain/bultos.js` `renglonNuevo`: congela `precioBultoOriginal`, cantidad con `cantidadInicialConMinimo`, aplica `precioAplicado` — REQ-PBU, REQ-MIN
5. `src/domain/plantillas.js`: columna "Precio por unidad llevando bulto" (`precioBulto`, en `SOLO_PLANTILLA_PRODUCTO`), alias `precioventa1`→`precio` (Excel viejo), info de columnas — AC-PBU-2
6. `src/domain/productosRpc.js` `filaProductoRpc` con extras incluye `precio_bulto` (entra en la huella) — REQ-PBU
7. `src/domain/tienda.js` + fixture `tiendaCasos.js` (casos bulto 10/16/20 u., mínimo redondeado) — AC-PBU-4, AC-MIN-1/3
8. `supabase/migrations/010_lote_operacion_precios.sql` — REQ-PBU, REQ-MIN (tienda), REQ-HPR
9. `src/db/index.js`: `DB_VERSION=9`, store `cambiosPrecio`; `addProductoLocal(p, {usuario})` y `updateProducto(p, {usuario})` abren tx `['productos','cambiosPrecio']`, leen el previo DENTRO de la tx, llaman `cambioDePrecio` y guardan ambos atómicamente; `getCambiosPrecio`, `putCambiosPrecioRemotos`, `clearCambiosPrecioPendingSync(ids)` — AC-HPR-1
10. `src/services/cambiosPrecioService.js` (patrón `comisionesRubroService`): `subirCambiosPrecio(cred)` (RPC, limpia SOLO aceptados), `bajarCambiosPrecio()` (select por `fecha >= hoy-90` paginado, no pisa pendientes locales) — AC-HPR-1
11. `src/sync/syncService.js`: `syncProductos` sube `precio_bulto` (nivel nuevo en `upsertEscalonado`), pull mapea `precioBulto`; `subirProductosConPin` (productosAdminService) llama después `subirCambiosPrecio(cr.cred)`; pull general llama `bajarCambiosPrecio` — REQ-PBU, REQ-HPR
12. `src/components/ProductoForm.js`: campo nuevo + aviso `avisoPrecioBulto` — AC-PBU-1
13. `src/pages/Configuracion.js`: pasar `{usuario: vendedorActual}` a 71/74/241/244 — AC-HPR-1
14. `src/pages/NuevoPedido.js`: recalcular con `precioAplicadoRenglon` al cambiar cantidad; error de mínimo en renglón y bloqueo de guardar; aviso "Sin stock (hay N)" — AC-PBU-3, AC-MIN-1, AC-SST-1
15. `src/pages/Facturacion.js`: idem + `precioManual:true` en `setPrecio`/descuentos/`aplicarPrecioLista`; base de descuento `precioBaseRenglon`; confirm de mínimo (admin); `marcarFacturado` usa `resumenSinStock` (sigue `confirm`, nunca `bloquear`) — AC-PBU-3, AC-MIN-2, AC-SST-1
16. `src/pages/Armado.js`: tomar `stockMap` de `useApp`, avisos por renglón, recálculo de precio, no bajar del mínimo (stepper con piso; tachar como faltante sigue igual) — AC-PBU-3, AC-MIN-2, AC-SST-1
17. `src/tienda/*` (ficha/carrito): texto "Llevando el display…", `precioVisto` = precio aplicado recalculado al cambiar cantidad — AC-PBU-4, AC-MIN-1
18. `src/pages/CambiosPrecio.js` (nuevo, solo admin, entrada desde Configuración › Productos) + `src/utils/pdfGen.js` `generarCambiosPrecioFile(filas, {desde, hasta, soloNuevo})` — AC-HPR-2/3/4 (leyenda "Se registra desde esta versión")
19. Stock.js: sin cambios (ya rojo); solo test — AC-SST-2

## 5. Concurrencia offline / multidispositivo
- `cambiosPrecio` con UUID e insert `on conflict do nothing`: reintentos y doble subida idempotentes. Se limpian solo los ids `aceptados`.
- Registro y producto en la MISMA transacción IndexedDB: no hay producto guardado sin su cambio (ni al revés). El previo se lee en la tx, no del estado de React (evita diffs contra datos viejos).
- Pull de productos (`putProductosBatch`) NO genera cambios: cada dispositivo registra solo sus ediciones y las comparte vía `cambios_precio`. Dos dispositivos que cambian el mismo precio ⇒ dos registros; `resumirCambiosPrecio` ordena por `creadoEn` (primer anterior / último nuevo). Relojes desfasados: aceptado (supuesto).
- Pedidos: los precios del renglón se congelan al crearlo (`precioOriginal`, `precioBultoOriginal`); un cambio de precio sincronizado después no re-precia pedidos ya cargados. Renglones legacy sin `precioBultoOriginal` ⇒ nunca precio por bulto (comportamiento de hoy).
- Stock: sin cambios de modelo; negativo = suma de movimientos. No se sincroniza ningún número.
- `precio_bulto` con 007 sin 010: el RPC viejo ignora la clave ⇒ se perdería. Mitigación: sonda `admin_registrar_cambios_precio` (id vacío ⇒ `no_autorizado`, no gasta intento); si falta, `extrasPendientes:true` en los productos con `precioBulto>0` y aviso "Falta aplicar la migración 010". Orden de despliegue: aplicar 010 antes de publicar la app.
- Tienda: el servidor es la autoridad (precio aplicado y mínimo efectivo); el cliente solo previsualiza; diferencia ⇒ `motivo:'cambio'` con carrito corregido (flujo existente).

## 6. Decisiones de seguridad (autorizadas por el dueño)
- S1. `cambios_precio`: lectura con anon permitida (precios de venta ya son públicos en `productos`/tienda; no hay costos ni ganancias). Escritura directa revocada a anon/authenticated; solo vía `admin_registrar_cambios_precio` con PIN de admin activo (patrón 007). Sin update/delete: historial inmutable.
- S2. La tabla NO guarda costo, ganancia ni datos de clientes; `usuario_nombre` es el nombre visible del vendedor (no credencial).
- S3. `precio_bulto` solo se escribe por `admin_guardar_productos` (escritura de productos sigue cerrada por 007). `tienda_catalogo` expone `precioBulto` (dato de venta), nunca costo/stock exacto.
- S4. Helpers SQL nuevos `security invoker`/sin grant a anon; RPC nuevas con `set search_path = public, pg_temp`, validan tipos/largos/topes (≤500 filas, importes ≤ numeric(14,2), uuid válido, fecha válida).
- S5. Pantalla "Cambios de precio": solo admin (`esAdmin`), igual que la edición de productos.

## 7. Supuestos (opción conservadora)
- U1. Si `precioBulto > precio`, se aplica `min(precio, precioBulto)`: llevar más nunca cuesta más (el form solo avisa).
- U2. Oferta de tienda vigente + precio por bulto ⇒ se cobra el menor de los dos.
- U3. "Se vende por bulto" (AC-MIN-3) = `ventaPorEfectivo === 'bulto'`; en `ambos` el mínimo no se redondea.
- U4. Alta de producto con precio cuenta como cambio (`anterior:null`, PDF muestra "Nuevo", variación vacía).
- U5. Restaurar backup y pull remoto no registran cambios.
- U6. `fecha` del cambio = día local de Argentina del dispositivo; el filtro por día usa ese campo.
- U7. "Total sin descuento" sigue usando `precioOriginal` (spec): el ahorro por bulto aparece como diferencia, igual que hoy con descuentos.
- U8. AC-MIN-1 bloquea también al admin en Nuevo pedido; la excepción con confirmación es solo Facturación (AC-MIN-2). Pedidos viejos ya bajo el mínimo no se bloquean al reeditarlos (`previos`).
- U9. Se bajan cambios de los últimos 90 días al dispositivo; rangos más viejos se consultan online.

## 8. Plan de pruebas
| AC | Tipo | Dónde |
|---|---|---|
| AC-PBU-5 | unit (tabla de bordes: bultoX 0/1/vacío, precioBulto vacío/0/mayor, decimales, 10/16/20 u.) | `domain/__tests__/precios.test.js` |
| AC-PBU-1 | unit `validarProducto`/`avisoPrecioBulto` + RTL `ProductoForm` (labels) | domain + components |
| AC-PBU-2 | unit `mapearEncabezados`/`planificarImportacion` (plantilla nueva y Excel con "Precio venta 1") | `plantillas.test.js` |
| AC-PBU-3 | unit `precioAplicadoRenglon`/`esPrecioManual` (sube/baja bulto, manual respetado, legacy) + RTL NuevoPedido | domain + pages |
| AC-PBU-4 | unit `calcularCarrito` con fixture `tiendaCasos` + test estático del SQL 010 (usa `tienda_precio_aplicado` en catálogo y crear_pedido) + checklist SQL manual en el reporte | domain + `security.*.test.js` |
| AC-MIN-1/3 | unit `minimoEfectivo`, `cantidadInicialConMinimo`, `validarMinimosItems`; RTL NuevoPedido (error en renglón, no guarda) | domain + pages |
| AC-MIN-2 | unit `puedeGuardarBajoMinimo` por rol/pantalla; RTL Facturación (confirm) y Armado (piso) | domain + pages |
| AC-SST-1 | unit `avisoSinStock`, `resumenSinStock`, `decidirFacturacion('advertir')≠'bloquear'`; RTL Facturación (facturar con stock 0) | domain + pages |
| AC-SST-2 | unit `calcularStock` negativo + revertir (existente AC-STK-3) + RTL Stock rojo | domain + pages |
| AC-SST-3 | regresión `tiendaCasos` con `permitirSinStock` false/true sin cambios | domain |
| AC-HPR-1 | unit `cambioDePrecio` (sin cambio ⇒ null, alta, solo bulto); service con IndexedDB mock: update escribe ambos en una tx; sync limpia solo aceptados; reintento idempotente | domain + services |
| AC-HPR-2/3 | unit `resumirCambiosPrecio` (varios cambios, orden rubro/nombre, %), `filasPdfSoloPrecioNuevo`; smoke `generarCambiosPrecioFile` | domain + utils |
| AC-HPR-4 | RTL `CambiosPrecio` (leyenda y solo admin) | pages |
| Seguridad | test estático del SQL 010: revoke insert/update/delete en `cambios_precio`, RPC con `verificar_pin`, sin `drop` | `services/__tests__/security.*.test.js` |
| Migración IDB | unit `onupgradeneeded` 8→9 conserva stores y datos | db |

Gates: `node harness/gates/run-gates.mjs` (tests + build verdes).
