# Distribuidora App — contexto para agentes

PWA React 18 (Create React App) **offline-first**: IndexedDB local (`src/db/index.js`) + Supabase como backend (`src/sync/syncService.js`). Usuarios = vendedores con rol `permiso` (1 admin, 2 vendedor, 3 armador).

## Mapa
- `src/domain/` — **lógica de negocio pura** (sin React, sin IndexedDB). Todo lo nuevo de validación/cálculo va acá y se testea acá.
- `src/db/index.js` — stores IndexedDB. Cambios de schema ⇒ subir `DB_VERSION` y migrar en `onupgradeneeded` sin borrar datos.
- `src/sync/` — push/pull con Supabase. Patrón: `pendingSync:true` local ⇒ upsert ⇒ limpiar SOLO los ids subidos.
- `src/services/stockService.js` — orquesta stock (ledger) entre dominio, IndexedDB y sync.
- `src/pages/*` — pantallas. `src/components/*` — formularios reutilizables.
- `supabase/migrations/*.sql` — cambios de esquema remoto (se aplican a mano en el SQL editor de Supabase).
- `harness/` — harness de agentes (SPEC, pipeline, gates, runner).

## Reglas duras
1. Leer `harness/SPEC.md` antes de tocar código. Cada cambio referencia un `REQ-*`/`AC-*`.
2. No romper lo existente: `npm test` y `npm run build` deben quedar verdes.
3. Campos internos legacy se mantienen (`nombre`, `direccion`, `telefono`, `precio`, `categoria`).
4. Stock **solo** vía movimientos (`movimientosStock`), nunca escribiendo un número de stock.
5. IDs nuevos: `crypto.randomUUID()` (no autoIncrement) para tablas nuevas.
6. Nunca leer/imprimir `.env`, nunca loguear claves, nunca `git push`, nunca borrar datos de usuario.
7. Comentarios y textos de UI en español rioplatense, sin tildes rotas (archivo UTF-8).

## Comandos
- Tests: `CI=true npx react-scripts test --watchAll=false`
- Build: `npx react-scripts build`
- Gates completos: `node harness/gates/run-gates.mjs`
