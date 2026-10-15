# Plan — REQ-PAN Panel de ganancia y rentabilidad (run 20261015-2019)

## Decisión central de seguridad (delegada por el dueño)
El snapshot de costo (AC-PAN-1) lo **captura el servidor**, no el cliente:
- Trigger `AFTER INSERT OR UPDATE` en `public.pedidos` → escribe en tabla privada `public.pedidos_costos`
  (RLS on + `revoke all` a anon/authenticated, como `pedidos_factura` 011 / `ingresos_costos` 012).
- Lee solo el admin con PIN por RPC `admin_costos_venta_bajar` (cursor keyset, patrón 012/014).
- Por qué así y no "el dispositivo que factura manda el costo": desde la 013 los costos solo están en el
  dispositivo admin que los bajó con PIN; un vendedor que factura **no tiene costos**. El servidor sí
  (`productos.costo_final/descuento1/descuento2`), así que es la única fuente uniforme y no pide PIN al facturar.
- `costoUnitario` **nunca** viaja en `pedidos.items` (pedidos es legible con anon). Defensa extra: `toRemoteRow`
  limpia claves de costo de los items antes de subir.
- Pantalla "Panel" solo `isAdmin`; los datos de costo bajan solo con PIN y el PIN no se guarda ni loguea.

## Modelo de datos

### Supabase — `supabase/migrations/015_lote_operacion_panel.sql` (idempotente, sin drop de datos)
| Objeto | Detalle |
|---|---|
| `public.pedidos_costos` | `pedido_id text PK` (sin FK: borrar pedido no se traba), `costos jsonb not null default '{}'` (objeto `productoId → costo neto unitario numeric(14,2)`; tope `pg_column_size < 262144`), `capturado_at timestamptz`, `updated_at`, `synced_at timestamptz` (trigger servidor, como S-012-02) + índice `(synced_at, pedido_id)` |
| RLS | `enable row level security`; `revoke all ... from public, anon, authenticated`; sin policies |
| `_costo_neto_producto(costo, d1, d2) returns numeric` | Misma fórmula que `calcularPrecioVenta`: d1/d2 acotados 0..100, `round(..., 2)`; costo null o ≤ 0 ⇒ null. `revoke all` (helper interno) |
| `tg_pedidos_costos_snapshot()` | `security definer`, `search_path = public, pg_temp`. Corre si `new.estado = 'facturado'` y (INSERT, o `old.estado` distinto, o `old.items` distinto). Por cada `items[].productoId` no eliminado que **todavía no esté** en el snapshot, agrega su costo neto actual (merge `existente || nuevos` con prioridad al existente ⇒ el primero gana = "costo del momento"). Productos sin costo no se agregan. Todo envuelto en `exception when others then return new` ⇒ **nunca** bloquea el guardado de un pedido |
| trigger `pedidos_costos_snapshot` | `after insert or update of estado, items on public.pedidos for each row` (`drop trigger if exists` + create) |
| `admin_costos_venta_bajar(p_admin_id, p_admin_pin, p_cursor jsonb) returns jsonb` | `_es_admin_con_pin`; keyset `(synced_at, pedido_id) > cursor` limit 1000; devuelve `{ok, costos:[{pedido_id, costos, capturado_at, synced_at}]}`. `grant execute` a anon, authenticated (el PIN es el control) |
| Backfill | **No**. Pedidos viejos quedan sin fila ⇒ "costo estimado" (AC-PAN-1) |

### IndexedDB — `src/db/index.js`, `DB_VERSION` 11 → **12**
| Store | Clave | Índices | Notas |
|---|---|---|---|
| `costosVenta` (nuevo) | `pedidoId` (remoteId en string) | — | Caché de solo lectura en el dispositivo admin. **Sin `pendingSync`**: el cliente nunca escribe al servidor |
| `meta`/localStorage | cursor `panelCostosCursor` | — | Mismo formato que cursores de compras/rendición |
Solo se agrega el store (`if (!contains)`); no se toca ningún otro.

### Mapeo UI → interno → remoto
| UI | Interno | Remoto |
|---|---|---|
| Costo unitario (por renglón) | `costosVenta[pedidoId].costos[productoId]` | `pedidos_costos.costos->>productoId` |
| "Costo estimado" | `renglon.costoEstimado = true` (calculado, no se guarda) | — |
| Fecha de snapshot | `capturadoAt` | `capturado_at` |
| Ventas / costo / ganancia / margen | cálculo en `panel.js` (centavos, margen en puntos básicos) | — |

## Archivos (en orden)
1. `supabase/migrations/015_lote_operacion_panel.sql` — tabla, helper, trigger, RPC (AC-PAN-1, seguridad).
2. `src/domain/panel.js` (nuevo) — todo el cálculo (AC-PAN-1..6).
3. `src/domain/__tests__/panel.test.js` (nuevo) — AC-PAN-1..6 + rendimiento.
4. `src/domain/cursorCompras.js` — agregar `TABLAS_CURSOR_PANEL = { costos: 'pedido_id' }` (reuso; AC-PAN-1).
5. `src/db/index.js` — v12, store `costosVenta`, `getCostosVenta()`, `putCostosVentaBatch()` (AC-PAN-1).
6. `src/services/pedidoRepository.js` — `toRemoteRow`: `items: itemsSinCostos(p.items)` (AC-PAN-1, seguridad).
7. `src/services/panelService.js` (nuevo) — `bajarCostosVenta(cred, {completo})`, `sondearMigracion015()`,
   `cargarDatosPanel()` (lee pedidos, productos, rendiciones, costosVenta locales) (AC-PAN-1/2).
8. `src/components/GraficoBarras.js` (nuevo) — SVG propio, sin librerías; props `{ barras:[{etiqueta, valorCents}], alto }`; barras negativas bajo el eje; `role="img"` + `<title>` (AC-PAN-4).
9. `src/pages/Panel.js` (nuevo) — selector de período (default mes en curso), tarjetas con comparación, tablas
   ordenables (producto/rubro/marca/vendedor/cliente), top 10, alza/baja, sin ventas, tendencia semanal/mensual,
   avisos; botón "Actualizar costos (PIN)" que llama `bajarCostosProductos` + `bajarRendiciones` + `bajarCostosVenta`;
   aviso si falta la 015 o si no hay costos bajados. Cálculo en `useMemo` (AC-PAN-2..5).
10. `src/App.js` — tab `{ id: 'panel', label: 'Panel' }` + `{tab === 'panel' && isAdmin && <Panel />}` (AC-PAN-2, solo admin).
11. Tests de servicio/página (ver plan de pruebas).

## Funciones puras — `src/domain/panel.js`
Montos en **centavos enteros**; margen en puntos básicos (`null` si ventas = 0). Fechas ISO `YYYY-MM-DD`.
- `costoNetoProductoCents(producto) → number|null` — usa `calcularPrecioVenta(...).costoNeto`; null si costo ≤ 0/vacío.
- `itemsSinCostos(items) → items` — copia sin `costoUnitario`/`costoFinal`/`descuento*`/`ganancia` (para `toRemoteRow`).
- `periodoMesEnCurso(now) → {desde, hasta}`; `periodoAnterior({desde, hasta}) → {desde, hasta}` — mes calendario
  completo ⇒ mes anterior completo; rango libre ⇒ misma cantidad de días inmediatamente antes.
- `renglonesVenta(pedidos, { costosVenta: Map, productosById: Map, periodo }) → Renglon[]` — solo facturados no
  ocultos ni eliminados (`isPedidoOculto`), items no `eliminado`, `cantidad > 0`. `Renglon = { pedidoId, fecha,
  productoId, nombre, rubro, marca, vendedor, clienteKey, clienteNombre, unidades, ventaCents, costoCents|null,
  costoEstimado, productoBorrado }`. Costo: snapshot si existe; si no, costo actual ⇒ `costoEstimado: true`; si
  tampoco ⇒ `costoCents: null` ("sin costo"). Producto inexistente ⇒ `productoBorrado`, nombre del renglón.
- `ajustesRendicion(rendiciones, { pedidosById, costosVenta, productosById, periodo }) → Renglon[]` — solo
  `cuentaComoVigente`, por **fecha de la rendición**. Devolución/cambio "entra": unidades y venta negativas
  (`precioCents` del renglón); costo negativo solo si `vuelveAlStock !== false` (merma = costo perdido).
  Cambio "sale": positivo, costo snapshot del pedido o actual (estimado). NC: renglón sin producto
  (`productoId: null`, `tipo: 'nc'`) con `ventaCents = -creditoCents`, costo 0.
- `resumenPeriodo(renglones) → { ventasCents, costoCents, gananciaCents, margenBp, pedidos, ticketPromedioCents,
  renglonesSinCosto, renglonesEstimados }` — pedidos = ids distintos con venta > 0.
- `compararPeriodos(actual, anterior) → { campo: { actual, anterior, variacionBp|null } }`.
- `rentabilidadPor(renglones, dimension: 'producto'|'rubro'|'marca'|'vendedor'|'cliente') → Fila[]`
  (`{ clave, etiqueta, unidades, ventasCents, costoCents, gananciaCents, margenBp, estimado }`); NC solo cuenta
  en vendedor/cliente/totales (fila "Notas de crédito" fuera de producto/rubro/marca).
- `ordenarFilas(filas, campo, dir) → Fila[]` — estable, nulos al final.
- `masVendidos(filasProducto, n = 10) → { porUnidades, porImporte }`.
- `enAlzaEnBaja(filasActual, filasAnterior, n = 10) → { alza, baja }` — variación de unidades; anterior 0 ⇒ "nuevo".
- `sinVentas(productos, filasProducto) → producto[]` — catálogo vigente con 0 unidades netas.
- `tendencia(renglones, { agrupacion: 'semana'|'mes', hasta, cantidad = 12 }) → [{ etiqueta, desde, ventasCents, gananciaCents }]`
  (semana lunes–domingo, buckets vacíos en 0).
- `avisosPanel(productos, filasProducto) → { margenNegativo: [], sinCosto: [] }` — margen negativo en el período o
  `precio < costoNeto` en catálogo; sin costo = producto vigente con costo vacío/0.
- `calcularPanel({ pedidos, productos, rendiciones, costosVenta, periodo, agrupacion, now }) → PanelVM` — orquesta
  todo en **una pasada** por período con `Map`s (sin `Date` por renglón: fecha por pedido) para AC-PAN-6.

## Riesgos de concurrencia offline / multidispositivo
| Riesgo | Mitigación |
|---|---|
| Pedido facturado offline sube días después | El snapshot toma el costo al llegar al servidor; los costos solo cambian online con PIN (`admin_guardar_productos`), la deriva es acotada. Anotado en Supuestos |
| Dos dispositivos facturan/editan el mismo pedido | Merge "el primero gana" por producto dentro del trigger (`on conflict do update` combinando jsonb); reintentos no cambian valores ⇒ idempotente |
| Re-facturar tras revertir a pendiente | Se conserva el costo ya capturado (no se pisa); productos nuevos se agregan |
| Pedido sin `remoteId` aún | No tiene snapshot local ⇒ `costoEstimado`; se corrige al bajar costos tras sincronizar |
| Pedido borrado | Sin FK; `pedidos_costos` queda huérfano y el panel lo ignora (no hay pedido) |
| Trigger rompe guardados existentes | `exception when others then return new`; AFTER trigger; solo actúa con `estado='facturado'` |
| Caché local vs servidor | `costosVenta` es solo lectura, reemplazo por fila con cursor `(synced_at, pedido_id)` + solape 5 min (reuso `cursorConSolape`); sin `pendingSync`, no hay conflictos de escritura |
| Stock | El panel **no** escribe stock ni movimientos; unidades salen de items y rendiciones, nunca de un número de stock |
| Rendiciones anuladas o rechazadas | `cuentaComoVigente` las excluye |

## Plan de pruebas
| AC | Test | Tipo |
|---|---|---|
| AC-PAN-1 | snapshot gana sobre costo actual; sin snapshot ⇒ costo actual + `costoEstimado`; sin costo ⇒ `null`; `costoNetoProductoCents` == `calcularPrecioVenta().costoNeto` en tabla de casos (d1/d2 fuera de rango, vacíos) | unit `panel.test.js` |
| AC-PAN-1 (seguridad) | `itemsSinCostos` quita claves de costo; `toRemoteRow` no emite `costoUnitario` | unit + `pedidoRepository` test |
| AC-PAN-1 (sync) | `bajarCostosVenta`: sin PIN ⇒ `pin_requerido`; `no_autorizado`; `falta_migracion`; paginado + cursor; no guarda PIN | service test con mock de supabase/db |
| AC-PAN-1 (SQL) | revisión manual de la 015 por el auditor (RLS, revoke, grants, trigger no bloqueante) + grep en gate de que `pedidos_costos` no tenga `grant select` | revisión / gate |
| AC-PAN-2 | totales, ganancia, margen, pedidos, ticket; período anterior (mes y rango libre); neteo devolución, merma, cambio, NC; rendición anulada no cuenta | unit |
| AC-PAN-3 | agrupado por las 5 dimensiones; orden por cada campo; producto borrado | unit |
| AC-PAN-4 | top 10 por unidades/importe; alza/baja con anterior 0; sin ventas; tendencia semanal/mensual con buckets vacíos | unit; `GraficoBarras` render (barras y valores negativos) |
| AC-PAN-5 | margen negativo; sin costo cargado | unit |
| AC-PAN-6 | centavos (0,1+0,2), período vacío ⇒ ceros y margen null; **20.000 renglones < 1 s** (`performance.now()`) | unit |
| Solo admin | tab y página no visibles para permiso 2/3 | page test `App`/`Panel` |
| No regresión | `npm test` + `build` verdes; DB v12 abre sobre v11 sin perder stores | gates |

## Supuestos (opción conservadora)
1. Snapshot por **producto dentro del pedido** (mismo costo para renglones repetidos del mismo producto en el mismo momento) — equivale a "por renglón".
2. Ventas = Σ `precio × cantidad` de renglones no eliminados (igual que REQ-REN), no `pedido.total`.
3. Fecha de venta = `pedido.fecha` normalizada; rendiciones se imputan a su propia fecha.
4. NC no se reparte por producto/rubro/marca (fila aparte); sí afecta totales, vendedor y cliente.
5. Merma: baja la venta pero no el costo (la mercadería se perdió).
6. Sin backfill: lo previo a la 015 se muestra como "costo estimado".
7. Riesgo aceptado: anon ya puede escribir `pedidos`; eso solo dispara capturas de costo que anon no puede leer.
8. Redondeo SQL (`round`) vs JS (`Math.round`) puede diferir en 1 centavo en casos límite; aceptable.
