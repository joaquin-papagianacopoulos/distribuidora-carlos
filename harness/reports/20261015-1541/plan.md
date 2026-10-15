# Plan — RUN 20261015-1541 — REQ-INA, REQ-CPR, REQ-STB

Contexto: REQ-ING/REQ-STK (ledger), "Lote operación — principios", patrón PIN admin de 010/011.

## 0. Decisiones de seguridad (delegadas por el dueño)
| # | Decisión | Motivo |
|---|---|---|
| D1 | Los costos y el tipo A/B del ingreso NO van en `ingresos_mercaderia` (hoy `select/insert` abierto a anon, 001 l.157) ni dentro de su `items` jsonb. Van en tabla nueva `ingresos_costos` (1:1 por `ingreso_id`). | Cerrar `ingresos_mercaderia` rompería el pull de stock de vendedores/armadores. |
| D2 | `ingresoToRemote` pasa a **whitelistear** campos de `items` (`productoId, codigo, descripcion, stockActual, ingreso, stockTotal`). | Defensa en profundidad: aunque la UI meta `costoUnitario` en el renglón, nunca sale por anon. |
| D3 | Tablas `ingresos_costos`, `cuenta_proveedores`, `pedidos_proveedor`, `comprobantes_habilitados`: RLS on + `revoke all from public, anon, authenticated`. Acceso solo por RPC `security definer` que validan `_es_admin_con_pin` (011). | Mismo patrón que `pedidos_factura`. |
| D4 | Pedidos al proveedor también detrás de PIN (no contienen costos, pero revelan relación comercial y es pantalla admin). | Conservador; mismo RPC que la cuenta, costo cero extra. |
| D5 | Bucket Storage `comprobantes-proveedores` **privado** (`public=false`, 5 MB, `image/jpeg,image/png,image/webp,application/pdf`). Insert: policy que exige nombre habilitado por RPC con PIN (patrón `tienda_subida_habilitada` de 009, 10 min). Lectura: policy select que exige habilitación de lectura por RPC con PIN (2 min, ese path exacto); el cliente usa `download()` → blob → `URL.createObjectURL` (no se generan URLs compartibles). Sin policies update/delete. | Sin Edge Function ni service role en el cliente. Path con UUID del servidor (no adivinable). |
| D6 | El PIN nunca se persiste: se pide al subir/bajar/ver (como `facturacionService`). | AC-SEC-1. |
| D7 | Riesgo preexistente (fuera de alcance, se anota para el auditor): `productos.costo_final` es legible con anon (007 `grant select`). AC-INA-4 lo actualiza; no empeora la exposición, pero conviene una migración futura que lo mueva. | Transparencia. |
| D8 | `stock_minimo` no es sensible: columna en `productos`, escritura por `admin_guardar_productos` (007/010). | Reusar flujo existente. |

## 1. Modelo de datos

### IndexedDB — `DB_VERSION` 9 → 10 (solo se AGREGAN stores; nada se migra ni borra)
| Store | keyPath | Índices | Contenido |
|---|---|---|---|
| `ingresosCostos` | `id` (= id del ingreso, 1:1) | `proveedorId`, `fecha` | `{id, proveedorId, fecha, tipoCabecera:'A'\|'B', facturaA, facturaB, renglones:[{productoId, costoUnitario:number\|null, tipoFactura:'A'\|'B'}], usuario, updatedAt, pendingSync}` |
| `cuentaProveedores` | `id` UUID | `proveedorId`, `fecha` | `{id, proveedorId, tipo:'cargo'\|'pago', fecha:'YYYY-MM-DD', montoCentavos:int>0, medio:'efectivo'\|'transferencia'\|'directa'\|null, referencia, clienteId?, pedidoId?, comprobantePath?, anulado:null\|{motivo, usuario, at}, usuario, creadoAt, updatedAt, pendingSync}` |
| `comprobantesPendientes` | `id` (= id del pago) | — | `{id, blob, mime, size}` cola local de adjuntos aún no subidos |
| `pedidosProveedor` | `id` UUID | `proveedorId`, `estado` | `{id, proveedorId, estado:'borrador'\|'enviado'\|'recibido', items:[{productoId, cantidad:int, unidad:'u'\|'bulto', bultoX}], ingresoId?, usuario, creadoAt, updatedAt, pendingSync}` |

- Las **compras** de la cuenta NO se guardan como filas: se derivan de `ingresosCostos` (Σ costo×ingreso) en dominio. Evita duplicados/inconsistencias y cumple "se cargan solas" (AC-CPR-1).
- `productos`: campo nuevo `stockMinimo` (sin store nuevo; default `null`).
- `ingresos` (store existente): sin cambios de forma (AC-INA-5).

### Supabase — `supabase/migrations/012_lote_operacion_compras_stock.sql` (idempotente, sin drop)
| Objeto | Detalle |
|---|---|
| `productos.stock_minimo integer null check (>=0)` | + `create or replace admin_guardar_productos` = cuerpo de 010 + `stock_minimo` (si la clave no viene, conserva el valor) |
| `ingresos_costos(ingreso_id uuid pk references ingresos_mercaderia(id), proveedor_id, fecha timestamptz, tipo_cabecera, factura_a, factura_b, renglones jsonb (tope tamaño), updated_at, updated_by)` | checks `tipo in ('A','B')`, costo ≥ 0 validado en RPC |
| `cuenta_proveedores(id uuid pk, proveedor_id, tipo, fecha date, monto_centavos bigint >0, medio, referencia, cliente_id, pedido_id, comprobante_path, anulado_motivo, anulado_por, anulado_at, usuario, creado_at, updated_at)` | trigger: inmutable salvo transición `anulado_at null → no null` (una vez) |
| `pedidos_proveedor(id uuid pk, proveedor_id, estado, items jsonb, ingreso_id, usuario, creado_at, updated_at)` | LWW por `updated_at`; `recibido` no retrocede |
| `comprobantes_habilitados(nombre text pk, modo 'subir'\|'leer', expira_at)` | cerrada; limpieza de vencidos en cada RPC |
| bucket `comprobantes-proveedores` | ver D5; policies `comprob_insert_habilitado`, `comprob_select_habilitado` |
| RPC `admin_compras_guardar(p_admin_id, p_admin_pin, p_lote jsonb)` | `p_lote = {costos:[], cuenta:[], pedidos:[]}` ≤ 500 filas; valida todo server-side; devuelve `{ok, guardados:{costos,cuenta,pedidos}, rechazados:[{id,motivo}]}`; reloj tope `now()+5min` (S-011-04) |
| RPC `admin_compras_bajar(p_admin_id, p_admin_pin, p_desde timestamptz)` | devuelve las 3 tablas con `updated_at > p_desde` (paginado 1000) |
| RPC `admin_comprobante_subida(id, pin, p_pago_id uuid, p_ext)` → `{ok, nombre}` | nombre `<proveedor>/<pago>-<uuid>.<ext>` |
| RPC `admin_comprobante_lectura(id, pin, p_nombre)` → `{ok}` | habilita 2 min |
| Grants | `execute` a anon/authenticated solo de las 4 RPC + funciones de policy (que devuelven boolean) |

### Mapeo UI → interno → remoto
| UI | Interno | Remoto |
|---|---|---|
| Costo unitario (renglón ingreso) | `ingresosCostos.renglones[].costoUnitario` | `ingresos_costos.renglones[].costo_unitario` |
| Factura A / Factura B (cabecera / renglón) | `tipoCabecera` / `renglones[].tipoFactura` | `tipo_cabecera` / `renglones[].tipo_factura` |
| N.º factura A / B | `facturaA` / `facturaB` | `factura_a` / `factura_b` |
| Actualizar costo del producto (tilde) | flag efímero del form, no se guarda | — (va por `productos.costo_final` vía `admin_guardar_productos`) |
| Monto / Medio / Referencia / Cliente-pedido | `montoCentavos` / `medio` / `referencia` / `clienteId,pedidoId` | `monto_centavos` / `medio` / `referencia` / `cliente_id,pedido_id` |
| Comprobante | `comprobantePath` (+ blob en `comprobantesPendientes`) | `comprobante_path` + objeto en bucket |
| Stock mínimo | `stockMinimo` | `stock_minimo` |

## 2. Archivos (en orden)
1. `supabase/migrations/012_lote_operacion_compras_stock.sql` — REQ-INA, REQ-CPR, REQ-STB(AC-STB-1). Prerrequisito: 011 (`_es_admin_con_pin`).
2. `src/domain/compras.js` (nuevo) — REQ-INA: costos del ingreso, subtotales A/B, filtros historial, mapeos remoto.
3. `src/domain/cuentaProveedores.js` (nuevo) — REQ-CPR AC-1/2/3/5: validación de pagos/cargos, saldos, anulación, mapeos.
4. `src/domain/pedidosProveedor.js` (nuevo) — REQ-CPR AC-4: armado, bultos→unidades, transición de estado, precarga de ingreso.
5. `src/domain/stockBajo.js` (nuevo) — REQ-STB: estado de stock, búsqueda, filtros, contador. `domain/stock.js#productosStockBajo` pasa a delegar en `umbralStock` (misma firma, AC-STK-7 intacto).
6. `src/domain/stock.js` — REQ-INA AC-5: `ingresoToRemote` con whitelist de `items` (D2); `validarIngreso` sin cambios de contrato.
7. `src/domain/productos.js` — REQ-STB AC-1: campo `stockMinimo` (entero ≥0 o vacío) en form/validación/`toRemote`/`fromRemote` (default `null`).
8. `src/db/index.js` — v10: 4 stores nuevos; `addIngresoCompleto(ingreso, costos, movimientos)` en una sola transacción (`ingresos`,`ingresosCostos`,`movimientosStock`); getters/put/clearPending de los stores nuevos.
9. `src/services/stockService.js` — REQ-INA AC-1/4/5: `registrarIngreso` acepta costos opcionales; si tilde "actualizar costo", llama `updateProducto` (que ya registra `cambiosPrecio`, AC-HPR-1) con `costoFinal` nuevo y precio recalculado por `calcularPrecioVenta`; producto queda `pendingSync` (sube con el flujo de productos).
10. `src/services/comprasService.js` (nuevo) — REQ-INA/CPR: `subirCompras(cred)`, `bajarCompras(cred)`, `subirComprobantes(cred)`, `verComprobante(cred, path)`, `sondearMigracion012()`. Patrón `facturacionService`.
11. `src/utils/pdfGen.js` — `generarIngresosFile`, `generarEstadoCuentaFile`, `generarPedidoProveedorFile` (REQ-INA AC-3, REQ-CPR AC-3/4).
12. `src/components/ProductoForm` (o el que corresponda vía `CAMPOS`) — campo "Stock mínimo" (AC-STB-1). Plantilla Excel: columna opcional "Stock mínimo" (aditivo).
13. `src/pages/Stock.js` — REQ-INA (renglón costo + A/B, subtotales, historial filtrable/PDF), REQ-STB AC-2/3 (buscador, filtros, contador, lista de bajos + "Agregar al pedido al proveedor"). Si supera ~400 líneas, extraer `src/pages/stock/IngresoMercaderia.js` y `HistorialIngresos.js`.
14. `src/pages/Proveedores.js` (nuevo, solo admin) — REQ-CPR: cuenta corriente, pago/cargo, anular, comprobante, pedidos al proveedor (borrador → compartir con `shareFiles` → recibido abre Ingreso precargado).
15. `src/App.js` — pestaña "Proveedores" (admin) y badge contador de stock bajo en pestaña Stock (AC-STB-3, AC-SEC-4).
16. Tests (sección 5).

## 3. Funciones puras de dominio (firmas + contrato)
`src/domain/compras.js`
- `normalizarTipoAB(v) → 'A'|'B'|null`.
- `validarCostosIngreso(form, {ingreso}) → {ok, errores, costos|null}` — costo vacío ⇒ `null`; si no, ≥0 y ≤ MAX_IMPORTE, 2 decimales; tipo de renglón default = cabecera; `facturaA/B` texto ≤40. Si ningún renglón tiene costo ni A/B explícito ⇒ igual devuelve registro (el tipo A/B es dato). Errores por `item:<productoId>`.
- `subtotalesIngreso(ingreso, costos|null) → {A:{unidades, costoCentavos}, B:{…}, sinDato:{unidades}, total:{unidades, costoCentavos}}` (AC-INA-2, AC-INA-5).
- `filtrarHistorial(ingresos, costosById, {proveedorId, desde, hasta, tipo:'A'|'B'|'todas'}) → filas` + `totalesHistorial(filas) → {A, B, sinDato, total}` (AC-INA-3).
- `ingresosPorProducto(ingresos, costosById, productoId) → [{fecha, factura, tipo, unidades, costoUnitario}]` (AC-INA-3).
- `costoProductoDesdeIngreso(producto, costoUnitario) → {costoFinal, precio}|null` — null si costo vacío o igual al actual (AC-INA-4).
- `costosToRemote(c)` / `costosFromRemote(r)`; `comprasDeIngresos(costos) → [{id:ingresoId, proveedorId, fecha, tipo:'compra', montoCentavos}]` (solo renglones con costo).

`src/domain/cuentaProveedores.js`
- `MEDIOS_PAGO = ['efectivo','transferencia','directa']`; `aCentavos(v) → int|null`.
- `validarMovimientoCuenta(form, {tipo, proveedores, clientes, now, genId, usuario}) → {ok, errores, mov}` — monto >0, fecha ISO, medio obligatorio en pago, cliente/pedido solo si `directa`.
- `validarAdjunto({size, type}) → {ok, error}` — ≤5 MB y MIME permitido (AC-CPR-2).
- `anularMovimiento(mov, {motivo, usuario, now}) → {ok, error, mov}` — motivo obligatorio; ya anulado ⇒ error; compras derivadas no se anulan.
- `estadoDeCuenta(compras, movs, {desde, hasta, medio}) → {filas:[…con saldoAcumulado], saldoInicial, saldoFinal, totalesPorMedio, totalAnulados}` — orden fecha+creadoAt+id, anulados visibles pero fuera del saldo, todo en centavos enteros (AC-CPR-3/5).
- `saldoProveedor(compras, movs) → centavos` (puede ser negativo = saldo a favor).
- `movCuentaToRemote` / `movCuentaFromRemote`.

`src/domain/pedidosProveedor.js`
- `nuevoPedidoProveedor(proveedorId, {usuario, now, genId})`; `agregarItems(pedido, items) → pedido` (suma si repite producto; cantidad entera >0).
- `unidadesItem(item) → int` (bulto × bultoX; bultoX ≤1 ⇒ unidades).
- `marcarRecibido(pedido, {now}) → {ok, pedido, formIngreso:{proveedorId, items:[{productoId, ingreso}]}}` — solo desde borrador/enviado; idempotente.
- `pedidoProveedorToRemote` / `FromRemote`; `textoCompartirPedido(pedido, productos, proveedor) → string`.

`src/domain/stockBajo.js`
- `umbralStock(producto) → number` — `stockMinimo` si es número ≥0 cargado; si no `minimoVenta || 0` (AC-STB-1).
- `estadoStock(producto, stock) → 'negativo'|'sin_stock'|'bajo'|'ok'` (stock<0; =0; ≤umbral; resto).
- `buscarProductos(productos, query) → productos` — normaliza (NFD, minúsculas), cada palabra debe aparecer en nombre/código/marca, orden libre (AC-STB-2).
- `filtrarStock(productos, stockMap, {query, rubro, marca, proveedorId, estado}) → filas`.
- `contarStockBajo(productos, stockMap) → int` — cuenta `bajo`+`sin_stock`+`negativo` (supuesto S4).
- `stockBajoDeProveedor(productos, stockMap, proveedorId) → [{productoId, sugerido}]` — sugerido = max(umbral − stock, 1), redondeado a bulto si `bultoX>1` (reusa `domain/bultos`).

## 4. Concurrencia offline / multidispositivo
| Riesgo | Mitigación |
|---|---|
| Ingreso con costo hecho offline | Una transacción IDB graba ingreso + costos + movimientos. Ingreso/movimientos suben por `syncStock` (anon, sin costos). Costos quedan `pendingSync` y suben con `subirCompras(cred)` cuando el admin pone el PIN (botón "Subir datos de compras (N pendientes)" en Proveedores/Stock, como Facturación). |
| `ingresos_costos` subido antes que la cabecera | RPC rechaza con `ingreso_inexistente` y queda pendiente (no se limpia); se reintenta después de `syncStock`. El servicio llama primero `syncStock` y luego la RPC. |
| Reintentos / doble subida | Todo upsert por UUID; `ingresos_costos` pk = `ingreso_id`. Se limpia `pendingSync` SOLO de los ids confirmados y cuyo `updatedAt` no cambió durante la subida (patrón `subirTiposFactura`). |
| Dos dispositivos editan el mismo pedido al proveedor | LWW por `updated_at` (tope reloj +5 min); `recibido` es terminal (el servidor no lo retrocede). Marcar recibido dos veces no crea dos ingresos: el ingreso precargado se confirma a mano y AC-ING-4 bloquea la misma factura. |
| Anular en dos dispositivos | Transición única en servidor (primera gana; la segunda se confirma como ya resuelta). Pagos nunca se editan ni borran: corrección = anular + cargar nuevo. |
| Pull pisa cambios locales | `mergeRemotos`: no se pisan filas con `pendingSync`. Cursor por `updated_at` con solape de 5 min, guardado en `localStorage` (`comprasSyncCursor`). |
| Comprobante offline | Blob en `comprobantesPendientes`; el pago sube sin `comprobantePath`; luego `subirComprobantes(cred)`: pide nombre → `upload` → upsert del pago con path → recién ahí borra el blob local (ya está en Storage). Falla a mitad ⇒ el nombre vence y se pide otro (objeto huérfano privado, inocuo). |
| Stock | Sin cambios: solo movimientos `ingreso` por UUID (AC-ING-5/AC-STK-8). Nada sincroniza un número de stock; `stockMinimo` es un umbral, no stock. |
| Falta la migración 012 | `sondearMigracion012()`; todo sigue local con aviso "Falta la migración 012"; el pull de `ingresos_mercaderia` no cambia. |

## 5. Plan de pruebas
| AC | Tipo | Archivo |
|---|---|---|
| AC-INA-1, 2, 5 | unit dominio (costo vacío/0/negativo/decimales, A/B mixto, default cabecera, ingreso viejo sin costos ⇒ "sin dato") | `src/domain/__tests__/compras.test.js` |
| AC-INA-1 / D2 | unit: `ingresoToRemote` nunca emite `costoUnitario`/`tipoFactura` en `items` | `src/domain/__tests__/stock.test.js` (agregar) |
| AC-INA-3 | unit filtros/totales A vs B/por producto + smoke PDF (mock jsPDF) | `compras.test.js`, `src/utils/__tests__/pdfGen.compras.test.js` |
| AC-INA-4 | servicio con IDB fake: tilde sí ⇒ `costoFinal` + `cambiosPrecio`; tilde no / costo igual ⇒ nada | `src/services/__tests__/stockService.ingresoCostos.test.js` |
| AC-INA-5, AC-ING-5 | regresión: movimientos idénticos con y sin costos | idem |
| AC-CPR-1, 3, 5 | unit saldos (centavos, negativo, anulados, orden, totales por medio, filtros) | `src/domain/__tests__/cuentaProveedores.test.js` |
| AC-CPR-2 | unit validación pago/medio/directa + adjunto 5 MB/MIME | idem |
| AC-CPR-4 | unit pedido (bultos, repetidos, recibido idempotente, precarga) + RTL: recibido abre Ingreso precargado | `pedidosProveedor.test.js`, `src/pages/__tests__/proveedores.test.js` |
| Sync/PIN (CPR, INA) | servicio con supabase mock: sin cred ⇒ skipped; limpia solo confirmados; falta 012; reintento sin duplicar; PIN no se loguea | `src/services/__tests__/comprasService.test.js` |
| AC-STB-1 | unit `umbralStock` (vacío/0/número) + `productos.js` round-trip remoto | `stockBajo.test.js`, `productos.test.js` |
| AC-STB-2 | unit búsqueda (tildes, mayúsculas, orden de palabras, código, marca) y filtros por estado | `stockBajo.test.js` |
| AC-STB-3 | RTL: badge en pestaña Stock y contador en pantalla; botón agrega al borrador del proveedor | `src/pages/__tests__/stock.stockBajo.test.js` |
| AC-SEC-4/5 | test estático de la 012: RLS on + revoke en tablas nuevas, bucket `public=false`, sin policy update/delete, RPC con `_es_admin_con_pin`, grants solo de execute | `src/__tests__/security.migracion.test.js` (agregar) |
| AC-STK-7 | regresión: `productosStockBajo` igual que antes sin `stockMinimo` | `stock.test.js` |

## 6. Supuestos (opción conservadora)
- S1 "Factura proveedor" sigue obligatoria y es la clave de AC-ING-4; los n.º A y B son opcionales y extra (si se carga solo A/B, la UI sugiere copiarlo a "Factura proveedor").
- S2 Costo unitario es sin IVA tal como lo carga el admin; la app no calcula impuestos.
- S3 Compras de la cuenta = Σ (ingreso × costoUnitario) de renglones con costo; renglones sin costo no suman (se muestra "N renglones sin costo").
- S4 "Stock bajo" del contador incluye sin stock y negativo (estado ≤ umbral). Con umbral 0 y stock 0 cuenta como "sin stock".
- S5 Cargos manuales = tipo `cargo` (compra sin ingreso). No hay edición: se anula y se recarga.
- S6 Ver/compartir datos de la cuenta y el historial con costos de otros dispositivos requiere conexión + PIN (`bajarCompras`); offline se ve lo local.
- S7 La cantidad pedida al proveedor es entero; en bultos se convierte a unidades al precargar el Ingreso.
- S8 Vendedores/armadores no ven Proveedores ni costos; Stock sigue solo admin (App.js actual).
