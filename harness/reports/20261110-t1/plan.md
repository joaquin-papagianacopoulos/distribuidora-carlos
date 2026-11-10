# Plan — RUN 20261110-t1 (Tanda 1: carga de pedidos)
Alcance: REQ-EDP, REQ-MUL, REQ-CBU, REQ-SST2, REQ-MIN2, REQ-ASV, REQ-PEN. Base: REQ-BUL/PBU/MIN/SST/FRB/GBU, AC-COM-7/8/13/17.

## 0. Lo que ya existe (verificado)
- `minimos.js`: `minimoEfectivo`, `cantidadInicialConMinimo`, `puedeGuardarBajoMinimo` (hoy solo admin+facturacion = 'confirmar'), `validarMinimosItems`.
- `unidadVenta.js`: `cantidadConPaso` (AC-FRB-4, ignora el minimo), `puedeGuardarNoMultiplo` (solo admin+facturacion), `validarMultiplosItems`, `congelarBultosItems` (ya existe `item.bultos` congelado: NO reusar ese nombre para casilleros).
- `bultos.js`: `renglonNuevo` (arranca en el minimo, marca `_cantidadPorDefecto`), `sumarBultoRenglon`, `restarBulto`, `desgloseBultos`, `puedeUsarBulto`.
- `armado.js`: `cambiosDeCantidad(antes, despues)` (sirve para EDP-2). `comisiones.js`: `vendedorQueCargo` = `pedido.vendedor`, `asignacionPorDefecto` = ficha, `validarAsignacion` modos ficha/cargador/otro/dividir/sin_comision.
- Pedido remoto: `vendedor` es TEXTO (nombre); `vendedorId` hoy solo vive local (id de IndexedDB). `updated_at` lo pone el CLIENTE (`toRemoteRow`), no hay trigger en `pedidos`. `mapPedidoRemoto` no guarda `updated_at`.
- Pull de pedidos es por `fecha` (+ `vendedor`/`zona`): pedidos de otras fechas no bajan solos (afecta REQ-PEN).
- Trigger `tg_pedidos_web_guard` (008): un pedido web NO aceptado no se puede actualizar desde la app (devuelve OLD sin error).
- `tienda_crear_pedido` vigente = migracion 019 (valida minimo, multiplo de bulto si `venta_por='bulto'`, disponibilidad).
- **Donde se oculta/bloquea sin stock (AC-SST2-1)**: en la app interna, en NINGUN lado. `searchProductos` (utils/fuzzy.js) no filtra por stock; NuevoPedido/Facturacion/Armado solo avisan (`avisoSinStock`); Facturacion pide confirmacion con `STOCK_POLICY='advertir'` (bloquea solo si fuera 'bloquear'). Solo la tienda filtra/bloquea (`TarjetaProducto.puedeAgregar`, `tienda.js:115 validarRenglon`, `TiendaApp.js:174`, `sugerenciasCarrito`, `catalogoDesdeLocales`, `v_disp` en `tienda_crear_pedido`) y queda igual (AC-SST-3). `Rendicion.js:221` es "disponible para devolver", no stock. => SST2 es: etiqueta "Sin stock — por recibir" + test de regresion que garantice que no se oculta.

## 1. Modelo de datos
- IndexedDB: **sin stores ni indices nuevos ⇒ `DB_VERSION` queda en 12**. Campos nuevos dentro de `pedidos` (objeto libre).
- Supabase: migracion `supabase/migrations/024_pedidos_edicion_vendedor.sql` (aditiva, tolerante, re-ejecutable).

| UI | Interno (pedido) | Remoto (`pedidos`) |
|---|---|---|
| "Vendedor del pedido" (dueno, comision) | `vendedor` + `vendedorNombre` (nombre), `vendedorId` (remoteId del vendedor, o id local) | `vendedor` (existente), `vendedor_id text` (nuevo, ≤64) |
| "Cargado por" | `cargadoPor` (nombre), `cargadoPorId` (solo local) | `cargado_por text` (nuevo, ≤80) |
| "Modificado" (EDP-2) | `modificadoTrasArmado: { at:number, por:string, productoIds:string[] } \| null` | `modificado_tras_armado jsonb` (nuevo, check `pg_column_size ≤ 16384`) |
| version del servidor | `remoteUpdatedAt` (string tal cual vino) | `updated_at` (existente; desde 024 lo fija el SERVIDOR por trigger) |
| base de la edicion | `baseRemoteUpdatedAt` (solo local, transitorio) | — |
| conflicto | `conflictoEdicion: { at, remoteUpdatedAt } \| null` (solo local) | — |
| "Sin vendedor" | derivado: `vendedor` vacio o 'WEB' | — |
| Casilleros "Bultos"/"Unidades sueltas" | derivado de `item.cantidad` (no se guarda) | — |

- `updatedAt` local (ms) sigue como hoy (AC-SEG2-7). `item.cantidad` sigue en unidades (stock, armado, comisiones no cambian).

Migracion 024 (orden):
1. `alter table public.pedidos add column if not exists cargado_por text, vendedor_id text, modificado_tras_armado jsonb;` + checks `not valid` (largo/tamano).
2. `drop trigger if exists set_updated_at on public.pedidos; create trigger set_updated_at before update ...execute function public.tg_set_updated_at()` (reloj del servidor; nombre ordena antes que `tg_pedidos_web_guard`).
3. Indice parcial `pedidos_no_facturados_idx on pedidos (fecha) where estado not in ('facturado','cancelado','eliminado','borrado')` (REQ-PEN).
4. `public.tienda_cantidad_valida(p_u bigint, p_min int, p_vp text, p_bx int) returns boolean immutable` = espejo exacto de `esCantidadValidaMinimo`.
5. `create or replace function public.tienda_crear_pedido(p jsonb)` = copia de la version 019 + `or not public.tienda_cantidad_valida(v_u, v_min, v_vp, v_bx)` en la linea de "Reglas" (devuelve carrito corregido, no crea). Mismo `revoke ... from public` / `grant execute ... to anon, authenticated`. (AC-MUL-2)
6. Sin grants nuevos (pedidos no tiene select por columnas; productos no cambia ⇒ no toca `COLUMNAS_PRODUCTO_PUBLICAS`).

## 2. Funciones puras de dominio (Bloque A)
`src/domain/permisos.js`
- `puedeEditarPedido(usuario, pedido) => { ok:boolean, pantalla:'pedido'|'facturacion'|null, motivo:string|null }` — permiso via `permisoValido`. Borrado/cancelado ⇒ no. Admin: no facturado ⇒ 'pedido'; facturado ⇒ 'facturacion' (como hoy). Vendedor (2): estado ≠ 'facturado' y (`vendedor/vendedorNombre` o `cargadoPor` == `usuario.nombre`, comparando con `claveUnica`) y no es web no aceptado. Armador / permiso invalido ⇒ no. (AC-EDP-1/3)
- `puedeAsignarVendedor(usuario, pedido, { alCrear=false }) => boolean` — admin siempre (no borrado; web no aceptado solo desde la bandeja); vendedor solo `alCrear`. (AC-ASV-1/2)

`src/domain/minimos.js` (AC-MUL-1/2, AC-MIN2-1)
- `pasoMinimo(producto) => number` — `minimoVenta` entero > 1 y `ventaPor` ≠ 'bulto' ⇒ m; si no 1.
- `cantidadConPasoMinimo(cantidad, producto, op='sumar'|'restar') => number` — m ≤ 1 ⇒ `cantidadConPaso` (FRB-4 intacto). 'ambos' con bulto: desde el bulto igual que FRB-4; por debajo, siguiente/anterior multiplo de m (7→10 con m=5; 12→10). Nunca baja de `minimoEfectivo`, tope `MAX_CANTIDAD`.
- `esCantidadValidaMinimo(cantidad, producto) => boolean` — c ≥ minimoEfectivo y (m ≤ 1 o c % m = 0 o (bultoX>1 y (c % bultoX) % m = 0)).
- `ajustarAMultiploMinimo(cantidad, producto) => { cantidad, ajustado, aviso }` — sube las sueltas (o el total si no hay bulto) al multiplo superior; aviso "Se ajusto a N (de a m)".
- `validarMultiplosMinimoItems(items, byId, { permiso, pantalla, previos }) => { errores, requiereConfirmacion, bloquea }` — saltea renglones sin cambio vs `previos` (pedidos viejos no se bloquean).
- `puedeGuardarBajoMinimo(permiso, pantalla)`: admin en 'facturacion' **o 'armado'** ⇒ 'confirmar'; resto 'no'.

`src/domain/unidadVenta.js`: `puedeGuardarNoMultiplo` ⇒ admin en 'facturacion' o 'armado' (AC-MIN2-1).
`src/domain/bultos.js` (AC-CBU-2/3): `partirBultos(cantidad, bultoX) => { bultos, sueltas } | null`; `juntarBultos(bultos, sueltas, bultoX) => number | null` (enteros ≥ 0, ≤ MAX_CANTIDAD).
`src/domain/casilleros.js` (nuevo; importa bultos+minimos+precios+grupoBulto para no agrandar el ciclo minimos<->bultos)
- `cambiarCasillero(cantidad, producto, casillero:'bultos'|'sueltas', op, { cantidadPorDefecto }) => number` — 'bultos': ±bultoX (BUL-9: reemplaza la unidad por defecto; resta con `restarBulto` como hoy, no suma el minimo); 'sueltas': `cantidadConPasoMinimo` sobre el total.
- `botonesProductoLista(producto) => { unidad:{texto,precio}, bulto:{texto,precio,bultoX}|null }` — "Unidad $X" / "Bulto xN $Y", Y = (precioBulto>0 ? precioBulto : precio) × N. (AC-CBU-1)
- `agregarBultoDesdeLista(items, producto) => items` — existe ⇒ +1 bulto; no ⇒ `renglonNuevo` con cantidad = bultoX sin marca por defecto.
- `precioVigenteRenglon(item) => { tipo:'bulto'|'unidad', precio, texto }` — "Precio bulto $Y c/u" / "Precio unidad $X" segun `precioPorBulto` (ya re-preciado por `preciosPorGrupoBulto`). (AC-CBU-3)
`src/domain/stock.js`: `etiquetaSinStock(disponible) => 'Sin stock — por recibir' | null` (≤ 0). (AC-SST2-1)
`src/domain/edicionPedido.js` (nuevo; AC-EDP-2/3)
- `armadoEmpezado(pedido) => boolean` (armado true o armadoLog con confirmados/removidos/cambios).
- `renglonesCambiados(antes, despues) => { agregados, quitados, cambiados }` (usa `cambiosDeCantidad`).
- `aplicarEdicion(original, { items, total, observaciones }, { usuario, now }) => pedido` — whitelist de campos (el vendedor no cambia vendedor/estado/precios congelados de renglones existentes); mismo `id/remoteId/clientUuid`; `baseRemoteUpdatedAt = original.remoteUpdatedAt`; si `armadoEmpezado` ⇒ `modificadoTrasArmado` (union de productoIds si ya habia marca).
- `confirmarModificacion(pedido, usuario, now) => pedido` (marca = null).
- `hayConflictoVersion(base, actual) => boolean` — compara `Date.parse`; base null ⇒ false (legacy).
- `modificadoToRemote(p)` / `modificadoFromRemote(r, local)` (tolerante + saneo: ≤500 ids, ≤64 chars).
`src/domain/vendedorPedido.js` (nuevo; AC-ASV-1/2)
- `vendedorDelPedido(p) => string|null` ('' / 'WEB' ⇒ null); `esSinVendedor(p)`.
- `datosVendedorAlCrear({ vendedorActual, elegido, vendedores }) => { ok, error, campos:{ vendedor, vendedorNombre, vendedorId, cargadoPor, cargadoPorId } }` — elegido tiene que estar en `filtrarActivos`; default = el actual.
- `asignarVendedor(pedido, vendedor, { usuario, now }) => pedido` (+ zona del vendedor como hoy en ListaPedidos).
- `vendedorToRemote(p)` / `vendedorFromRemote(r, local)` / `sinColumnas024(row)` / `nombraColumna024(error)`.
`src/domain/pedidosPendientes.js` (nuevo; AC-PEN-1)
- `pedidosPendientesVisibles(pedidos, hoy) => Array<{ pedido, fecha, dias, etiqueta }>` — no borrados, no facturados, fecha ≠ hoy (los de hoy ya estan en la lista), excluye web no aceptados (viven en la bandeja), dedupe por remoteId/id, orden por fecha asc; `dias` (+ futuro / − vencido), etiqueta "Faltan N dias" / "Hace N dias" / "Sin fecha".
`src/domain/comisiones.js` (AC-ASV-1/2)
- `asignacionPorDefecto`: si el pedido tiene `cargadoPor` (vendedor elegido explicito) y su dueno es valido ⇒ `{modo:'cargador'}` 100 % al dueno (`pedido.vendedor`); web sin vendedor ⇒ `{modo:'sin_comision'}` y linea con `sinVendedorWeb:true`; resto como hoy (ficha).
- `calcularAvisos`: nuevo contador `(e) pedido sin vendedor`; aviso (a) sigue igual (dueno ≠ ficha).
- `calcularAjustesPendientes`: linea cerrada con `sinVendedorWeb` y pedido hoy con vendedor ⇒ ajuste `motivo:'vendedor_asignado'` (AC-COM-13).
`src/domain/tienda.js`: `pasoUnidades` por debajo del bulto usa `pasoMinimo`; `validarRenglon` agrega `esCantidadValidaMinimo` (mismo texto que el servidor).

## 3. Archivos en orden
### Bloque A — dominio + permisos + migracion + EDP/ASV/PEN (primero; B arranca con A mergeado)
| # | Archivo | REQ/AC |
|---|---|---|
| A1 | `supabase/migrations/024_pedidos_edicion_vendedor.sql` | EDP-2/3, ASV-1, PEN-1, MUL-2 |
| A2 | `src/domain/{permisos,minimos,unidadVenta,bultos,stock}.js` + nuevos `casilleros.js`, `edicionPedido.js`, `vendedorPedido.js`, `pedidosPendientes.js` | todos (seccion 2) |
| A3 | `src/domain/comisiones.js`, `src/domain/tienda.js` | ASV-1/2, MUL-2 |
| A4 | `src/services/pedidoRepository.js`: `toRemoteRow` + `vendedorToRemote`/`modificadoToRemote`; fallback 024 junto al de 011/003; `guardarPedidoOnlineFirst(p, { versionBase })` = update condicional `.eq('id').eq('updated_at', versionBase).select('id,updated_at')` (0 filas ⇒ `{ mode:'conflicto' }`, revierte local); nuevos `editarPedidoOnlineFirst(original, cambios)`, `asignarVendedorOnlineFirst`, `confirmarModificacionOnlineFirst`, `resolverConflictoEdicion(pedido, 'servidor'|'mia')` | EDP-1/2/3, ASV |
| A5 | `src/sync/syncService.js`: `mapPedidoRemoto` guarda `remoteUpdatedAt` + `vendedorFromRemote` + `modificadoFromRemote`; `pedidoToRemoteRow` igual que A4; `syncPedidosPendientes`: si `baseRemoteUpdatedAt` ⇒ update condicional, 0 filas ⇒ `conflictoEdicion` y sigue con los demas (no throw, no limpia pendingSync); despues de subir guarda `remoteUpdatedAt` y borra la base; nuevo `pullPedidosPendientes({ vendedorNombre, zona })` paginado (2 queries `vendedor`/`cargado_por` y merge; sin 024 solo `vendedor`) | EDP-3, PEN-1, ASV-1 |
| A6 | `src/App.js`: estado `pedidoAEditar`; `ListaPedidos onEditar`, `NuevoPedido pedidoEditarId/onFinEdicion` | EDP-1 |
| A7 | `src/pages/NuevoPedido.js` **solo el componente principal** (no `ItemRow` ni la lista de sugerencias): modo edicion (carga el pedido; online refresca del remoto para tener base fresca; sin borrador de localStorage), guardar via `editarPedidoOnlineFirst`, aviso de conflicto + recarga; selector "Vendedor del pedido" (admin y vendedor, `filtrarActivos`) | EDP-1/3, ASV-1 |
| A8 | `src/pages/ListaPedidos.js`: boton "Editar" segun `puedeEditarPedido`; filtro de vendedor = dueno o `cargadoPor`; bloque "Pendientes" (`pedidosPendientesVisibles` + `pullPedidosPendientes` al abrir en hoy); selector de vendedor admin para cualquier pedido (generaliza el bloque 'WEB'); badge "Sin vendedor"/"Modificado"/"Conflicto" con botones "Usar la del servidor" / "Subir la mia igual" | EDP-1/3, ASV-2, PEN-1 |
| A9 | `src/pages/PedidosWeb.js`: badge "Sin vendedor"; selector pre-cargado (link/ficha) que el admin puede cambiar al aceptar | ASV-2 |
| A10 | `src/pages/Comisiones.js`: mostrar aviso (e) y motivo 'vendedor_asignado' | ASV-2 |

### Bloque B — UI de bultos/multiplos/sin stock/minimos en Armado (despues de A)
| # | Archivo | REQ/AC |
|---|---|---|
| B1 | `src/components/BultoControl.js`: casillero "Bultos" (contador de `partirBultos` + `+`/`−`); conserva `data-testid` `bulto-mas`/`bulto-menos`/`bulto-desglose` y props actuales (Facturacion/Armado lo siguen usando igual) | CBU-2 |
| B2 | `src/pages/NuevoPedido.js` (`ItemRow`, handlers de cantidad, lista de sugerencias): casillero "Unidades sueltas" = el `.qty-control` actual (mismo orden de `.qty-btn` que esperan los tests) via `cambiarCasillero`; tipeo ⇒ `ajustarAMultiploMinimo` con aviso; `precioVigenteRenglon`; en sugerencias botones "Unidad $X"/"Bulto xN $Y" (`botonesProductoLista`, `agregarBultoDesdeLista`) y "Sin stock — por recibir"; guardar valida `validarMultiplosMinimoItems` | CBU-1/2/3, MUL-1/2, SST2-1 |
| B3 | `src/pages/Armado.js`: `cantidadConPasoMinimo`; admin bajo minimo/fuera de multiplo ⇒ `window.confirm`, vendedor/armador ⇒ error en renglon y no guarda; banner "Modificado" + resalta `productoIds` + boton "Confirmar cambios" (`confirmarModificacionOnlineFirst`); `guardarArmado` pasa `versionBase: armando.remoteUpdatedAt` | MIN2-1, MUL-2, EDP-2/3 |
| B4 | `src/pages/Facturacion.js`: `cantidadConPasoMinimo`; admin puede dejar cualquier cantidad con confirmacion (ya existe para minimo; sumar multiplo); "Sin stock — por recibir" en el renglon | MUL-2, SST2-1 |
| B5 | `src/tienda/Carrito.js`, `DetalleProducto.js`: solo si el paso no sale de `pasoUnidades` (verificar; hoy lo usan) | MUL-2 |

## 4. Concurrencia offline / multidispositivo
- **Mismo pedido, no duplicado (EDP-3)**: la edicion reutiliza `id`, `remoteId` y `clientUuid`; nunca llama a `crearPedidoOnlineFirst`. Un pedido editado que aun no subio su alta sigue yendo por el upsert idempotente de AC-SEG2-3.
- **No pisar en silencio (EDP-3)**: version = `updated_at` del SERVIDOR (trigger 024). Al abrir el editor (online) se refresca la fila y se toma `remoteUpdatedAt` como base. Guardar = `update ... where id = X and updated_at = base` (atomico, sin ventana de carrera). 0 filas ⇒ conflicto: online se avisa "El pedido cambio en otro dispositivo, se recargo" y se recarga el editor con la version remota; offline queda `pendingSync` con `conflictoEdicion` y la Lista ofrece elegir. Nunca se resuelve solo.
- Pull: `putPedidosRemotosSinPisarLocales` ya saltea locales `synced:false` (la edicion offline no se pisa).
- Armado vs vendedor: `guardarArmado` usa la misma guarda (B3) para no borrar renglones que agrego el vendedor mientras se armaba.
- Sin 024: sin trigger el `updated_at` lo sigue poniendo el cliente (la guarda igual funciona porque compara el valor guardado); sin columnas nuevas, fallback `sinColumnas024` y los campos quedan locales (como 003/011).
- Legacy sin `remoteUpdatedAt` y offline ⇒ base null ⇒ ultimo que escribe gana (comportamiento de hoy); documentado.
- Pendientes de otras fechas: `pullPedidosPendientes` paginado; no borra nada local que no venga (no hay limpieza nueva).
- Stock: la edicion del vendedor es siempre de no facturados ⇒ `aplicarStockPedido` no genera movimientos; facturado solo admin por Facturacion (ajusta la diferencia en el ledger, AC-STK-4). Nunca se sincroniza un numero de stock.
- Web no aceptado: el trigger 008 ignora updates; la asignacion de vendedor de esos pedidos solo se hace al aceptar en la bandeja (RPC).

## 5. Decisiones de seguridad (autorizadas, lo mas simple)
- S1 `cargado_por`/`vendedor_id` los declara el cliente (no hay Auth real, S-1110-01 fuera de alcance). Mitigacion: el vendedor solo elige dueno al CREAR; despues solo el admin reasigna; Comisiones muestra "cargado por X a nombre de Y" como aviso (a) para revision.
- S2 Edicion del vendedor con whitelist (`items`, `total`, `observaciones`); precios de renglones existentes congelados; renglones nuevos con precio vigente; no puede editar precio (igual que NuevoPedido).
- S3 Checks de largo/tamano en las columnas nuevas; `modificado_tras_armado` se sanea al bajar.
- S4 `tienda_crear_pedido` sigue `security definer` con mismos grants; la regla de multiplos vive en un helper `immutable` testeado contra el espejo JS.
- S5 Sin DELETE nuevos; 024 no revoca ni amplia permisos existentes.

## 6. Supuestos
1. "Sus pedidos" (EDP-1) = dueno (`vendedor`) o quien lo cargo (`cargadoPor`).
2. Multiplo del minimo con bulto: valido si las sueltas son multiplo de m (`(c % bultoX) % m = 0`) o el total lo es; el casillero de bultos no exige minimo (CBU-2).
3. "Precio bulto $Y" del renglon (CBU-3) = precio unitario aplicado con "c/u"; el boton de la lista (CBU-1) muestra el total del bulto.
4. REQ-ESC (citado en AC-CBU-3) no existe en el SPEC: se aplica solo PBU/GBU.
5. Casilleros (CBU) solo en Nuevo pedido/edicion; Facturacion y Armado siguen con `BultoControl` actual.
6. Pedido web con link de vendedor conserva ese vendedor; "Sin vendedor" = link general o 'WEB' legacy. Al aceptar, el selector viene pre-cargado (link/ficha) y el admin puede cambiarlo.
7. Web sin vendedor ⇒ 'sin_comision' por defecto (no bloquea el cierre, a diferencia de AC-COM-8) + aviso (e).
8. Pendientes excluye web no aceptados y los de la fecha de hoy (ya estan en la lista principal).

## 7. Plan de pruebas
| AC | Test | Tipo |
|---|---|---|
| EDP-1 | `domain/__tests__/permisos.editarPedido.test.js` (roles × estados × dueno/cargadoPor/ajeno/borrado/web) ; `pages/__tests__/ListaPedidos.editar.test.js` (boton visible/oculto) ; `NuevoPedido.edicion.test.js` (carga, mismas reglas) | unit + page |
| EDP-2 | `domain/__tests__/edicionPedido.test.js` (`armadoEmpezado`, `aplicarEdicion`, union de ids, `confirmarModificacion`) ; `pages/__tests__/Armado.modificado.test.js` (B) | unit + page |
| EDP-3 | `edicionPedido.test.js` (`hayConflictoVersion`) ; `services/__tests__/pedidoRepository.edicion.test.js` (mismo id/clientUuid, update condicional, 0 filas ⇒ conflicto y revierte, offline ⇒ pendingSync) ; `services/__tests__/syncPedidos.conflicto.test.js` | unit + service (mock supabase) |
| MUL-1/2 | `domain/__tests__/minimos.multiplos.test.js` (3→6→9, 7→10, convive con FRB-4, bordes m vacio/0/1/texto, bulto 10 + m 3) ; `tienda.carrito.test.js` ampliado ; `domain/__tests__/migracion024.sql.test.js` (helper + uso en `tienda_crear_pedido`, grants) ; `NuevoPedido.multiplos.test.js` (B) | unit + estatico + page |
| CBU-1/2/3 | `domain/__tests__/casilleros.test.js` (`partirBultos`/`juntarBultos`, pedidos viejos, BUL-9, "sumar bulto no suma minimo", botones, precio vigente) ; `NuevoPedido.casilleros.test.js` (B) | unit + page |
| SST2-1 | `stock.test.js` (`etiquetaSinStock`) ; `NuevoPedido.sinStock.test.js` (stock 0 y negativo aparece, se agrega, se guarda) ; `utils/__tests__/fuzzy.sinStock.test.js` (no filtra) | unit + page |
| MIN2-1 | `minimos.test.js`/`unidadVenta.test.js` por rol ; `precioMinimoStock.armado.test.js` + casos admin (confirm acepta/cancela) (B) | unit + page |
| ASV-1/2 | `domain/__tests__/vendedorPedido.test.js` ; `comisiones.asignacionVendedor.test.js` (default al dueno, web sin vendedor = 0 + aviso, ajuste 'vendedor_asignado') ; `NuevoPedido.vendedor.test.js` ; `PedidosWeb.test.js` ampliado | unit + page |
| PEN-1 | `domain/__tests__/pedidosPendientes.test.js` (futuro, vencido, borrados, facturados, sin fecha, dedupe) ; `ListaPedidos.pendientes.test.js` | unit + page |

Tests viejos que cambian (actualizar, no borrar; citar el AC nuevo):
- `domain/__tests__/minimos.test.js:48` `puedeGuardarBajoMinimo(1,'armado')` 'no' ⇒ 'confirmar' (AC-MIN2-1 modifica AC-MIN-2).
- `domain/__tests__/unidadVenta.test.js:162` `puedeGuardarNoMultiplo(1,'armado')` false ⇒ true; `:174` `bloquea` con permiso 1 en 'armado' true ⇒ false.
- `frb.pasoBulto.test.js`, `unidadVenta.test.js` (AC-FRB-4): NO cambian (`cantidadConPaso` intacto; el minimo entra por `cantidadConPasoMinimo`). Revisar los page tests de FRB-4 (`NuevoPedido.ventaPor.test.js`, `Facturacion.ventaPor.test.js`, `Armado.ventaPor.test.js`) solo si el producto tiene `minimoVenta > 1`.
- `bultos.pedido.test.js` (AC-BUL-1..9): deben seguir verdes con B1/B2 (mismos testids y `restarBulto`); si el casillero cambia textos, actualizar solo el selector.
- `precioMinimoStock.pedido.test.js`: depende del orden de `.qty-btn` y del primer `input[type=number]` (precio); B2 lo conserva.
- `ListaPedidos` tests con vendedor 'WEB' (bloque de asignacion generalizado) y `PedidosWeb.test.js` (selector pre-cargado).
Gates: `CI=true npx react-scripts test --watchAll=false`, `npx react-scripts build`, `node harness/gates/run-gates.mjs`.
