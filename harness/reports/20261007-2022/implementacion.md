# Implementación — RUN 20261007-2022 — REQ-COM (Cierre de comisiones)

Base: `harness/SPEC.md` (AC-COM-1..16) + `plan.md` de esta corrida. Se respetó lo aprobado de REQ-BUL (20261007-2004): `armado.js`, `bultos.js` y el modo edición de `Facturacion.js` no se tocaron; `bultos.*.test.js` y `security.bultos.test.js` siguen verdes.

## Resultados (números reales)

| Comando | Resultado |
|---|---|
| `CI=true npx react-scripts test --watchAll=false` | 37 suites OK · 697 passed, 1 skipped (698). Antes de esta corrida: 27 suites, 478 passed, 1 skipped |
| `npx react-scripts build` | Compiled successfully (también con `CI=true`, donde los warnings cuentan como error) |
| `node harness/gates/run-gates.mjs --fast` | TODOS LOS GATES PASARON: unit-tests, coverage-domain (100 % de líneas en `src/domain`), traceability (59/59 AC), secret-scan, security-rules |

## Archivos

Nuevos:
- `src/domain/comisiones.js`: toda la lógica pura (permisos, entregado, período, dinero en centavos, reparto, asignación, clasificación, avisos, ajustes, resumen, dashboard, cierre, anulación, mapeo remoto, borrador, filas del PDF) y `CONFIG_COMISIONES` con los supuestos configurables.
- `src/services/comisionesService.js`: `cargarDatosComisiones`, `guardarBorrador`, `confirmarCierre`, `enviarCierre`, `anularCierre`, `pullCierres`, `syncComisiones`.
- `src/sync/tolerancia.js`: `esColumnaInexistente`, movido acá para que lo use `pedidoRepository`. `syncService` lo sigue re-exportando.
- `src/pages/Comisiones.js`: pantalla solo para admin.
- `supabase/migrations/003_comisiones.sql`: **no aplicada**, se corre a mano.
- Tests: `src/domain/__tests__/comisiones.test.js`, `security.comisiones.test.js`, `migracion003.test.js`; `src/services/__tests__/entregadoSync.test.js`, `comisionesService.test.js`; `src/pages/__tests__/comisiones.page.test.js`, `entregado.facturacion.test.js`, `entregado.ordenEntrega.test.js`, `security.comisiones.roles.test.js`; `src/utils/__tests__/pdfComisiones.test.js`.

Modificados:
- `src/db/index.js`: `DB_VERSION` 4 → 5. Se agregan los stores `comisionesCierres` (keyPath `id`, índices `estado` y `desde`) y `comisionesBorradores` (keyPath `id`) con `if (!contains)`; no se borra nada. Funciones nuevas: `getComisionesCierres`, `putComisionCierreLocal`, `putComisionesCierresRemotos`, `clearComisionesCierresPendingSync`, `getComisionBorrador`, `putComisionBorrador`. `importBackup` no se tocó.
- `src/sync/syncService.js`:
  - `pedidoToRemoteRow` y `mapPedidoRemoto` manejan `entregado*` y toleran columnas faltantes.
  - Fallback `conFallbackEntrega` en updates e inserts de `syncPedidosPendientes`.
  - Pasada nueva `syncEntregasPendientes`.
  - Función nueva `pullPedidosByRango`.
- `src/services/pedidoRepository.js`:
  - `toRemoteRow` con `entregado*`.
  - Si falla por columna inexistente, reintenta sin esas columnas: no hace rollback y deja `entregaPendiente`.
  - Función nueva `marcarEntregadoOnlineFirst`, que no pasa por el stock.
- `src/hooks/useAppContext.js`: estado `comisionesCierres` (se carga con su propio try/catch) y paso `6d. syncComisiones` en `runSync` solo para admin, con su propio try/catch.
- `src/utils/pdfGen.js`: `generarCierreComisionesFile(cierre)` con jsPDF + autotable. Las filas salen de `filasPdfCierre` del dominio.
- `src/App.js`: pestaña `comisiones` (solo admin, porque `visibleTabs` filtra a los no admin) y render protegido por `isAdmin`.
- `src/pages/Facturacion.js`, solo en la botonera y badges de la tarjeta del listado y en los `confirm` de revertir/cancelar:
  - botón "Marcar entregado" / "Desmarcar entregado";
  - badges "Entregado" y "Cerrado";
  - aviso de "ajuste pendiente".
- `src/pages/OrdenEntrega.js`: tarjeta nueva "Entregas" (`EntregasDelDia`). Por defecto muestra los pedidos facturados de ayer, que son los que salen hoy. Admin y armador marcan/desmarcan; el vendedor solo ve el estado.

## AC cubiertos (cada test lleva el ID en el título)

| AC | Dónde se testea |
|---|---|
| AC-COM-1 | dominio (marcar, permisos, mapeo remoto tolerante), `entregadoSync` (PGRST204 → reintento + `entregaPendiente`, sin stock), Facturación, Orden de entrega |
| AC-COM-2 | dominio (`puedeVerComisiones` estricto), `security.comisiones.roles` (pestaña y guard), página |
| AC-COM-3 | `periodoPorDefecto` / `validarPeriodo` / `clasificarPedidos` / `enRango`, `pullPedidosByRango`, servicio |
| AC-COM-4 | tabla de `calcularComision` (redondeo, sin %, total inválido) |
| AC-COM-5 | `resumirPorVendedor` (incluye pedido dividido y ajustes), detalle desplegable en la página |
| AC-COM-6 | `calcularAvisos` (a)(b)(c)(d) con contadores, avisos en la página |
| AC-COM-7 | `validarAsignacion` / `repartirComision` (suma exacta), selector + 50/50 en la página |
| AC-COM-8 | `puedeCerrar`, botón deshabilitado con motivo |
| AC-COM-9 | borrador (dominio, servicio y página: se restaura al volver a la pantalla) |
| AC-COM-10 | `construirCierre` (UUID, congelado / deep copy), `confirmarCierre` (local pendiente → RPC → vigente; firma de datos cambiados), modal de confirmación |
| AC-COM-11 | `pedidosEnCierresVigentes`, exclusión del período, badge "Cerrado", trigger de inmutabilidad en SQL |
| AC-COM-12 | `validarAnulacion`, `anularCierre` (incluye red caída: sigue vigente), historial |
| AC-COM-13 | `calcularAjustesPendientes` (editado / revertido / borrado / desmarcado / ya cobrado), sección de ajustes, `confirm` en Facturación |
| AC-COM-14 | `filasPdfCierre`, `generarCierreComisionesFile` (PDF real con jsPDF), botón PDF de la página |
| AC-COM-15 | `comisiones.test.js` + `security.comisiones.test.js` (NaN, Infinity, strings, arrays, negativos, sumas de 99,99 y 100,01) |
| AC-COM-16 | `migracion003.test.js` (RLS, índice único parcial, sin DELETE, security definer), `comisionesService.test.js` (`ya_existia`, `ya_cerrado`, RPC inexistente, reintento con el mismo UUID, el pull no pisa pendientes), test de `DB_VERSION` 5 |

## Supuestos aplicados (plan §9). Los configurables están en `CONFIG_COMISIONES`

1. **Confirmar y anular requieren conexión.** El borrador funciona offline. El cierre se guarda local con su UUID antes de la RPC y se reintenta idempotente.
2. **"Entregado" es una marca nueva** (`criterioEntregado: 'entregado'`). ⚠ Si el dueño confirma que alcanza con "A reparto", se cambia a `'aReparto'` en `CONFIG_COMISIONES`, sin tocar lógica.
3. **Quién marca entregado:** admin y armador (`rolesMarcanEntregado: [1, 3]`). El vendedor solo ve el estado.
4. **Aviso (a):** solo si quien cargó es un vendedor con permiso 2 (`rolesQueCuentanComoCargador: [2]`). Los pedidos "WEB" o cargados por el admin van al vendedor de la ficha sin aviso.
5. **Período:** fecha del pedido, inclusivo, máximo `maxDiasPeriodo: 366`. División por defecto `divisionPorDefecto: [50, 50]`.
6. **Total y montos:** se usa `pedido.total` como total facturado. Un total no numérico o negativo da comisión 0 y aviso.
7. **Ajustes:** usan el % y la asignación congelados en el cierre original. Ajustes negativos se descuentan aunque dejen negativo el total del vendedor (⚠ a confirmar). Un pedido cerrado como "sin comisión" no genera ajustes.
8. **Desmarcar un pedido cerrado:** solo el admin y con confirmación, porque queda como ajuste.
9. **Pedidos sin `remoteId`:** bloquean el cierre ("sincronizá primero").
10. **Ficha con vendedor inexistente** (renombrado o borrado) se trata como cliente sin vendedor, aviso (b).

## Desvíos respecto del plan (con motivo)

- **El borrador no se borra al confirmar el cierre.** Es inofensivo, porque las asignaciones de pedidos ya cerrados se ignoran. Si el cierre se anula, el admin recupera sus asignaciones. Además evita borrar datos.
- **Migración 003 sin correr:** el cierre local queda `rechazado` con `motivoRechazo: 'falta_migracion'` en vez de borrarse. Nunca cuenta y no se borra nada.
- **La RPC valida que el pedido exista y esté `facturado`, pero no exige `entregado`.** El criterio de entregado es configurable en el cliente (`aReparto`). Exigirlo en el servidor daría falsos rechazos.
- **`comisiones_cierres` tiene una columna extra `lineas jsonb`** (renglones planos congelados con asignación y %). Se usa para derivar pedidos cerrados y ajustes en otros dispositivos. `detalle` mantiene la jerarquía vendedor → cliente → pedido.
- **Los casos de roles van en un archivo aparte** (`security.comisiones.roles.test.js`), porque el test de la App necesita mockear todas las pantallas, incluidas Stock y Configuración, que `security.roles.test.js` testea de verdad.
- **`marcarEntregadoOnlineFirst` usa `guardarPedidoInterno` directo:** ni siquiera llama a `aplicarStockPedido`. Hay test explícito de que no se llama.

## Pasos manuales

1. **Supabase → SQL Editor:** hacer backup y correr `supabase/migrations/003_comisiones.sql`. Es idempotente y no borra datos. Hasta correrla:
   - la marca Entregado queda local (`entregaPendiente`) y se reintenta en cada sync;
   - Comisiones muestra "falta la migración 003" y no deja cerrar.
2. **Nombre del admin:** las RPC validan que `cerrado_por` / `p_por` coincida exactamente (con `trim`) con un `vendedores.nombre` que tenga `permiso = 1`. Revisar que el nombre del admin en Supabase sea el mismo que usa la app.
3. **QA con dos dispositivos:**
   - Dos navegadores admin cierran el mismo período: el segundo tiene que recibir "Otro admin ya cerró…" y su cierre queda `rechazado`.
   - Anular el cierre: los pedidos tienen que volver a aparecer.
4. **Upgrade de IndexedDB a v5:** si hay otra pestaña abierta con la versión anterior, la app avisa (`onblocked`). Hay que cerrarla.
5. **Seguridad (igual que la 002):** sin Supabase Auth, cualquiera con la anon key puede llamar a las RPC mandando el nombre del admin. Las tablas quedan en solo lectura y la escritura pasa por las RPC con validaciones, pero la protección real requiere Auth (PASO 5 de la 002). Opcional a futuro: validar el PIN del admin dentro de la RPC con `verificar_pin`.

## A confirmar con el dueño (sin cambios respecto del plan §10)

- ¿Alcanza con "A reparto"? Se cambia con un flag (`CONFIG_COMISIONES.criterioEntregado`).
- Quién marca entregado en la calle.
- Si los pedidos "WEB" o cargados por el admin comisionan.
- Ajustes negativos.
- Cierre sin conexión.
- Qué % usar si cambia a mitad de mes: hoy se usa el % de la ficha al momento del cierre, como dice el SPEC.


## Iteración 2 (correcciones de security-report.md)

### IDs corregidos

| ID | Qué se hizo | Dónde | Tests |
|---|---|---|---|
| S-COM-01 | `cerrar_comisiones(p_cierre, p_renglones, p_admin_id, p_admin_pin)` y `anular_cierre_comisiones(p_id, p_admin_id, p_admin_pin, p_motivo)` validan el admin por id remoto + `permiso = 1` + `public.verificar_pin` (002 paso 1). Con PIN incorrecto devuelven `pin_incorrecto` con `return` (no `raise`), así el intento fallido queda registrado para el bloqueo. `cerrado_por` y `anulado_por` los fija el servidor. La 003 arranca con un `do $$` que aborta si `verificar_pin` no existe ("aplicar antes 002 paso 1"). Se hace `drop function if exists` de las firmas viejas, que autorizaban por nombre. En el cliente, la confirmación, la anulación y el reintento de pendientes piden el PIN (`type=password`, `autoComplete=off`). El PIN vive solo en el estado del componente durante la llamada y se borra antes de llamar. No se guarda en IndexedDB, localStorage ni la sesión, y no se loguea | `supabase/migrations/003_comisiones.sql`, `src/services/comisionesService.js`, `src/pages/Comisiones.js`, `src/domain/permisos.js` (`validarPinIngresado`) | `security.comisiones.auditoria.test.js`, `comisionesService.test.js` (bloque S-COM-01), `comisiones.page.test.js`, `permisos.test.js` |
| S-COM-02 | La RPC recalcula. Total del pedido = `public.pedidos.total` (si es negativo, 0). Comisión = `round(total * pct / 100, 2)`, con el `pct` enviado validado entre 0 y 100. Ajustes = diferencia contra lo ya cerrado, con el % congelado del **servidor** (columna nueva `comisiones_cierre_pedidos.pct`). Totales del cierre: `total_vendido`, `total_comision`, `totales.totalVendido`, `totales.totalComision` y la suma de `porVendedor`. `cerrado_at = now()`. **Decisión: RECHAZA** si algo no coincide (`montos_inconsistentes`, `ajuste_invalido`, `totales_inconsistentes`); no reemplaza. Motivo: `detalle` y `totales` (jsonb del historial y del PDF) los arma el cliente, y pisar solo las columnas numéricas dejaría el cierre incoherente. Lo grabado en las columnas numéricas son los valores verificados. El cliente manda `pct` (2 decimales, `pctCongelado`) y `sin_comision` por renglón | SQL 003, `src/domain/comisiones.js` (`pctCongelado`, `cierreToRemote`) | auditoría (reglas SQL + réplica JS de las reglas del servidor sobre un cierre real con dividir, sin comisión, sin %, % de 3 decimales y ajuste) |
| S-COM-04 | La RPC exige `coalesce(p.entregado, false)` y fecha dentro del período. Documentado en el SQL y en `CONFIG_COMISIONES`: si el dueño elige "A reparto", hay que cambiar **juntos** la RPC (`p.a_reparto`) y `criterioEntregado`. Hay un test que falla si quedan desalineados | SQL 003, `src/domain/comisiones.js` | auditoría (`AC-COM-3 S-COM-04`) |
| S-COM-05 | `marcarEntregadoOnlineFirst(pedido, entregado, { cerradoEn })` valida con `validarCambioEntrega` (dominio) y el permiso de la sesión en memoria, con los mismos roles que la UI (1 y 3; desmarcar algo cerrado solo lo hace el admin). Si no corresponde, lanza el error sin escribir nada | `src/services/pedidoRepository.js`, `src/domain/comisiones.js` | `entregadoSync.test.js`, `permisos.test.js` |
| S-COM-07 | La RPC exige que `lineas` y `p_renglones` sean el mismo set, con los mismos montos (`except` en ambos sentidos y el mismo largo). Si no, devuelve `lineas_inconsistentes` | SQL 003 | auditoría |
| S-COM-08 | `filasPdfCierre` convierte a string todas las celdas: `texto()` en vendedor, cliente, pedido, %, división y fecha; `fmtPesos` tolera objetos; `asignacion` solo se interpreta si es un string conocido; las listas no-array se ignoran | `src/domain/comisiones.js` | auditoría (`S-COM-08`, con celdas `{content, styles, colSpan}`) |
| S-COM-09 | `pg_advisory_xact_lock(hashtext('comisiones_cierre:' \|\| id))` antes del chequeo de idempotencia. Si un `pedido_id` viene duplicado (como pedido o como ajuste), devuelve `renglones_duplicados` | SQL 003 | auditoría |
| S-COM-10 | La idempotencia por UUID se resuelve **después** de autorizar (PIN) y devuelve `ya_existia` solo si `cerrado_por` es el mismo admin. Si no, devuelve `id_en_uso` | SQL 003 | auditoría |
| S-COM-11 | Helper `permisoValido`/`esAdmin`/`esArmador` (`src/domain/permisos.js`): solo acepta el número entero 1, 2 o 3. Lo usan `App.js` (pestañas), `Comisiones.js` y `comisionesService`. No rompe los permisos existentes: la sesión ya normaliza con `Number()` contra la base. Hay tests con admin, vendedor, armador, "1", "3" y 1.0001 | `src/App.js`, `src/pages/Comisiones.js`, `src/services/comisionesService.js` | `security.comisiones.roles.test.js`, `permisos.test.js`, `comisionesService.test.js` |
| S-COM-12 | `set search_path = public, pg_temp` en las dos RPC | SQL 003 | auditoría |

No se tocaron, porque quedan para el dueño: S-COM-03, S-DEP-01, S-HDR-01 y S-01. En `security.comisiones.auditoria.test.js` queda un solo `it.todo`, el de S-COM-03.

### Cambios de comportamiento a tener en cuenta
- **El sync en segundo plano ya no reenvía cierres ni anulaciones pendientes**, porque el PIN no se guarda. `syncComisiones()` sin PIN solo baja cierres y cuenta los pendientes. En Comisiones aparece una tarjeta "N cierre(s) o anulación(es) sin confirmar", con un campo de PIN y el botón "Reintentar con el servidor", que llama a `syncComisiones({ pin })` con el mismo UUID. Mientras tanto, los pedidos siguen contando como cerrados (conservador, igual que antes).
- **Rechazo por PIN:**
  - En el primer envío, el cierre queda `rechazado` y libera los pedidos: el UUID nunca llegó al servidor.
  - En un reintento queda `pendiente`, porque no se sabe si el servidor ya lo tiene, y se corta la tanda.
  - El bloqueo de `verificar_pin` ("Demasiados intentos") se muestra como "Probá de nuevo en 15 minutos".
- **El admin necesita tener PIN cargado en Supabase (`pin_hash`) y estar sincronizado (`remoteId`)** para cerrar o anular. Si no, el mensaje es "PIN incorrecto (o tu usuario no tiene PIN cargado…)" o "todavía no está sincronizado".
- **Columnas nuevas en `comisiones_cierre_pedidos`:** `pct numeric(5,2)` y `sin_comision boolean`, agregadas con `add column if not exists`. También entran en el trigger de inmutabilidad.

### Pasos manuales (reemplazan los puntos 1, 2 y 5 de arriba)
1. **Supabase → SQL Editor:** backup → correr el **PASO 1 de `002_seguridad_recomendada.sql`** → correr `003_comisiones.sql`. Si se corre la 003 sin la 002 paso 1, aborta al principio sin tocar nada.
2. **El admin tiene que tener PIN.** La 002 paso 1 lo hashea en `pin_hash`. Ya no importa que el nombre coincida, porque la autorización es por id + PIN.
3. **Publicar esta versión de la app junto con la 003.** El cliente viejo llama a las firmas de 2 y 3 argumentos, que la 003 elimina.

### Limitaciones que siguen
- **El SQL no se ejecutó contra un Postgres real:** no hay Postgres en CI y Docker no estaba corriendo. Lo validan los tests por regex de `migracion003.test.js` y `security.comisiones.auditoria.test.js`, más la réplica en JS de las reglas del servidor. Antes de producción conviene probar la 003 en un proyecto Supabase de staging: cerrar, cerrar con PIN malo, anular, reintentar con el mismo UUID y dos admins a la vez.
- **El `detalle` jsonb por pedido (lo que muestra el PDF) no se recalcula en el servidor:** se validan los totales y los renglones, no cada fila del detalle. Para alterarlo hoy hace falta el PIN del admin.
- **S-01 sigue abierto:** `pedidos.total`, `estado` y `entregado` se pueden escribir con la anon key, así que el recálculo del servidor confía en esas columnas. La solución definitiva sigue siendo Supabase Auth.

### Números (iteración 2)
- `CI=true npx react-scripts test --watchAll=false`: 41 suites OK; 775 passed, 1 skipped, 1 todo (777). Antes de la iteración: 735 passed, 4 todo.
- Cobertura de `src/domain`: 100 % de líneas (818/818), 95,59 % de ramas. `comisiones.js` 100 % líneas / 96,24 % ramas; `permisos.js` 100 %.
- `npx react-scripts build`: "Compiled successfully", sin warnings.
- `node harness/gates/run-gates.mjs --fast`: unit-tests, coverage-domain, traceability, secret-scan y security-rules PASS.


## Iteración 3 (correcciones de security-report.md: S-COM-13, 15, 16 y 17)

Decisión del dueño para S-COM-13: **el login es 100 % online**. El PIN se verifica solo en el servidor y no queda en ningún dispositivo. Una sesión ya iniciada se mantiene y la app sigue funcionando offline igual que antes (la restauración de 12 h de `sesionVendedor` no cambia). Lo que pide conexión es un ingreso nuevo.

### IDs corregidos

| ID | Qué se hizo | Dónde | Tests |
|---|---|---|---|
| S-COM-13 (login) | Al tocar un usuario: sin conexión aparece "Necesitás conexión para ingresar." y no se entra. Con conexión, si tiene PIN se abre el modal y el PIN se valida con `supabase.rpc('verificar_pin', { p_vendedor_id: String(remoteId), p_pin })`. Solo `data === true` deja entrar. El PIN nunca se compara contra nada local y se borra del estado antes de llamar. Hay mensajes para PIN incorrecto, para el bloqueo por intentos ("Demasiados intentos. Probá de nuevo en 15 minutos.") y para la falta de la 002. Un usuario sin PIN según el dispositivo se confirma con el servidor (`select('id,tiene_pin,permiso')`): si el servidor dice que tiene PIN, se le pide. Los usuarios solo-locales (que nunca llegaron al servidor) y sin PIN entran como antes | `src/domain/vendedores.js` (nuevo), `src/services/vendedoresService.js` (nuevo), `src/components/SelectorVendedor.js`, `src/hooks/useAppContext.js` (la restauración usa `tienePin`) | `src/domain/__tests__/vendedores.test.js`, `src/services/__tests__/vendedoresService.test.js`, `src/components/__tests__/SelectorVendedor.test.js`, `security.comisiones.iter2.test.js` |
| S-COM-13 (pull) | `downloadMaestros` y `downloadVendedores` usan `fetchVendedoresRemotos`, con select explícito `id,nombre,zona,permiso,tiene_pin`, nunca `*`, `pin` ni `pin_hash`. Si `tiene_pin` todavía no existe (falta el PASO 1 de la 002), reintentan con `id,nombre,zona,permiso`. El mapeo `vendedorDesdeRemoto` no copia `pin`: guarda `tienePin` | `src/sync/syncService.js`, `src/domain/vendedores.js` | `vendedoresService.test.js` (pull), `vendedores.test.js` |
| S-COM-13 (IndexedDB) | `DB_VERSION` 5 → 6. El `onupgradeneeded` recorre el store `vendedores` con un cursor y hace `cursor.update(sinPinLocal(v))`: solo **elimina la propiedad `pin`** (y `pin_hash` si existiera) y deja `tienePin` (true si había PIN, así se conserva el candado y se sigue pidiendo PIN). No borra registros ni stores, y no hace `cursor.delete` ni `deleteObjectStore`. Además, toda escritura de vendedores (`putVendedoresBatch`, `addVendedor`, `updateVendedor`, `importBackup`) pasa por `sinPinLocal`. **Regla dura 6 (no borrar datos de usuario):** el PIN no es dato de negocio. Es una credencial que, después del PASO 1 de la 002, vive hasheada en Supabase (`pin_hash`). Quitarla del dispositivo no pierde información del usuario: el único efecto es que el ingreso pasa a validarse online | `src/db/index.js` | `src/db/__tests__/migracionV6.test.js`, `security.comisiones.iter2.test.js` |
| S-COM-13 (altas/ediciones) | Configuración → Vendedores llama a `guardarVendedorAdmin`, que usa `rpc('admin_guardar_vendedor', { p_admin_id, p_admin_pin, p_vendedor_id, p_nombre, p_zona, p_permiso, p_pin_nuevo, p_borrar_pin })` con la firma de la 002. El formulario pide "Tu PIN de admin", en un campo `password` sin autocompletar. Los dos PIN se borran del estado antes de llamar. Recién con el OK del servidor se escribe en local, sin `pin`, con `tienePin` y el `remoteId` que devuelve la RPC. Requiere conexión. Ya no hay insert directo con `pin` desde Configuración. `syncVendedor` (auto-alta desde la pantalla de ingreso) inserta solo `nombre`, `zona` y `permiso: 2`, nunca `pin` | `src/pages/Configuracion.js`, `src/services/vendedoresService.js`, `src/sync/syncService.js` | `vendedoresService.test.js`, `SelectorVendedor.test.js` |
| S-COM-13 (aviso del auditor: alta de admin) | Con el PASO 1, un `insert` con la anon key se guarda con `permiso = 2`. Ahora el alta de un admin pasa por la RPC `security definer`, que sí graba `permiso = 1`. Regla de dominio (`validarFormVendedor`): **un admin tiene que quedar con PIN** de 4 a 8 dígitos, porque sin PIN no puede cerrar comisiones ni autorizar cambios y entraría sin clave. No se le puede quitar el PIN a un admin | `src/domain/vendedores.js` | `vendedores.test.js` |
| S-COM-16 | En `cerrar_comisiones` y `anular_cierre_comisiones`, `verificar_pin` se llama **siempre**, aunque el id no sea admin. "No es admin" y "PIN incorrecto" devuelven el mismo `no_autorizado`, con `return` y sin `raise`, así el intento queda grabado. La columna nueva `comisiones_cierres.cerrado_por_id` (`add column if not exists`, en el trigger de inmutabilidad) la graba el servidor, y la idempotencia compara `cerrado_por_id = v_admin_id`, no el nombre. En la 002 se aplicó el mismo criterio a `admin_guardar_vendedor`: `null` en ambos casos y sin el `raise 'Solo un admin con PIN…'`. El cliente acepta `no_autorizado` como rechazo de autenticación y sigue aceptando los motivos viejos | `supabase/migrations/003_comisiones.sql`, `supabase/migrations/002_seguridad_recomendada.sql`, `src/services/comisionesService.js` | `security.comisiones.iter2.test.js`, `security.comisiones.auditoria.test.js` (adaptado), `comisionesService.test.js` |
| S-COM-15 | `cerrar_comisiones` toma `pg_advisory_xact_lock(hashtext('comisiones_pedido:' \|\| pedido_id))` por cada pedido distinto, **en orden** (un loop `for … order by 1`). Lo hace después de autorizar y antes de validar pedidos, montos y ajustes. Así, dos cierres concurrentes con el mismo pedido se ejecutan de a uno, y el segundo valida contra lo que grabó el primero (su ajuste deja de coincidir y responde `ajuste_invalido`). **`ajuste_seq` lo asigna el servidor** (`max(ajuste_seq)` histórico del pedido + 1, bajo el lock); el valor del cliente se ignora y ya no es obligatorio. **Anular, decisión: BLOQUEAR.** `anular_cierre_comisiones` toma los mismos locks por pedido. Si algún pedido que el cierre tiene como base tiene ajustes vigentes en **otros** cierres, devuelve `tiene_ajustes_vigentes` con los ids de esos cierres y no anula. El admin anula primero los cierres posteriores y después la base. Se descartó la cascada porque modificaría cierres vigentes cuyos totales y PDF ya incluyen esos ajustes. El cliente hace el mismo chequeo antes de llamar (`cierresConAjustesDependientes`, dominio) y muestra "anulalos primero" | SQL 003, `src/domain/comisiones.js`, `src/services/comisionesService.js` | `security.comisiones.iter2.test.js` (S-COM-15), `comisionesService.test.js` |
| S-COM-17 | `marcarEntregadoOnlineFirst(p, !p.entregado, { cerradoEn: cierreDe(p) })` en `Facturacion.js` y en `OrdenEntrega.js`. `cierreDe` ya devolvía el id del cierre vigente o `null` | `src/pages/Facturacion.js`, `src/pages/OrdenEntrega.js` | `entregado.facturacion.test.js`, `entregado.ordenEntrega.test.js` (casos nuevos con `cerradoEn: 'c1'`) |

Sigue abierto: S-COM-14 (DoS por bloqueo; SQL de la 002 / dueño), además de S-COM-03, S-COM-06, S-01, S-DEP-01 y S-HDR-01, que no cambian. En `security.comisiones.iter2.test.js` queda un solo `it.todo`, el de S-COM-14. Los de S-COM-13 y S-COM-15 pasaron a tests reales, y se agregaron tests de S-COM-16.

### Tests existentes adaptados (y por qué)
- **`security.comisiones.auditoria.test.js` y los dos primeros de `security.comisiones.iter2.test.js`** buscaban `'no_admin'` y `'pin_incorrecto'` en el SQL. Por S-COM-16 esas respuestas pasaron a ser una sola, `'no_autorizado'`. Los tests verifican lo mismo que antes (sin `raise` antes del rechazo, rechazo antes de cualquier escritura o lectura del cierre) sobre el motivo nuevo. Además fijan que ya no existan los dos motivos viejos y que `values (...)` incluya `v_admin_id` (`cerrado_por_id`).
- **`migracion003.test.js`** exigía `DB_VERSION = 5`; ahora exige ≥ 5, porque los stores de la v5 no cambian. **`db/__tests__/migracionV5.test.js`** espera la versión 6; el paso v4 → v5 sigue creando solo los dos stores.
- **`entregado.facturacion.test.js` y `entregado.ordenEntrega.test.js`** esperaban dos argumentos; ahora también se espera `{ cerradoEn: null }` (S-COM-17).
- **Ningún test validaba el login local** contra `v.pin`. `security.sesion.test.js` sigue verde sin cambios: su fixture con `pin: '4321'` se interpreta con `tienePin()`, que reconoce el pin legacy de un registro todavía no migrado.

### Orden exacto de despliegue
1. **Backup** (Supabase → Database → Backups).
2. **002 PASO 1** (SQL Editor). Hashea los PIN (`pin_hash`, `tiene_pin`) y crea `verificar_pin` y `admin_guardar_vendedor`. Si la 002 ya se había corrido antes de esta iteración, volver a correr el PASO 1 completo: es idempotente y reemplaza `admin_guardar_vendedor` por la versión con respuesta única.
3. **002 PASO 2**: descomentar y correr. Pone `pin = null` donde ya hay hash, revoca el `select` y da `select` por columna sin `pin` ni `pin_hash`.
4. **003**: `supabase/migrations/003_comisiones.sql` completa. Es idempotente y agrega `cerrado_por_id`, los locks por pedido y las respuestas nuevas.
5. **Publicar esta versión de la app.**
6. **Cambiar el PIN del admin** (y los de quien lo tenga expuesto) desde Configuración → Vendedores de la app nueva: editar el usuario, poner un PIN nuevo de 4 a 8 dígitos y confirmar con el PIN actual. El PIN actual ya fue legible con la anon key y quedó copiado en los dispositivos viejos.

Los pasos 3 a 5 conviene hacerlos seguidos, en la misma sesión (ver el punto siguiente). La app nueva **necesita** el PASO 1: sin `verificar_pin`, nadie con PIN puede entrar ("falta aplicar la migración 002"). Por eso la app no se publica antes de la 002.

### Qué pasa con los dispositivos que tienen la versión vieja
- **Después del PASO 2 y hasta que se actualicen:**
  - El `select('*')` de `vendedores` responde *permission denied*.
  - En la versión vieja, `downloadMaestros` corta la pasada completa del sync (cada 30 min y al arrancar). El push de pedidos pendientes corre antes y sigue funcionando, pero en esa pasada no bajan productos, clientes, pedidos recientes ni stock.
  - El sync liviano (sin maestros) sigue andando.
  - "Sincronizar vendedores" de la pantalla de ingreso da error.
  - Por eso los pasos 3 a 5 van seguidos, y hay que pedirles a todos que recarguen la PWA (cerrar y abrir) para tomar la versión nueva.
- **El login viejo sigue comparando contra el `pin` que tiene copiado en IndexedDB,** así que se sigue entrando offline con el PIN viejo y ese PIN queda legible en el dispositivo. Al abrir la versión nueva, el upgrade a v6 lo borra. Esta es la razón del paso 6: hasta cambiar el PIN del admin, cualquier dispositivo viejo lo expone.
- **Altas desde la versión vieja:**
  - Configuración vieja hace un `insert` con `pin`. El trigger del PASO 1 lo hashea y fuerza `permiso = 2`.
  - Un alta de admin desde un cliente viejo queda como vendedor; se corrige editándolo desde la app nueva.
  - Las ediciones viejas eran solo locales y no tocan el servidor.
- **Comisiones:** el cliente viejo llama a firmas de la 003 que ya no existen (iteración 2) y recibe "falta migración"; no rompe datos. Si llegara a recibir `no_autorizado`, lo muestra como "El servidor rechazó el cierre (no_autorizado)" y el cierre queda `rechazado` sin bloquear pedidos.
- **IndexedDB v6:** si hay otra pestaña abierta con la versión anterior, la app avisa (`onblocked`) igual que en la v5. Hay que cerrarla.

### Residuales / a confirmar
- **Auto-alta en la pantalla de ingreso** ("+ Agregar vendedor"): se mantiene como antes. Crea un vendedor común (`permiso 2`) **sin PIN**, ahora sin mandar `pin`. Cualquiera con la app puede crearse un usuario vendedor; cerrarlo requiere Auth (S-01) o quitar el botón. Queda a decisión del dueño.
- **Si la 002 PASO 1 no está aplicada,** un usuario sin `tiene_pin` entra sin verificación (no hay contra qué verificar), y uno con PIN no puede entrar. Por eso el orden de arriba.
- **El SQL no se ejecutó contra un Postgres real** (lo mismo que en la iteración 2): está validado por tests estáticos. Antes de producción, en staging probar: dos cierres concurrentes con ajuste del mismo pedido (el segundo tiene que dar `ajuste_invalido`), anular una base con ajustes en otro cierre (`tiene_ajustes_vigentes`), `no_autorizado` con un id no admin y con PIN malo (el intento tiene que quedar en `vendedores_pin_intentos`), y el alta de un admin con `admin_guardar_vendedor`.
- **S-COM-14** sigue abierto: 5 PIN malos bloquean el ingreso del admin 15 min, y ahora también su login, porque el ingreso es online.

### Números (iteración 3)
- `CI=true npx react-scripts test --watchAll=false`: 46 suites OK; 842 passed, 1 skipped, 2 todo (845). Antes de la iteración: 42 suites; 783 passed, 1 skipped, 4 todo (788).
- `npx react-scripts build` (también con `CI=true`): "Compiled successfully", sin warnings.
- `node harness/gates/run-gates.mjs --fast`: unit-tests, coverage-domain, traceability, secret-scan y security-rules PASS ("TODOS LOS GATES PASARON").

## AC-COM-17 (2026-10-08)

Decisión del dueño: cada pedido de "Pedidos para asignar" se confirma por separado. Al confirmarlo, sale de los avisos (a) y (b).

### Archivos
- `src/domain/comisiones.js`
  - `confirmarAsignacionBorrador(borrador, periodo, pedidoId, { pedido, cliente, vendedores }, now)` devuelve `{ ok, errores, borrador }` y marca `confirmada: true` en `borrador.asignaciones[pedidoId]`.
    - Solo acepta asignaciones que pasan `validarAsignacion`. Si el pedido no tiene entrada en el borrador, confirma el default de la ficha.
    - Si no es válida, devuelve el borrador sin cambios.
  - `asignacionLineaValida(linea)` decide si el botón "Confirmar asignación" está habilitado.
  - `armarLinea` agrega `asignacionConfirmada`. Vale `true` solo si `confirmada === true` y la asignación sigue siendo válida (por ejemplo, si se borra el vendedor, vuelve a pendiente).
  - `calcularAvisos`: (a) y (b) excluyen las líneas confirmadas. En (b) un cliente sale del aviso solo cuando todos sus pedidos del período están confirmados.
  - `setAsignacionBorrador` no cambió: `limpiarAsignacionInput` no copia `confirmada`, así que cualquier cambio desconfirma. Sin marca equivale a no confirmada, y los borradores viejos se tratan igual.
- `src/pages/Comisiones.js`
  - Botón "Confirmar asignación" por pedido.
  - Tarjeta resumida: "Asignado a X ✓", "Sin comisión ✓" o "Dividido N/M ✓ (A / B)", con botón "Editar". Editar solo reabre el selector; recién un cambio desconfirma.
  - Se persiste con `guardarBorrador`, igual que hoy.
- Tests:
  - `src/domain/__tests__/comisiones.confirmacion.test.js` (nuevo, 13 tests).
  - `src/pages/__tests__/comisiones.page.test.js` (6 tests nuevos en `describe('AC-COM-17 …')`).

### Lo que no cambia
- Cálculo de comisiones, totales, resumen, `firmaDashboard` y `puedeCerrar` (AC-COM-8). Un test compara el dashboard con y sin confirmaciones.
- Payload de la RPC y PDF:
  - `lineaCongelada` copia `asignacion` de `validarAsignacion` (`{ modo, partes }`), no la entrada del borrador.
  - Un test verifica que `construirCierre` y `cierreToRemote` dan lo mismo con y sin confirmaciones, y que ni `confirmada` ni "✓" aparecen en el payload ni en `filasPdfCierre`.
  - El borrador no se sincroniza con Supabase.
- Sin cambios de schema IndexedDB ni migración: la marca vive dentro del objeto de asignación del store de borradores existente.

### Números
- `CI=true npx react-scripts test --watchAll=false`: 48 suites OK; 893 passed, 1 skipped, 2 todo (896).
- `CI=true npx react-scripts build`: "Compiled successfully".
- `node harness/gates/run-gates.mjs --fast`: unit-tests, coverage-domain, traceability, secret-scan y security-rules PASS ("TODOS LOS GATES PASARON").
