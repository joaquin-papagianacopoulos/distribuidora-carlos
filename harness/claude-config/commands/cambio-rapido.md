---
description: Cambio rápido en una sola sesión (sin subagentes), con tests y gates al final. Para bugs, ajustes y features chicas/medianas.
argument-hint: "qué cambiar (y REQ/AC si existe, ej. REQ-VTA AC-VTA-3)"
---
Pedido: $ARGUMENTS

Sos un solo ingeniero haciendo el cambio de punta a punta. **No uses subagentes** ni escribas plan/informes en archivos. Objetivo: resolverlo en minutos, sin perder las reglas de `CLAUDE.md`.

## Cómo trabajar
1. **Entender (corto):** si el pedido nombra un REQ/AC, leé solo esa sección de `harness/SPEC.md` (Grep `^## REQ-` + Read con offset/limit). Buscá con Grep el código involucrado y leé solo esas partes. Si algo es ambiguo y cambia el resultado, preguntá **una vez** antes de tocar código; si no, elegí lo conservador y decilo al final.
2. **Plan en 3–5 líneas en el chat** (no en archivo) y seguí sin esperar confirmación.
3. **Implementar** respetando `CLAUDE.md`: lógica en `src/domain/` (pura), stock solo por movimientos, IDs `crypto.randomUUID()`, `DB_VERSION` + migración sin borrar datos, sync con `pendingSync`, migraciones SQL idempotentes con RLS.
4. **Tests justos:** por cada función de dominio nueva o cambiada, 1 caso feliz + los bordes que realmente importan (máx. ~5). Si hay AC, el id va en el título del `it`. No dupliques tests que ya existen; no borres ni saltees tests existentes.
5. **Verificar mientras trabajás:** `CI=true npx react-scripts test --watchAll=false --findRelatedTests <archivos tocados>`.
6. **Cierre (obligatorio):** `node harness/gates/run-gates.mjs` (todos los gates, ~30 s). Si algo falla, corregilo y volvé a correr. No termines con gates en rojo.

## Seguridad
Si el cambio toca `supabase/`, RLS, autenticación/permisos, `src/sync/`, `public/_headers` o una superficie pública nueva: revisá vos mismo (anon no puede leer/escribir de más, el servidor no confía en datos del cliente, sin secretos ni `dangerouslySetInnerHTML`) y avisá al final: "recomiendo correr `/auditar-seguridad`".

## Respuesta final (máx. 10 líneas)
Qué cambió (archivos clave), tests agregados, resultado de los gates y pasos manuales (migración SQL, deploy). Sin commit ni push salvo que te lo pida.
