# Auditoría de seguridad — RUN 20261007-2004 — REQ-BUL (botón "Bulto")

Alcance: `src/domain/bultos.js`, `src/domain/armado.js`, `src/components/BultoControl.js`, cambios en `src/pages/NuevoPedido.js`, `src/pages/Facturacion.js`, `src/pages/Armado.js`, y la protección remota (`supabase/migrations/001_*.sql`, `002_*.sql`).
No se leyó `.env`. No se modificó código de producción.

## Resumen ejecutivo

REQ-BUL **no introduce vulnerabilidades nuevas de severidad Crítico ni Alto**. El dominio es sólido frente a entradas hostiles (NaN, Infinity, negativos, overflow, tipos raros, claves de prototipo), el desglose no puede transportar texto del atacante y la matriz de roles de AC-BUL-8 es correcta. El stock sigue pasando **solo por movimientos** y por **diferencia** (`movimientosParaPedido`, idempotente por ref).

El riesgo real sigue siendo el preexistente **S-01** (run1, Crítico): sin autenticación en el servidor, la anon key escribe `pedidos` (incluidos `items` y `armado_log`) y `movimientos_stock` sin control de rol. Los controles de REQ-BUL son **solo de UI**; ninguna RLS los respalda.

Conteo: 1 Crítico, 1 Alto, 1 Medio, 4 Bajo, 2 Info.

Estados usados en la tabla:
- **ABIERTO**: sin corregir; requiere acción (implementador o dueño, según la columna "Dónde se corrige").
- **En corrección (iteración 2)**: el implementador lo está corrigiendo en paralelo en esta corrida; el estado pasa a CORREGIDO cuando sus tests queden verdes.
- **CORREGIDO**: corregido y verificado con tests (S-BUL-02, S-BUL-03, S-BUL-05 y S-BUL-07 en iteración 2).

## Tabla de hallazgos

| Severidad | Hallazgo | Evidencia | Estado | Dónde se corrige | Origen |
|---|---|---|---|---|---|
| Crítico (CVSS 9.1) | **S-01 (run1)** — Sin auth en el servidor: con la anon key cualquiera hace PATCH a `pedidos.items` / `pedidos.armado_log` y POST a `movimientos_stock`. AC-BUL-8 solo oculta botones | `supabase/migrations/001_altas_y_stock.sql:149-151` (`movs_insert/update ... with check (true)`); `pedidos` sin políticas en el repo; `src/pages/*.js` `puedeUsarBulto` (solo cliente) | ABIERTO | Dueño, Supabase: `002_seguridad_recomendada.sql` pasos 1-4 y paso 5 (Auth) | Preexistente |
| Alto (CVSS 7.1) | **S-BUL-01** — El rol (`permiso`) sale de `vendedorActual` local (forjable en localStorage/IndexedDB). Un vendedor que lo cambia a 1 ve Facturación y los botones Bulto de admin | `src/pages/Facturacion.js:195-197`, `src/pages/Armado.js:137-138`, `src/pages/NuevoPedido.js:202-204`, `src/App.js:38-39` | ABIERTO | Dueño, Supabase Auth (002 paso 5) + claim `permiso` en JWT | Preexistente (S-01/S-20 run1) |
| Medio (CVSS 5.4) | **S-BUL-04** — Editar un pedido **ya facturado** (Facturación `guardarEdicion` o Armado `guardarArmado`) reconcilia stock sin `previsualizarStockPedido`: "+ Bulto" puede dejar stock negativo sin aviso (contradice el espíritu de AC-BUL-6 en esas pantallas). El armador (permiso 3) también cambia la deuda del cliente | `src/pages/Facturacion.js:577-606` (no llama a `previsualizarStockPedido`, que solo está en `:645` al facturar); `src/pages/Armado.js:536-539`; `pedidoRepository.js:189-193` | ABIERTO | Implementador: `src/pages/Facturacion.js`, `src/pages/Armado.js` | Preexistente, amplificado por REQ-BUL |
| Bajo (CVSS 3.7) | **S-BUL-02** — `sumarBulto/restarBulto` conservan decimales legacy (`2.5 + 12 = 14.5`). `movimientos_stock.cantidad` es `integer`: si ese pedido se factura, el movimiento es rechazado (22P02) y queda pendiente para siempre en ese dispositivo (stock local != remoto). En Facturación se trunca a entero al guardar (`parseInt`), en Armado no | `src/domain/bultos.js:29-34,38-56`; `src/pages/Armado.js:509`; `001_altas_y_stock.sql:65`; `src/services/stockService.js:97-113` | CORREGIDO (iteración 2) | Implementador: `src/domain/bultos.js` (+ test S-BUL-02) | Raíz preexistente (decimales legacy); REQ-BUL los propaga |
| Bajo (CVSS 3.1) | **S-BUL-03** — `armadoLog.cambios` conserva un cambio de una sesión anterior aunque el producto se haya sacado del todo en esta sesión: Facturación muestra "X 5->10" y a la vez "Sacados: X x10" | `src/domain/armado.js:57-89`; `src/pages/Armado.js:529` | CORREGIDO (iteración 2) | Implementador: `src/domain/armado.js` (`fusionarCambiosArmado`) + `src/pages/Armado.js` | Nuevo (REQ-BUL) |
| Bajo (CVSS 3.1) | **S-BUL-05** — `fusionarCambiosArmado` acepta `armado_log.cambios` remoto sin límite de cantidad de entradas ni largo de `nombre` (un atacante con la anon key infla el JSON; DoS visual en Facturación y se re-sube en cada guardado). No es XSS: React lo escapa | `src/domain/armado.js:61-67`; `src/pages/Facturacion.js:58-61` | CORREGIDO (iteración 2) | Implementador: `src/domain/armado.js`; Dueño: CHECK SQL sobre `pedidos.armado_log` | Nuevo (superficie), explotable por S-01 |
| Bajo (CVSS 2.6) | **S-BUL-06** — Cantidad manual sin tope en Armado (`setCantidadArmadoTexto`) y Facturación (`guardarEdicion` parseInt) y suma de filas duplicadas en Armado: pueden superar `MAX_CANTIDAD`; el movimiento viola `abs(cantidad) <= 1000000` y queda rechazado. El botón Bulto sí respeta el tope | `src/pages/Armado.js:467-471,500-505`; `src/pages/Facturacion.js:584-585` | ABIERTO | Implementador: dominio (`bultos.js`/`validacion.js`) + 2 pantallas | Preexistente |
| Info | **S-BUL-07** — `aplicarBulto` de Facturación hace efectos (`draftRef.current = ...`, `setDraftByPid`) dentro del updater de `setItemsEdit`. Hoy es idempotente (StrictMode lo corre dos veces con el mismo `prev`), pero es frágil | `src/pages/Facturacion.js:439-453` | CORREGIDO (iteración 2) | Implementador: `src/pages/Facturacion.js` | Nuevo |
| Info | **S-BUL-08** — `getProductoActual` cae a búsqueda por nombre si no matchea el id: el `bultoX` podría ser el de otro producto homónimo | `src/pages/Facturacion.js:216-220` | ABIERTO | Implementador: `src/pages/Facturacion.js` | Preexistente |

## Detalle y remediación

### S-01 / S-BUL-01 — RLS no protege estas escrituras (Crítico/Alto, preexistente)
- **Evidencia:** `movs_insert`/`movs_update` con `with check (true)` para `anon`; `pedidos` no tiene políticas versionadas en el repo (run1 S-01). `puedeUsarBulto` y los guards de `App.js` corren en el navegador.
- **Ataque:** `curl -X PATCH "$URL/rest/v1/pedidos?id=eq.N" -H "apikey: <anon>" -d '{"items":[...cantidad 999999...],"armado_log":{...}}'`. El próximo admin/armador que guarde ese pedido facturado genera el movimiento de stock por la diferencia. También se puede insertar `movimientos_stock` directo (el paso 4 de 002 solo acota signo/ref).
- **Impacto:** integridad de pedidos, deuda de clientes y stock comprometida por cualquiera que tenga el bundle.
- **Remediación (dueño):** aplicar 002 pasos 1-4 ya; paso 5 (Auth con claim `permiso`). Con Auth, ejemplo para pedidos:
  ```sql
  alter table public.pedidos enable row level security;
  create policy pedidos_upd on public.pedidos for update to authenticated
    using ((auth.jwt()->>'permiso')::int in (1,3) or vendedor_nombre = auth.jwt()->>'vendedor_nombre')
    with check ((auth.jwt()->>'permiso')::int in (1,3) or (estado <> 'facturado' and vendedor_nombre = auth.jwt()->>'vendedor_nombre'));
  -- Defensa en profundidad sin Auth (aplicable hoy): acotar el JSON de armado_log.
  alter table public.pedidos add constraint pedidos_armado_log_chk check (
    armado_log is null or (jsonb_typeof(armado_log) = 'object'
      and coalesce(jsonb_array_length(armado_log->'cambios'), 0) <= 500
      and octet_length(armado_log::text) <= 65536)) not valid;
  ```

### S-BUL-04 — Stock negativo silencioso al editar facturados (Medio, ABIERTO)
- **Impacto:** stock negativo sin aviso y cambios de deuda hechos por el armador.
- **Remediación:** en `guardarEdicion` (Facturación) y `guardarArmado` (Armado), si `pedidoFinal.estado === 'facturado'`, antes de guardar:
  ```js
  const { faltantes: sinStock, decision } = await previsualizarStockPedido(pedidoFinal, productos || []);
  if (sinStock.length && !window.confirm(`Quedarían sin stock: ${sinStock.map(f => f.nombre).join(', ')}. ¿Guardar igual?`)) return;
  if (decision === 'bloquear') { alert('Stock insuficiente'); return; }
  ```
  y evaluar si el armador (3) debe poder modificar pedidos ya facturados (hoy cambia stock y deuda).

### S-BUL-02 — Decimales hacia un ledger entero (Bajo, CORREGIDO en iteración 2)
- **Impacto:** movimiento rechazado por el servidor, queda pendiente para siempre; stock local distinto del remoto.
- **Remediación** en `src/domain/bultos.js` (no operar sobre cantidades no enteras, igual que el desglose):
  ```js
  export function sumarBulto(cantidad, bultoX, veces = 1) {
    const c = normalizarCantidad(cantidad);
    if (!Number.isInteger(c)) return c; // dato legacy: no se suma encima
    ...
  ```
  (ídem `restarBulto`). Test pendiente: `test.todo` S-BUL-02 en `src/domain/__tests__/security.bultos.test.js`.

### S-BUL-03 — Cambios "fantasma" en armadoLog (Bajo, CORREGIDO en iteración 2)
- **Impacto:** información contradictoria en Facturación (integridad de la auditoría de armado).
- **Remediación:** podar con los productos que quedan activos:
  ```js
  // Armado.js guardarArmado
  const idsFinal = new Set(itemsFinal.map(i => String(i.productoId)));
  const cambios = fusionarCambiosArmado(armando.armadoLog?.cambios, cambiosDeCantidad(armando.items, itemsFinal))
    .filter(c => idsFinal.has(c.productoId));
  ```
  o, mejor, un tercer parámetro `{ productosVigentes }` en `fusionarCambiosArmado` (puro y testeable).

### S-BUL-05 — armadoLog remoto sin límites (Bajo, CORREGIDO en iteración 2)
- **Impacto:** DoS visual y crecimiento del JSON que se re-sube en cada guardado.
- **Remediación** en `fusionarCambiosArmado`: `listaPrev.slice(0, 500)`, `nombre: String(c.nombre).slice(0, 120)` y `productoId` con largo <= 64; más el CHECK SQL de arriba.

### S-BUL-06 — Cantidades manuales sin tope (Bajo, ABIERTO)
- **Remediación:** validar en dominio con `MAX_CANTIDAD` (p. ej. `normalizarCantidadRenglon(v)` en `src/domain/bultos.js` o `validacion.js`) y usarlo en `setCantidadArmadoTexto`, en la fusión de duplicados de `guardarArmado` (`Math.min(MAX_CANTIDAD, ...)` o error) y en `guardarEdicion`.

### S-BUL-07 / S-BUL-08 (Info; S-BUL-07 CORREGIDO en iteración 2, S-BUL-08 ABIERTO)
- **S-BUL-07:** mover los efectos fuera del updater de `setItemsEdit` (calcular el nuevo array, luego `setItemsEdit(next)` y `setDraftByPid`).
- **S-BUL-08:** resolver el producto solo por id; si no matchea, no aplicar `bultoX` (o pedir confirmación).

## Verificado sin hallazgos
- **XSS:** sin `dangerouslySetInnerHTML` en el alcance; desglose y etiqueta solo contienen dígitos y texto fijo (test con regex); `armadoLog.cambios` se renderiza como texto React. El desglose no va a PDFs ni CSV/XLSX (no hay formula injection nueva).
- **Entradas numéricas:** `normalizarBultoX` rechaza NaN, Infinity, negativos, decimales, `"0x10"`, `"1e3x"`, objetos con `valueOf`, booleanos, arrays y > `MAX_CANTIDAD`; `sumarBulto` no supera `MAX_CANTIDAD` aunque se toque 1000 veces; `restarBulto` nunca da NaN ni negativo con `minimo` hostil. La DB acota `bulto_x >= 1` y el alta de productos lo acota a 1..1.000.000.
- **Roles (AC-BUL-8 / AC-SEC-4):** matriz correcta (pedido 1,2; facturación 1; armado 1,3); `puedeUsarBulto` usa `hasOwnProperty` (no se cuela `__proto__`/`constructor`) y rechaza permisos no enteros.
- **Stock:** ninguna pantalla escribe un número de stock; todo pasa por `guardarPedidoOnlineFirst -> aplicarStockPedido -> movimientosParaPedido` (diferencia contra los movimientos del ref, idempotente, UUID por movimiento). Toques rápidos usan updater funcional (sin estado viejo).
- **Prototipo:** `armado.js` usa `Map`, `productoId: "__proto__"` no contamina.
- **Secretos/logs:** los archivos nuevos no tienen `console.*`, claves ni acceso a storage.

## Corregido en esta corrida
- Nada de código de producción por parte del auditor (regla del auditor). 
- CORREGIDO por el implementador (iteración 2): S-BUL-02, S-BUL-03, S-BUL-05 y S-BUL-07, con tests (los 2 `test.todo` pasaron a tests reales; suite completa 478 passed, 1 skipped).
- Agregado `src/domain/__tests__/security.bultos.test.js`: 34 tests que fijan las propiedades seguras de arriba + 2 `test.todo` (S-BUL-02, S-BUL-03). Corrida: 34 passed, 2 todo.

## Requiere acción del dueño
- **Dueño (Supabase):** aplicar `002_seguridad_recomendada.sql` pasos 1-4, el CHECK de `armado_log` de arriba y planificar paso 5 (Auth). Sin eso, AC-BUL-8 es solo cosmético frente a un atacante con la anon key (S-01, S-BUL-01: ABIERTO).
- **Implementador (próxima iteración):** S-BUL-04 (ABIERTO). S-BUL-06 y S-BUL-08 cuando se toque esa zona.
