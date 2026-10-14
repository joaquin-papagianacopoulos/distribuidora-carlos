# Plan de arquitectura — RUN 20261014-1449 — REQ-COMR (comisiones por vendedor y por rubro)

Alcance: `REQ-COMR` (AC-COMR-1..15) y los ajustes que trae en REQ-CLI (AC-CLI-1), REQ-PROD (Rubro), REQ-PLA (AC-PLA-2/3/4) y REQ-COM (AC-COM-4, AC-COM-6 c).

Fuentes leídas: `CLAUDE.md`, `harness/SPEC.md` (REQ-CLI, PROD, COM, VEN, PLA, COMR), `harness/reports/20261012-2106/plan.md`. También el código:
- `src/domain/{comisiones,clientes,vendedores,productos,plantillas,bultos,validacion}.js`;
- `src/db/index.js` y `src/db/__tests__/migracionV5|V6.test.js`;
- `src/sync/{syncService,tolerancia}.js`;
- `src/services/comisionesService.js`;
- `src/pages/{Comisiones,Configuracion}.js` (estructura) y `src/components/{ClienteForm,ProductoForm,CamposForm}.js`;
- `src/utils/pdfGen.js` (cierre);
- `supabase/migrations/001..004`;
- `harness/gates/run-gates.mjs`.

El SPEC no se toca. Las decisiones del arquitecto quedan en este plan (secciones 1 y 9).

---

## 0. Hechos del código que condicionan el diseño

| # | Hecho | Consecuencia |
|---|---|---|
| H1 | `DB_VERSION = 6` (`src/db/index.js:7`). Stores con UUID: `proveedores`, `movimientosStock`, `ingresos`, `comisionesCierres`, `comisionesBorradores` | Se pasa a **7** y se agrega el store `comisionesRubro` |
| H2 | REQ-COM identifica al vendedor **por nombre**: `cliente.vendedor`, `pedido.vendedor` y `partes[].vendedor` se comparan con `claveUnica` (`comisiones.js:237-251`). REQ-VEN hace baja **lógica** (`activo=false`) y conserva la fila. `remoteId` = `public.vendedores.id` (se compara como `id::text` en 003/004). El id local de `vendedores` es autoIncrement, **distinto en cada dispositivo** | La tabla de % se ata a `remoteId` (sección 1.1) |
| H3 | `cerrar_comisiones` (003) **recalcula y rechaza**: `comision = round(total_srv * pct / 100, 2)` por renglón, y en los ajustes `round(tot_actual * pct_base / 100, 2) - com_cerrada` (003:403-452) | Con el modelo por rubro, toda comisión distinta de 0 daría `montos_inconsistentes`. La 005 **tiene** que redefinir `cerrar_comisiones` (sección 1.4) |
| H4 | La autorización de admin en Supabase es **RPC `security definer` + id remoto del admin + PIN** verificado con `public.verificar_pin` y respuesta genérica `no_autorizado` (003 y 004). No hay Supabase Auth: con la anon key, una política RLS no puede distinguir a un admin | Para "solo admin lee y escribe" se usa el mismo mecanismo: **tabla sin grants ni políticas para anon/authenticated + RPC con PIN** (sección 1.2) |
| H5 | `syncClientes` sube `clienteExtraToRemote(c)` en un **upsert por lote** (`syncService.js:443`). PostgREST arma el `INSERT ... ON CONFLICT DO UPDATE` con la **unión de claves** de todas las filas del lote: si una sola fila trae `comision`, a las demás se les manda `null` | `comision` no puede viajar en **ninguna** fila (sección 1.3) |
| H6 | Configuración guarda clientes con `updateCliente({ ...editItem, ...data })` (`Configuracion.js:199`) y lo mismo hace la importación (`:89`). `validarCliente` hoy devuelve `comision: null` | Si el dominio deja de devolver la clave `comision`, el valor viejo local se conserva solo, por el spread |
| H7 | Las tres pantallas crean renglones con `renglonNuevo(producto)` de `src/domain/bultos.js:59` (`NuevoPedido.js:270`, `Facturacion.js:421`, `Armado.js:413`). Las ediciones posteriores hacen spread del renglón (`...i`) | Un solo punto para AC-COMR-5 |
| H8 | `pedido.items[].precio` ya trae el descuento por ítem, redondeado a 2 decimales (`Facturacion.js:529,550`). `eliminado` existe solo en pantalla, en Armado; al guardar se filtra (`Armado.js:509`) | Base por renglón = `precio × cantidad`; igual se ignoran los renglones `eliminado` |
| H9 | `comisionesService` ya resuelve el patrón "pendiente local + reintento con PIN desde la pantalla". `runSync` en segundo plano **no** reenvía nada sin PIN (S-COM-01) | La tabla de % sigue el mismo patrón |
| H10 | La plantilla de clientes ya excluye "Comisión" (corrida 2106), pero lo calcula **a partir de** `CAMPOS_CLIENTE` (`plantillas.js:88-90`). El texto del aviso dice "la comisión se carga solo desde la ficha del cliente" (`:519`) | Al sacar `comision` de `CAMPOS_CLIENTE` hay que mantener el encabezado legacy por otra vía y cambiar el texto |
| H11 | El gate `coverage-domain` exige 100 % de líneas en `src/domain/`. `traceability` busca cada `AC-*` del SPEC en algún test | Cada rama nueva necesita su test. Los 15 AC-COMR aparecen en títulos de `it(...)` |

---

## 1. Decisiones de diseño (justificadas)

### 1.1 Identidad estable del vendedor (AC-COMR-8)

**Decisión:** la tabla de % se guarda por `vendedorId = String(vendedor.remoteId)` (el `id` de `public.vendedores`). No se usa el nombre ni el id local.

- **Por qué no el nombre:** el admin puede renombrar (`admin_guardar_vendedor`), y la tabla se perdería.
- **Por qué no el id local:** es autoIncrement y cada dispositivo tiene uno distinto (H2).
- **Por qué `remoteId`:** es el único id compartido entre dispositivos y no cambia ni al renombrar ni al dar de baja.

Resolución en el cálculo: la asignación de REQ-COM sigue trabajando por **nombre**, para no romper AC-COM-7/8/17. Para cada parte se resuelve `vendedorId = vendedorIdPorNombre(parte.vendedor, vendedores)`:
- busca con `claveNombreVendedor` sobre la lista **completa**, activos y dados de baja (el nombre es único por S-VEN-01);
- el % se busca en la tabla por `(vendedorId, claveRubro)`.

Casos:
- **Renombrar:** la tabla sigue colgada del mismo `remoteId`. Los pedidos y fichas que tienen el nombre viejo ya caen hoy en el aviso (b) "sin vendedor" (comportamiento previo de REQ-COM, no cambia).
- **Baja (REQ-VEN):** la fila del vendedor sigue existiendo (`activo=false`), así que el dashboard resuelve su id y su tabla igual. Sus filas de % **no se borran**. La grilla no se ofrece para dados de baja (AC-VEN-3), y la RPC rechaza cambios a un inactivo (`vendedor_inactivo`).
- **Cierres:** cada parte congela `vendedor` (nombre), `vendedorId` y el % por rubro. Un cierre ya no necesita resolver nada después, así que ni un renombre ni una baja pueden romperlo.
- **Vendedor sin `remoteId`** (solo local, nunca sincronizado): no puede tener tabla. Sus renglones comisionan 0 con el aviso "vendedor sin sincronizar", y `puedeCerrar` bloquea el cierre hasta sincronizarlo.

### 1.2 Persistencia y RLS "solo admin" de la tabla de % (AC-COMR-7)

- **Local:** store `comisionesRubro` (v7), `keyPath: 'id'` con `crypto.randomUUID()` (vía `nuevoId`). Es único **lógico** por `(vendedorId, rubroClave)`: el dominio reutiliza el id existente si la clave ya está.
- **Remoto:** tabla `public.comisiones_rubro`, con RLS habilitado, **sin políticas** y con `revoke all` a `public, anon, authenticated`. Lectura y escritura **solo** por las RPC `admin_leer_comisiones_rubro` y `admin_guardar_comisiones_rubro` (security definer, PIN), con el mismo mecanismo de autorización que `cerrar_comisiones` y `admin_baja_vendedor`. Así un vendedor con la anon key **no puede leer** la tabla (no repetimos S-COM-03, donde los cierres quedaron legibles).
- **"Sync por upsert con `pendingSync`":** se hace con la RPC de escritura, que hace un upsert idempotente por `id` y por `(vendedor_id, rubro_clave)`. La llaman tres caminos, siempre con el PIN tipeado y nunca guardado:
  - (a) "Guardar" de la grilla;
  - (b) "Actualizar % de comisión" en Comisiones;
  - (c) `confirmarCierre`, antes de recalcular.
- **`runSync` en segundo plano no sube nada**, porque no tiene el PIN (igual que los cierres, H9). Solo cuenta los pendientes, para mostrar un aviso.
- **Limpieza de `pendingSync`:** se limpia **solo** en los ids que la RPC devolvió como aceptados (`clearPendingIn`).
- **Tolerancia a la 005 sin aplicar** (RPC inexistente: `PGRST202`/`42883`/`42P01`/`PGRST205`, el mismo `esFaltaMigracion` de comisionesService): no lanza error, los pendientes quedan pendientes y se muestra "Falta la migración 005 en Supabase: los % quedan en este dispositivo". La grilla y el dashboard funcionan con la tabla local. **Cerrar** queda bloqueado, porque el servidor no podría verificar.

### 1.3 El upsert de clientes no pisa `comision` en Supabase (AC-COMR-1)

**Decisión: no mandar nunca la columna.** Se descartó "mandar lo que ya tenía".

- `clienteExtraToRemote` deja de incluir `comision`, y `clienteExtraFromRemote` deja de mapearla (AC-COMR-1: "se quitan la validación y el mapeo").
- **Por qué no mandar lo que ya tenía:**
  - Un dispositivo puede tener el valor viejo o `null` (cliente creado después, o un pull de antes de la 001). Mandarlo **pisaría** el valor de Supabase con un dato local desactualizado.
  - Por H5, alcanza con una fila del lote que traiga la clave para que PostgREST ponga `null` en todas las demás.
  - Si no se manda, el `ON CONFLICT DO UPDATE` no toca la columna y el `INSERT` de un cliente nuevo deja `null`, el default de la 001.
- **Local:**
  - `validarCliente` deja de devolver la clave `comision`, y lo mismo `clienteVacio` y `validarFilaCliente`. Con el spread `{ ...editItem, ...data }` (H6), el valor viejo en IndexedDB se conserva.
  - El pull ya hace `...(local ?? {})` antes de mapear (`syncService.js:869`), así que el `comision` local sobrevive aunque el mapeo remoto desaparezca.
  - No se migra ni se borra nada en IndexedDB.
- **Upsert de "básicos"** (`syncService.js:427-436`): ya no incluye `comision`. No cambia.

### 1.4 Cálculo y criterio de redondeo (AC-COMR-9/10)

Toda la aritmética es entera. Se agrega una conversión **exacta**, basada en el string decimal, para que cliente y servidor (Postgres `numeric`) den exactamente lo mismo:

1. **Número válido de un renglón** (`numeroRenglon`):
   - un `number` finito sin exponente, o un `string` que cumpla `/^-?\d+(\.\d+)?$/` (sin trim, sin coma);
   - cualquier otra cosa (NaN, `"1.234,5"`, `1e21`, objeto, null) hace que el renglón sea **inválido**: cuenta 0 y da el aviso `renglon_invalido`.
   - Hay que usar la misma regla en SQL: `jsonb ->> 'precio' ~ '^-?[0-9]+(\.[0-9]+)?$'`.
2. **Precio:** `precioCents = round_half_away_from_zero(precio, 2)` sobre la representación decimal (string), sin punto flotante. Así 1,005 da 101 y 1,0049999 da 100, igual que `round(numeric, 2)` en Postgres. Se rechaza `precio < 0`.
3. **Cantidad:** tiene que ser `> 0` y cumplir `/^\d+(\.\d{1,6})?$/` (los decimales legacy de S-BUL-02 se aceptan hasta 6 dígitos).
4. **Subtotal del renglón en centavos** = `round_half_away(precioCents × cantidad)`. Con una cantidad entera es exacto, y con una decimal se escala a entero. En SQL es `round(round(precio,2) * cantidad, 2)`. **Esto no es "redondear la comisión"**: es expresar el importe vendido en centavos, igual que el `total` del pedido.
5. **% del vendedor para el rubro:** `pctCent = pct × 100` (entero, de 0 a 10000; la tabla solo admite 2 decimales).
6. **División:** `divCent = pctDivision × 100` (10000 si va 100 % a uno).
7. **Comisión de un vendedor en un pedido (un solo redondeo):**
   `montoCents_v = round_half_away( Σ_r subtotalCents_r × pctCent_v(rubro_r) × divCent_v / 10^8 )`
   - El numerador se acumula con `BigInt(...)`, porque `10^12 × 10^4 × 10^4` supera 2^53. Se usa **solo el constructor `BigInt()`**, sin literales `123n`, para no depender de Babel.
   - En SQL: `round( sum(subtotal * pct) / 100 * div / 100 , 2 )` con `numeric`, que es exacto. `round(numeric)` de Postgres redondea alejándose del cero, igual que `mulDivRedondeo` (`comisiones.js:187`).
8. **Comisión de la línea** = `Σ_v montoCents_v`. Es solo un dato técnico, para el servidor y los totales: no se muestra como "comisión del pedido" en pedidos divididos (AC-COMR-10).
9. **Total vendido repartido:** igual que hoy, `repartirCentavos(totalCents, partes)` (la última parte se lleva el resto).
10. **Desglose por rubro** (AC-COMR-12/13): para cada vendedor, `subtotal` y `pct` por rubro, y la comisión del rubro **prorrateada** con el método del mayor resto (Hamilton) a partir de `montoCents_v`, proporcional a `subtotalCents × pctCent`. Si hay empate, gana el orden alfabético de `rubroClave`. Así el desglose **suma exacto** al monto del vendedor, y no hay un segundo redondeo que cambie lo que cobra.

Verificación del ejemplo del SPEC: $1000 de Golosinas, A=5 %, B=3 %, división 50/50.
- A: 100000 × 500 × 5000 / 10^8 = 2500 centavos, o sea **$25**.
- B: 100000 × 300 × 5000 / 10^8 = 1500 centavos, o sea **$15**.

Renglones que comisionan 0, con aviso:
- `eliminado` (`String(item.eliminado) === 'true'`): no cuenta y **no genera aviso**;
- inválido: aviso `renglon_invalido`;
- sin rubro: aviso (c2);
- rubro sin % para ese vendedor (o % vaciado, `pct: null`): aviso (c1).

### 1.5 Rubro del renglón (AC-COMR-3/4/5)

- **Rubro = `producto.categoria`** (campo legacy, regla dura 3). El texto visible se normaliza con `normalizarRubro`: `texto(v, 60)`, que recorta, colapsa espacios y quita caracteres de control.
- **Clave de comparación** (`claveRubro`): primero `normalizarRubro`, después `translate` con una tabla **explícita** de acentos y por último minúsculas. Se usa una tabla explícita y **no NFD** porque el servidor tiene que replicar la clave con `public.rubro_clave()` sin depender de la extensión `unaccent`. Las dos cadenas (`ACENTOS_DESDE`/`ACENTOS_HASTA`) son constantes exportadas de `rubros.js`, y un test estático verifica que la 005 contiene exactamente las mismas.
- **Dedupe** (`resolverRubro`): si la clave ya existe, se reutiliza la escritura existente. Si hay varias escrituras para la misma clave, gana la del producto más viejo (`createdAt`, después `id`), que es determinístico.
- **`renglonNuevo(producto)`:** agrega `rubro: normalizarRubro(producto.categoria)` **solo si no es vacío**. Es aditivo: un producto sin rubro deja el renglón igual que hoy, y el test `bultos.cantidadPorDefecto.test.js:16`, que usa `toEqual`, sigue pasando.
- **Rubro efectivo del renglón** (`rubroDeRenglon(item, productosById)`):
  - `item.rubro` no vacío: ese (origen `renglon`);
  - si no, el rubro actual del producto, buscado por `String(productoId)` (origen `producto`);
  - si el producto no existe (fue borrado): sin rubro (origen `producto_borrado`).
  - En SQL: `coalesce(nullif(btrim(item->>'rubro'),''), productos.categoria)`.

### 1.6 Esquema del cierre con `modelo` (AC-COMR-13/14)

- **Cierre local / `p_cierre`:** se agrega `modelo: 'rubro'` a todo cierre nuevo. Uno sin campo se lee como `'cliente'`. `modeloDeCierre(c)` devuelve `'rubro'` si `c.modelo === 'rubro'` o si alguna línea tiene `modelo === 'rubro'`; en cualquier otro caso devuelve `'cliente'`.
- **Línea congelada** (`lineaCongelada`) de un pedido en modelo rubro:
  ```
  { tipo:'pedido', modelo:'rubro', pedidoId, fecha, clienteId, clienteNombre, cargadoPor, vendedorFicha,
    total, pct:null, comision /* Σ partes */, asignacion,
    partes: [{ vendedor, vendedorId, pct /* división */, total, monto,
               desglose: [{ rubro, rubroClave, subtotal, pct /* % del vendedor o null */, comision }] }],
    ajusteSeq: 0 }
  ```
- **Ajuste:** se agrega `modelo` = el modelo del cierre **base**. Con base `'cliente'`, la forma es la de hoy (`pct` congelado). Con base `'rubro'`, las `partes` con su `desglose` llevan la diferencia.
- **Renglón remoto** (`comisiones_cierre_pedidos`): columnas nuevas `modelo` (default `'cliente'`) y `desglose jsonb`, que **arma el servidor**. Para un `'rubro'` son `partes[{vendedor_id, pct, monto, rubros[{rubro_clave, rubro, subtotal, pct}]}]`. `pct` queda `null`.
- **Ajustes (AC-COMR-14):**
  - **Base `'cliente'`:** se usa exactamente la fórmula de hoy, `total × pct congelado`. Como el cambio de modelo no toca `pedido.total`, **no genera ajustes por sí solo**.
  - **Base `'rubro'`:** se recalcula con los ítems actuales del pedido, la **misma asignación congelada** (vendedorId + división) y el **% congelado por rubro** del desglose de la base. Para un rubro que no estaba en la base (se agregó un producto nuevo después del cierre), se usa el % **vigente** de la tabla (supuesto S6). Así, un cambio de % en la tabla **no** genera ajustes en pedidos que no cambiaron.
  - `dif_v = actual_v − (monto base_v + Σ ajustes vigentes_v)` y `dif línea = Σ dif_v`.
- **PDF / historial:**
  - `modelo 'cliente'`: `filasPdfCierre` devuelve **exactamente** lo de hoy, y `pdfComisiones.test.js` no cambia.
  - `modelo 'rubro'`: `headDetalle = ['Vendedor','Cliente','Pedido','Fecha','Rubro','Subtotal','%','Comisión']`, con una fila por (vendedor, pedido, rubro). Los ajustes de una base `'cliente'` van con Rubro `-`.
  - `pdfGen` no se toca: dibuja `headDetalle`/`detalle` de forma genérica.
- **Servidor:** `comisiones_cierres.modelo` (default `'cliente'`). La 005 **rechaza** renglones `tipo='pedido'` con modelo `'cliente'` y responde `modelo_obsoleto`. Así una PWA vieja en caché no puede cerrar con el % del cliente después del cambio (supuesto S5). Los ajustes de base `'cliente'` siguen aceptados.

---

## 2. Modelo de datos

### 2.1 IndexedDB: `DB_VERSION` 6 → **7**

En `onupgradeneeded`, un bloque nuevo **solo aditivo**, con el mismo patrón `if (!contains)` de v4/v5:
```
// v7 — REQ-COMR: % de comisión por vendedor y rubro. Solo se AGREGA el store.
if (!d.objectStoreNames.contains('comisionesRubro')) {
  const cr = d.createObjectStore('comisionesRubro', { keyPath: 'id' });
  cr.createIndex('vendedorId', 'vendedorId', { unique: false });
  cr.createIndex('clave', 'clave', { unique: false }); // `${vendedorId}|${rubroClave}`
}
```
- No toca `clientes`: la `comision` vieja queda tal cual. No hay cursor, ni `clear`, ni `deleteObjectStore`.
- El índice `clave` **no** es único a propósito: la unicidad la impone el dominio, y un duplicado de otro dispositivo se marca `obsoleto` en vez de borrarse (sección 5, R1).

Registro local `comisionesRubro`:

| Campo | Tipo | Nota |
|---|---|---|
| `id` | string UUID | `nuevoId()` (`crypto.randomUUID`) |
| `vendedorId` | string | `String(remoteId)` (1.1) |
| `vendedorNombre` | string | Informativo (para mostrar en la grilla y en los avisos) |
| `rubro` | string | Escritura visible (`normalizarRubro`) |
| `rubroClave` | string | `claveRubro(rubro)` |
| `clave` | string | `${vendedorId}|${rubroClave}` (índice) |
| `pct` | number \| null | null = "vaciado" (cuenta 0 con aviso). Nunca se borra la fila |
| `editadoAt` | number (ms) | Para last-write-wins en el servidor |
| `editadoPor` | string | Nombre del admin (informativo) |
| `pendingSync` | boolean | true hasta que la RPC acepta ese id |
| `obsoleto` | boolean? | true si el servidor canonizó otra fila con la misma clave |
| `syncRechazo` | string? | Motivo si el servidor rechazó la fila (p. ej. `vendedor_inactivo`) |
| `updatedAt` | number | |

Funciones nuevas en `src/db/index.js`, con los helpers genéricos existentes:
- `getComisionesRubro()`;
- `putComisionesRubroLocal(rows)`, que pone `pendingSync: true` y `updatedAt`;
- `putComisionesRubroRemotos(rows)`, una escritura neutral;
- `clearComisionesRubroPendingSync(ids)`, que es `clearPendingIn`.

Renglón de pedido (`pedido.items[]`): se agrega **opcionalmente** `rubro: string`. No hay migración: los pedidos viejos no lo tienen y usan el fallback (1.5).

Cierre (`comisionesCierres`): se agregan `modelo` y, en las líneas, `modelo`, `partes[].vendedorId` y `partes[].desglose`. No hace falta migrar: si falta, es `'cliente'`.

### 2.2 Supabase (`supabase/migrations/005_comisiones_rubro.sql`)

Es idempotente, va en `begin/commit` y **requiere la 002 PASO 1, la 003 y la 004**. Si falta alguna, aborta antes de tocar nada. Sin `delete`, sin `drop table`. Cabecera:

> Redefine `cerrar_comisiones` y los triggers de inmutabilidad de la 003. Si se vuelve a correr la 003, hay que volver a correr esta 005.

Esqueleto (diseño, no código final):
```sql
begin;
-- 0. Prerrequisitos: verificar_pin (002 P1), vendedor_habilitado + comisiones_cierre_pedidos (003),
--    columna vendedores.activo (004). Si falta algo: raise exception, sin tocar nada.

-- 1. Clave de rubro: ESPEJO EXACTO de claveRubro() de src/domain/rubros.js
create or replace function public.rubro_clave(p text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select nullif(lower(translate(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'),
         '<ACENTOS_DESDE>', '<ACENTOS_HASTA>')), '')
$$;

-- 2. Tabla
create table if not exists public.comisiones_rubro (
  id             text primary key check (length(id) between 1 and 64),
  vendedor_id    text not null check (length(vendedor_id) between 1 and 64),
  rubro          text not null check (length(rubro) between 1 and 60),
  rubro_clave    text not null check (length(rubro_clave) between 1 and 60),
  pct            numeric(5,2) check (pct is null or (pct >= 0 and pct <= 100)),
  editado_at     timestamptz not null default now(),
  editado_por    text check (editado_por is null or length(editado_por) <= 80),
  editado_por_id text check (editado_por_id is null or length(editado_por_id) <= 64),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint comisiones_rubro_vendedor_rubro_uq unique (vendedor_id, rubro_clave)
);
-- trigger updated_at (public.tg_set_updated_at de la 003) + trigger que impide DELETE
-- ("vaciar" = pct null; nunca se borran filas).

-- 3. RLS: solo admin. Sin políticas y sin grants => anon/authenticated no leen ni escriben.
alter table public.comisiones_rubro enable row level security;
revoke all on table public.comisiones_rubro from public, anon, authenticated;

-- 4. Lectura (solo admin con PIN)
create or replace function public.admin_leer_comisiones_rubro(p_admin_id text, p_admin_pin text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$ ... $$;
--   * Igual que cerrar_comisiones paso 1: admin = permiso 1 y vendedor_habilitado(id);
--     verificar_pin SIEMPRE; return {ok:false, motivo:'no_autorizado'} SIN raise.
--   * {ok:true, filas:[{id, vendedor_id, rubro, rubro_clave, pct, editado_at, editado_por}]}, tope 20000.

-- 5. Escritura idempotente (solo admin con PIN)
create or replace function public.admin_guardar_comisiones_rubro(p_admin_id text, p_admin_pin text, p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$ ... $$;
--   1) autorización (idéntica a 4).
--   2) pg_advisory_xact_lock(hashtext('comisiones_global')) — el MISMO lock que cerrar/anular:
--      ningún % cambia en medio de un cierre.
--   3) forma: array 1..1000; cada fila {id 1..64, vendedor_id 1..64, rubro 1..60,
--      pct number 0..100 con <= 2 decimales o null, editado_at ISO}.
--   4) por fila:
--      clave := rubro_clave(rubro) (se ignora la que mande el cliente);
--      vendedor inexistente / inactivo => rechazada ('vendedor_inexistente' / 'vendedor_inactivo');
--      si existe por id con otra (vendedor_id, clave) => rechazada ('id_en_uso');
--      si existe por id => update (last-write-wins por editado_at);
--      si no, insert ... on conflict (vendedor_id, rubro_clave) do update
--        set pct, rubro, editado_* where excluded.editado_at >= comisiones_rubro.editado_at.
--      editado_por / editado_por_id los fija el SERVIDOR (admin autenticado).
--   5) return {ok:true, filas:[{id_enviado, id, vendedor_id, rubro, rubro_clave, pct, editado_at}],
--              rechazadas:[{id, motivo}]}.

-- 6. Cierres: columnas nuevas
alter table public.comisiones_cierres add column if not exists modelo text not null default 'cliente'
  check (modelo in ('cliente','rubro'));
alter table public.comisiones_cierre_pedidos add column if not exists modelo text not null default 'cliente'
  check (modelo in ('cliente','rubro'));
alter table public.comisiones_cierre_pedidos add column if not exists desglose jsonb;
-- create or replace tg_cierre_inmutable / tg_cierre_renglon_inmutable: igual que la 003 + modelo y desglose.

-- 7. Helpers de cálculo (NO expuestos: revoke all from public, anon, authenticated)
--   comision_rubro_base(p_pedido_id text) returns table(rubro_clave text, rubro text, subtotal numeric)
--     items de public.pedidos (items::jsonb): sin eliminado='true'; precio ~ '^-?[0-9]+(\.[0-9]+)?$' y >= 0;
--     cantidad ~ '^[0-9]+(\.[0-9]{1,6})?$' y > 0; subtotal = round(round(precio,2)*cantidad,2);
--     rubro = coalesce(nullif(btrim(item->>'rubro'),''), productos.categoria where id::text = productoId).
--   comision_rubro_partes(p_pedido_id text, p_partes jsonb, p_congelado jsonb default null) returns jsonb
--     por parte {vendedor_id, pct}: monto = round(sum(subtotal * pct_v(clave)) / 100 * pct / 100, 2);
--     pct_v = congelado[vendedor_id][clave] si existe; si no, comisiones_rubro.pct; null => 0.

-- 8. create or replace public.cerrar_comisiones(jsonb, jsonb, text, text) — MISMA firma, mismo orden
--    (id -> autorización -> lock global -> idempotencia -> forma -> período -> duplicados -> lineas = renglones).
--    Cambios:
--    a) v_modelo := coalesce(p_cierre->>'modelo','cliente') in ('cliente','rubro'), si no 'cierre_invalido'.
--    b) renglón: modelo in ('cliente','rubro') (default 'cliente'); tipo='pedido' con modelo 'cliente'
--       => {ok:false, motivo:'modelo_obsoleto'}; 'rubro' sin sin_comision => partes array de 1..2
--       {vendedor_id existente, pct 0..100, monto number}, con suma de pct = 100 (en centésimos).
--    c) paso 5 (montos): 'rubro' => total_env = total_srv (igual que hoy) y cada parte.monto =
--       monto del servidor (comision_rubro_partes) y comision = Σ montos; sin_comision => 0.
--    d) ajustes: base 'cliente' => fórmula de la 003 sin cambios; base 'rubro' => actual =
--       comision_rubro_partes(pedido, base.desglose partes, base.desglose congelado) si sigue
--       facturado+entregado, si no 0; se verifica la línea y cada parte contra lo cerrado vigente por vendedor_id.
--    e) insert: renglones con modelo y desglose ARMADO POR EL SERVIDOR; cierre con modelo = v_modelo.
--    f) revoke/grant de la firma exacta, igual que la 003.
commit;
```

Por qué una sola RPC de escritura con lote, y no `from('comisiones_rubro').upsert`: el upsert directo exige un grant de `insert/update` a anon, y cualquier vendedor podría escribir la tabla, lo que viola "solo admin". El lote (≤1000) además es atómico bajo el lock.

### 2.3 Mapeo campo UI → interno → remoto

| UI | Interno | Remoto | Nota |
|---|---|---|---|
| Configuración → Vendedores → "% por rubro" → fila "Rubro" | `comisionesRubro.rubro` / `rubroClave` | `comisiones_rubro.rubro` / `rubro_clave` | La clave la recalcula el servidor |
| Ídem → "%" | `comisionesRubro.pct` (number \| null) | `comisiones_rubro.pct numeric(5,2)` | Vacío = null |
| (oculto) vendedor | `comisionesRubro.vendedorId` = `String(vendedores.remoteId)` | `comisiones_rubro.vendedor_id` = `vendedores.id::text` | 1.1 |
| Producto → "Rubro" (selector) | `productos.categoria` | `productos.categoria` | Ya se sincroniza (`syncProductos`). Ahora llega normalizada |
| (oculto) renglón | `pedido.items[].rubro` | `pedidos.items` (jsonb) | Viaja dentro de `items`, sin columna nueva |
| ~~Cliente → Comisión~~ | `clientes.comision` (legacy, se conserva y no se usa) | `clientes.comision` (no se manda más) | 1.3 |
| Cierre (historial/PDF) | `comisionesCierres.modelo`, `lineas[].modelo/partes[].desglose` | `comisiones_cierres.modelo`, `lineas` (jsonb), `comisiones_cierre_pedidos.modelo/desglose` | 1.6 |

---

## 3. Funciones puras de dominio (firma + contrato)

Todas sin React, sin IndexedDB y sin Supabase. Son robustas ante `null`, `undefined`, NaN, objetos, arrays y texto: nunca lanzan, salvo `construirCierre`, como hoy. Las ramas se cubren al 100 % (H11).

### 3.1 `src/domain/rubros.js` (nuevo)

| Firma | Contrato |
|---|---|
| `ACENTOS_DESDE`, `ACENTOS_HASTA` (strings) | Tabla explícita de acentos. La 005 usa exactamente las mismas cadenas |
| `normalizarRubro(v) -> string` | `texto(v, 60)`. Lo que no es string ni número da `''` |
| `claveRubro(v) -> string` | `normalizarRubro`, después `translate(ACENTOS)` y después `toLowerCase()`. `''` si es vacío. "golosinas", "Golosinas " y "GOLOSINAS" dan la misma clave, y "Lácteos" y "lacteos" también |
| `listarRubros(productos, extras = []) -> string[]` | Rubros distintos por clave, a partir de `productos[].categoria` y de `extras`. Escritura = la del producto más viejo (`createdAt`, después `id`). Orden alfabético `localeCompare('es')` por clave. Sin vacíos |
| `resolverRubro(texto, existentes) -> { rubro, clave, esNuevo }` | Si la clave existe, devuelve la escritura existente y `esNuevo:false`. Si no, el texto normalizado y `esNuevo:true`. Vacío: `{ rubro:'', clave:'', esNuevo:false }` |
| `rubroDeProducto(p) -> string` | `normalizarRubro(p?.categoria)` |
| `rubroDeRenglon(item, productosById) -> { rubro, clave, origen }` | `origen ∈ 'renglon'|'producto'|'sin_rubro'|'producto_borrado'` (1.5). `productosById`: `Map<string, producto>` |
| `validarPctRubro(v) -> { ok, pct, error }` | `''`/null/undefined/solo espacios dan `{ok:true, pct:null}`. String: `^\d{1,3}([.,]\d{1,2})?$` (más de 2 decimales, signos o texto, error). Number: finito y con ≤2 decimales. Rango 0..100. Casos: 0 ok; 100 ok; 100.01 error; -1 error; "5,5" da 5.5; "" da null; "abc" error; "5,555" error; "1.000" error (ambiguo) |
| `indexarTablaRubros(filas) -> Map<vendedorId, Map<clave, fila>>` | Ignora `obsoleto`. Si hay dos filas con la misma clave, gana el `editadoAt` mayor |
| `pctDe(indice, vendedorId, clave) -> number \| null` | null si no hay fila o si `pct` es null |
| `upsertPctLocal(filas, { vendedorId, vendedorNombre, rubro, pct, editadoPor }, { now, genId }) -> { ok, fila, nueva, error }` | Valida `vendedorId` no vacío, rubro no vacío y el % con `validarPctRubro`. Reutiliza el `id` de la fila con la misma clave (no obsoleta). Si no hay, usa `genId()`. Pone `pendingSync:true` y `editadoAt:now` |
| `filasGrillaVendedor({ vendedorId, rubros, filas }) -> [{ rubro, clave, pct, filaId, pendiente, rechazo }]` | Todos los rubros existentes, más los que ya estaban en la tabla de ese vendedor, en orden alfabético |
| `filaRubroToRemote(f) -> object` | `{ id, vendedor_id, rubro, rubro_clave, pct, editado_at (ISO) }` |
| `mezclarTablaRubros(locales, remotos) -> { aGuardar, obsoletos }` | No pisa locales con `pendingSync`. Una fila remota con la misma clave que una local de **otro** id, no pendiente, hace que la local vaya a `obsoletos` (patch `obsoleto:true`), sin borrar |
| `interpretarGuardarRubros({ data, error }) -> { ok, aceptados:[{idEnviado, fila}], rechazados:[{id,motivo,mensaje}], motivo, mensaje }` | `no_autorizado`, bloqueo de PIN, falta de migración (`PGRST202/42883/42P01/PGRST205`), red. Cualquier respuesta rara se trata como no autorizado |
| `vendedorIdPorNombre(nombre, vendedores) -> string \| null` | `claveNombreVendedor` sobre la lista **completa**. `String(remoteId)` o null |

### 3.2 `src/domain/comisiones.js` (cambios, todos aditivos)

| Firma | Contrato |
|---|---|
| `MODELOS_COMISION = ['cliente','rubro']`, `MODELO_VIGENTE = 'rubro'` | |
| `decimalACentavos(v) -> int \| null` | Exacto sobre el string decimal (1.4-2). Exponente, NaN o formato inválido dan null |
| `subtotalRenglonCentavos(item) -> { cents, valido }` | 1.4-1..4. `eliminado` da `{cents:0, valido:true, eliminado:true}` |
| `baseRubrosPedido(pedido, productosById) -> { porRubro:[{rubro, clave, subtotalCents}], sinRubro:[{productoId, nombre, subtotalCents}], invalidos:int }` | Agrupa por clave. Los `porRubro` salen ordenados por clave |
| `comisionParteRubro({ base, vendedorId, pctPorClave, divisionPct }) -> { montoCents, desglose:[{rubro, rubroClave, subtotal, pct, comision}], sinPct:[{rubro, clave, subtotalCents}] }` | Un solo redondeo (1.4-7, con BigInt). Desglose prorrateado por Hamilton (1.4-10). `pctPorClave(clave) -> number \| null` |
| `armarLineaRubro(pedido, { clientes, vendedores, productosById, indiceTabla, asignacionBorrador }, config) -> linea` | La misma línea que `armarLinea`, más `modelo:'rubro'` y `pct:null`. `partes[]` agrega `vendedorId` y `desglose`. `comision = Σ montos`. `comisionUnica = asignacion.modo !== 'dividir'`. `avisosRubro: { sinPct:[{vendedor, vendedorId, rubro, clave, subtotalCents}], sinRubro:[...], vendedorSinId:[...], invalidos }`. Reutiliza `validarAsignacion` y `asignacionPorDefecto` sin cambios (AC-COM-7/8/17) |
| `armarDashboard({ ..., modelo, productos, tablaRubros }, config)` | `modelo === 'rubro'` usa `armarLineaRubro`. Si falta `modelo`, usa `'cliente'`, lo de hoy: es **compatibilidad**, y los servicios siempre mandan `MODELO_VIGENTE`. Devuelve también `modelo` |
| `calcularAvisos(lineas, noEntregados, sinSincronizar)` | Agrega `c1` (vendedor + rubro sin %: `{vendedor, vendedorId, rubro, clave, pedidos, montoAfectado}`; monto = subtotal de esos renglones, y en pedidos divididos solo la parte de ese vendedor), `c2` (productos sin rubro: `{productoId, nombre, renglones, monto}`), `vendedorSinId` y `renglonInvalido`. **Mantiene** `c`/`clienteSinPct` (vacío en modelo rubro). `contadores.total` los suma a todos |
| `calcularAjustesPendientes(pedidos, cierres, config, ctx = {})` | Despacha según el `modelo` de la línea base (1.6). `ctx = { productosById, indiceTabla, vendedores }` solo hace falta para las bases `'rubro'`. Con base `'cliente'` el resultado es idéntico al de hoy |
| `resumirPorVendedor(lineas, ajustes)` | Copia `parte.desglose` y `vendedorId` al detalle. `comisionPedido = null` si la línea es `'rubro'` y `dividir` (AC-COMR-10) |
| `puedeCerrar(d)` | Motivos nuevos: vendedor sin sincronizar en alguna parte; `d.faltaMigracion005`; `d.pendientesRubro > 0` ("Sincronizá los % antes de cerrar") |
| `lineaCongelada`, `construirCierre` | Copian `modelo`, `vendedorId` y `desglose`. El cierre lleva `modelo: d.modelo` |
| `cierreToRemote(c)` | `p_cierre.modelo`; renglones con `modelo` y `partes:[{vendedor_id, pct, monto}]` (solo `'rubro'`). Lo legacy, idéntico |
| `cierreFromRemote(r, local)`, `modeloDeCierre(c)` | `modelo` (1.6) |
| `filasPdfCierre(cierre)` | Despacha con `modeloDeCierre`. Para `'cliente'` el resultado es idéntico al de hoy |
| `firmaDashboard(d)` | Agrega `[vendedorId, monto]` por parte (un cambio de % invalida la confirmación) |

### 3.3 Otros módulos de dominio

| Archivo | Cambio |
|---|---|
| `src/domain/clientes.js` | Se saca `comision` de `CAMPOS_CLIENTE` (quedan 16), de `clienteVacio`, de `validarCliente` (ni valida ni devuelve la clave), de `clienteExtraToRemote` y de `clienteExtraFromRemote` |
| `src/domain/bultos.js` | `renglonNuevo` agrega `rubro` si el producto tiene uno (1.5) |
| `src/domain/productos.js` | `CAMPOS_PRODUCTO.categoria` pasa a `tipo: 'rubro'` (misma etiqueta y orden). `validarProducto` acepta `{ rubros }` opcional y devuelve `categoria = resolverRubro(form.categoria, rubros).rubro` (AC-COMR-4). Sin `rubros`, se comporta como hoy con `normalizarRubro` |
| `src/domain/plantillas.js` | `ENCABEZADOS_EXCLUIDOS.clientes` sale de una constante legacy `['Comisión','Comision','Comisión %','% Comisión']` normalizada (ya no de `CAMPOS_CLIENTE`). `CAMPOS_EXCLUIDOS_PLANTILLA.clientes` queda `['comision']` como alias legacy. `validarFilaCliente` no devuelve `comision` (ni en altas). El texto de `avisoColumnasExcluidas` pasa a: `La columna "Comisión" se ignoró: ahora la comisión se carga por vendedor y rubro (Configuración → Vendedores).` En productos, después de `form.categoria = textoSeguro(...)` (línea que fija `security.validacion.test.js:232`), se canoniza con `resolverRubro(form.categoria, ctx.rubros)`. Los rubros de las filas ya procesadas del mismo archivo se suman a `ctx.rubros`, así que dos filas "golosinas" y "GOLOSINAS" quedan iguales |

---

## 4. Archivos a crear o modificar, en orden

El orden va de lo puro a la UI. Después de cada paso, `npm test` y el build quedan verdes.

| # | Archivo | Acción | REQ / AC |
|---|---|---|---|
| 1 | `src/domain/rubros.js` | **Crear** (3.1) | AC-COMR-3, 4, 5, 6, 8, 15 |
| 2 | `src/domain/clientes.js` | Modificar (3.3) | AC-COMR-1, AC-CLI-1 |
| 3 | `src/domain/bultos.js` | `renglonNuevo` + rubro | AC-COMR-5 |
| 4 | `src/domain/productos.js` | `tipo:'rubro'` + `resolverRubro` | AC-COMR-3, 4 |
| 5 | `src/domain/plantillas.js` | 3.3 | AC-COMR-2, 4, AC-PLA-2/3/4 |
| 6 | `src/domain/comisiones.js` | 3.2 | AC-COMR-9..15 |
| 7 | `src/db/index.js` | v7 + store + 4 funciones (2.1) | AC-COMR-7 |
| 8 | `supabase/migrations/005_comisiones_rubro.sql` | **Crear** (2.2) | AC-COMR-7, 8, 9, 13, 14, AC-SEC-5 |
| 9 | `src/sync/syncService.js` | No cambia el código de clientes: la exclusión viene de `clienteExtraToRemote`. Solo un comentario en `syncClientes` que explique por qué `comision` no viaja (H5) | AC-COMR-1 |
| 10 | `src/services/comisionesRubroService.js` | **Crear**: `cargarTablaRubros()`; `guardarPctsVendedor({ vendedor, cambios, pin })`, que valida con el dominio, hace `putComisionesRubroLocal` y, si hay PIN y conexión, llama a `syncComisionesRubro`; `syncComisionesRubro({ pin, cred })`, que sube los pendientes por RPC, limpia solo los ids aceptados, marca rechazados y obsoletos y después lee y mezcla; `contarPendientesRubro()`. Solo admin (`esAdminSesion`) | AC-COMR-6, 7, 8 |
| 11 | `src/services/comisionesService.js` | `cargarDatosComisiones` devuelve además `productos`, `tablaRubros`, `modelo: MODELO_VIGENTE`, `pendientesRubro` y `faltaMigracion005`. `confirmarCierre`: después de `syncPedidosPendientes`, corre `syncProductos()` + `downloadMaestros()` (productos y fichas frescos) y `syncComisionesRubro({ cred })` con la **misma** credencial del cierre, y recién entonces recalcula y compara la firma. `mensajeRechazo` agrega `modelo_obsoleto` ("Actualizá la app: el cierre se calcula por vendedor y rubro") y `cierre_invalido`. `pdf`: sin cambios | AC-COMR-9, 13, 7 |
| 12 | `src/components/CamposForm.js` | Prop aditiva `renderCampo={{ [key]: (props) => node }}`. Si existe, se usa en vez del input, conservando `label htmlFor="campo-<key>"`, la ayuda y el error | AC-COMR-3 |
| 13 | `src/components/SelectorRubro.js` | **Crear**: `<select id="campo-categoria">` con `— Sin rubro —`, los rubros (`listarRubros`), el valor actual si no está en la lista, y `Agregar rubro nuevo…`. Esa opción muestra `<input id="campo-categoria-nuevo">` y el botón "Usar". Si el nombre coincide con un existente, selecciona el existente y muestra "Ya existe: se usa «Golosinas»" | AC-COMR-3, 4 |
| 14 | `src/components/ProductoForm.js` | Prop `rubros` (default `[]`), `renderCampo.categoria = SelectorRubro`, y `validarProducto(valores, { ..., rubros })` | AC-COMR-3, 4 |
| 15 | `src/components/ClienteForm.js` | Sin cambio de código: toma `CAMPOS_CLIENTE` | AC-COMR-1 |
| 16 | `src/components/ComisionRubroGrid.js` | **Crear**: grilla Rubro → %, con `filasGrillaVendedor`, input por rubro (`inputMode="decimal"`) y error por fila (`validarPctRubro`). Campo PIN opcional (`CampoPin`, sin persistir) y "Guardar". Muestra pendientes y rechazos. Prop `rubroFoco` para enfocar la fila al venir desde un aviso. Si el vendedor no tiene `remoteId`, queda deshabilitada con "Sincronizá el vendedor primero". Sin cálculos propios | AC-COMR-6, 8, 11 |
| 17 | `src/pages/Configuracion.js` | Productos: pasa `rubros={listarRubros(productos)}` a `ProductoForm`, e `importarProductos` pasa `rubros` al contexto de plantilla. Vendedores: botón "% por rubro" por fila (solo `permiso === 1` y vendedor activo) que abre `ComisionRubroGrid` | AC-COMR-3, 4, 6, 8 |
| 18 | `src/pages/NuevoPedido.js`, `Facturacion.js`, `Armado.js` | **Sin cambios de código** (H7: `renglonNuevo`). Solo se verifica que ningún `map` de guardado reconstruye el renglón campo por campo; si alguno lo hace, se agrega `rubro` al spread | AC-COMR-5 |
| 19 | `src/pages/Comisiones.js` | Avisos (c1)/(c2)/vendedor sin sincronizar/renglón inválido, con contador y monto. Cada fila de (c1) tiene "Cargar %", que abre `ComisionRubroGrid` inline para ese vendedor con `rubroFoco`. Botón "Actualizar % de comisión" (PIN) que llama a `syncComisionesRubro`. Banner "Falta la migración 005" o "N % sin sincronizar". Detalle de pedido con desglose por rubro y por vendedor (rubro, subtotal, %, comisión). En pedidos divididos **no** se muestra una comisión única: una fila por vendedor. Historial: los cierres `'rubro'` muestran el desglose y los `'cliente'`, lo de hoy. **Sin aritmética en la página** | AC-COMR-10, 11, 12, 13 |
| 20 | Tests (sección 7) | Crear/modificar | Todos |

`src/utils/pdfGen.js` y `useAppContext.js` **no se tocan**.

---

## 5. Riesgos de concurrencia offline / multidispositivo y mitigación

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | Dos admins cargan offline el mismo (vendedor, rubro) con UUIDs distintos | El servidor hace el upsert por `(vendedor_id, rubro_clave)` con last-write-wins por `editado_at` y devuelve el `id` canónico. En el cliente, `mezclarTablaRubros` guarda la canónica y marca la local duplicada `obsoleto:true`, **sin borrarla** (regla dura 6). `indexarTablaRubros` ignora las obsoletas |
| R2 | Reintento de la misma subida (se corta la red después de commitear) | El upsert es idempotente por `id` y por clave natural. Reenviar el mismo `id` con el mismo `editado_at` no cambia nada. `pendingSync` se limpia solo en los ids que el servidor devolvió como aceptados |
| R3 | Se edita un % mientras otro admin cierra | Las dos RPC toman el mismo `pg_advisory_xact_lock(hashtext('comisiones_global'))`. `cerrar_comisiones` calcula con la tabla del **servidor**. El cliente sube y baja los % antes de recalcular, compara `firmaDashboard` (que ahora incluye los montos por vendedor) y, si algo cambió, pide confirmar de nuevo |
| R4 | Un dispositivo tiene la tabla, los productos o las fichas desactualizados | `confirmarCierre` corre `syncProductos` + `downloadMaestros` + `syncComisionesRubro` antes de recalcular. Si igual difiere, el servidor rechaza con `montos_inconsistentes`, y el mensaje existente dice "Actualizá y revisá". En el dashboard offline: banner con los pendientes |
| R5 | Una PWA vieja en caché cierra con el modelo por cliente | La 005 rechaza renglones `pedido` con modelo `'cliente'` (`modelo_obsoleto`). Los cierres viejos ya grabados no se tocan |
| R6 | La 005 no está aplicada | Las RPC no existen: grilla y dashboard funcionan local, el cierre se bloquea con "Falta la migración 005", y no se pierde ni se borra nada. Si la 005 no está, `cerrar_comisiones` sigue siendo la de la 003 y rechazaría los montos, pero el cliente ni llega a llamarla |
| R7 | Se vuelve a correr la 003 después de la 005 y pisa `cerrar_comisiones` | Nota en la cabecera de la 003 (solo comentario) y de la 005. Un test estático fija que la 005 redefine la **misma firma** |
| R8 | Diferencia de normalización o de redondeo entre JS y SQL | Las cadenas de acentos son compartidas (test estático); el parseo decimal es exacto, con las mismas regex en los dos lados; hay un solo redondeo en el mismo sentido (alejándose del cero). Riesgo residual: un rubro legacy con caracteres de control o un NBSP raro en `categoria`. Desde ahora los productos guardan `categoria` normalizada; si pasa, el cierre se rechaza (falla segura), no se paga mal |
| R9 | Desborde aritmético en pedidos enormes | Se usa `BigInt()` para el numerador. El build lo valida (gate) y no hay literales `n` |
| R10 | Se renombra o se da de baja a un vendedor | 1.1: la tabla va por `remoteId` y los cierres congelan id y nombre |
| R11 | Upsert de clientes que pisa `comision` | 1.3: la clave no viaja en ninguna fila. Un test sobre el payload real de `syncClientes` (lotes mixtos) lo verifica |
| R12 | Se edita un pedido después de cargarlo (Facturación/Armado): ¿se pierde `rubro`? | Todas las ediciones hacen spread del renglón (H7/H8). Un renglón agregado de nuevo toma el rubro **actual**, que es lo que pide AC-COMR-5 |
| R13 | Stock | **No se toca.** Ningún cambio escribe un número de stock: `movimientosStock` sigue siendo el único camino (regla dura 4) |

Sobre UUID e idempotencia: el único store nuevo usa UUID. Los cierres siguen idempotentes por UUID bajo el lock global. Ningún flujo agrega `delete`, ni local ni remoto: "vaciar un %" es `pct: null`.

---

## 6. Tests existentes que hay que ACTUALIZAR (no borrar, ni `skip`/`only`)

Cada uno lleva el comentario `// MOD (RUN 20261014-1449, AC-COMR-x): antes ...; ahora ... porque ...`, y el reporte final los lista.

| Archivo:línea | Qué cambia | Por qué |
|---|---|---|
| `src/domain/__tests__/clientes.test.js:8-12` | 17 etiquetas → 16, sin 'Comisión'. El título pasa a "AC-CLI-1 AC-COMR-1 ... 16 campos" | AC-COMR-1 |
| `clientes.test.js:90-102` | `comision: '150'`/`'-1'`/`'abc'`/`'2,5'` ya **no** dan error ni aparecen en `r.cliente` (`not.toHaveProperty('comision')`). El resto de las aserciones de error se mantiene | Se quita la validación |
| `clientes.test.js:113-115` | `clienteExtraToRemote` **no** tiene la clave `comision` | 1.3 |
| `clientes.test.js:119-127` | `clienteExtraFromRemote` no devuelve `comision` (la conserva el spread del pull: se prueba en syncTolerante) | Se quita el mapeo |
| `src/components/__tests__/ClienteForm.test.js:57,61,64` | 16 etiquetas | AC-CLI-1 |
| `ClienteForm.test.js:152,168` | Se saca `comision` de `llenar` y del objeto esperado | El campo no existe |
| `ClienteForm.test.js:212-215` | Pasa a afirmar que no existe `#campo-comision` ni el error `comision`. Los demás errores del caso siguen igual | AC-COMR-1 |
| `src/pages/__tests__/ConfiguracionAltas.test.js:243-247` | 17 → 16 | AC-CLI-1 |
| `src/services/__tests__/syncTolerante.test.js:133,146,196,267` | El payload esperado **no** incluye `comision`. En `:267`, `comision` sale de la lista de columnas "completas" y se agrega `expect(fila).not.toHaveProperty('comision')` para **todas** las filas del lote. `:174` (local conserva 2.5 tras el pull) se mantiene como está | 1.3 |
| `src/domain/__tests__/plantillas.test.js:63` | `toContain('comision')` pasa a `not.toContain` | AC-COMR-1 |
| `plantillas.test.js:235,243,455,456` | Alta: `comision` `toBeNull()` pasa a `not.toHaveProperty('comision')` | Se quita la clave también en altas |
| `plantillas.test.js:431` | `LABELS_CON_COMISION` se arma explícito: `[...16 etiquetas, 'Comisión']` (`CAMPOS_CLIENTE` ya no la tiene) | AC-COMR-2 |
| `plantillas.test.js:466` y `src/pages/__tests__/plantillas.page.test.js:255,269` | Texto nuevo del aviso | El texto viejo ("desde la ficha del cliente") quedó falso |
| `src/services/__tests__/plantillaExcel.test.js:141,150,156` | `comision: null` pasa a ausente. `:150` arma las columnas explícitas con 'Comisión' | Ídem |
| `plantillas.page.test.js:243,245,266` | `comision: null` pasa a `expect.not.objectContaining({ comision: expect.anything() })` / ausente | Ídem |
| `src/db/__tests__/migracionV5.test.js:40,41,48` | La versión pasa a 7. Desde v4 se crean `comisionesBorradores`, `comisionesCierres` y `comisionesRubro`. En la prueba de idempotencia, `comisionesRubro` se suma a los existentes | v7 |
| `src/db/__tests__/migracionV6.test.js:4,63` | `TODOS` incluye `comisionesRubro` (el fake `createObjectStore` es `jest.fn()` sin `createIndex`). La versión pasa a 7 | v7 |
| `src/components/__tests__/ProductoForm.test.js:116-134` | Se renderiza con `rubros: ['Bebidas']` (el `select` necesita la opción). Las aserciones de `onGuardar` no cambian | AC-COMR-3 (el Rubro ahora es un selector) |
| `src/services/__tests__/comisionesService.test.js:67,137-140` | Los fixtures suman `items` con `rubro`, `productos` y `tablaRubros` (Carlos: rubro X = 5 %), y los mocks `getComisionesRubro`, `getProductos` y `rpc('admin_leer_/guardar_comisiones_rubro')`. Los montos esperados (50 / 25 / total 75) **se mantienen** con esos datos. El payload esperado suma `modelo:'rubro'`, `pct:null` y `partes` | El servicio ahora usa el modelo vigente |
| `src/domain/__tests__/bultos.cantidadPorDefecto.test.js:16` | **Sin cambio** (el `rubro` es aditivo solo si existe). Se agrega un caso nuevo aparte | — |

Se revisan y, en principio, quedan **sin cambios**, porque el `modelo` ausente se trata como `'cliente'`:
- `comisiones.test.js`, `qa.comisiones.test.js`, `comisiones.confirmacion.test.js`, `comisiones.anulacion.ux.test.js`;
- `security.comisiones*.test.js` (las aserciones sobre la 003 siguen valiendo: la 003 no se edita salvo un comentario en la cabecera);
- `pdfComisiones.test.js`, `comisiones.page.test.js` (su mock de `cargarDatosComisiones` no trae `modelo`) y `security.comisiones.roles.test.js`.

Si alguno falla, se ajusta con la misma regla `MOD` y se documenta.

---

## 7. Plan de pruebas y matriz AC-COMR → archivos → tests

Cada `it(...)` nuevo nombra su AC.

### 7.1 Tests nuevos (resumen por archivo)

| ID | Archivo | Tipo | Contenido mínimo (SPEC "Tests y revisión") |
|---|---|---|---|
| T1 | `src/domain/__tests__/rubros.test.js` | Unit | `normalizarRubro`/`claveRubro` (mayúsculas, espacios dobles, tildes, ñ, NBSP, control, número, null, objeto). `listarRubros` (dedupe, escritura del más viejo, orden). `resolverRubro` (existente vs nuevo). `rubroDeRenglon` (guardado vs viejo sin rubro vs producto borrado vs `''`). `validarPctRubro` (0, 100, 100.01, -1, "5,5", "", "  ", "abc", "5,555", "1.000", 3 decimales numéricos, NaN, objeto). `upsertPctLocal` (reutiliza id, valida). `mezclarTablaRubros` (no pisa pendientes, marca obsoletos, no borra). `vendedorIdPorNombre` (renombrado, dado de baja, sin remoteId) |
| T2 | `src/domain/__tests__/comisiones.rubro.test.js` | Unit | Varios rubros con % distintos. Rubro sin % (0 + c1). Producto sin rubro (0 + c2). `eliminado`. Renglón inválido. Ejemplo **$25/$15** 50/50. 70/30 con tablas distintas. Modos `ficha`, `cargador`, `otro`, `sin_comision`. `comisionUnica:false` al dividir. Desglose por rubro que suma exacto (Hamilton). Avisos c1 agrupados por vendedor+rubro con contador y monto. Vendedor sin `remoteId`. `armarDashboard` con `modelo:'rubro'` vs sin modelo (legacy idéntico) |
| T3 | `src/domain/__tests__/comisiones.rubro.redondeo.test.js` | Unit | Medio centavo exacto (0,005 → 0,01; -0,005 → -0,01). % con 2 decimales (10,25). Totales grandes (10^12 centavos × 100 %, sin perder precisión, con BigInt). Un solo redondeo por pedido y vendedor (tres renglones de $0,10 al 5 % dan 0,02, no 0,00+0,00+0,00 ni 0,03). `decimalACentavos` (1.005, "1.0049999", 1e21, "1,5", NaN, null, undefined, objeto, texto). Precio negativo y cantidad 0 o negativa dan inválido |
| T4 | `src/domain/__tests__/comisiones.rubro.ajustes.test.js` | Unit | Base `'cliente'` sin cambios: 0 ajustes, aunque haya tabla de % nueva. Base `'cliente'` con total cambiado: diferencia × % congelado (igual que hoy). Base `'rubro'` editada: diferencia por rubro con % congelado. Rubro nuevo con % vigente. Cambiar la tabla sin editar el pedido: 0 ajustes. Pedido que deja de contar: ajuste negativo por vendedor. `sin_comision`: sin ajustes |
| T5 | `src/domain/__tests__/comisiones.rubro.cierre.test.js` | Unit | `construirCierre` con `modelo:'rubro'` congela `partes[].vendedorId/desglose`. `cierreToRemote` (renglones con `modelo` y `partes`; el legacy, idéntico). `cierreFromRemote`/`modeloDeCierre` (sin campo da `'cliente'`). `filasPdfCierre` rubro (head con Rubro/Subtotal, una fila por rubro) y cliente (salida idéntica a hoy). `puedeCerrar` con los motivos nuevos. `firmaDashboard` cambia si cambia un % |
| T6 | `src/db/__tests__/migracionV7.test.js` | Unit (IndexedDB simulado, como V5/V6) | Desde v6 crea **solo** `comisionesRubro` (`keyPath:'id'`, sin autoIncrement, índices `vendedorId` y `clave`). No hay `deleteObjectStore`, ni `clear`, ni cursor sobre `clientes`. Un cliente con `comision: 4` queda igual. Idempotente si el store ya existe. Versión 7 |
| T7 | `src/services/__tests__/comisionesRubroService.test.js` | Servicio (mock db + supabase) | Sube solo los pendientes y limpia **solo** los ids aceptados (otro editado durante la subida sigue pendiente). Rechazados quedan marcados. Id canónico distinto: la local queda obsoleta y no se borra. Falta la 005: no lanza, siguen pendientes, `faltaMigracion`. Sin PIN: no llama a la RPC. No admin: no hace nada. El PIN no se guarda (no aparece en IndexedDB ni en los mocks de put) |
| T8 | `src/services/__tests__/syncTolerante.test.js` (casos nuevos) | Servicio | El lote mixto (`extrasDirty` + básicos + uno con `comision` local) no lleva la clave `comision` en **ninguna** fila. Fallback legacy (PGRST204) idem. Después del pull, la `comision` local sigue igual |
| T9 | `src/services/__tests__/comisionesService.test.js` (casos nuevos) | Servicio | `cargarDatosComisiones` devuelve `modelo:'rubro'`. `confirmarCierre`: el orden de llamadas es pedidos → productos/maestros → % (con la misma cred) → RPC cierre. Con 005 faltante, no cierra. `modelo_obsoleto` se mapea a su mensaje |
| T10 | `src/domain/__tests__/migracion005.test.js` | Estático SQL | Prerrequisitos que abortan. `ACENTOS_DESDE/HASTA` idénticos a `rubros.js`. Tabla con `unique (vendedor_id, rubro_clave)`. RLS enable y `revoke all ... from public, anon, authenticated`, sin `create policy` y sin `grant` de tabla. Las RPC son `security definer`, con `search_path = public, pg_temp`, `verificar_pin` siempre, `no_autorizado` sin raise antes de autorizar, lock `comisiones_global` después de autorizar, `revoke ... from public` + `grant execute` de la firma exacta. Los helpers no tienen grant. `cerrar_comisiones` se redefine con la misma firma; el orden se conserva (autorización → lock → idempotencia); `modelo_obsoleto`; `desglose` armado por el servidor. Triggers de inmutabilidad con `modelo`/`desglose`. Sin `delete from` ni `drop table`. Todo en `begin/commit` |
| T11 | `src/domain/__tests__/security.comisionesRubro.test.js` | Seguridad (lo agrega el auditor) | RLS solo-admin de la 005 y que `rubros.js`/`ComisionRubroGrid` no logueen ni persistan el PIN |
| T12 | `src/components/__tests__/SelectorRubro.test.js` + casos en `ProductoForm.test.js` | UI | Lista ordenada. "Agregar rubro nuevo…" muestra el input. Escribir "GOLOSINAS " con "Golosinas" existente selecciona "Golosinas" y avisa. Uno nuevo queda en el select. `onGuardar` recibe `categoria` normalizada. Producto viejo con rubro fuera de la lista lo conserva |
| T13 | `src/components/__tests__/ComisionRubroGrid.test.js` | UI | Todos los rubros. Validación por fila ("100,01", "-1", "5,555" muestran error y no guardan). Vaciar queda en null. Guardar llama al servicio con los cambios. Pendientes y rechazos visibles. Deshabilitada sin `remoteId` |
| T14 | `src/pages/__tests__/comisionesRubro.config.page.test.js` | Página | Admin ve "% por rubro" en Vendedores. Vendedor (2) y armador (3) no lo ven. Dado de baja: no aparece. Configuración pasa `rubros` a `ProductoForm` |
| T15 | `src/pages/__tests__/comisiones.rubro.page.test.js` | Página | Desglose por rubro por vendedor. Pedido dividido sin comisión única. Avisos c1 (contador + monto) con "Cargar %" que abre la grilla con el rubro enfocado. c2 listado. Banner de 005 faltante y de pendientes. Vendedor/armador no ven el dashboard ni la grilla |
| T16 | `src/pages/__tests__/rubro.renglones.test.js` | Página (3 `describe`, con el mismo patrón de mocks que `bultos.pedido/facturacion/armado.test.js`) | Al agregar un producto con rubro, el renglón guardado tiene `rubro`. Después de cambiar la categoría del producto, el renglón guardado no cambia. Un pedido viejo sin `rubro` se abre, se edita y se guarda sin errores en Nuevo pedido, Facturación y Armado |
| T17 | `src/domain/__tests__/plantillas.test.js` y `src/services/__tests__/plantillaExcel.test.js` (casos nuevos) | Unit | Clientes sin columna Comisión. Un Excel viejo con Comisión se importa, se avisa con el texto nuevo y no pisa la `comision` de los existentes. Productos: "golosinas"/"GOLOSINAS " se canonizan a la escritura existente, también entre filas del mismo archivo |
| T18 | `src/domain/__tests__/bultos.cantidadPorDefecto.test.js` (caso nuevo) | Unit | `renglonNuevo` con `categoria: ' golosinas  '` da `rubro: 'golosinas'`. Sin categoría, no agrega la clave |
| T19 | `src/domain/__tests__/comisiones.rubro.pureza.test.js` | Estático | `Comisiones.js` y `ComisionRubroGrid.js` no contienen aritmética de comisión (`/ 100`, `* pct`, `BigInt`) y solo importan funciones de `src/domain/` para calcular |

### 7.2 Matriz AC-COMR → archivos → tests

| AC | Archivos de producción | Tests |
|---|---|---|
| AC-COMR-1 | `domain/clientes.js`, `components/ClienteForm.js` (indirecto), `sync/syncService.js` (comentario) | T8. MOD de `ClienteForm.test.js`, `clientes.test.js`, `ConfiguracionAltas.test.js` y `syncTolerante.test.js` |
| AC-COMR-2 | `domain/plantillas.js` | T17. MOD de `plantillas.test.js`, `plantillaExcel.test.js` y `plantillas.page.test.js` |
| AC-COMR-3 | `domain/rubros.js`, `domain/productos.js`, `components/{CamposForm,SelectorRubro,ProductoForm}.js`, `pages/Configuracion.js` | T1, T12, T14. MOD de `ProductoForm.test.js` |
| AC-COMR-4 | `domain/rubros.js`, `domain/productos.js`, `domain/plantillas.js`, `components/SelectorRubro.js` | T1, T12, T17 |
| AC-COMR-5 | `domain/bultos.js`, `domain/rubros.js` (`rubroDeRenglon`) | T1, T16, T18 |
| AC-COMR-6 | `domain/rubros.js` (`validarPctRubro`, `filasGrillaVendedor`), `components/ComisionRubroGrid.js`, `pages/Configuracion.js`, `services/comisionesRubroService.js` | T1, T13, T14 |
| AC-COMR-7 | `db/index.js` (v7), `services/comisionesRubroService.js`, `005_comisiones_rubro.sql` | T6, T7, T10, T11. MOD de `migracionV5/V6.test.js` |
| AC-COMR-8 | `domain/rubros.js` (`vendedorIdPorNombre`), `domain/comisiones.js` (`vendedorId` en partes), 005 (`vendedor_id` = `vendedores.id::text`, `vendedor_inactivo`) | T1, T2, T5, T7, T10, T14 |
| AC-COMR-9 | `domain/comisiones.js` (`decimalACentavos`, `subtotalRenglonCentavos`, `comisionParteRubro`, `armarLineaRubro`), `services/comisionesService.js`, 005 (helpers + `cerrar_comisiones`) | T2, T3, T9, T10 |
| AC-COMR-10 | `domain/comisiones.js` (`comisionUnica`, `comisionPedido:null`), `pages/Comisiones.js` | T2, T15 |
| AC-COMR-11 | `domain/comisiones.js` (`calcularAvisos` c1/c2), `pages/Comisiones.js`, `components/ComisionRubroGrid.js` (`rubroFoco`) | T2, T15 |
| AC-COMR-12 | `domain/comisiones.js` (desglose), `pages/Comisiones.js` | T2, T15 |
| AC-COMR-13 | `domain/comisiones.js` (`lineaCongelada`, `construirCierre`, `cierreToRemote/FromRemote`, `modeloDeCierre`, `filasPdfCierre`), 005 (`modelo`, `desglose`, triggers) | T5, T9, T10. `pdfComisiones.test.js` sin cambios (legacy) + caso rubro |
| AC-COMR-14 | `domain/comisiones.js` (`calcularAjustesPendientes`), 005 (ajustes por modelo base) | T4, T10 |
| AC-COMR-15 | `domain/rubros.js`, `domain/comisiones.js` | T1–T5, T19. Gate `coverage-domain` al 100 % |

Gates de cierre: `CI=true npx react-scripts test --watchAll=false`, `npx react-scripts build` y `node harness/gates/run-gates.mjs --out harness/reports/20261014-1449/gates.json`. `traceability` tiene que incluir los 15 AC-COMR, y `coverage-domain` no puede bajar del 100 % de líneas.

---

## 8. Fuera de alcance (no se implementa)

- Borrar la columna `clientes.comision` en Supabase o la propiedad local.
- Que el vendedor vea sus comisiones.
- Recalcular o modificar cierres confirmados.
- Renombrar un rubro en bloque.
- Un % por defecto por vendedor.
- Supabase Auth.
- Resolver las fichas de cliente que nombran a un vendedor renombrado (comportamiento previo de REQ-COM, aviso b).

---

## 9. Supuestos (opción conservadora elegida)

- **S1.** El `rubro` vacío o ausente en un renglón usa el rubro **actual** del producto (no solo en "renglones viejos"). Así el admin puede resolver un aviso (c2) asignando el rubro al producto, sin editar pedidos. Un renglón con rubro guardado **nunca** cambia (AC-COMR-5).
- **S2.** El precio del renglón se toma al centavo (`round(precio, 2)`) para formar el subtotal. Esto no es un redondeo de comisión. La comisión se redondea **una sola vez por pedido y por vendedor**, incluida la división.
- **S3.** La comisión **por rubro** que se muestra en el desglose y en el PDF es informativa y se prorratea con el método del mayor resto, para que sume exacto el monto del vendedor.
- **S4.** Leer la tabla de % en un dispositivo nuevo requiere el PIN del admin ("Actualizar % de comisión"). Es el costo de "solo admin lee" sin Supabase Auth.
- **S5.** Después de la 005, el servidor **rechaza** cierres de pedidos con el modelo por cliente (`modelo_obsoleto`), para que una app vieja no cierre con el % del cliente.
- **S6.** En ajustes de pedidos cerrados con el modelo nuevo, un rubro que **no** estaba en el cierre original usa el % vigente. Los rubros que ya estaban usan el % congelado.
- **S7.** El monto afectado del aviso (c1) en pedidos divididos es la parte del vendedor afectado.
- **S8.** La 003 y la 004 están (o van a estar) aplicadas **antes** de la 005. La 005 aborta si no. No se edita la 003 salvo un comentario en la cabecera ("si se re-corre, re-correr la 005").
- **S9.** Los pedidos sin renglones válidos con total mayor que 0 (p. ej. pedidos WEB sin `items`) comisionan 0 con el aviso "renglón inválido". No se usa `total` como base de reemplazo.

## 10. A confirmar con el dueño (no bloquea)

1. ¿El selector de rubro del producto tiene que permitir **renombrar** un rubro para todos los productos a la vez? Por ahora no.
2. ¿Hace falta un % "por defecto" por vendedor para rubros nuevos? Por ahora no: se avisa con 0.
3. S1: ¿un renglón cargado cuando el producto **no tenía rubro** toma el rubro que se le asigne después al producto? Por ahora sí.
4. S4: ¿le sirve pedir el PIN para bajar la tabla de % en un dispositivo nuevo, o prefiere que se pueda leer sin PIN? La segunda opción implica que cualquier vendedor con la app podría leer los % de todos.
5. S5: confirmar que, una vez aplicada la 005, ya no se puede cerrar con el % de la ficha del cliente.
6. S6: % de rubros nuevos en ajustes posteriores al cierre: ¿el vigente o 0?
7. Pendiente de la corrida anterior: "Entregado" contra "A reparto" (sigue sin cambios).
8. ¿Ya se aplicaron la 003 y la 004 en Supabase? Define el orden de despliegue: 002 P1 → 003 → 004 → 005.
