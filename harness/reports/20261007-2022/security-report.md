# Auditoría de seguridad — RUN 20261007-2022 — REQ-COM (cierre de comisiones) + login online (S-COM-13)

Alcance: `supabase/migrations/003_comisiones.sql` (RLS, RPC `security definer`, triggers, locks), `supabase/migrations/002_seguridad_recomendada.sql` (PASO 1 y PASO 2, `verificar_pin`, `admin_guardar_vendedor`), `src/domain/vendedores.js` (nuevo), `src/services/vendedoresService.js` (nuevo), `src/components/SelectorVendedor.js`, `src/hooks/useAppContext.js`, `src/services/sesion.js`, `src/db/index.js` (DB_VERSION 6), `src/sync/syncService.js` (vendedores), `src/pages/Configuracion.js` (tab vendedores), `src/domain/comisiones.js`, `src/services/comisionesService.js`, `src/services/pedidoRepository.js`, `src/pages/Facturacion.js` y `src/pages/OrdenEntrega.js` (solo el llamado a `marcarEntregadoOnlineFirst`).
Fuera de alcance por pedido del orquestador: los cambios en paralelo de bultos (`src/domain/bultos.js` y "+ Bulto" en NuevoPedido/Facturacion/Armado, AC-BUL-9).
No se leyó `.env` (está en `.gitignore`; `git ls-files .env` no lo encuentra). No se modificó código de producción y no se agregaron tests en esta verificación. Las migraciones 002 y 003 **no están aplicadas** en Supabase y no se ejecutaron contra un Postgres real: lo del servidor se auditó leyendo el SQL y con los tests estáticos existentes.

Esta versión del reporte incorpora la **verificación de la iteración 3** del implementador (sección "Iteración 3" de `implementacion.md`).

## Resumen ejecutivo

La iteración 3 cierra en código los cuatro hallazgos pedidos:
- **S-COM-13:** el login ya no compara contra un PIN local. Valida solo con `rpc('verificar_pin')`, el pull de vendedores usa select explícito sin `pin`, la DB v6 quita la propiedad `pin` sin borrar registros, toda escritura local pasa por `sinPinLocal` (incluido `importBackup`) y las altas/ediciones van por `admin_guardar_vendedor` con el PIN del admin. Queda **efectivo recién cuando el dueño aplique la 002 PASO 1 + PASO 2 y rote el PIN del admin**, porque el PIN actual ya fue legible.
- **S-COM-15:** locks por pedido en orden, `ajuste_seq` asignado por el servidor y anulación bloqueada si hay ajustes vigentes en otros cierres.
- **S-COM-16:** una sola respuesta `no_autorizado`, `verificar_pin` se llama siempre, `cerrado_por_id` para la idempotencia y el mismo criterio en `admin_guardar_vendedor` de la 002.
- **S-COM-17:** los dos llamadores pasan `cerradoEn`.

**Login (pregunta del orquestador): mejora en lo que importa y no empeora el bypass.** El bypass de UI por estado local (S-BUL-01) sigue igual: se puede forjar `sesionVendedor` en localStorage o el registro en IndexedDB. Pero ahora el dispositivo **ya no tiene el PIN**, así que el atacante consigue solo la UI y no la credencial que piden las RPC del servidor (comisiones, vendedores). Antes conseguía las dos cosas.

Hallazgos nuevos de esta verificación:
- **S-COM-18** (Medio): después de verificar en el servidor, el login usa el registro **local** (permiso, nombre, remoteId). El `permiso` que devuelve el servidor se descarta. Un vendedor que edita IndexedDB entra con la UI de admin usando su propio PIN o ninguno. Se corrige en código.
- **S-COM-19** (Medio): la auto-alta "+ Agregar vendedor" de la pantalla de ingreso crea un usuario sin PIN, con nombre y zona libres. Las comisiones y los filtros van por **nombre**, así que alguien puede hacerse pasar por un vendedor existente. La decisión es del dueño.
- **S-COM-20** (Bajo): `admin_guardar_vendedor` no exige en el servidor que un admin tenga PIN (la regla está solo en el cliente). Tampoco impide degradar al último admin.
- **S-COM-21** (Bajo): hasta 5000 advisory locks por transacción (uno por pedido) pueden agotar la tabla de locks compartida de Postgres en un cierre grande. Hay que confirmarlo en staging.
- **S-COM-14** empeora en disponibilidad: como el login ahora es online, 5 PIN malos bloquean también el **ingreso** del usuario atacado durante 15 minutos (antes bloqueaban solo el cierre y la anulación).

Conteo (abiertos):
- 1 Crítico (S-01, preexistente)
- 2 Alto (S-BUL-01 y S-DEP-01, preexistentes)
- 5 Medio (S-COM-03, S-COM-06, S-COM-14, S-COM-18 nuevo, S-COM-19 nuevo)
- 3 Bajo (S-COM-20 nuevo, S-COM-21 nuevo, S-HDR-01)
- 1 Info (S-COM-22 nuevo)
- CORREGIDO: 14 hallazgos (S-COM-01, 02, 04, 05, 07, 08, 09, 10, 11, 12, 13, 15, 16, 17) y 9 controles (C-COM-01 a C-COM-09).

Estados usados:
- **ABIERTO**: sin corregir. La columna "Dónde se corrige" indica si lo arregla el implementador (código de este run), si es SQL que hay que cambiar antes de aplicarlo, o si es acción del dueño (Supabase Auth o aplicar la 002).
- **CORREGIDO**: verificado en código/SQL con evidencia archivo:línea y con test. `CI=true npx react-scripts test --watchAll=false` da 46 suites OK: 842 passed, 1 skipped, 2 todo (845).

## Tabla de hallazgos

| Severidad | Hallazgo | Evidencia | Estado | Dónde se corrige | Origen |
|---|---|---|---|---|---|
| Crítico (CVSS 9.1) | **S-01 (run1)**: el servidor no tiene autenticación. La anon key escribe `pedidos` (`estado`, `total`, `fecha`, `entregado`). Hasta que se aplique el PASO 2, también lee `vendedores.pin` en texto plano. El recálculo de la 003 confía en `pedidos.total`, `estado` y `entregado`, que se pueden manipular | `002_seguridad_recomendada.sql:199-211` (PASO 2 todavía comentado); `pedidos` sin políticas en el repo; `003_comisiones.sql:352-362,375-381` confía en `public.pedidos` | ABIERTO | Dueño: aplicar la 002, pasos 1-4, y el paso 5 (Supabase Auth) | Preexistente |
| Alto (CVSS 7.1) | **S-BUL-01 (run 20261007-2004)**: el rol y la sesión salen del estado local y se pueden forjar. `sesionVendedor` (12 h) vive en localStorage sin firma: con `{"id":"<id local del admin>","exp":9e15}` más `vendedorActual={"id":...}` se restaura la sesión de admin sin PIN, incluso offline. La iteración 3 **no lo empeora**: lo mejora, porque el PIN ya no está en el dispositivo y el atacante obtiene solo la UI, no la credencial de las RPC | `src/services/sesion.js:19-26`; `src/hooks/useAppContext.js:252-266` (`!tienePin(found) \|\| sesionValidada(found.id)`) | ABIERTO | Dueño: Supabase Auth (002 paso 5) con claim `permiso` en el JWT | Preexistente |
| Alto (CVSS 7.5) | **S-DEP-01**: `xlsx@0.18.5` (Prototype Pollution GHSA-4r6h-8v6p-xvw6 y ReDoS GHSA-5pgg-2g8v-p4x9, sin fix en npm). `react-scripts` está en `dependencies`, así que `npm audit --omit=dev` reporta las vulnerabilidades del tooling | `package.json:15,17` | ABIERTO | Dueño: instalar `xlsx` desde el CDN de SheetJS (>=0.20.2) y mover `react-scripts` a `devDependencies` | Preexistente |
| Medio (CVSS 5.4) | **S-COM-18 (nuevo)**: el login confía en el registro local después de la verificación del servidor. (a) `iniciarIngreso` devuelve el `permiso` del servidor, pero `trySelect` llama a `seleccionarVendedor(v)` con el `v` local, así que un vendedor que cambia su `permiso` a 1 en IndexedDB entra como admin sin PIN. (b) `verificarPinIngreso` usa el `remoteId` local: si se pone el `remoteId` propio en el registro del admin y se tipea el PIN propio, el servidor responde `true` y se entra con nombre y permiso del admin. (c) Un registro sin `remoteId` y sin PIN entra sin consultar a nadie (`decidirIngreso` → `entrar`), con el permiso que tenga. Limitado a la UI: las RPC de comisiones y vendedores siguen pidiendo el PIN del admin | `src/components/SelectorVendedor.js:101-102,126-131`; `src/services/vendedoresService.js:43,49-55`; `src/domain/vendedores.js:77` | ABIERTO | Implementador: ver Detalle (usar la fila del servidor después de verificar; solo-local ⇒ permiso 2). Definitivo: Auth | Nuevo (iteración 3) |
| Medio (CVSS 5.3) | **S-COM-19 (nuevo)**: auto-alta sin PIN en la pantalla de ingreso. Cualquiera con la URL de la PWA crea un vendedor (`permiso 2`, sin PIN) con **nombre y zona libres** y entra. Las comisiones (`buscarVendedor` por `claveUnica(nombre)`) y el pull de pedidos de un vendedor (`vendedorNombre`) van por nombre: con el nombre de un vendedor real se ven sus pedidos y se cargan pedidos a su nombre. `downloadMaestros` además baja todos los clientes | `src/components/SelectorVendedor.js:52-81,179-183`; `src/sync/syncService.js:718-731`; `src/domain/comisiones.js:237-240`; `src/hooks/useAppContext.js:315-318` | ABIERTO | Dueño (decisión): quitar el botón o pedir el PIN del admin (`admin_guardar_vendedor`); en SQL, después del PASO 2, `revoke insert on public.vendedores from anon, authenticated` y un índice único en `lower(trim(nombre))` | Preexistente (lo marca la iteración 3 como residual) |
| Medio (CVSS 5.9) | **S-COM-14**: el bloqueo de PIN se puede usar como DoS. `verificar_pin` bloquea 15 minutos después de 5 fallos **por `vendedor_id`**, sin mirar el origen, y está otorgada a `anon`. **Empeora en la iteración 3:** como el login es online, el atacante deja sin poder **ingresar** a cualquier usuario con PIN, no solo sin cerrar ni anular. La fuerza bruta de un PIN de 4 dígitos sigue en unos 480 intentos por día | `002_seguridad_recomendada.sql:108-113,120,124`; `src/domain/vendedores.js:86,92`; `003_comisiones.sql:241,502` | ABIERTO | Dueño/SQL 002: bloqueo por id + origen, backoff creciente, PIN de admin de 6 o más dígitos (`PIN_REGEX` hoy acepta 4) y alerta. Definitivo: Auth | Preexistente, agravado |
| Medio (CVSS 5.3) | **S-COM-03**: `comisiones_cierres` y `comisiones_cierre_pedidos` se pueden leer con `using (true)` para `anon`. AC-COM-2 y AC-SEC-4 se cumplen solo en la UI | `003_comisiones.sql:548-558` | ABIERTO | SQL 003 (RPC de lectura con PIN) o dueño (Auth + política por `permiso`) | Iteración 1 |
| Medio (CVSS 4.3) | **S-COM-06**: un pedido facturado y cerrado se puede editar con la anon key (`PATCH pedidos.total`, S-01). El próximo cierre genera un ajuste que el servidor valida contra ese mismo `pedidos.total` manipulado, y lo acepta | `003_comisiones.sql:386-412` | ABIERTO | Dueño: Auth/RLS en `pedidos`, o un trigger que impida cambiar `total` en un pedido con renglón vigente | Iteración 1, raíz S-01 |
| Bajo (CVSS 2.7) | **S-COM-20 (nuevo)**: `admin_guardar_vendedor` no valida en el servidor que un admin tenga PIN. Con el PIN de un admin se puede crear un `permiso = 1` sin `p_pin_nuevo`, o mandar `p_borrar_pin` a un admin. Ese admin queda sin PIN y entra con un toque (`iniciarIngreso` → `tiene_pin=false` → `entrar`). La regla está solo en `validarFormVendedor`. Tampoco se impide degradar al último admin (deja la base sin admin). Además, un `p_vendedor_id` inexistente devuelve `null` y el cliente lo muestra como "PIN de admin incorrecto" | `002_seguridad_recomendada.sql:146-172`; `src/domain/vendedores.js:135-136,168-170` | ABIERTO | SQL 002 (ver Detalle) | Nuevo (iteración 3) |
| Bajo (CVSS 3.7) | **S-COM-21 (nuevo)**: cantidad de locks. `cerrar_comisiones` toma un `pg_advisory_xact_lock` por cada pedido distinto (hasta 5000) y `anular` uno por cada pedido del cierre. La tabla de locks compartida mide `max_locks_per_transaction (64) × max_connections` (unos 3840 en las instancias chicas de Supabase). Un cierre anual grande puede fallar con *out of shared memory* y, mientras dura, hacer fallar locks de otras sesiones. Requiere el PIN del admin | `003_comisiones.sql:269-271` (hasta 5000 renglones), `:312-316`, `:522-526` | ABIERTO (confirmar en staging) | SQL 003: reemplazar los locks por pedido por **un solo lock global** de comisiones (los cierres son raros), o por cubetas `hashtext(...) & 255` distintas y ordenadas | Nuevo (iteración 3) |
| Bajo (CVSS 3.1) | **S-HDR-01**: la CSP está en `Content-Security-Policy-Report-Only`, así que no bloquea nada | `public/_headers:7` | ABIERTO | Dueño: pasarla a `Content-Security-Policy` después de una semana sin reportes | Preexistente |
| Info | **S-COM-22 (nuevo)**: dos residuos de la iteración 3. (1) Login *fail-open* si falta la 002 PASO 1: cuando no existe la columna `tiene_pin`, `iniciarIngreso` deja entrar a cualquier usuario sin PIN local. Solo aplica si se publica la app antes de la 002 (el orden documentado lo evita). (2) El "no oráculo" de S-COM-16 es cosmético mientras siga S-01: el grant por columna del PASO 2 deja legibles `permiso` y `tiene_pin`, así que `GET /rest/v1/vendedores?select=id,nombre&permiso=eq.1` lista a los admins. Además, `verificar_pin` vuelve antes, sin bcrypt, cuando el id no tiene hash (canal de tiempo sobre "tiene PIN") | `src/services/vendedoresService.js:37-39`; `002_seguridad_recomendada.sql:115-118,205-208` | ABIERTO | (1) Respetar el orden de despliegue. (2) Auth | Nuevo |
| Alto → resuelto | **S-COM-13**: el PIN que protegía las RPC era legible. **Login:** `trySelect` sin conexión no entra; con PIN valida solo con `rpc('verificar_pin', { p_vendedor_id: String(remoteId), p_pin })` y únicamente `data === true` habilita; el PIN se borra del estado antes de la llamada; sin PIN local se confirma con el servidor. **Pull:** select explícito `id,nombre,zona,permiso,tiene_pin` (con fallback legacy) y `vendedorDesdeRemoto` no copia `pin`. **IndexedDB v6:** un cursor en `onupgradeneeded` hace `cursor.update(sinPinLocal(v))`, sin `delete` ni `deleteObjectStore`; `putVendedoresBatch`, `addVendedor`, `updateVendedor` e `importBackup` pasan por `sinPinLocal`. **Altas/ediciones:** Configuración llama a `guardarVendedorAdmin` → `rpc('admin_guardar_vendedor')` con el PIN del admin (input `password`, `autoComplete="off"`) y los dos PIN se vacían antes de llamar; local sin `pin`, solo después del OK. La auto-alta inserta `nombre`, `zona` y `permiso: 2`, sin `pin`. No hay PIN en `console.*` ni en localStorage | `src/components/SelectorVendedor.js:95-136`; `src/services/vendedoresService.js:24-97`; `src/domain/vendedores.js:21-23,26,32-43,48-61,90-99`; `src/sync/syncService.js:718-758,884-891,900-911`; `src/db/index.js:7,88-102,206,331,449,574`; `src/pages/Configuracion.js:228,271-293,670-682` | CORREGIDO (código; efectivo cuando el dueño aplique 002 PASO 1 + PASO 2 y rote el PIN del admin; residuales en S-COM-18, S-COM-19 y S-COM-22) | `vendedores.test.js`, `vendedoresService.test.js`, `SelectorVendedor.test.js`, `migracionV6.test.js`, `security.comisiones.iter2.test.js` (bloque S-COM-13) | Iteración 3 |
| Bajo → resuelto | **S-COM-15**: `cerrar_comisiones` toma `pg_advisory_xact_lock(hashtext('comisiones_pedido:' \|\| pid))` en un `for … order by 1`, después de autorizar y antes de validar pedidos, montos y ajustes. `ajuste_seq` = `max` histórico del pedido + 1, calculado en el servidor (el valor del cliente se ignora). `anular_cierre_comisiones` autoriza, hace `for update` del cierre, toma los mismos locks en el mismo orden y devuelve `tiene_ajustes_vigentes` (con los ids) si hay ajustes vigentes de sus pedidos base en otros cierres; el cliente hace el mismo chequeo antes de llamar. No se ve riesgo de deadlock: los locks se toman siempre en el mismo orden. Residual de capacidad en S-COM-21 | `003_comisiones.sql:306-316,454-460,515-534`; `src/domain/comisiones.js:704`; `src/services/comisionesService.js:250-253` | CORREGIDO | `security.comisiones.iter2.test.js` (S-COM-15), `comisionesService.test.js` | Iteración 3 |
| Info → resuelto | **S-COM-16**: las dos RPC llaman a `verificar_pin` **siempre** y responden `no_autorizado` tanto si el id no es admin como si el PIN es incorrecto, con `return` y sin `raise`. `cerrado_por_id` lo graba el servidor, está en el trigger de inmutabilidad, y la idempotencia compara `cerrado_por_id = v_admin_id`. En la 002, `admin_guardar_vendedor` devuelve `null` en ambos casos y ya no tiene el `raise 'Solo un admin…'`. El cliente acepta `no_autorizado` y los motivos viejos. Residual en S-COM-22 (2) | `003_comisiones.sql:101-102,153,230-258,447-449,495-505`; `002_seguridad_recomendada.sql:137-145`; `src/services/comisionesService.js:140-148`; `src/domain/vendedores.js:160-170` | CORREGIDO | `security.comisiones.iter2.test.js` (S-COM-16 y el de la 002), `security.comisiones.auditoria.test.js`, `comisionesService.test.js` | Iteración 3 |
| Bajo → resuelto | **S-COM-17**: `marcarEntregadoOnlineFirst(p, !p.entregado, { cerradoEn: cierreDe(p) })` en los dos llamadores; el repositorio valida con `validarCambioEntrega(..., cerradoEn)`. En dispositivos sin cierres (armador) `cerradoEn` sigue siendo `null`, lo que se aceptó como residual: el desmarcado se ve como ajuste | `src/pages/Facturacion.js:747`; `src/pages/OrdenEntrega.js:31,45`; `src/services/pedidoRepository.js:208-210` | CORREGIDO | `entregado.facturacion.test.js:131`, `entregado.ordenEntrega.test.js:115`, `entregadoSync.test.js:147-150` | Iteración 3 |
| Alto → resuelto | **S-COM-01**: las RPC autorizaban por nombre. Ahora piden `p_admin_id` + `p_admin_pin`, validan `permiso = 1` por id y `verificar_pin` antes de cualquier lectura o escritura de cierres. El cliente no persiste el PIN. Con S-COM-13 corregido en código, queda **efectivo** cuando se aplique el PASO 2 y se rote el PIN | `003_comisiones.sql:50-55,208-244,480-505,560-563`; `comisionesService.js:131-137` | CORREGIDO | `security.comisiones.auditoria.test.js`, `security.comisiones.iter2.test.js`, `comisionesService.test.js`, `comisiones.page.test.js`, `permisos.test.js` | Iteración 2 |
| Medio → resuelto | **S-COM-02**: el servidor recalcula total, comisión, ajustes y totales, y rechaza si no coinciden. Residual: el `pct` lo elige el cliente y `detalle` no se valida fila por fila (los dos requieren el PIN del admin) | `003_comisiones.sql:366-445` | CORREGIDO | `security.comisiones.auditoria.test.js` | Iteración 2 |
| Medio → resuelto | **S-COM-04**: la RPC exige facturado + `entregado` + fecha dentro del período, alineado con `CONFIG_COMISIONES.criterioEntregado` | `003_comisiones.sql:350-364`; `src/domain/comisiones.js:21` | CORREGIDO | `security.comisiones.auditoria.test.js` | Iteración 2 |
| Medio → resuelto | **S-COM-05**: `marcarEntregadoOnlineFirst` valida el permiso de la sesión en memoria (roles 1 y 3) | `src/services/pedidoRepository.js:208-214`; `src/domain/comisiones.js:68-71` | CORREGIDO | `entregadoSync.test.js`, `permisos.test.js` | Iteración 2 |
| Medio → resuelto | **S-COM-11**: `permisoValido`, `esAdmin` y `esArmador` aceptan solo los enteros 1, 2 o 3 | `src/domain/permisos.js:11-15` | CORREGIDO | `security.comisiones.roles.test.js`, `permisos.test.js` | Iteración 2 |
| Bajo → resuelto | **S-COM-07**: `lineas` y `p_renglones` tienen que ser el mismo set | `003_comisiones.sql:318-348` | CORREGIDO | `security.comisiones.auditoria.test.js` | Iteración 2 |
| Bajo → resuelto | **S-COM-08**: `filasPdfCierre` fuerza string en todas las celdas | `src/domain/comisiones.js` (`filasPdfCierre`) | CORREGIDO | `security.comisiones.auditoria.test.js` | Iteración 2 |
| Bajo → resuelto | **S-COM-09**: lock por id de cierre y `renglones_duplicados` | `003_comisiones.sql:250,300-304` | CORREGIDO | `security.comisiones.auditoria.test.js` | Iteración 2 |
| Bajo → resuelto | **S-COM-10**: la idempotencia corre después del PIN (ahora por `cerrado_por_id`) | `003_comisiones.sql:246-258` | CORREGIDO | `security.comisiones.auditoria.test.js`, `security.comisiones.iter2.test.js` | Iteración 2 |
| Info → resuelto | **S-COM-12**: `set search_path = public, pg_temp` en las dos RPC | `003_comisiones.sql:210,482` | CORREGIDO | `security.comisiones.auditoria.test.js` | Iteración 2 |
| — | **C-COM-01**: RLS en las 2 tablas, solo `select`, `revoke insert, update, delete, truncate` | `003_comisiones.sql:545-558` | CORREGIDO | `migracion003.test.js`, `security.migracion.test.js` | Esta corrida |
| — | **C-COM-02**: índices únicos parciales de pedido vigente y de ajuste vigente | `003_comisiones.sql:126-130` | CORREGIDO | `migracion003.test.js` | Esta corrida |
| — | **C-COM-03**: triggers de inmutabilidad (incluyen `cerrado_por_id`) | `003_comisiones.sql:143-189` | CORREGIDO | idem | Esta corrida |
| — | **C-COM-04**: RPC `security definer` con `search_path` fijo y `revoke all … from public` antes del `grant` | `003_comisiones.sql:208-210,480-482,560-563` | CORREGIDO | `security.comisiones.auditoria.test.js` | Esta corrida |
| — | **C-COM-05**: validación de entrada en las RPC | `003_comisiones.sql:262-298,491-493` | CORREGIDO | `migracion003.test.js` | Esta corrida |
| — | **C-COM-06**: dominio robusto ante NaN, Infinity, strings y negativos | `src/domain/comisiones.js` | CORREGIDO | `comisiones.test.js`, `security.comisiones.test.js` | Esta corrida |
| — | **C-COM-07**: marcar entregado no pasa por el stock (regla dura 4) | `src/services/pedidoRepository.js:208-214` | CORREGIDO | `entregadoSync.test.js` | Esta corrida |
| — | **C-COM-08**: AC-COM-2 en la UI | `src/App.js:43-44`; `src/pages/Comisiones.js` | CORREGIDO (solo UI; ver S-COM-03 y S-BUL-01) | `security.comisiones.roles.test.js` | Esta corrida |
| — | **C-COM-09**: idempotencia del lado del cliente | `comisionesService.js`; `src/domain/comisiones.js` | CORREGIDO | `comisionesService.test.js` | Esta corrida |

## Detalle

### S-COM-13: verificación (CORREGIDO en código)
Se revisó lo siguiente:
- **El login no compara contra nada local.** `confirmarPin` (`SelectorVendedor.js:117-136`) vacía el estado del PIN y llama a `verificarPinIngreso`. Esa función (`vendedoresService.js:47-60`) usa solo `supabase.rpc('verificar_pin')`, y `interpretarVerificacionPin` habilita únicamente con `data === true` (`vendedores.js:97`). No existe ningún camino `v.pin === pin`. Un `pin` legacy en IndexedDB solo prende el candado (`tienePin`, `vendedores.js:32`) y obliga a ir al servidor (test "un pin legacy guardado localmente no se usa para entrar").
- **El pull no baja el PIN.** `fetchVendedoresRemotos` (`syncService.js:736-758`) usa select explícito, sin `*`, y `downloadMaestros` y `downloadVendedores` lo usan. Con el PASO 2, el grant por columna incluye `tiene_pin` y `permiso`, así que el login sigue andando.
- **DB v6 sin pérdida de datos.** `db/index.js:95-101`: el cursor en la transacción de upgrade solo actualiza los registros con campos secretos; no hay `cursor.delete`, `deleteObjectStore` ni `clear`. `sinPinLocal` conserva todos los campos y fija `tienePin` (`vendedores.js:37-43`). Es compatible con la regla dura 6: el PIN es una credencial que vive hasheada en el servidor, no un dato de negocio.
- **Altas y ediciones.** `Configuracion.js:271-293` usa la RPC y vacía `pin`/`adminPin` del estado antes de llamar. No queda ningún `insert`/`upsert` con `pin` en `src/` (lo verifica `security.comisiones.iter2.test.js`). `importBackup` limpia los vendedores con `sinPinLocal` (`db/index.js:574`).
- **Logs.** El único `console.*` del flujo es `SelectorVendedor.js:71`, que imprime el `message` del error de insert, sin PIN.

**Compatibilidad con dispositivos viejos.** El análisis de `implementacion.md` es correcto:
- Hasta que se actualicen, los clientes viejos siguen entrando offline con el PIN copiado en IndexedDB, y ese PIN queda legible en el dispositivo.
- Después del PASO 2, su `select('*')` falla y corta `downloadMaestros` en la pasada completa.

Lo que **no** se menciona: un dispositivo viejo que nunca se actualiza conserva el PIN para siempre. Por eso la rotación del paso 6 no es opcional. Además, hay que rotar los PIN de **todos** los usuarios cuyo PIN estuvo en la base en texto plano, no solo el del admin: cualquiera podía leerlos con la anon key.

**Orden de despliegue.** El orden de `implementacion.md` es seguro: backup → 002 PASO 1 → 002 PASO 2 → 003 → publicar → rotar PINs.
- Publicar la app antes de la 002 deja a los usuarios con PIN sin poder entrar y abre el *fail-open* de S-COM-22 (1).
- Correr el PASO 2 sin publicar enseguida rompe la sincronización completa de los clientes viejos.
- Recordatorio: el PASO 2 está **comentado** en el SQL (`002:199-211`) y hay que descomentarlo a mano.

### S-COM-18: el login confía en el registro local (Medio, ABIERTO)
- **Ataque A (vendedor con DevTools, online):**
  1. IndexedDB → `vendedores` → en su propio registro (sin PIN) poner `permiso: 1`.
  2. Tocar su nombre: `iniciarIngreso` consulta al servidor, que responde `tiene_pin=false, permiso=2`.
  3. `trySelect` llama a `seleccionarVendedor(v)` con el `v` local, de `permiso 1`, y queda adentro con la UI de admin.
- **Ataque B:** en el registro del admin, cambiar `remoteId` por el remoteId propio y tipear el PIN propio. `verificar_pin` responde `true` y se entra con nombre y permiso del admin.
- **Impacto:** acceso a pantallas de admin (precios, productos, ajustes de stock, Facturación). Lo que esas pantallas escriben con la anon key ya se puede hacer con curl (S-01). Comisiones y vendedores siguen protegidos por el PIN del admin en el servidor.
- **Remediación (código de este run):**
  ```js
  // vendedoresService: después de verificar (o en "consultar"), traer la fila del servidor
  const { data } = await supabase.from('vendedores')
    .select('id,nombre,zona,permiso,tiene_pin').eq('id', String(rid)).maybeSingle();
  return { ok: true, vendedor: vendedorDesdeRemoto(data, vendedorLocal) };   // permiso/nombre del SERVIDOR
  // SelectorVendedor.trySelect / confirmarPin
  seleccionarVendedor(r.vendedor ?? { ...v, permiso: r.permiso ?? 2 });
  // decidirIngreso: un registro solo-local (sin remoteId) entra siempre como vendedor
  return { accion: 'entrar', mensaje: null, permiso: ROLES.VENDEDOR };
  ```
  Mejor todavía: que `verificar_pin` (o una RPC nueva `ingresar(p_id, p_pin)`) devuelva `{ok, nombre, permiso}`, así el cliente no tiene de dónde tomar un rol forjado. La solución definitiva sigue siendo Auth (S-BUL-01).

### S-COM-19: auto-alta sin PIN (Medio, ABIERTO, decisión del dueño)
- **Ataque:** abrir la PWA → "+ Agregar vendedor" → nombre "Carlos Rodriguez" (el de un vendedor real) → entrar. Se ven los pedidos que el pull filtra por `vendedorNombre`, se cargan pedidos a su nombre (que después cuentan para sus comisiones, porque la atribución es por nombre) y se baja la cartera completa de clientes.
- **Remediación:** la más simple es quitar el botón de `SelectorVendedor.js:179-183`, porque las altas ya se hacen desde Configuración con la RPC. En SQL, después del PASO 2:
  ```sql
  revoke insert on public.vendedores from anon, authenticated;   -- las altas solo por admin_guardar_vendedor
  create unique index if not exists vendedores_nombre_uq on public.vendedores (lower(trim(nombre)));
  ```
  Antes de crear el índice, revisar que no haya duplicados existentes.

### S-COM-20: admin sin PIN por la RPC (Bajo, ABIERTO)
Agregar en `admin_guardar_vendedor`, después de autorizar (un `raise` en ese punto no borra ningún intento fallido, porque el PIN ya fue correcto):
```sql
if p_permiso = 1 and (p_borrar_pin or (coalesce(trim(p_pin_nuevo), '') = ''
     and not exists (select 1 from public.vendedores where id::text = p_vendedor_id and pin_hash is not null))) then
  raise exception 'Un admin tiene que tener PIN';
end if;
if p_vendedor_id is not null and p_permiso <> 1
   and exists (select 1 from public.vendedores where id::text = p_vendedor_id and permiso = 1)
   and (select count(*) from public.vendedores where permiso = 1 and pin_hash is not null) <= 1 then
  raise exception 'No se puede quitar el ultimo admin';
end if;
if p_vendedor_id is not null and not exists (select 1 from public.vendedores where id::text = p_vendedor_id) then
  raise exception 'vendedor inexistente';
end if;
```

### S-COM-21: cantidad de advisory locks (Bajo, ABIERTO, confirmar en staging)
Los cierres son poco frecuentes y los hace un admin, así que alcanza con serializarlos todos:
```sql
perform pg_advisory_xact_lock(hashtext('comisiones_global'));   -- en cerrar y en anular, después de autorizar
```
Ese lock reemplaza los dos loops por pedido y también el lock por id de cierre. La otra opción es usar cubetas: `select distinct hashtext(...) & 255 … order by 1`, que da como máximo 256 locks.

### S-COM-14: bloqueo de PIN como DoS (Medio, ABIERTO, agravado)
- **Ataque:** mandar 5 veces `POST /rest/v1/rpc/verificar_pin {"p_vendedor_id":"<id>","p_pin":"0000"}` cada 15 minutos. Ahora también impide **ingresar** al usuario atacado, porque el login es online. Las sesiones ya abiertas (12 h) no se cortan.
- **Remediación** (SQL de la 002):
  - contar fallos por `(vendedor_id, origen)`, con `current_setting('request.headers', true)::json->>'x-forwarded-for'`;
  - poner un techo global diario que dispare una alerta;
  - exigir PIN de 6 o más dígitos a los admins.
  - Definitivo: Auth.

### S-COM-03: cierres legibles con la anon key (Medio, ABIERTO)
Sin cambios. Remediación sin Auth:
- `revoke select` a `anon`/`authenticated` sobre las dos tablas;
- exponer `listar_cierres_comisiones(p_admin_id, p_pin)` como `security definer`, validando con `verificar_pin`;
- para las pantallas que no son de admin, una vista o RPC que devuelva solo los `pedido_id` vigentes, sin montos.

### Verificación de la iteración 3 (lo que se buscó y no se encontró)
- **PIN en persistencia o logs:** no aparece en IndexedDB (todas las escrituras pasan por `sinPinLocal`), en localStorage (`datosPersistibles` guarda solo id, remoteId y nombre, `sesion.js:12`), en `console.*`, ni en el borrador de comisiones.
- **Comparación local del PIN:** no hay ningún camino `pin ===` contra datos del dispositivo.
- **Deadlocks en S-COM-15:** cerrar y anular toman los locks por pedido en el mismo orden (`order by 1`, mismo prefijo). El `for update` de anular apunta a un cierre que ya existe y cerrar inserta uno nuevo, así que no hay ciclo.
- **`ajuste_seq` del cliente:** se ignora. Bajo el lock, la colisión del índice `comisiones_ajuste_vigente_uq` deja de ser alcanzable entre cierres concurrentes.
- **XSS / formula injection:** sin cambios. No hay `dangerouslySetInnerHTML`, `innerHTML` ni `eval` en los archivos tocados.
- **Fuera de seguridad (regla 7):** `src/pages/Configuracion.js:210,213` tiene mojibake ("ConfiguraciÃ³n", "tenÃ©s"). Conviene corregirlo con un editor en UTF-8.

## Corregido en esta corrida

No se modificó código de producción ni se agregaron tests en esta verificación, por pedido del orquestador (hay otro implementador trabajando en paralelo). Se verificaron con evidencia archivo:línea y con tests verdes:
- **Iteración 3:** S-COM-13 (en código; efectivo con la 002 PASO 1 + PASO 2 aplicados y los PIN rotados), S-COM-15, S-COM-16 y S-COM-17.
- **Iteración 2:** S-COM-01, S-COM-02, S-COM-04, S-COM-05, S-COM-07, S-COM-08, S-COM-09, S-COM-10, S-COM-11 y S-COM-12.
- **Controles:** C-COM-01 a C-COM-09.

`CI=true npx react-scripts test --watchAll=false`: 46 suites OK; 842 passed, 1 skipped, 2 todo (845). En `security.comisiones.iter2.test.js` queda un solo `it.todo`, el de S-COM-14.

**Se pueden corregir en código de este run (implementador):**
- S-COM-18: tomar permiso y nombre de la fila del servidor después de verificar; un registro solo-local entra como vendedor.
- S-COM-19: si el dueño lo decide, quitar el botón de auto-alta.

**Se pueden corregir en el SQL antes de aplicarlo:**
- S-COM-20 (002): admin con PIN obligatorio, no degradar al último admin, id inexistente.
- S-COM-21 (003): un lock global en lugar de uno por pedido.
- S-COM-03 (003): lectura de cierres por RPC con PIN.

## Requiere acción del dueño

1. **Desplegar en este orden:** backup → 002 PASO 1 → 002 PASO 2 (descomentarlo) → 003 → publicar la app → pedir a todos que recarguen la PWA. Los pasos del PASO 2 a la publicación, seguidos y en la misma sesión.
2. **Rotar los PIN** después de publicar: el del admin y los de **todos** los usuarios que tenían PIN en texto plano. Esos PIN fueron legibles con la anon key y siguen copiados en cualquier dispositivo que no se actualice.
3. **S-COM-19:** decidir si se mantiene la auto-alta sin PIN. La recomendación es quitarla y revocar `insert` sobre `vendedores` a `anon`.
4. **S-COM-14:** bloqueo por origen y PIN de admin de 6 o más dígitos (SQL de la 002).
5. **S-01 / S-BUL-01 / S-COM-06 (Crítico/Alto, preexistentes):** aplicar los pasos 3 y 4 de la 002 y planificar el paso 5 (Supabase Auth con claim `permiso`). Es la única protección real del rol en la UI y de `pedidos.total`, `estado` y `entregado`.
6. **Probar en staging, antes de producción:**
   - login con PIN bueno, con PIN malo y con bloqueo;
   - alta de un admin por la RPC;
   - dos cierres concurrentes con ajuste del mismo pedido (el segundo tiene que dar `ajuste_invalido`);
   - anular una base con ajustes en otro cierre (`tiene_ajustes_vigentes`);
   - un cierre con miles de pedidos (S-COM-21);
   - `no_autorizado` con PIN malo (el intento tiene que quedar en `vendedores_pin_intentos`).
7. **S-DEP-01:** reemplazar `xlsx` por la build del CDN de SheetJS y mover `react-scripts` a `devDependencies`.
8. **S-HDR-01:** pasar la CSP de `Report-Only` a `Content-Security-Policy`.

### Limitaciones que siguen
- **El SQL no se ejecutó contra un Postgres real.** Lo validan los tests por regex y la réplica de las reglas en JS.
- **El `detalle` jsonb del cierre no se recalcula en el servidor.** Para alterarlo hace falta el PIN del admin.
- **Mientras siga S-01, el recálculo del servidor confía en columnas de `pedidos` que se pueden escribir con la anon key.**
