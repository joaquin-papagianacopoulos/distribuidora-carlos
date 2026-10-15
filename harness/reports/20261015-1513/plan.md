# Plan — RUN 20261015-1513 (REQ-FAB, REQ-AGR, REQ-TRQ, REQ-ZON)

Base: SPEC "Decisiones", "Lote operación — principios", AC-FAB-1..4, AC-AGR-1..4, AC-TRQ-1, AC-ZON-1..4.
Ningún REQ de este lote toca stock: no se crean ni modifican movimientos (`movimientosStock`).

## 1. Decisiones de seguridad (delegadas por el dueño, a validar por el auditor)
| # | Dato | Decisión | Por qué |
|---|---|---|---|
| S1 | `tipo_factura` (A/B/sin factura) | **No** va como columna de `pedidos` (que se lee/escribe con anon). Tabla nueva `pedidos_factura` con RLS activo, `revoke all` a anon/authenticated, acceso solo por RPC `security definer` con PIN de admin (patrón 007/010). Localmente sí vive en el pedido (`pedido.tipoFactura`). | El principio del lote pide que "facturación A/B" no sea legible/escribible con anon. Desvío consciente de la pista "columnas en el pedido": el nombre de columna `tipo_factura` de AC-FAB-1 se respeta, pero en la tabla lateral. |
| S2 | `grupos` | Columna `pedidos.grupos jsonb` (pista del caller). | Es presentación (nombres + ids de renglones), sin montos propios ni datos fiscales. Se sanea al leer (dato no confiable: cualquier dispositivo con anon puede escribir `pedidos`). |
| S3 | Reporte "Facturas a emitir" (CUIT) | Pantalla solo admin (tab oculto + guard en la página). Datos por RPC `admin_facturas_a_emitir` con PIN; el PIN no se guarda ni se loguea; nombre del PDF sin CUIT; nada de `console.*` con filas. | AC-FAB-3 + pedido del caller. |
| S4 | `clientes.orden_zona` | Columna común (como `orden_entrega`), editable por cualquier usuario como hoy. | No es dato financiero; AC-ZON-1 no restringe rol. |
| S5 | Riesgo residual | `clientes.cuit`/`tipo_iva` ya son legibles con anon hoy (fuera de alcance). Se anota para el auditor; no se amplía la exposición. | — |

## 2. Modelo de datos

### IndexedDB
- **`DB_VERSION` se queda en 9**: no hay stores ni índices nuevos. Todo son campos opcionales en registros existentes (registros viejos sin el campo ⇒ defaults).
- `pedidos` (campos nuevos, opcionales):
  - `tipoFactura`: `'A' | 'B' | 'ninguna' | undefined` (undefined = sin confirmar, se muestra la sugerencia).
  - `tipoFacturaAt` (ms, para last-write-wins) y `tipoFacturaPendiente: bool` (equivale a `pendingSync` del dato A/B; se limpia SOLO para los ids que la RPC confirmó).
  - `grupos`: `[{ id: uuid, nombre: string, itemIds: string[] }] | undefined`.
- `clientes`: `ordenZona: number | null` (se sube con el `pendingSync` que ya existe).

### Supabase — migración `supabase/migrations/011_lote_operacion_facturacion_zonas.sql`
Idempotente (`if not exists`, `create or replace`), sin `drop`; prerrequisitos: `verificar_pin(text,text)` (002) y 010.
1. `alter table pedidos add column if not exists grupos jsonb` (null por defecto).
2. `alter table clientes add column if not exists orden_zona integer` + check `> 0` + **inicialización (AC-ZON-3)**: `update ... set orden_zona = row_number() over (partition by clave de zona order by índice del día lunes..domingo, orden_entrega, nombre, id) where orden_zona is null` — solo en la primera corrida (si no existe ningún `orden_zona` no nulo). No toca `dia_entrega`/`orden_entrega`.
3. Tabla `pedidos_factura(pedido_id <mismo tipo que pedidos.id> primary key, tipo_factura text not null check in ('A','B','ninguna'), updated_at timestamptz not null, updated_by text)`. Sin FK con cascade (los pedidos se "borran" por estado; no se arrastran datos). RLS on, `revoke all ... from public, anon, authenticated`.
4. RPC `admin_guardar_tipos_factura(p_admin_id text, p_admin_pin text, p_filas jsonb) returns jsonb` — upsert por `pedido_id` solo si `excluded.updated_at >= actual.updated_at`; devuelve `{ok, guardados:[ids], rechazados:[{id,motivo}]}`; tope 500 filas.
5. RPC `admin_facturas_a_emitir(p_admin_id text, p_admin_pin text, p_desde date, p_hasta date) returns jsonb` — join `pedidos` (estado `facturado`) + `clientes` (cuit, tipo_iva, nombre) + `pedidos_factura` (left join); rango máx. 366 días.
6. `revoke all on function ... from public; grant execute ... to anon, authenticated` (el PIN es la barrera, como 007/010).

### Mapeo UI → interno → remoto
| UI | Interno | Remoto |
|---|---|---|
| Selector "Factura A / Factura B / Sin factura" | `pedido.tipoFactura` (`'A'`/`'B'`/`'ninguna'`) | `pedidos_factura.tipo_factura` (vía RPC; `pedido_id` = `pedido.remoteId`) |
| "Agrupar" (nombre editable) | `pedido.grupos[].nombre/itemIds` | `pedidos.grupos` (jsonb) |
| Clave de renglón | `claveRenglon(item)` = `String(item.productoId ?? item.nombre)` | dentro de `grupos[].itemIds` |
| Zona (de la ficha) | `cliente.zona` (ya existe) | `clientes.zona` (ya existe) |
| Puesto en la zona | `cliente.ordenZona` | `clientes.orden_zona` |
| (legacy, oculto) | `diaEntrega` / `ordenEntrega` | `dia_entrega` / `orden_entrega` (se siguen subiendo tal cual) |

Nota: `pedidos.zona` existente es la zona del **vendedor**; REQ-ZON usa `cliente.zona`. No mezclar.

## 3. Funciones puras de dominio (`src/domain/`)

### `facturacionAB.js` (REQ-FAB)
- `TIPOS_FACTURA = ['A','B','ninguna']`, `ETIQUETA_TIPO_FACTURA`.
- `sugerirTipoFactura(cliente) -> 'A'|'B'|'ninguna'` — RI ⇒ A; otro tipoIva no vacío ⇒ B; vacío/null ⇒ ninguna (AC-FAB-1).
- `tipoFacturaEfectivo(pedido, cliente) -> {tipo, sugerido: bool}` — guardado si es válido; si no, sugerencia.
- `normalizarTipoFactura(v) -> tipo | null` — rechaza cualquier otro valor.
- `marcarTipoFactura(pedidos, ids, tipo, now) -> pedidos[]` — masivo; setea `tipoFacturaAt` y `tipoFacturaPendiente`; no toca items/estado (AC-FAB-1).
- `avisoFacturaA(tipo, cliente) -> string | null` — tipo A y `!validarCuit(cliente.cuit)` ⇒ aviso (AC-FAB-2; no bloquea).
- `filasTiposFacturaRpc(pedidos) -> [{pedido_id, tipo_factura, updated_at}]` — solo pendientes con `remoteId`.
- `interpretarGuardarTiposFactura({data,error}) -> {ok, guardados, rechazados, motivo}` (`falta_migracion`, `pin_incorrecto`, etc.).
- `armarReporteFacturas(filas, {desde, hasta, filtro:'A'|'B'|'todas'}) -> {grupos:[{tipo, filas, subtotal}], total}` — solo facturados no borrados dentro del rango, orden por fecha y n.º; `ninguna` queda fuera; marca filas sugeridas (AC-FAB-3).

### `gruposFactura.js` (REQ-AGR)
- `claveRenglon(item) -> string`.
- `sugerirNombreGrupo(items, productosById) -> string` — marca común (con `claveMarca`); si no, rubro común; si no, "Grupo".
- `crearGrupo(grupos, itemIds, nombre, idFn) -> grupos` — saca esos ids de otros grupos (un renglón en un solo grupo); ignora selección vacía.
- `renombrarGrupo(grupos, id, nombre)`, `deshacerGrupo(grupos, id)`.
- `normalizarGrupos(grupos, items) -> grupos` — saneo (máx. 50 grupos, nombre `texto(..,60)`), descarta itemIds que ya no existen y grupos que quedan vacíos (AC-AGR-4).
- `textoBultosGrupo(renglones) -> string` — si todos comparten `bultoX` válido y la suma es múltiplo: "3 bultos (36 u.)"; si no, "36 u." (bultos mixtos ⇒ solo unidades).
- `filasBoleta(items, grupos, {modo:'detalle'|'solo_grupos'}) -> [{tipo:'grupo'|'detalle'|'item', nombre, cantidadTexto, precioTexto, subtotal}]` — total = suma de items (nunca doble conteo); orden alfabético mezclando grupos y sueltos (AC-AGR-3).

### `boletaLayout.js` (REQ-TRQ, apoyo de AC-AGR-3/FAB-4)
- `layoutPieBoleta({finalY, pageH, hayDescuento, hayDeuda, hayObs}) -> {nuevaPagina: bool, totalesY, deudaY, obsY, corteY, casillas:[{label,y}], proveedorY}` — garantiza que totales/deuda/obs terminen arriba de la línea de corte; si no entran ⇒ `nuevaPagina` (troquel solo en la última página). Casillas: Efectivo, Transferencia, **Transf. a proveedor** + línea "Proveedor: ________" (AC-TRQ-1).
- `encabezadoTipoFactura(tipo) -> 'FACTURA A' | 'FACTURA B' | null` (AC-FAB-4).

### `zonas.js` (REQ-ZON)
- `claveZona(z) -> string` — trim, colapsa espacios, minúsculas, sin tildes (`claveUnica`); vacío ⇒ `''` = "Sin zona".
- `listarZonas(clientes) -> [{clave, etiqueta, cantidad}]` — etiqueta = la variante más usada; "Sin zona" al final.
- `ordenLegacy(c)` — índice de `diaEntrega` (DIAS_SEMANA), luego `ordenEntrega`, luego nombre.
- `clientesDeZona(clientes, clave) -> clientes[]` ordenados: `ordenZona` válido primero (empates por nombre, luego id), después los sin `ordenZona` por `ordenLegacy` (inicialización perezosa local, AC-ZON-3).
- `moverEnZona(clientes, clave, clienteId, nuevoPuesto) -> [{id, ordenZona}]` — corre a los demás como hoy; devuelve SOLO los cambiados; renumera 1..n sin huecos.
- `ordenZonaTrasCambioZona(anterior, nuevo) -> number|null` — si cambia la clave de zona ⇒ `null` (va al final de la nueva).
- `calcularOrdenPorZona(pedidos, clientes, {zonas}) -> [{clave, etiqueta, pedidos:[{pedido, orden}]}]` — agrupa por zona del cliente, filtra zonas elegidas, numera 1..n sin huecos por quién tiene pedido; pedidos sin cliente/zona ⇒ "Sin zona" al final (AC-ZON-2).

## 4. Archivos (en orden)
1. `supabase/migrations/011_lote_operacion_facturacion_zonas.sql` (nuevo) — REQ-FAB, REQ-AGR, REQ-ZON.
2. `src/domain/facturacionAB.js` + test — REQ-FAB.
3. `src/domain/gruposFactura.js` + test — REQ-AGR.
4. `src/domain/boletaLayout.js` + test — REQ-TRQ (y FAB-4/AGR-3).
5. `src/domain/zonas.js` + test — REQ-ZON.
6. `src/domain/clientes.js` — aplicar `ordenZonaTrasCambioZona` al editar (si `validarCliente` no ve el registro anterior, hacerlo en el handler de guardado del form) — REQ-ZON.
7. `src/sync/syncService.js` — REQ-AGR/REQ-ZON:
   - `pedidoToRemoteRow`: incluir `grupos` **solo si `p.grupos !== undefined`** (un dispositivo viejo no lo pisa); `mapPedidoRemoto`: `grupos` tolerante (`undefined` ⇒ local) + `tipoFactura*` siempre del local (no viene de `pedidos`).
   - `syncClientes`: `orden_zona` en la fila básica; el upsert de básicos pasa a `upsertTolerante` (fila legacy sin `orden_zona`) para no cortar el sync si falta la 011.
   - `downloadMaestros`: `ordenZona` tolerante como `ordenEntrega`.
   - Fallback de columnas: si PGRST204 nombra `grupos`, reintentar sin `grupos` (helper `sinColumnas011`) antes del fallback de entrega existente.
8. `src/services/pedidoRepository.js` — `toRemoteRow` con `grupos` (misma regla) + mismo reintento sin `grupos` — REQ-AGR.
9. `src/services/facturacionService.js` (nuevo) — REQ-FAB: `guardarTiposFacturaLocal(ids, tipo)`, `subirTiposFactura(cred)` (lotes 500, limpia solo `guardados`), `bajarTiposFactura(cred, desde, hasta)` (no pisa locales pendientes), `consultarFacturasAEmitir(cred, desde, hasta)`, `sondearMigracion011()`. Reusa `credencialesAdminProductos(pin)`.
10. `src/utils/pdfGen.js` — REQ-TRQ/AGR/FAB: `buildFacturaDoc(..., ordenOverride, opciones = {})` con `{tipoFactura, modoGrupos}` (6.º parámetro opcional ⇒ retrocompatible); filas desde `filasBoleta`; pie desde `layoutPieBoleta`; nuevo `generarFacturasAEmitirFile(reporte, {desde, hasta, filtro})`.
11. `src/components/TipoFacturaSelector.js` (nuevo) — REQ-FAB (selector + aviso AC-FAB-2).
12. `src/components/AgruparRenglones.js` (nuevo) — REQ-AGR (seleccionar renglones, Agrupar, renombrar, deshacer).
13. `src/pages/Facturacion.js` — REQ-FAB/AGR: selector por pedido, acción masiva sobre `seleccion`, botón "Subir tipos de factura (N)" con PIN, agrupar en el editor, opción "con detalle / solo grupos" al imprimir. Guardar grupos usa `guardarPedidoOnlineFirst` sin `iniciarStock`.
14. `src/pages/FacturasAEmitir.js` (nuevo) + `src/App.js` (tab solo si `permiso === 1`) — REQ-FAB (AC-FAB-3).
15. `src/pages/OrdenEntrega.js` — REQ-ZON: selector de zona + lista reordenable (`moverEnZona`, `updateCliente` solo de los cambiados, conservando `diaEntrega/ordenEntrega` con spread); impresión por fecha(s) de pedido + zona(s) con `calcularOrdenPorZona`; ORDEN de la boleta = número de zona.
16. `src/utils/ordenEntrega.js` — sin cambios funcionales (`calcularOrdenDelDia` queda por compatibilidad/tests existentes).
`src/db/index.js`: sin cambios (no hace falta subir la versión).

## 5. Concurrencia offline / multidispositivo
| Riesgo | Mitigación |
|---|---|
| Un dispositivo viejo/desactualizado sube el pedido y borra `grupos` | La clave `grupos` se omite si está `undefined` (PostgREST no toca columnas ausentes); las versiones viejas no la conocen. |
| Grupos que apuntan a renglones borrados/editados por otro | `normalizarGrupos` al leer y al imprimir; nunca afecta totales (se calculan de `items`). |
| Dos admins marcan A/B distinto | LWW por `updated_at` en la RPC (no retrocede); local `tipoFacturaPendiente` no se pisa al bajar. |
| Pedido creado offline sin `remoteId` | Su tipo queda pendiente hasta tener `remoteId`; `filasTiposFacturaRpc` lo saltea. |
| Subida parcial de tipos | Se limpia `tipoFacturaPendiente` SOLO de los `guardados` devueltos (patrón `pendingSync`). Reintento idempotente (upsert por `pedido_id`). |
| Dos dispositivos reordenan la misma zona offline | Cada cliente LWW (patrón actual); empates/huecos se resuelven determinísticamente (ordenZona, nombre, id) y la impresión renumera sin huecos. |
| Inicialización de `ordenZona` en varios dispositivos | No se escribe en masa desde la app: SQL inicializa una sola vez en el servidor; localmente el orden faltante se deriva (perezoso) y solo se persisten los clientes que el usuario mueve. |
| Falta la migración 011 | `grupos`/`orden_zona`: reintento sin la columna + aviso; tipos A/B quedan locales pendientes + aviso "Falta la 011". |
| Stock | Agrupar/tipo de factura no llaman a `stockService` con diferencias: test explícito de 0 movimientos. |
| IDs | `grupos[].id` con `crypto.randomUUID()` (inyectable en tests). |

## 6. Plan de pruebas
| AC | Test | Tipo |
|---|---|---|
| AC-FAB-1 | `sugerirTipoFactura` (RI, Monotributo, CF, vacío), `marcarTipoFactura` masivo; Facturación: selector + acción sobre selección | unit dominio + RTL página (mocks db/supabase) |
| AC-FAB-2 | `avisoFacturaA` (CUIT válido/inválido/vacío, tipo B sin aviso); aviso visible sin bloquear | unit + RTL |
| AC-FAB-3 | `armarReporteFacturas` (rango, filtro A/B/todas, excluye borrados/no facturados/ninguna, subtotales y total); página oculta y bloqueada para permiso 2/3; PDF generado con mock jsPDF; RPC con PIN y `interpretarGuardarTiposFactura` (falta_migracion, pin_incorrecto, parciales) | unit + RTL + servicio con supabase mock |
| AC-FAB-4 | `encabezadoTipoFactura`; `buildFacturaDoc` escribe "FACTURA A" (spy `doc.text`) | unit + util PDF con jsPDF mock |
| AC-AGR-1 | `sugerirNombreGrupo` (marca común, rubro común, mezcla), crear/renombrar/deshacer en `AgruparRenglones` | unit + RTL componente |
| AC-AGR-2 | Guardar grupos no genera movimientos (spy `aplicarStockPedido`/ledger = 0); renglones siguen separados en `items` | servicio con mocks |
| AC-AGR-3 | `filasBoleta` modo detalle/solo_grupos; total igual al de sin grupos | unit |
| AC-AGR-4 | `textoBultosGrupo` (bultos iguales, mixtos, sin bultoX), `normalizarGrupos` (renglón eliminado, grupo vacío, datos basura) | unit |
| AC-TRQ-1 | `layoutPieBoleta`: boleta corta, boleta larga (finalY al límite), con deuda + descuento + obs ⇒ sin solapamiento (y < corte) y casilla "Transf. a proveedor" + "Proveedor:" dentro de la página | unit + util PDF (spy de textos/rects) |
| AC-ZON-1 | `moverEnZona` (subir/bajar, escribir número, corrimiento), solo devuelve cambiados; pantalla con selector de zona | unit + RTL |
| AC-ZON-2 | `calcularOrdenPorZona` (varias zonas, numeración sin huecos, sin zona al final, filtro de zonas); impresión pasa el número de zona a `generarFacturaFile` | unit + RTL con mock pdf |
| AC-ZON-3 | `clientesDeZona` sin `ordenZona` usa día+orden; `diaEntrega/ordenEntrega` se conservan tras mover; sync tolerante sin columna `orden_zona` | unit + sync con supabase mock |
| AC-ZON-4 | `claveZona` (mayúsculas, espacios, tildes), empates, sin zona | unit |
| Regresión | sync de pedidos sin `grupos` no manda la clave; `mapPedidoRemoto` conserva `tipoFactura`; suite completa + build | unit sync + gates |

## 7. Supuestos (opción conservadora)
- Fechas de impresión en Orden de entrega = **fechas de pedido** (AC-ZON-2); se mantiene un atajo "Reparto de hoy" que agrega la fecha de ayer. Numeración por (fecha, zona). Zonas impresas en orden alfabético, "Sin zona" al final.
- Zona del pedido = zona actual de la ficha del cliente (no `pedidos.zona`, que es del vendedor).
- Clave de renglón = `productoId` (o nombre si no hay); renglones duplicados del mismo producto caen juntos en el grupo.
- `tipoFactura` sin confirmar: el reporte usa la sugerencia y la marca "(sugerido)"; `ninguna` no entra al reporte.
- Reporte "Facturas a emitir" requiere conexión + PIN (datos de todos los dispositivos); sin conexión no se ofrece (evita un reporte incompleto presentado como total).
- Boleta: el troquel se dibuja solo en la última página. Reordenar zonas: cualquier usuario (como hoy). Agrupar y A/B: solo admin (Facturación ya es solo admin).
