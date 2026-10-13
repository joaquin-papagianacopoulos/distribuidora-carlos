# Plan técnico — RUN 20261007-2022 (fase arquitecto) — REQ-COM

Alcance: REQ-COM (AC-COM-1..16, "Cierre de comisiones") de `harness/SPEC.md`, respetando AC-SEC-1..5, AC-CLI-5 (tolerar columnas remotas faltantes) y AC-STK-* (la marca "entregado" y los cierres **no tocan el stock**).

Resumen:
- Marca **Entregado** como campos propios del pedido (`entregado`, `entregadoAt`, `entregadoPor`), independiente de `estado` y del ledger, igual que `armado`/`aReparto`.
- **Cierre** = documento inmutable con UUID (`crypto.randomUUID()` vía `nuevoId`) con el detalle congelado en JSON. El "pedido cerrado" **no** se escribe en la fila del pedido: se deriva de los cierres vigentes (fuente de verdad: tabla de renglones con índice único parcial en Supabase).
- Confirmar y anular un cierre se hace por **RPC atómica** en Supabase (requiere conexión); el borrador del período es local (offline).
- `DB_VERSION` 4 → 5 (dos stores nuevos, sin tocar los existentes). Migración nueva `supabase/migrations/003_comisiones.sql`.
- Toda la lógica (filtros, cálculo, reparto, avisos, ajustes, validaciones) en `src/domain/comisiones.js`, función pura y testeada.

Coordinación con RUN 20261007-2004 (REQ-BUL): esa corrida modifica `Facturacion.js` (edición de renglones, `ArmadoResumen`) y crea `src/domain/armado.js`/`bultos.js`. Este plan toca `Facturacion.js` **solo** en la botonera de la tarjeta del listado (L1057-1102 actual) y en las confirmaciones de `marcarPendiente`/`cancelarDesdeFacturar`; no toca el modo edición ni `armado.js`/`bultos.js`. Implementar REQ-COM **después** de que 2004 esté mergeado y re-leer el archivo antes de editar.

---

## 1. Modelo de datos

### 1.1 Marca de entregado en pedidos (AC-COM-1)

| UI | Interno (IndexedDB `pedidos`) | Remoto (`public.pedidos`) | Nota |
|---|---|---|---|
| Botón "Marcar entregado" / "Desmarcar" | `entregado: boolean` | `entregado boolean not null default false` | No cambia `estado` ni genera movimientos |
| (fecha/hora de la marca) | `entregadoAt: number (ms) \| null` | `entregado_at timestamptz` | ISO al subir, `Date.parse` al bajar |
| (quién marcó) | `entregadoPor: string \| null` | `entregado_por text` | Sale de `getNombreUsuarioSesion()` (S-20), no de localStorage |
| (reintento de subida) | `entregaPendiente: boolean` | — (solo local) | `true` si Supabase no tenía las columnas (PGRST204/42703) |

- Sin índice nuevo en `pedidos` (se filtra en memoria como hoy). El objeto pedido solo gana propiedades opcionales: pedidos viejos sin `entregado` ⇒ `false`.
- Solo un pedido con `estado === 'facturado'` y no borrado se puede marcar. Desmarcar está permitido siempre que esté marcado.
- Pedidos que sean `facturado` y estén en un cierre vigente: desmarcar solo admin y con confirmación ("va a quedar como ajuste pendiente", AC-COM-13).

### 1.2 Cierre de comisiones (AC-COM-10..12, 16)

**IndexedDB — store nuevo `comisionesCierres`** (keyPath `id`, UUID, sin autoIncrement; índices `estado`, `desde`):

```
{
  id: 'uuid-v4',                 // nuevoId() => crypto.randomUUID()
  desde: 'YYYY-MM-DD', hasta: 'YYYY-MM-DD',
  cerradoAt: number, cerradoPor: string,          // admin de la sesion
  estado: 'vigente' | 'anulado' | 'pendiente' | 'rechazado',
  //   pendiente = se mando la RPC y no hubo respuesta (red); se reintenta por UUID
  //   rechazado = el servidor lo rechazo (conflicto con otro cierre); solo local
  anuladoAt, anuladoPor, motivoAnulacion,         // AC-COM-12
  totales: { pedidos, clientes, totalVendido, totalComision,
             porVendedor: [{ vendedor, pedidos, clientes, totalVendido, totalComision }] },
  detalle: [ // congelado vendedor -> cliente -> pedido
    { vendedor, totalComision, clientes: [
      { clienteId, clienteNombre, pct, pedidos: [
        { pedidoId /* remoteId string */, fecha, total, pct, comision,
          tipo: 'pedido' | 'ajuste', ajusteDeCierreId?, ajusteSeq?,
          asignacion: { modo, partes: [{ vendedor, pct, monto }] } } ] } ] } ],
  renglones: [ { pedidoId, tipo, ajusteSeq, comision, total } ], // plano, para la RPC y la derivacion
  conflictos?: [pedidoId],                        // si estado = 'rechazado'
  pendingSync: boolean, createdAt, updatedAt
}
```

**IndexedDB — store nuevo `comisionesBorradores`** (keyPath `id` = `periodo:<desde>:<hasta>`, solo local, no se sincroniza; AC-COM-9):

```
{ id, desde, hasta, asignaciones: { [pedidoId]: { modo, vendedor?, pctFicha?, pctCargador? } }, updatedAt }
```

**Supabase** (ver §4): `comisiones_cierres` (cabecera + JSON congelado) y `comisiones_cierre_pedidos` (un renglón por pedido/ajuste, con `vigente` e índice único parcial). Ambas `id`/claves `text` (UUID generado en el dispositivo), como `movimientos_stock`.

### 1.3 Cómo se marca un pedido como cerrado (AC-COM-11)

- **No** se agrega `cierre_id` a la fila de `pedidos`. Motivo: `pedidoToRemoteRow`/`toRemoteRow` hacen *last-writer-wins* sobre la fila completa; un dispositivo con copia vieja del pedido (armador marcando "a reparto") pisaría `cierre_id` con `null` y el pedido volvería a contarse. Es el mismo error que el SPEC prohíbe para el stock.
- Fuente de verdad remota: `comisiones_cierre_pedidos(pedido_id, vigente)` con **índice único parcial** `(pedido_id) where vigente and tipo='pedido'` ⇒ imposible que un pedido esté en dos cierres vigentes (AC-COM-16).
- Localmente: `pedidosEnCierresVigentes(cierres)` (dominio) devuelve `Map<pedidoId, cierreId>` a partir de los cierres `vigente` y `pendiente`. La UI muestra el badge "Cerrado (cierre dd/mm)" en Facturación y el dashboard lo excluye.
- Anular ⇒ RPC pone `estado='anulado'` y los renglones `vigente=false` ⇒ los pedidos vuelven a estar disponibles.

### 1.4 Identidad de pedido, cliente y vendedor

- `pedidoId` de comisiones = `String(pedido.remoteId)`. Pedidos sin `remoteId` (cargados offline, sin subir) **no se pueden cerrar**: aparecen en un aviso "pedido sin sincronizar" y bloquean el cierre hasta sincronizar (conservador).
- Cliente: `pedido.clienteId` ⇒ `clientes.id` (mismo id local/remoto, `syncClientes` sube por `id`). Fallback por `clienteNombre` normalizado si `clienteId` es null (pedidos viejos), con aviso.
- Vendedor de la ficha: `cliente.vendedor` (texto, REQ-CLI). Vendedor que cargó: `pedido.vendedor ?? pedido.vendedorNombre`. Comparación con `claveUnica()` (minúsculas, sin tildes, trim).
- % de comisión: `cliente.comision` (0–100, REQ-CLI), congelado en el cierre.

---

## 2. Cambios de IndexedDB (`src/db/index.js`)

- `DB_VERSION = 5`. En `onupgradeneeded`, **solo agregar** (patrón existente `if (!d.objectStoreNames.contains(...))`):
  ```
  // v5 — REQ-COM. Claves UUID.
  comisionesCierres   { keyPath: 'id' }  indices: estado, desde
  comisionesBorradores{ keyPath: 'id' }
  ```
  Nada se borra ni se re-crea; `pedidos` no cambia de schema (campos nuevos son propiedades).
- Funciones nuevas (con helpers genéricos ya existentes `getAllFrom`, `putManyInto`, `clearPendingIn`):
  - `getComisionesCierres()`, `putComisionCierreLocal(c)` (marca `pendingSync:true`, `updatedAt`), `putComisionesCierresRemotos(rows)`, `clearComisionesCierresPendingSync(ids)`.
  - `getComisionBorrador(id)`, `putComisionBorrador(b)`, `deleteComisionBorrador(id)` (se borra **solo** al confirmar el cierre del mismo período; es un borrador, no dato de negocio).
- `importBackup` **no** se toca (no limpia los stores nuevos: no se borran cierres al importar un backup).
- `onblocked` existente ya avisa si otra pestaña tiene la v4 abierta.

---

## 3. Sync push/pull tolerante

### 3.1 Entregado en pedidos (`pedidoRepository.js` + `syncService.js`)

- Mapeo centralizado en dominio: `pedidoEntregaToRemote(p)` y `pedidoEntregaFromRemote(r, local)` (en `src/domain/comisiones.js`), usados por **ambos** `toRemoteRow` (pedidoRepository) y `pedidoToRemoteRow`/`mapPedidoRemoto` (syncService), para no duplicar lógica.
- Push online (`guardarPedidoInterno`): si el `update`/`insert` falla con `esColumnaInexistente(error)` ⇒ reintentar **sin** las claves `entregado*` y guardar local con `synced:true, entregaPendiente: <tenía entregado distinto de default>`. No restaurar el original ni tirar error (hoy un error de columna haría rollback local y el usuario perdería la marca).
- Push diferido (`syncPedidosPendientes`): mismo fallback para updates e inserts. Además, una pasada extra para pedidos `synced && entregaPendiente && remoteId`: `update({entregado, entregado_at, entregado_por}).eq('id', remoteId)`; si OK ⇒ `patchRegistros('pedidos', [id], { entregaPendiente:false })`; si sigue faltando la columna ⇒ se deja y se avisa una sola vez (reusar el flag `avisoMigracion` con mensaje de la 003).
- Pull (`mapPedidoRemoto`): `r.entregado !== undefined ? !!r.entregado : !!local?.entregado` (igual que `armado`/`a_reparto`). Si `local.entregaPendiente` ⇒ conservar los valores locales de `entregado*`.
- Se reutiliza `esColumnaInexistente` (exportado de syncService); mover el helper a `src/sync/tolerancia.js` **no** hace falta (evitar ruido de diff).

### 3.2 Cierres (`src/services/comisionesService.js`, nuevo)

- **Confirmar (AC-COM-10/16)**: requiere `navigator.onLine`.
  1. `syncPedidosPendientes()` (que suba marcas de entregado) + `pullPedidosByRango(desde, hasta)` + `pullCierres()`.
  2. Recalcular el dashboard con datos frescos (dominio). Si cambió algo respecto de lo que el admin vio ⇒ volver a mostrar la confirmación.
  3. `cierre = construirCierre(...)` con `id = nuevoId()`; guardar local `estado:'pendiente', pendingSync:true` (transacción local antes de llamar a la red: si el teléfono se apaga, se reintenta).
  4. `supabase.rpc('cerrar_comisiones', { p_cierre, p_renglones })`. Resultado:
     - `{ ok:true }` o `{ ok:true, ya_existia:true }` (reintento del mismo UUID) ⇒ local `estado:'vigente', pendingSync:false`.
     - `{ ok:false, conflictos:[...], motivo }` ⇒ local `estado:'rechazado', conflictos`, `pendingSync:false`; mensaje "Otro admin ya cerró N de estos pedidos; actualizá y revisá".
     - Error de red/timeout ⇒ queda `pendiente`; `syncComisiones` reintenta la RPC con el **mismo UUID** (idempotente).
     - `PGRST202`/`42883` (RPC inexistente) o `42P01`/`PGRST205` (tabla inexistente) ⇒ borrar el cierre local pendiente (nunca llegó) y mostrar "Falta correr supabase/migrations/003_comisiones.sql". No se permite un cierre solo-local.
- **Anular (AC-COM-12)**: requiere online. `validarAnulacion` (dominio) ⇒ `rpc('anular_cierre_comisiones', { p_id, p_por, p_motivo })` ⇒ local `estado:'anulado'`. Con error de red: guardar local con `anulacionPendiente:{por, motivo, at}` y `pendingSync:true`; mientras tanto el cierre **sigue contando como vigente** localmente (conservador: no liberar pedidos que el servidor todavía considera cerrados).
- **`syncComisiones()`** (llamado en `runSync` después de `syncStock`, **solo si el usuario es admin**, en try/catch propio como `syncDeudas`):
  - Push: reintentar cierres `pendiente` (RPC cerrar) y `anulacionPendiente` (RPC anular).
  - Pull: `select * from comisiones_cierres order by updated_at` paginado, completo (tabla chica). `mergeRemotos` sin pisar locales con `pendingSync`. Cierres `rechazado` locales se conservan (son solo locales, para que el admin vea qué pasó).
  - Tabla inexistente ⇒ `{ ok:true, skipped:true }` + `console.warn` (sin datos sensibles; AC-SEC-1).
- **Pull de pedidos del período**: nueva `pullPedidosByRango(desde, hasta)` en `syncService.js` (paginado por 500, `gte/lte('fecha')`, sin filtro de vendedor, sin borrar locales; reutiliza `mapPedidoRemoto` + `putPedidosRemotosSinPisarLocales`). Hoy el admin solo tiene en local los ~300 pedidos recientes: sin esto el dashboard del mes estaría incompleto.

---

## 4. Migración SQL `supabase/migrations/003_comisiones.sql`

Idempotente, `begin/commit`, comentarios en español, mismo estilo que la 001.

1. **Pedidos**: `alter table public.pedidos add column if not exists entregado boolean not null default false; ... entregado_at timestamptz; ... entregado_por text;` + CHECK `not valid` `length(coalesce(entregado_por,'')) <= 80`.
2. **`comisiones_cierres`**:
   ```
   id text primary key (check length(id) <= 64),
   desde date not null, hasta date not null, check (desde <= hasta),
   cerrado_at timestamptz not null, cerrado_por text not null (len <= 80),
   estado text not null default 'vigente' check (estado in ('vigente','anulado')),
   anulado_at timestamptz, anulado_por text, motivo_anulacion text (len 3..300),
   check (estado = 'vigente' or (anulado_at is not null and anulado_por is not null and length(trim(motivo_anulacion)) >= 3)),
   total_vendido numeric(16,2), total_comision numeric(16,2),
   totales jsonb not null, detalle jsonb not null,
   created_at timestamptz default now(), updated_at timestamptz default now()
   ```
   índices `updated_at`, `(desde, hasta)`.
3. **`comisiones_cierre_pedidos`**:
   ```
   cierre_id text not null references comisiones_cierres(id) on delete restrict,
   pedido_id text not null, tipo text not null check (tipo in ('pedido','ajuste')),
   ajuste_seq int not null default 0,
   total numeric(16,2), comision numeric(16,2), vigente boolean not null default true,
   primary key (cierre_id, pedido_id, tipo, ajuste_seq)
   ```
   - `create unique index ... (pedido_id) where vigente and tipo = 'pedido';` ⇒ AC-COM-16.
   - `create unique index ... (pedido_id, ajuste_seq) where vigente and tipo = 'ajuste';` ⇒ un mismo ajuste no se cobra en dos cierres concurrentes.
4. **Triggers**: `set_updated_at` (reusa `public.tg_set_updated_at` de la 001); `tg_cierre_inmutable`: en UPDATE solo se permite `vigente → anulado` cambiando `estado/anulado_*/motivo_anulacion/updated_at`; cualquier otra columna ⇒ `raise exception` (AC-COM-11). Renglones: solo `vigente true → false`.
5. **RPC `cerrar_comisiones(p_cierre jsonb, p_renglones jsonb) returns jsonb`** — `security definer`, `set search_path = public`:
   - Si ya existe `id` ⇒ `{ok:true, ya_existia:true}` (idempotencia).
   - Valida que `cerrado_por` sea un vendedor con `permiso = 1` (defensa mínima; ver riesgos).
   - Valida que cada `pedido_id` exista en `pedidos` con `estado='facturado'` y `entregado` (para `tipo='pedido'`); los que no ⇒ `{ok:false, motivo:'pedido_invalido', conflictos}`.
   - Inserta cabecera + renglones en la misma transacción; `exception when unique_violation` ⇒ devuelve `{ok:false, motivo:'ya_cerrado', conflictos:[pedidos en otro cierre vigente]}` (todo se revierte).
   - Límites: máx. 5000 renglones, tamaño de `detalle` acotado.
6. **RPC `anular_cierre_comisiones(p_id text, p_por text, p_motivo text) returns jsonb`** — security definer: valida admin, motivo 3..300 chars, estado actual `vigente`; actualiza cabecera y pone `vigente=false` en sus renglones. Anular uno ya anulado ⇒ `{ok:true, ya_anulado:true}`.
7. **RLS (AC-SEC-5)**: `enable row level security` en ambas tablas. Políticas: **solo `select`** para `anon, authenticated`. Sin políticas de insert/update/delete ⇒ toda escritura pasa por las RPC. `revoke insert, update, delete, truncate on ... from anon, authenticated;` `grant execute` de las dos RPC a `anon, authenticated`, `revoke all ... from public` antes (patrón de la 002).
8. Comentario de cabecera: "La app tolera que esto no se haya corrido: la marca Entregado queda local (entregaPendiente) y Comisiones muestra 'falta migración 003' sin dejar cerrar."

---

## 5. Funciones puras de dominio — `src/domain/comisiones.js` (AC-COM-15)

Imports: `redondear2`, `toNum`, `texto`, `claveUnica`, `nuevoId`, `esFechaISO`, `hoyISO` de `./validacion`; `normalizePedidoFecha`/`isPedidoOculto` se re-implementan o se importan de `../utils/pedidos` (puros, sin React/IDB). Todo el dinero se opera en **centavos enteros** y se devuelve en pesos con 2 decimales.

```js
export const ESTADOS_CIERRE = ['vigente', 'anulado', 'pendiente', 'rechazado'];
export const MODOS_ASIGNACION = ['ficha', 'cargador', 'dividir', 'otro', 'sin_comision'];
export const MAX_MOTIVO = 300;

// ---- Permisos (AC-COM-2, AC-SEC-4) ----
puedeVerComisiones(permiso): boolean                // solo Number(permiso) === 1
puedeMarcarEntregado(pedido, permiso): { ok, motivo? } // facturado, no borrado, permiso 1 o 3
puedeDesmarcarEntregado(pedido, permiso, cerradoEn?): { ok, requiereConfirmacion, motivo? }

// ---- Entregado (AC-COM-1) ----
marcarEntregado(pedido, entregado, usuario, now = Date.now()): pedido   // no toca estado/items/total
pedidoEntregaToRemote(p): { entregado, entregado_at, entregado_por }
pedidoEntregaFromRemote(r, local): { entregado, entregadoAt, entregadoPor } // tolerante a undefined

// ---- Período (AC-COM-3) ----
periodoPorDefecto(now = new Date()): { desde: 'YYYY-MM-01', hasta: ultimo dia del mes }
validarPeriodo({ desde, hasta }): { ok, errores: { desde?, hasta? }, periodo }  // ISO validas, desde <= hasta, rango <= 366 dias

// ---- Dinero (AC-COM-4, AC-COM-15) ----
aCentavos(n): number | null           // NaN/Infinity/no numerico => null
porcentajeValido(v): number | null    // 0..100, acepta "10,5"; fuera de rango/NaN/'' => null
calcularComision(total, pct): { comision: number, aviso: null | 'sin_pct' | 'total_invalido' }
   // round2(total * pct / 100) via centavos; pct null => 0 + 'sin_pct'; total NaN/negativo => 0 + 'total_invalido'
repartirComision(comision, asignacion): Array<{ vendedor, pct, monto }>
   // 'dividir': monto1 = round(c * pct1/100) en centavos, monto2 = c - monto1 (suma exacta); 'sin_comision' => []

// ---- Asignacion (AC-COM-7, AC-COM-8) ----
vendedorDeFicha(cliente): string | null
vendedorQueCargo(pedido): string | null
esCargaDeOtroVendedor(pedido, cliente, vendedores): boolean
   // true si ambos existen, difieren (claveUnica) y el que cargo es vendedor permiso 2 de la lista
asignacionPorDefecto(pedido, cliente, vendedores): asignacion
   // ficha => { modo:'ficha', partes:[{vendedor: ficha, pct:100}] }; sin ficha => { modo:null } (bloquea)
validarAsignacion(input, { pedido, cliente, vendedores }): { ok, errores, asignacion }
   // dividir: pctFicha + pctCargador === 100 (enteros o 2 decimales, sin NaN, 0..100), default 50/50
   // 'otro' (cliente sin ficha): vendedor debe existir en la lista; 'sin_comision' valido
   // modo invalido / vendedor inexistente => error

// ---- Filtro y armado del dashboard (AC-COM-3, 5, 6, 13) ----
pedidosEnCierresVigentes(cierres): Map<pedidoId, cierreId>       // vigente + pendiente (+ anulacionPendiente)
clasificarPedidos(pedidos, periodo, cerrados): {
  incluidos, noEntregados /* (d) */, sinSincronizar, yaCerrados }
   // facturado && !oculto && fecha en [desde,hasta] (fecha del pedido, normalizada)
calcularAvisos(incluidos, noEntregados, clientes, vendedores): {
  cargadoPorOtro: [...], clienteSinVendedor: [...], clienteSinPct: [...], noEntregados: [...],
  sinSincronizar: [...], contadores: { a, b, c, d, total } }
calcularAjustesPendientes(pedidosTodos, cierres): Array<{ pedidoId, cierreId, comisionCerrada,
  comisionActual, diferencia, ajusteSeq, asignacion }>
   // por pedido en cierre vigente: base = comision congelada + sum(ajustes vigentes); actual = comision con el % congelado
   // si borrado/no facturado/no entregado => actual 0; diferencia != 0 => ajuste
armarDashboard({ pedidos, clientes, vendedores, cierres, borrador, periodo }): {
  lineas, ajustes, avisos, resumenPorVendedor, totales, bloqueos }
resumirPorVendedor(lineas): Array<{ vendedor, pedidos, clientes, totalVendido, totalComision,
  detalle: [{ clienteId, clienteNombre, pedidos:[...] }] }>
   // un pedido dividido suma 1 pedido y su parte de comision a cada vendedor; totalVendido se reparte con el mismo %

// ---- Cierre (AC-COM-8, 10, 11, 12) ----
puedeCerrar(dashboard): { ok, motivos: string[] }
   // bloquea: cliente sin vendedor sin asignar, divisiones invalidas, pedidos sin sincronizar,
   //          0 lineas y 0 ajustes, montos invalidos
construirCierre(dashboard, { periodo, admin, now = new Date(), genId = nuevoId }): cierre  // congelado, deep copy
validarAnulacion(cierre, motivo, usuario): { ok, errores, patch }  // motivo trim 3..MAX_MOTIVO, solo 'vigente'
cierreToRemote(c): { p_cierre, p_renglones }
cierreFromRemote(r, local): cierre

// ---- Borrador (AC-COM-9) ----
claveBorrador(periodo): string               // 'periodo:YYYY-MM-DD:YYYY-MM-DD'
aplicarBorrador(dashboard, borrador): dashboard   // asignaciones de pedidos que ya no estan se ignoran
```

Contratos/bordes clave (van a la tabla de tests):

| Función | Entrada | Salida |
|---|---|---|
| `calcularComision` | `(1000, 5)` | `{ comision: 50, aviso: null }` |
| | `(333.33, 7.5)` | `25` (24.99975 ⇒ 25.00) |
| | `(0.005, 100)` / `(1.005, 10)` | redondeo por centavos, sin error de float |
| | `(1000, null)` / `(1000, '')` / `(1000, 'abc')` / `(1000, 150)` | `{ 0, 'sin_pct' }` |
| | `(NaN, 5)` / `(-100, 5)` / `('x', 5)` / `(Infinity, 5)` | `{ 0, 'total_invalido' }` |
| `repartirComision` | `(10, dividir 50/50)` | `[5, 5]` |
| | `(0.01, dividir 50/50)` | `[0.01, 0]` (la suma da exacto) |
| | `(100, dividir 33.33/66.67)` | `[33.33, 66.67]` |
| `validarAsignacion` | dividir `60/50`, `NaN/100`, `-10/110` | error "la suma tiene que dar 100 %" / "% inválido" |
| `clasificarPedidos` | pedido facturado no entregado | va a `noEntregados` (aviso d), no a `incluidos` |
| | pedido `eliminado`/`cancelado`/`borrado:true` | excluido |
| | fecha `2026-10-31T23:00` con hasta `2026-10-31` | incluido (se normaliza) |
| | pedido en cierre vigente | `yaCerrados` |
| `calcularAjustesPendientes` | cerrado con total 1000 al 5 %, editado a 1200 | ajuste `+10` |
| | cerrado y luego revertido a pendiente / borrado | ajuste `−50` |
| | ajuste ya incluido en otro cierre vigente | no reaparece |
| | cierre anulado | sus pedidos vuelven a `incluidos`, sin ajuste |

Validación en dominio, no solo en la UI (AC-SEC-2): `motivo` y nombres pasan por `texto()` (trim, largo máximo, sin caracteres de control); `pct` por `porcentajeValido`; fechas por `esFechaISO`.

---

## 6. Archivos a crear / modificar (en orden)

| # | Archivo | Acción | REQ/AC |
|---|---|---|---|
| 1 | `src/domain/comisiones.js` | **crear**: funciones de §5 | AC-COM-1, 3..13, 15, SEC-2, SEC-4 |
| 2 | `src/domain/__tests__/comisiones.test.js` | **crear** | AC-COM-3..13, 15 |
| 3 | `src/domain/__tests__/security.comisiones.test.js` | **crear**: NaN/negativos/strings, motivo largo/control chars, permisos forjados (`'1'` string, undefined) | AC-COM-15, SEC-2, SEC-4 |
| 4 | `supabase/migrations/003_comisiones.sql` | **crear** (§4) | AC-COM-1, 11, 12, 16, SEC-5 |
| 5 | `src/domain/__tests__/migracion003.test.js` | **crear**: lee el SQL con `fs` y verifica RLS habilitado, sin `for delete`/`for all` en tablas de cierres, índice único parcial, `security definer` + `search_path`, `if not exists` | AC-COM-16, SEC-5 |
| 6 | `src/db/index.js` | **modificar**: `DB_VERSION=5`, stores v5, funciones §2 | AC-COM-9, 16 |
| 7 | `src/services/pedidoRepository.js` | **modificar**: `toRemoteRow` usa `pedidoEntregaToRemote`; fallback por columna inexistente sin rollback; nueva `marcarEntregadoOnlineFirst(pedido, valor)` (usa `guardarPedidoOnlineFirst` sin `iniciarStock`) | AC-COM-1, CLI-5 |
| 8 | `src/sync/syncService.js` | **modificar**: `pedidoToRemoteRow`/`mapPedidoRemoto` con entregado tolerante; fallback en `syncPedidosPendientes`; pasada `entregaPendiente`; nueva `pullPedidosByRango` | AC-COM-1, 3, CLI-5 |
| 9 | `src/services/__tests__/entregadoSync.test.js` | **crear**: PGRST204 ⇒ reintento sin columnas + `entregaPendiente`; pull sin columna conserva local; marcar no genera movimientos | AC-COM-1, CLI-5, STK-* |
| 10 | `src/services/comisionesService.js` | **crear**: `cargarDatosComisiones`, `guardarBorrador`, `confirmarCierre`, `anularCierre`, `syncComisiones` (§3.2) | AC-COM-9, 10, 11, 12, 16 |
| 11 | `src/services/__tests__/comisionesService.test.js` | **crear** (supabase mockeado) | AC-COM-9, 10, 11, 12, 16 |
| 12 | `src/hooks/useAppContext.js` | **modificar**: paso `6d. syncComisiones` en `runSync` solo si admin, con try/catch propio | AC-COM-16 |
| 13 | `src/utils/pdfGen.js` | **modificar**: `generarCierreComisionesFile(cierre)` (jsPDF + autotable, mismo estilo que faltantes): resumen por vendedor + detalle cliente/pedido + "ANULADO: motivo" si corresponde | AC-COM-14 |
| 14 | `src/pages/Comisiones.js` | **crear**: guard `puedeVerComisiones` (devuelve "No tenés permisos" si no es admin); selector período; avisos con contadores; resumen por vendedor (expandible a cliente → pedido); asignación por pedido con aviso (a)/(b); ajustes pendientes; botón "Cerrar comisiones" con modal de confirmación con totales; historial con anular (motivo obligatorio) y PDF | AC-COM-2..14 |
| 15 | `src/App.js` | **modificar**: tab `{ id:'comisiones', label:'Comisiones', icon:'\u{1F4B5}' }`; `visibleTabs` ya filtra no-admin (solo agrega para admin); render `{tab === 'comisiones' && isAdmin && <Comisiones />}` | AC-COM-2, SEC-4 |
| 16 | `src/pages/Facturacion.js` | **modificar (mínimo)**: en tarjetas `facturado` botón "Marcar entregado"/"Desmarcar" + badge "Entregado"/"Cerrado"; en `marcarPendiente` y `cancelarDesdeFacturar`, si el pedido está en un cierre vigente, texto extra en el `confirm` ("quedará como ajuste pendiente") | AC-COM-1, 13 |
| 17 | `src/pages/OrdenEntrega.js` | **modificar**: card nueva "Entregas" con fecha (default hoy de reparto ⇒ pedidos de ayer, mismo criterio que imprimir), lista de pedidos facturados del día con botón marcar/desmarcar (visible para admin y armador; vendedor ve solo el estado) | AC-COM-1 |
| 18 | `src/pages/__tests__/comisiones.page.test.js` | **crear** | AC-COM-2, 5, 6, 7, 8, 10, 12, 14 |
| 19 | `src/pages/__tests__/entregado.facturacion.test.js`, `entregado.ordenEntrega.test.js` | **crear** | AC-COM-1 |
| 20 | `src/pages/__tests__/security.roles.test.js` | **agregar casos**: vendedor/armador no ven tab ni renderizan `Comisiones` aunque `tab='comisiones'` | AC-COM-2, SEC-4 |

**No se tocan:** `src/domain/stock.js`, `src/services/stockService.js` (la marca y el cierre no generan movimientos), `src/domain/armado.js`, `src/domain/bultos.js`, modo edición de `Facturacion.js`, migraciones 001/002.

---

## 7. Riesgos de concurrencia offline / multidispositivo y mitigación

| Riesgo | Mitigación |
|---|---|
| Dos admins cierran el mismo período desde dos dispositivos (AC-COM-16) | Índice único parcial `(pedido_id) where vigente and tipo='pedido'` + RPC atómica: el segundo recibe `ya_cerrado` con la lista y su cierre queda `rechazado` (no vigente). Antes de confirmar se hace pull de cierres para minimizar el caso. |
| Reintento de la RPC tras timeout duplica el cierre | UUID generado en el cliente antes de llamar; la RPC es idempotente por `id` (`ya_existia`). Cierre local `pendiente` + `pendingSync` hasta respuesta definitiva. |
| Cierre hecho offline cuenta pedidos que otro admin ya cerró | No se permite confirmar offline (conservador). Borrador sí funciona offline (AC-COM-9). |
| Marca "cerrado" pisada por last-writer-wins en `pedidos` | No se escribe en la fila del pedido; se deriva de `comisiones_cierre_pedidos`/cierres vigentes (§1.3). |
| `entregado` pisado por un dispositivo con copia vieja del pedido | Riesgo **preexistente** del modelo de pedidos (igual que `a_reparto`): la fila se sube completa. Mitigación parcial: `syncLock`/`synced:false` ya protegen ediciones locales; el dashboard trabaja con el pull fresco del período. Anotado para un REQ futuro (updates parciales por columna). |
| Columnas `entregado*` no existen todavía en Supabase | Reintento sin esas claves (patrón `upsertTolerante`), `entregaPendiente` local y reintento en cada sync; pull conserva el valor local si `r.entregado === undefined` (AC-CLI-5). |
| Pedido sin `remoteId` (offline) | No se puede cerrar ni ajustar; aviso "sin sincronizar" y bloqueo del cierre. |
| Dashboard incompleto (el admin solo tiene pedidos recientes en local) | `pullPedidosByRango` al abrir la pantalla y antes de confirmar; si está offline, banner "datos posiblemente incompletos, conectate para cerrar". |
| Pedido editado después del cierre (otro dispositivo) | Ajuste pendiente calculado contra el detalle congelado (AC-COM-13); el ajuste lleva `ajusteSeq` con índice único ⇒ no se cobra dos veces. |
| Anulación con red caída | `anulacionPendiente` local; el cierre sigue contando como vigente hasta que el servidor confirme (no se liberan pedidos antes de tiempo). |
| Cambio del % o del vendedor en la ficha después de cerrar | El cierre guarda `pct` y asignación congelados; los ajustes usan el % congelado. |
| Renombrar un vendedor rompe la coincidencia ficha/cargador (son textos) | Comparación con `claveUnica`; si el nombre de la ficha no existe en `vendedores`, se trata como cliente sin vendedor (aviso b). Anotado. |
| Seguridad: la app entra con la anon key; cualquiera puede llamar las RPC | RLS solo-lectura + escritura solo por RPC con validación de admin (permiso 1) y de datos; sin DELETE. Igual que la 002: la protección real requiere Supabase Auth (PASO 5). Si la 002 está aplicada, opcional: pedir PIN del admin y validar con `verificar_pin` dentro de la RPC (no se hace en este REQ). |
| Stock | Ninguna acción de este REQ genera ni modifica `movimientosStock`; marcar/desmarcar llama a `guardarPedidoOnlineFirst` **sin** `iniciarStock` y con `estado` igual ⇒ `movimientosParaPedido` devuelve `[]` (test explícito). Nunca se sincroniza un número de stock. |
| Upgrade de IndexedDB bloqueado por otra pestaña en v4 | `onblocked` existente avisa; la migración v5 solo agrega stores. |

---

## 8. Plan de pruebas (AC → test)

Runner: `CI=true npx react-scripts test --watchAll=false`. Tests de página con el patrón de `security.roles.test.js` (`react-dom/client` + `act`, `jest.mock` de `useAppContext`, `db`, servicios y `pdfGen`). No se agregan dependencias. Cada `it(...)` lleva el ID `AC-COM-n` en el título.

| AC | Unit dominio (`comisiones.test.js`, `security.comisiones.test.js`) | Servicio / sync | Página | Otro |
|---|---|---|---|---|
| **AC-COM-1** | `marcarEntregado` setea los 3 campos y no toca `estado/items/total`; desmarcar limpia `At/Por`; `puedeMarcarEntregado` false si no facturado/borrado; `pedidoEntregaFromRemote` con `undefined` conserva local | `entregadoSync.test.js`: PGRST204 ⇒ reintento sin claves + `entregaPendiente`; siguiente sync sube solo `entregado*`; `marcarEntregadoOnlineFirst` ⇒ 0 movimientos de stock | Facturación: botón solo en facturados, toggle llama al repositorio con `entregado:true` y mismo `estado`. Orden: lista del día, armador ve botón, vendedor no | — |
| **AC-COM-2** | `puedeVerComisiones` 1 ⇒ true; 2, 3, `'1'` forjado tras `setUsuarioSesion`, undefined ⇒ false | — | `security.roles.test.js`: tab ausente para 2/3; `Comisiones` con vendedor muestra "No tenés permisos" | — |
| **AC-COM-3** | `periodoPorDefecto` (mes en curso, incluido febrero bisiesto); `validarPeriodo`; `clasificarPedidos` (facturado+entregado, borrados/cancelados fuera, borde de fechas, ya cerrados fuera) | `pullPedidosByRango` pagina y no borra locales | — | — |
| **AC-COM-4** | `calcularComision` tabla §5 (redondeo 2 decimales, sin %, total inválido) | — | — | — |
| **AC-COM-5** | `resumirPorVendedor`: pedidos, clientes distintos, total vendido, comisión; pedido dividido cuenta en ambos | — | Click en vendedor despliega clientes y pedidos | — |
| **AC-COM-6** | `calcularAvisos` (a) (b) (c) (d) con contadores; WEB/admin cargador no dispara (a) | — | Avisos arriba con contador visible | — |
| **AC-COM-7** | `asignacionPorDefecto` = ficha; `validarAsignacion` ficha/cargador/dividir 50/50 default, suma ≠ 100 rechaza; `repartirComision` suma exacta | — | Pedido con aviso (a): selector de 3 opciones, dividir con inputs 50/50 | — |
| **AC-COM-8** | `puedeCerrar` bloquea cliente sin vendedor sin asignar; permite tras `otro` o `sin_comision` | — | Botón "Cerrar" deshabilitado con motivo | — |
| **AC-COM-9** | `claveBorrador`, `aplicarBorrador` ignora pedidos que ya no están | Guardar borrador ⇒ `putComisionBorrador`; reabrir ⇒ asignaciones restauradas; confirmar ⇒ borrador eliminado | Desmontar y volver a montar conserva la asignación | — |
| **AC-COM-10** | `construirCierre`: UUID (genId inyectado), período, admin, fecha, detalle vendedor→cliente→pedido congelado (deep copy, mutar el input no lo cambia) | `confirmarCierre`: guarda `pendiente` ⇒ RPC ok ⇒ `vigente`; RPC llamada con `p_renglones` correctos | Modal de confirmación con totales por vendedor antes de llamar | — |
| **AC-COM-11** | `pedidosEnCierresVigentes`; pedido cerrado no aparece en otro período | Cierre `vigente` excluye pedidos en recálculo | Badge "Cerrado" en Facturación | Migración: trigger inmutable presente |
| **AC-COM-12** | `validarAnulacion` motivo vacío/espacios/> 300 rechaza; solo vigente | `anularCierre` ⇒ RPC ⇒ `anulado`, pedidos disponibles; red caída ⇒ `anulacionPendiente` y sigue vigente localmente | Historial muestra "Anulado" con quién/cuándo/motivo | — |
| **AC-COM-13** | `calcularAjustesPendientes`: total editado, revertido, borrado, desmarcado; ajuste ya cerrado no reaparece; cierre anulado no genera ajuste | — | Sección "Ajustes pendientes" con diferencia; confirm extra en Facturación al revertir pedido cerrado | — |
| **AC-COM-14** | — | — | Botón PDF llama `generarCierreComisionesFile(cierre)` (mock) | `pdfGen`: test del builder con jsPDF mockeado (filas resumen + detalle) |
| **AC-COM-15** | Todo lo anterior + NaN, Infinity, strings con coma, negativos, `null`, porcentajes 0 y 100, suma 99.99/100.01 | — | — | — |
| **AC-COM-16** | — | RPC `ya_existia` ⇒ vigente sin duplicar; `ya_cerrado` ⇒ `rechazado`; RPC inexistente ⇒ mensaje migración, sin cierre local; `syncComisiones` reintenta pendientes con el mismo UUID; pull no pisa `pendingSync` | — | `migracion003.test.js` (RLS, índices únicos parciales, sin DELETE); test de `db` (si hay mock de IDB) o revisión manual de `onupgradeneeded` v5 |

Gates: `node harness/gates/run-gates.mjs` (tests + build verdes). QA manual: correr la 003 en un proyecto de prueba y verificar dos navegadores cerrando el mismo período.

---

## 9. Supuestos (opción conservadora elegida)

1. **Confirmar y anular cierres requiere conexión.** La persistencia es offline-first (store local, UUID, `pendingSync`, reintento idempotente), pero la decisión de cerrar se valida en el servidor para garantizar AC-COM-16. El borrador sí es offline.
2. El borrador de asignaciones es **local al dispositivo** (no se sincroniza). Dos admins con borradores distintos no se pisan; lo que vale es el cierre confirmado.
3. Pedidos sin `remoteId` bloquean el cierre (aviso "sincronizá primero").
4. Total del pedido = `pedido.total` (lo facturado), no se recalcula desde los ítems.
5. Total no numérico o negativo ⇒ comisión 0 + aviso "monto inválido" (no se paga lo dudoso).
6. Aviso (a) solo si quien cargó es un vendedor con `permiso 2` de la lista. Pedidos cargados como "WEB" o por el admin van al vendedor de la ficha sin aviso (a), con nota informativa.
7. Ajustes (AC-COM-13) se calculan con el **% congelado** del cierre original y se asignan con la **misma asignación** congelada.
8. Desmarcar "entregado" en un pedido cerrado cuenta como "cambio" ⇒ ajuste pendiente; solo lo puede hacer el admin.
9. Pueden marcar entregado: **admin y armador** (en Orden de entrega); el vendedor solo ve el estado. En Facturación solo admin (la pantalla ya es solo admin).
10. Período por fecha del pedido inclusiva en ambos extremos; máximo 366 días.
11. El total vendido de un pedido dividido se reparte entre vendedores con el mismo % (para que la suma del resumen dé el total real).

## 10. A confirmar con el dueño

- ⚠ **"Entregado" vs "A reparto"** (SPEC): ¿alcanza con "A reparto"? El plan implementa la marca nueva; si alcanzara con "A reparto", `clasificarPedidos` cambiaría una sola condición (`entregado` ⇒ `aReparto`) y se ahorraría la UI de AC-COM-1.
- ¿Quién marca entregado en la calle (armador, vendedor, repartidor)? Hoy: admin + armador (supuesto 9).
- ¿Pedidos "WEB" o cargados por el admin generan comisión para el vendedor de la ficha? (supuesto 6).
- Ajustes negativos (pedido cerrado que se anula después): ¿se descuentan del próximo cierre del vendedor aunque deje su total negativo?
- ¿Se puede cerrar sin conexión? (supuesto 1: no).
- Si el % de comisión de la ficha cambia a mitad de mes, ¿se usa el % vigente al cerrar (lo que dice el SPEC) para todos los pedidos del período? El plan sigue el SPEC.
