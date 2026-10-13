# REQ-VEN — Baja de vendedores (implementación 20261012-ven)

Bug: el botón "×" de Configuración → Vendedores llamaba solo a `deleteVendedor` (IndexedDB); Supabase conservaba la fila y el pull la volvía a bajar.
Arreglo: **baja lógica** (`activo = false`) vía RPC `admin_baja_vendedor` autorizada con el PIN del admin. El registro local NO se borra: queda `activo:false`, así el pull no lo "resucita" y el historial sigue igual.

## Archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/004_baja_vendedores.sql` | **Nuevo.** Chequeo de la 002 PASO 1 (igual a la 003), columna `activo boolean not null default true`, `grant select (activo)` (por si ya se corrió el PASO 2 de la 002), trigger `vendedor_activo_solo_rpc` (anon no puede cambiar `activo` con PATCH), RPC `admin_baja_vendedor` (security definer, `search_path = public, pg_temp`, `no_autorizado` genérico, rechaza propio admin y último admin, `pg_advisory_xact_lock`, pone `activo=false`, `pin/pin_hash=null`, `tiene_pin=false`), revoke public + grant anon/authenticated. Idempotente, sin delete. **No aplicada.** |
| `src/domain/vendedores.js` | `COLUMNAS_VENDEDOR_REMOTO` suma `activo`; `COLUMNAS_VENDEDOR_SIN_ACTIVO` (fallback); `vendedorDesdeRemoto` mapea `activo`; `interpretarEstadoRemoto` frena a un dado de baja; nuevas `estaActivo`, `filtrarActivos`, `vendedoresParaSelector`, `puedeDarDeBaja`, `argsAdminBajaVendedor`, `interpretarBajaVendedor`, `MSG_FALTA_MIGRACION_004`, `MSG_BAJA_SIN_CONEXION`, `MSG_DADO_DE_BAJA`. |
| `src/services/vendedoresService.js` | `darDeBajaVendedorAdmin` (dominio → conexión → PIN → RPC → solo con OK `updateVendedor({...v, activo:false, tienePin:false})`). `iniciarIngreso` consulta también `activo` (con fallback si falta la 004). |
| `src/sync/syncService.js` | Pull de vendedores: `REMOTO` → si falta columna `SIN_ACTIVO` → si falta `LEGACY`. |
| `src/pages/Configuracion.js` | Ya no importa `deleteVendedor`. "×" en Vendedores: sin conexión avisa; con conexión abre tarjeta "Dar de baja" con "Tu PIN de admin" (solo en estado, se limpia antes de la RPC). Lista filtrada con `filtrarActivos`; `ClienteForm` recibe `vendedoresParaSelector`. Si el dado de baja era la sesión, `seleccionarVendedor(null)`. |
| `src/components/SelectorVendedor.js` | Ingreso muestra solo activos. |
| `src/pages/Comisiones.js` | Selector "Vendedor asignado": solo activos (+ el ya elegido). Los cálculos siguen usando la lista completa (historial). |
| `src/pages/ListaPedidos.js` | Selector "Asignar vendedor" (pedidos web): solo activos. |
| `src/hooks/useAppContext.js` | No restaura sesión de un inactivo; si el vendedor de la sesión pasa a inactivo (baja local o pull), se cierra la sesión. |
| `src/pages/Configuracion.test.js`, `src/pages/__tests__/ConfiguracionAltas.test.js` | Se quitó el mock de `deleteVendedor` (la página ya no lo usa; la baja es por RPC) y se agregó `getVendedores` al mock. |
| `src/domain/__tests__/vendedores.test.js`, `src/services/__tests__/vendedoresService.test.js` | Adaptados: el select remoto ahora incluye `activo` y hay un reintento más por columna faltante. |
| Tests nuevos | `src/domain/__tests__/vendedores.baja.test.js`, `src/domain/__tests__/migracion004.test.js`, `src/services/__tests__/bajaVendedores.test.js`, `src/pages/__tests__/bajaVendedores.page.test.js`; casos nuevos en `src/components/__tests__/SelectorVendedor.test.js` y `src/hooks/__tests__/useAppContext.test.js`. |

IndexedDB: **sin cambio de `DB_VERSION`** (`activo` es una propiedad más del registro; ausente = activo).

## AC cubiertos

| AC | Dónde | Tests |
|---|---|---|
| AC-VEN-1 | RPC + `darDeBajaVendedorAdmin` + tarjeta con PIN en Configuración; sin conexión no hace nada | dominio, servicio, página, SQL |
| AC-VEN-2 | `activo=false` + `pin_hash=null` en la RPC; local `activo:false`, `tienePin:false`; el ingreso consulta `activo` en el servidor | dominio, servicio, SelectorVendedor, SQL |
| AC-VEN-3 | Filtro en ingreso, Configuración, selector de cliente, asignación de comisiones, asignación de pedidos web; pull mapea `activo` | dominio, servicio (pull), página (no reaparece tras pull), SelectorVendedor |
| AC-VEN-4 | `puedeDarDeBaja` (cliente) + RPC (servidor); cierre de sesión en `useAppContext` | dominio, servicio, página, hook, SQL |
| AC-VEN-5 | Migración 004 idempotente que requiere 002 PASO 1; fallback del pull; "Falta la migración 004 en Supabase" sin tocar nada | dominio, servicio, página, SQL |
| AC-VEN-6 | Lógica pura en `src/domain/vendedores.js` | `vendedores.baja.test.js` |

## Resultados

- `CI=true npx react-scripts test --watchAll=false`: 52 suites OK; 939 passed, 1 skipped, 2 todo (942).
- `CI=true npx react-scripts build`: OK.
- `node harness/gates/run-gates.mjs --fast`: todos los gates PASS.

## Pasos manuales (dueño)

1. Backup de Supabase (Database → Backups).
2. Confirmar que la 002 PASO 1 está aplicada (existe `public.verificar_pin`). Si no, la 004 aborta sin tocar nada.
3. SQL Editor → pegar y correr `supabase/migrations/004_baja_vendedores.sql`.
4. Publicar la versión nueva de la app.
5. Probar: Configuración → Vendedores → "×" en un vendedor de prueba → PIN de admin → "Dar de baja". Tiene que desaparecer de la lista y del ingreso, y no volver tras "Sincronizar".
6. Para reactivar a alguien (no hay botón todavía): en el SQL Editor `update public.vendedores set activo = true where id = <id>;` y después cargarle un PIN nuevo desde la app (editar vendedor).

## Notas

- Sin la 004 la app sigue andando: el pull baja sin `activo` y el botón muestra "Falta la migración 004 en Supabase".
- Un vendedor solo-local (sin `remoteId`) no se puede dar de baja hasta sincronizarlo (mensaje explícito).
- Fuera de alcance: `src/pages/Configuracion.js` tiene textos con encoding roto heredados ("ConfiguraciÃ³n" en la pantalla sin permisos); no se tocaron.
