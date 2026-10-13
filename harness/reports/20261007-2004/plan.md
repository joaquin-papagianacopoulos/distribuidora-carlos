# Plan técnico — RUN 20261007-2004 (fase arquitecto) — REQ-BUL

Alcance: REQ-BUL (AC-BUL-1..8) de `harness/SPEC.md`. Botón "Bulto" en los renglones de **Pedido** (`NuevoPedido.js`), **Facturación** (`Facturacion.js`, modo edición) y **Armado** (`Armado.js`, vista "Armar pedido").

Resumen: es un cambio **solo de UI + dominio puro**. No hay stores nuevos, no sube `DB_VERSION`, no hay migración SQL. El stock sigue siendo ledger: los botones solo cambian `item.cantidad` y el guardado existente (`guardarPedidoOnlineFirst` → `aplicarStockPedido`) reconcilia por diferencia (AC-STK-4).

---

## 1. Modelo de datos

### IndexedDB
- **Sin cambios.** `DB_VERSION` queda igual. No se agrega ningún store ni índice.
- `bultoX` ya existe en `productos` (REQ-PROD, `validarProducto` lo normaliza a entero ≥ 1, `productoExtraFromRemote` lo baja de `bulto_x`).
- **No se copia `bultoX` al ítem del pedido.** El desglose se calcula siempre con el `bultoX` *actual* del producto (AC-BUL-4), buscándolo por `productoId` en `productos`. El único dato persistido sigue siendo `item.cantidad` (entero).
- `pedido.armadoLog` (objeto ya existente, guardado en IndexedDB y en la columna remota `armado_log`) gana una clave opcional nueva: `cambios` (ver §3.2). Aditivo: clientes viejos lo ignoran; `Facturacion.guardarEdicion` ya hace `{ ...logOriginal, removidos }`, así que lo preserva.

### Supabase
- **Sin migración.** `bulto_x` ya existe en `productos` (migración 001). `armado_log` ya existe en `pedidos` y se sube/baja tal cual (`syncService.js` L94/L123, `pedidoRepository.js` L30); una clave nueva dentro del JSON no requiere DDL.
- Verificación manual (no bloqueante, anotar en QA): confirmar en el SQL editor que `pedidos.armado_log` es `jsonb` (no se encontró en `supabase/migrations/`, es previa al harness). Si fuese `text`, también funciona porque hoy ya viaja un objeto.

### Mapeo UI → interno → remoto
| UI | Interno | Remoto | Nota |
|---|---|---|---|
| "+ Bulto (x N)" / "− Bulto" | modifica `item.cantidad` | `pedidos.items[].cantidad` (jsonb existente) | N = `normalizarBultoX(producto.bultoX)` |
| Desglose "41 u. = 3 bultos + 5 u." | derivado, no se guarda | — | calculado en render |
| Cambio de cantidad del armador | `pedido.armadoLog.cambios[]` | `pedidos.armado_log.cambios` | nuevo, opcional |
| Movimiento de stock por diferencia | `movimientosStock` (ledger, UUID) | `movimientos_stock` | **sin cambios**, lo genera `aplicarStockPedido` |

---

## 2. Archivos a crear / modificar (en orden)

| # | Archivo | Acción | REQ/AC |
|---|---|---|---|
| 1 | `src/domain/bultos.js` | **crear** — funciones puras de bulto, desglose y permiso | AC-BUL-1, 2, 3, 4, 5, 8 |
| 2 | `src/domain/__tests__/bultos.test.js` | **crear** | AC-BUL-1..5, 8 |
| 3 | `src/domain/armado.js` | **crear** — diff de cantidades para `armadoLog.cambios` | AC-BUL-7 |
| 4 | `src/domain/__tests__/armado.test.js` | **crear** | AC-BUL-7 |
| 5 | `src/components/BultoControl.js` | **crear** — componente presentacional reutilizable (botones + desglose) | AC-BUL-1, 2, 3, 4 |
| 6 | `src/components/__tests__/BultoControl.test.js` | **crear** | AC-BUL-1..4 |
| 7 | `src/pages/NuevoPedido.js` | **modificar** — `ItemRow` recibe `producto` + `puedeBulto`; handler `aplicarBulto` | AC-BUL-1..4, 6, 8 |
| 8 | `src/pages/Facturacion.js` | **modificar** — `FacturacionItemRow` + handler que actualiza `itemsEdit` **y** `draftByPid/draftRef`; `ArmadoResumen` muestra `cambios` | AC-BUL-1..4, 7, 8 |
| 9 | `src/pages/Armado.js` | **modificar** — `ItemArmadoCard` + handler; `guardarArmado` agrega `armadoLog.cambios` | AC-BUL-1..4, 7, 8 |
| 10 | `src/services/__tests__/stockService.test.js` | **agregar casos** (sin tocar `stockService.js`) | AC-BUL-7 |
| 11 | `src/pages/__tests__/bultos.pedido.test.js` | **crear** | AC-BUL-1, 2, 3, 4, 6, 8 |
| 12 | `src/pages/__tests__/bultos.facturacion.test.js` | **crear** | AC-BUL-1, 2, 3, 7, 8 |
| 13 | `src/pages/__tests__/bultos.armado.test.js` | **crear** | AC-BUL-1, 2, 3, 7, 8 |

**No se tocan:** `src/db/index.js`, `src/sync/*`, `src/services/stockService.js`, `src/services/pedidoRepository.js`, `src/domain/stock.js`, `src/domain/productos.js` (solo se importa `avisosItemPedido`), `App.js`, `supabase/migrations/*`.

---

## 3. Funciones puras de dominio

### 3.1 `src/domain/bultos.js`

Imports: `toInt` de `./validacion`, `MAX_CANTIDAD` de `./stock` (mismo tope que el CHECK de `movimientos_stock`, S-12).

```js
export const CANTIDAD_MINIMA_RENGLON = 1;

/** bultoX válido (entero > 1 y <= MAX_CANTIDAD) o null = "sin bulto". */
export function normalizarBultoX(v): number | null

/** true si el producto tiene bulto usable. Acepta producto u objeto nulo. */
export function tieneBulto(producto): boolean

/** Cantidad del renglón saneada: entero/finito >= 0; inválido => 0. */
export function normalizarCantidad(v): number

/** Suma `veces` bultos. Sin bulto => devuelve la cantidad sin cambios. */
export function sumarBulto(cantidad, bultoX, veces = 1): number

/** Resta 1 bulto sin bajar de `minimo` (default 0). */
export function restarBulto(cantidad, bultoX, { minimo = 0 } = {}): number

/** Desglose con el bultoX ACTUAL. null si no hay bulto o no corresponde mostrarlo. */
export function desgloseBultos(cantidad, bultoX): { bultos, sueltas, texto } | null

/** "+ Bulto (x 12)" o null si no hay bulto. */
export function etiquetaBotonBulto(bultoX): string | null

/** AC-BUL-8: ¿este permiso puede usar el botón en esta pantalla? */
export function puedeUsarBulto(permiso, pantalla /* 'pedido'|'facturacion'|'armado' */): boolean
```

Contratos y casos de borde:

| Función | Entrada | Salida |
|---|---|---|
| `normalizarBultoX` | `12`, `"12"`, `"12,0"` | `12` |
| | `1`, `0`, `-12`, `"-12"` | `null` (≤ 1 ⇒ sin bulto) |
| | `12.5`, `"12,5"` (decimal) | `null` |
| | `"doce"`, `""`, `"  "`, `null`, `undefined`, `NaN`, `Infinity` | `null` |
| | `true`, `[12]`, `{}` (tipos raros) | `null` — solo se aceptan `number` y `string` |
| | `> MAX_CANTIDAD` | `null` |
| `normalizarCantidad` | `5`, `"5"` | `5` |
| | `-3`, `"abc"`, `null`, `NaN` | `0` |
| | `2.5` (legacy decimal) | `2.5` (no se trunca un dato existente) |
| `sumarBulto` | `(0, 12, 3)` | `36` |
| | `(5, 12, 3)` | `41` |
| | `(5, null)` / `(5, 1)` / `(5, "x")` | `5` (sin bulto, no-op) |
| | `veces` ≤ 0 / no entero | trata como no-op |
| | resultado `> MAX_CANTIDAD` | devuelve la cantidad **sin cambios** (no suma parcial) |
| `restarBulto` | `(41, 12)` | `29` |
| | `(5, 12)` | `0` (default) |
| | `(5, 12, { minimo: 1 })` | `1` |
| | `(12, 12, { minimo: 1 })` | `1` |
| | `(0, 12)` | `0` |
| | sin bulto | cantidad sin cambios |
| `desgloseBultos` | `(36, 12)` | `{ bultos: 3, sueltas: 0, texto: "36 u. = 3 bultos" }` |
| | `(41, 12)` | `{ bultos: 3, sueltas: 5, texto: "41 u. = 3 bultos + 5 u." }` |
| | `(12, 12)` | `texto: "12 u. = 1 bulto"` (singular) |
| | `(13, 12)` | `texto: "13 u. = 1 bulto + 1 u."` |
| | `(5, 12)` (menos de 1 bulto) | `null` (no se muestra línea; el botón ya indica el tamaño) |
| | `(0, 12)`, cantidad decimal, sin bulto | `null` |
| `etiquetaBotonBulto` | `12` | `"+ Bulto (x 12)"` |
| | sin bulto | `null` |
| `puedeUsarBulto` | `(1, *)` | `true` en las tres |
| | `(2, 'pedido')` | `true`; `(2, 'facturacion'|'armado')` ⇒ `false` |
| | `(3, 'armado')` | `true`; `(3, 'pedido'|'facturacion')` ⇒ `false` |
| | permiso desconocido / pantalla desconocida | `false` |

Notas: los números del `texto` se formatean con `String(n)` (sin separador de miles) para que el string sea determinista y coincida literal con el AC. La normalización del permiso la sigue haciendo cada pantalla como hoy (`Number(vendedorActual?.permiso || 2)`), y se le pasa ese valor a `puedeUsarBulto`; así no cambia el comportamiento actual para un vendedor sin `permiso` cargado.

### 3.2 `src/domain/armado.js`

```js
/**
 * Diferencias de cantidad entre lo que había al abrir el armado y lo que queda.
 * Solo productos ACTIVOS en ambos lados o agregados (antes = 0).
 * Lo sacado del todo NO va acá (ya está en armadoLog.removidos).
 * Agrupa por productoId (suma filas duplicadas), ignora cantidades inválidas.
 */
export function cambiosDeCantidad(itemsAntes, itemsDespues):
  Array<{ productoId: string, nombre: string, antes: number, despues: number, diferencia: number }>

/**
 * Acumula con los cambios de sesiones anteriores del armador:
 * conserva el `antes` más viejo y el `despues` más nuevo; descarta los que
 * vuelven a quedar iguales (diferencia 0). No muta las entradas.
 */
export function fusionarCambiosArmado(previos = [], nuevos = []): mismo tipo
```

Casos de borde: `itemsAntes`/`itemsDespues` nulos ⇒ `[]`; `productoId` numérico vs string ⇒ se compara como `String`; mismo producto en dos filas ⇒ suma; `previos` no-array (dato viejo/corrupto del remoto) ⇒ se trata como `[]`.

---

## 4. Integración por pantalla

### 4.1 Componente `src/components/BultoControl.js`
Props: `{ bultoX, cantidad, onSumar, onRestar, puedeRestar, visible }`.
- Si `!visible` o `etiquetaBotonBulto(bultoX) === null` ⇒ `return null` (AC-BUL-1, AC-BUL-8).
- Renderiza `<button type="button" data-testid="bulto-mas">+ Bulto (x N)</button>`, `<button type="button" data-testid="bulto-menos" disabled={!puedeRestar}>− Bulto</button>` y `<span data-testid="bulto-desglose">` con `desgloseBultos(cantidad, bultoX)?.texto`.
- No calcula cantidades: solo dispara `onSumar`/`onRestar`. El cálculo vive en el dominio y en el handler del padre (estado único de verdad).
- `puedeRestar` = `cantidad > CANTIDAD_MINIMA_RENGLON`.

### 4.2 Pedido (`NuevoPedido.js`)
- `ItemRow` recibe `producto={productosById.get(String(item.productoId))}` y `puedeBulto={puedeUsarBulto(permisoNorm, 'pedido')}`.
- Handler nuevo en el padre, con updater funcional (evita closure viejo con toques rápidos):
  `aplicarBulto(productoId, op)` ⇒ `setItems(prev => prev.map(i => i.productoId === productoId ? { ...i, cantidad: op === 'sumar' ? sumarBulto(i.cantidad, bx) : restarBulto(i.cantidad, bx, { minimo: CANTIDAD_MINIMA_RENGLON }) } : i))`, con `bx` = `productosById.get(...).bultoX`.
- `cantidadText` ya se resincroniza por el `useEffect([item.cantidad])` existente.
- **AC-BUL-6**: los avisos ya se calculan en render con `item.cantidad` (`avisosItemPedido(...)`, L426); no hay que tocar nada, solo cubrirlo con test.
- El borrador en `localStorage` sigue guardando solo `items` (sin `bultoX`) ⇒ el desglose al reabrir usa el `bultoX` actual.

### 4.3 Facturación (`Facturacion.js`)
- La pantalla ya devuelve "No tenés permisos para facturar" a no-admin (L223); `puedeUsarBulto(permisoNorm, 'facturacion')` se pasa igual como defensa en profundidad.
- `FacturacionItemRow` recibe `producto={getProductoActual(item)}` (ya existe, con fallback por nombre) y renderiza `BultoControl`.
- **Trampa crítica**: `guardarEdicion` (L535-544) **prioriza `draftByPid[pid].cantidadText` sobre `item.cantidad`**. El handler de bulto DEBE actualizar `itemsEdit` y también `draftByPid` + `draftRef.current` con la cantidad resultante, copiando el patrón de `cambiarCantidad` (L396-409). Si no, al guardar se pisa la cantidad con el texto viejo y el stock no se ajusta. Test de regresión obligatorio (ver §6).
- Stock: `guardarEdicion` llama `guardarPedidoOnlineFirst(pedidoFinal)` **sin** `iniciarStock` ⇒ `aplicarStockPedido` solo reconcilia pedidos que ya tienen movimientos y emite únicamente la diferencia (AC-STK-4 ⇒ AC-BUL-7). No se agrega código de stock.
- `ArmadoResumen`: si `log.cambios?.length`, agrega una línea "Cantidades cambiadas: Coca 5→41, ..." (solo lectura; tolera `cambios` ausente o no-array).

### 4.4 Armado (`Armado.js`)
- Pestaña visible solo para admin y armador (`App.js` L56-60). `ItemArmadoCard` recibe `producto` (nuevo `productosById` con `useMemo`) y `puedeBulto={puedeUsarBulto(permisoNorm, 'armado')}`; no se muestra en ítems tachados (`item.eliminado`).
- Handler por `_key` (las filas se identifican por `_key`, no por `productoId`), con updater funcional y `minimo: CANTIDAD_MINIMA_RENGLON` (mismo piso que el "−" actual, L427).
- `guardarArmado`: después de armar `itemsFinal`,
  `const cambios = fusionarCambiosArmado(armando.armadoLog?.cambios, cambiosDeCantidad(armando.items, itemsFinal));`
  y `armadoLog = { confirmados, removidos, cambios, at, por }`.
- Stock: `guardarPedidoOnlineFirst(pedidoFinal)` (sin `iniciarStock`) ya reconcilia por diferencia si el pedido está facturado (AC-BUL-7). Deuda: `actualizarMontoDeudaDePedido` ya acompaña el total.
- Reducciones con "− Bulto" siguen yendo a Faltantes vía `registrarFaltantes(armando, itemsFinal)` (comportamiento existente del "−"); no se cambia.

---

## 5. Stock, concurrencia offline y multidispositivo

| Riesgo | Mitigación |
|---|---|
| Sincronizar "stock" como número | **Rechazado.** Los botones solo cambian `item.cantidad`; el stock sale de `movimientosParaPedido` (delta contra los movimientos del `ref` del pedido, UUID, `pendingSync`, upsert por `id`). |
| Doble toque / reintento de guardado descuenta doble | `movimientosParaPedido` es idempotente: compara deseado vs ya registrado para `refsPedido(pedido)`; re-guardar no emite nada (AC-STK-5). Test AC-BUL-7 lo cubre. |
| Toques rápidos con estado viejo (closure) | Handlers con updater funcional `setX(prev => ...)`. |
| Facturación pisa la cantidad con el borrador de texto | Actualizar `draftByPid`/`draftRef` en el mismo handler (§4.3) + test de regresión. |
| Pedido facturado antes del ledger: sumar bultos descuenta de golpe | No pasa: sin `iniciarStock` y sin movimientos previos, `aplicarStockPedido` no hace nada (fix B2 existente). |
| `bultoX` cambia en otro dispositivo | No se persiste en el ítem; solo cambia el desglose visible. La cantidad (dato real) no se recalcula. |
| `bultoX` corrupto desde CSV/remoto | `normalizarBultoX` ⇒ `null` ⇒ sin botón (AC-BUL-5). |
| Overflow de cantidad (muchos toques) | `sumarBulto` no supera `MAX_CANTIDAD` (alineado al CHECK de Supabase, S-12). |
| **Preexistente (no se arregla en este REQ):** dos dispositivos editan offline el mismo pedido facturado; ambos emiten su delta contra su ledger local y al sincronizar se suman (el pedido queda last-writer-wins). El bulto lo amplifica (deltas de a 12). | Se mitiga en parte porque cualquier guardado posterior del pedido re-alinea el ledger. Recomendación para un REQ futuro: reconciliar `aplicarStockPedido` después del pull de pedidos. Anotado para QA/seguridad. |
| Editar un pedido facturado en Facturación/Armado no pasa por `previsualizarStockPedido` (no avisa stock insuficiente) | Comportamiento actual del "+"; fuera de alcance. Anotado. |
| `armadoLog` viejo sin `cambios` / dispositivos con versión vieja | Clave opcional; consumidores toleran ausencia; versión vieja la ignora y `Facturacion` la preserva con el spread. Si un Armado viejo guarda, se pierde `cambios` (aceptable: es informativo). |

---

## 6. Plan de pruebas (AC → test)

Runner: `CI=true npx react-scripts test --watchAll=false`. Tests de página con el patrón de `security.roles.test.js` (`react-dom/client` + `act`, `jest.mock` de `useAppContext`, `db`, `pedidoRepository`, `stockService`, `faltanteRepository`, `deudaRepository`, `pdfGen`, `share`). No hay `@testing-library` en `package.json`: no agregar dependencias.

| AC | Unit (dominio) `bultos.test.js` / `armado.test.js` | Componente `BultoControl.test.js` | Página | Servicio `stockService.test.js` |
|---|---|---|---|---|
| **AC-BUL-1** | `etiquetaBotonBulto(12)` = `"+ Bulto (x 12)"`; `tieneBulto` false con 1, 0, vacío, null | renderiza con 12; `null` con 1/vacío/undefined | Pedido, Facturación (edición) y Armado (armar): producto bulto 12 muestra botón, producto bulto 1 no | — |
| **AC-BUL-2** | `sumarBulto` 0→36 y 5→41 (3 toques, también 3 llamadas encadenadas de 1) | click dispara `onSumar` | Pedido: renglón (borrador en `localStorage` con cantidad 5) + 3 clicks ⇒ input 41. Armado: 5 + 3 clicks ⇒ 41 | — |
| **AC-BUL-3** | `restarBulto` 41→29; 5→0; 5 con `minimo:1`→1; 0→0; sin bulto = no-op | "− Bulto" deshabilitado con cantidad ≤ 1 | Pedido/Armado: 5 − bulto ⇒ 1 y el renglón sigue existiendo | — |
| **AC-BUL-4** | `desgloseBultos` 36 ⇒ "36 u. = 3 bultos"; 41 ⇒ "41 u. = 3 bultos + 5 u."; 12 singular; 5 ⇒ null | muestra el texto | Re-render con `productos` cambiando `bultoX` 12→6 ⇒ "36 u. = 6 bultos" (usa el actual; un `bultoX` viejo en el ítem se ignora) | — |
| **AC-BUL-5** | tabla completa de §3.1: decimal (12.5, "12,5"), negativo (-12, "-12"), texto ("doce", ""), ausente (null/undefined), NaN/Infinity, tipos raros, > MAX | — | — | — |
| **AC-BUL-6** | (ya cubierto `avisosItemPedido`) | — | Pedido: producto `minimoVenta 24`, `bultoX 12`, stock 30, cantidad 1 ⇒ aviso mínimo; +bulto ×2 (25) ⇒ sin avisos; +bulto (37) ⇒ "Stock disponible: 30" (`data-testid="aviso-stock"`) | — |
| **AC-BUL-7** | `cambiosDeCantidad` (5→41 ⇒ diferencia 36; agregado ⇒ antes 0; removido no figura; duplicados suman); `fusionarCambiosArmado` (conserva `antes` viejo, descarta si vuelve a igual, tolera no-array) | — | Facturación: abrir edición de pedido facturado cantidad 5, +3 bultos, Guardar ⇒ `guardarPedidoOnlineFirst` recibe `items[0].cantidad === 41` (regresión del borrador) y **sin** `iniciarStock: true`. Armado: igual + `armadoLog.cambios` = `[{ antes: 5, despues: 41, diferencia: 36 }]` | Pedido facturado 5 (mov −5) → editado a 41 vía `sumarBulto` ⇒ `aplicarStockPedido` emite **solo** −36; re-aplicar ⇒ 0 movimientos; stock = inicial − 41. Pedido facturado sin movimientos (legacy) + bulto sin `iniciar` ⇒ 0 movimientos |
| **AC-BUL-8** | matriz `puedeUsarBulto` (1/2/3/desconocido × 3 pantallas + pantalla desconocida) | `visible=false` ⇒ nada | Pedido con vendedor (2) y admin (1) ⇒ botón; Facturación con vendedor/armador ⇒ "No tenés permisos" y sin botón; Armado con armador (3) y admin ⇒ botón, con vendedor (2) ⇒ sin botón | — |

Gates: `node harness/gates/run-gates.mjs` (tests + build verdes). Cada `test(...)` lleva el ID `AC-BUL-n` en el título para el mapeo de cobertura.

---

## 7. Supuestos (opción conservadora elegida)

1. **Piso del "− Bulto" = 1 unidad en las tres pantallas** (`CANTIDAD_MINIMA_RENGLON`). El AC dice "sin bajar de 0 … se comporta como hoy al vaciar la cantidad: el renglón no se borra solo"; hoy vaciar el campo en Pedido/Facturación vuelve a 1 y en Armado el "−" nunca baja de 1. Un renglón en 0 haría que `efectoDeseado` lo ignore (devuelve el stock) mientras sigue visible con subtotal 0: inconsistente. La función de dominio admite `minimo` (default 0, cumple literal el AC-BUL-5) y las pantallas pasan 1.
2. Desglose con menos de 1 bulto (p. ej. 5 u. con bulto x12) **no se muestra** (no hay "0 bultos"). Con 1 bulto, singular ("1 bulto").
3. `bultoX` como string numérico entero (`"12"`) **se acepta** (puede venir así de import/remoto); decimal, negativo, texto, ausente ⇒ sin bulto.
4. AC-BUL-6 aplica a los avisos **que ya existen** (solo en Pedido). No se agregan avisos nuevos a Facturación ni Armado.
5. `armadoLog.cambios` acumula entre sesiones del armador (antes original → después final). Ediciones hechas en Facturación entre sesiones no se registran como cambios del armador.
6. Los renglones arrancan en 1 al agregar un producto; "+ Bulto" sobre un renglón recién agregado deja `1 + bultoX` (p. ej. 13), porque el SPEC dice que se acumula. **A confirmar con el dueño** si prefiere un "Agregar bulto" directo desde el buscador (fuera de alcance).
7. No se agrega un guard de rol nuevo en `Armado.js` (hoy depende de la visibilidad de pestañas en `App.js`); solo se ocultan los botones de bulto vía `puedeUsarBulto`, para no cambiar el comportamiento actual de la pantalla.
