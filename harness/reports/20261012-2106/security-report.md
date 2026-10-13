# Auditoría de seguridad — RUN 20261012-2106 — cierre de REQ-VEN, REQ-PLA y C3..C9

Alcance:
- Lo cambiado en esta corrida (`harness/reports/20261012-2106/implementacion.md`): C3 (S-BUL-06), C4 (S-BUL-08), C5 (S-COM-18), C5b/C6 (S-COM-20, 004), C7 (S-COM-21, 003), C9 (stock inicial en importación parcial) y la exclusión de Comisión de la plantilla.
- Lo que nunca se había auditado:
  - **REQ-VEN:** `supabase/migrations/004_baja_vendedores.sql`, `src/services/vendedoresService.js` (`darDeBajaVendedorAdmin`, `ingresarConPin`, `iniciarIngreso`), la baja en `src/pages/Configuracion.js`, los filtros de inactivos (`SelectorVendedor`, `ListaPedidos`, `Comisiones`, `ClienteForm`) y el cierre de sesión en `src/hooks/useAppContext.js`.
  - **REQ-PLA:** `src/domain/plantillas.js`, `src/services/plantillaExcel.js` y la importación en `Configuracion.js` (parseo con `xlsx@0.18.5`).

Método:
- Lectura de código y SQL. El SQL **no** se ejecutó contra un Postgres real: la 003 y la 004 siguen sin aplicarse.
- `npm audit --omit=dev`.
- Barrido de secretos sobre los archivos versionados en git (`git grep`, salida redactada).
- Dos suites de tests nuevas (ver "Corregido en esta corrida").

No se leyó `.env`. `git ls-files` muestra que `.env` no está versionado (solo `.env.production`, que es el flag de sourcemaps). No se modificó código de producción.

## Resumen ejecutivo

**Los 5 hallazgos pedidos quedan CORREGIDOS en código o en SQL. Hay dos aclaraciones:**
- S-COM-20 y S-COM-21 corrigen SQL que **todavía no se aplicó**. Quedan efectivos cuando el dueño corra la 003 y la 004.
- S-COM-18 cierra el camino del **login**. El rol se sigue pudiendo forjar **después** del login, editando IndexedDB y recargando la página: es S-BUL-01 (Alto, abierto), que este run no empeora.

Hallazgos corregidos:

| Hallazgo | Qué lo corrige |
|---|---|
| S-COM-18 | `ingresarConPin` lee la fila por el mismo `remoteId` que verificó el PIN y es fail-closed. `vendedorDeSesion` ignora el permiso local. Un registro solo-local entra como vendedor (2) |
| S-COM-20 | La 004 redefine `admin_guardar_vendedor`: misma firma y defaults que la 002, admin autorizante activo y con PIN, `vendedor_inexistente`, `vendedor_inactivo`, `admin_sin_pin` y `ultimo_admin`, todo bajo el lock `vendedores_baja` |
| S-COM-21 | Un solo `pg_advisory_xact_lock(hashtext('comisiones_global'))` en cerrar y en anular, tomado después de autorizar |
| S-BUL-06 | `cantidadTipeada`, `sumarCantidades` y `validarCantidadesItems` en las 3 pantallas. Queda un residual en el ledger: S-BUL-09 (Bajo) |
| S-BUL-08 | `productoParaBulto` resuelve solo por id, en Facturación y en Armado |

**C7 (¿deadlock entre el lock global de la 003 y la baja de la 004?): no hay ciclo posible.**
- Las claves de lock son disjuntas: la 003 usa solo `comisiones_global` y la 004 solo `vendedores_baja`.
- Las RPC de la 003 no toman locks de fila sobre `vendedores`.
- La 004 no toca tablas de comisiones.
- Dentro de cada migración el orden es siempre el mismo: primero el lock global y después el `for update`.
- Lo único que comparten es el `insert` en `vendedores_pin_intentos`, que no tiene índice único y no bloquea.

Queda un TOCTOU sin impacto práctico: un cierre puede commitear firmado por un admin al que dan de baja en ese mismo instante (Info, S-VEN-04).

**C5b/C6 (¿qué pasa si alguien vuelve a correr la 002 después de la 004?)**
- **PASO 1:** pisa `admin_guardar_vendedor` con la versión vieja. Se pierden:
  - el chequeo de admin autorizante `activo`;
  - `vendedor_inactivo`: un admin podría volver a ponerle PIN a un dado de baja;
  - `admin_sin_pin` y `ultimo_admin`.
- **No se pierde:**
  - el trigger `vendedor_activo_solo_rpc` (la 002 no lo toca);
  - la baja ya hecha (`pin_hash` sigue en null);
  - el grant de `activo`: el PASO 2 arma el grant de forma dinámica con todas las columnas salvo `pin` y `pin_hash`.
- **El riesgo concreto es S-VEN-03 (Bajo).** Un dado de baja al que le vuelven a poner PIN no puede entrar a la UI (C5 lee `activo=false`), pero sí puede usar `cerrar_comisiones` y `anular_cierre_comisiones` (la 003 no mira `activo`) y la `admin_guardar_vendedor` vieja.
- **Remediación propuesta (SQL, detalle abajo):**
  - un trigger en la 004 que impida tener `pin_hash` con `activo=false`;
  - envolver la función de la 002 en un `DO` que no la cree si existe la columna `activo`.

**REQ-PLA:**
- **Prototype pollution:** no hay en el código propio. Los encabezados se mapean con `Map`, las claves de `indices` salen solo de campos conocidos y `tiene()` usa `hasOwnProperty`. `__proto__` se normaliza a `proto` y no matchea nada. Lo prueban los tests.
- **Formula injection:**
  - en la importación, `csvSafe` se aplica en todos los textos; CUIT y celular quedan solo con dígitos; la Comisión se ignora;
  - en la plantilla exportada, todas las celdas pasan por `csvSafe`, y además `aoa_to_sheet` escribe strings, no fórmulas.
- **Stock:** solo por movimientos (`ajustarStock` → ledger) y solo en altas. En un producto existente se ignora. Re-importar el mismo archivo no duplica stock.
- **Lo que queda abierto:**
  - el parser vulnerable (S-DEP-01, Alto). Se puede mitigar en código de este run aislándolo en un Web Worker;
  - no hay límite de filas, celdas ni descompresión (S-PLA-01, Medio, corregible en código);
  - los vendedores homónimos (S-PLA-03, Bajo).

Hallazgos nuevos:

| Hallazgo | Severidad | Qué pasa |
|---|---|---|
| S-VEN-01 | Medio | Un vendedor dado de baja se vuelve a crear con el mismo nombre desde "+ Agregar vendedor" y recupera la atribución por nombre. Agrava S-COM-19 |
| S-PLA-01 | Medio | Importación sin límites: DoS del navegador del admin |
| S-VEN-02 | Bajo | Los admins que ya existen **sin PIN** entran con UI de admin con un toque. La 004 no crea nuevos, pero no limpia los viejos |
| S-VEN-03 | Bajo | Ver C5b/C6 |
| S-PLA-03 | Bajo | `resolverVendedor` no detecta homónimos |
| S-BUL-09 | Bajo | `movimientosParaPedido` no topa el delta ni exige enteros |
| S-VEN-04 | Info | `statement_timeout` de `anon` más el lock global, y el TOCTOU de baja contra cierre |

Conteo de abiertos:

| Severidad | Cant. | Hallazgos |
|---|---|---|
| Crítico | 1 | S-01 (preexistente) |
| Alto | 2 | S-BUL-01 y S-DEP-01 (preexistentes) |
| Medio | 6 | S-COM-03, S-COM-06, S-COM-14 y S-COM-19 (preexistentes); S-VEN-01 y S-PLA-01 (nuevos) |
| Bajo | 5 | S-HDR-01 (preexistente); S-VEN-02, S-VEN-03, S-PLA-03 y S-BUL-09 (nuevos) |
| Info | 2 | S-COM-22 (preexistente); S-VEN-04 (nuevo) |

CORREGIDO en esta corrida: S-COM-18, S-COM-20, S-COM-21, S-BUL-06 y S-BUL-08, más los controles C-VEN-01..05 y C-PLA-01..05.

**Crítico/Alto abiertos y si se corrigen en código de este run:**

| Hallazgo | ¿Se corrige en código de este run? |
|---|---|
| **S-01 (Crítico)** | No. Es del dueño: aplicar la 002 PASO 2-4 y Auth |
| **S-BUL-01 (Alto)** | No se cierra en código: necesita Auth. Sí se puede **mitigar** en código: revalidar la fila del servidor al restaurar la sesión y en el efecto de merge cuando hay red (detalle abajo) |
| **S-DEP-01 (Alto)** | El fix real es del dueño: instalar `xlsx` desde el CDN, versión 0.20.3 o mayor. Hay **mitigación en código de este run**: parsear dentro de un Web Worker con timeout, `sheetRows` y solo `.xlsx`/`.csv`. Con eso baja a Medio |

## Tabla de hallazgos

| Severidad | Hallazgo | Evidencia | Estado | Dónde se corrige | Origen |
|---|---|---|---|---|---|
| Crítico (CVSS 9.1) | **S-01**: el servidor no tiene autenticación. La anon key lee y escribe `pedidos`, `clientes` (CUIT, teléfono, domicilio) y `productos`, y escribe `vendedores.nombre`/`zona`. Hasta el PASO 2, `vendedores.pin` se puede leer | `002_seguridad_recomendada.sql:202-214` (PASO 2 comentado), `:365-383` (PASO 5); `pedidos` sin políticas en el repo | ABIERTO | Dueño: 002 pasos 1-4 y paso 5 (Auth) | Preexistente (run1) |
| Alto (CVSS 7.1) | **S-BUL-01**: el rol sale del estado local. **Bypassea C5 después del login:** (1) se entra normal (permiso 2); (2) en IndexedDB se cambia `permiso: 1` del registro propio; (3) `recargar()` o un reload de la página → `init` restaura `found` del dispositivo sin pedir PIN (`!tienePin(found)`) y el efecto de merge copia `found.permiso`. Resultado: UI de admin. Las RPC (comisiones, vendedores) siguen pidiendo el PIN del admin | `src/hooks/useAppContext.js:262-266` (restaura desde lo local), `:371-391` (merge `{...vendedorActual, ...found}`); `src/services/sesion.js:19-26` | ABIERTO | Dueño: Supabase Auth con claim `permiso`. Mitigación en código de este run: revalidar con `leerFilaVendedor` al restaurar y en el merge cuando hay red | Preexistente |
| Alto (CVSS 7.5) | **S-DEP-01**: `xlsx@0.18.5` (GHSA-4r6h-8v6p-xvw6 prototype pollution, GHSA-5pgg-2g8v-p4x9 ReDoS), sin fix en npm. Ahora tiene **dos entradas**: Productos y Clientes (REQ-PLA). Se aceptan `.xls` (BIFF/CFB, la superficie más histórica) y `XLSX.read` se llama sin opciones. `npm audit --omit=dev`: 92 vulnerabilidades (3 critical, 73 high), casi todas de `react-scripts` en `dependencies` | `package.json:15,17`; `src/pages/Configuracion.js:46-61` (`XLSX.read(buf, { type: 'array' })`), `:532,588` (`accept=".csv,.txt,.xlsx,.xls"`) | ABIERTO | Dueño: tarball de cdn.sheetjs.com (>=0.20.3) y mover `react-scripts` a `devDependencies`. Código de este run: Web Worker, quitar `.xls` y opciones de lectura (ver Detalle) | Preexistente (agravado por REQ-PLA) |
| Medio (CVSS 5.3) | **S-VEN-01 (nuevo)**: la baja se evita re-creándose. El dado de baja "Carlos" toca "+ Agregar vendedor" y escribe "Carlos": se crea una fila nueva activa, sin PIN y con `permiso` 2. Como pedidos, comisiones y `resolverVendedor` van por **nombre**, recupera la visibilidad de "sus" pedidos y la atribución. Además, `resolverVendedor` de la importación lo vuelve a aceptar como vendedor activo | `src/components/SelectorVendedor.js:51-80,187-189`; `src/sync/syncService.js:717-729`; `src/domain/plantillas.js:236-242`; `src/hooks/useAppContext.js:316-319` (pull por `vendedorNombre`) | ABIERTO | Dueño (S-COM-19): quitar la auto-alta. Código de este run: rechazar un nombre que ya exista por `claveUnica`, activo o no. SQL: índice único `lower(trim(nombre))` y `revoke insert` | Nuevo (REQ-VEN, raíz S-COM-19) |
| Medio (CVSS 5.5) | **S-PLA-01 (nuevo)**: la importación no tiene límites. (1) Sin tope de filas: un CSV de 5 MB tiene unas 1.3 millones de filas, que se validan, se escriben **una por una** en IndexedDB y se renderizan como `<li>` en el resumen de rechazos. (2) `XLSX.read` sin `sheetRows`: un `.xlsx` de 5 MB comprimido puede descomprimir a GB (zip bomb), y eso tumba la pestaña. (3) Sin tope de columnas por fila. El atacante es un proveedor que manda la planilla: el admin solo tiene que abrirla | `src/pages/Configuracion.js:51-64,68-104,108-123`, `:126-160` (`ResultadoImport` lista todos los rechazos, `:155-156`); `src/domain/plantillas.js:383-460` | ABIERTO | Código de este run (ver Detalle) | Nuevo (REQ-PLA) |
| Medio (CVSS 5.9) | **S-COM-14**: el bloqueo de PIN se puede usar como DoS (5 fallos por `vendedor_id` → 15 minutos sin poder ingresar). PIN de admin de 4 dígitos | `002_seguridad_recomendada.sql:108-113` | ABIERTO | Dueño/SQL 002 | Preexistente |
| Medio (CVSS 5.3) | **S-COM-19**: auto-alta sin PIN, con nombre libre (ver S-VEN-01) | `SelectorVendedor.js:187-189` | ABIERTO | Dueño (decisión) | Preexistente |
| Medio (CVSS 5.3) | **S-COM-03**: los cierres se pueden leer con la anon key (`using (true)`) | `003_comisiones.sql` (políticas `*_select`) | ABIERTO | SQL 003 (RPC de lectura) o Auth | Preexistente |
| Medio (CVSS 4.3) | **S-COM-06**: `pedidos.total` se puede editar con la anon key y el recálculo de la 003 confía en ese valor | `003_comisiones.sql` (recálculo contra `public.pedidos`) | ABIERTO | Dueño: Auth/RLS o un trigger sobre pedidos cerrados | Preexistente |
| Bajo (CVSS 3.1) | **S-VEN-02 (nuevo)**: un admin del servidor sin PIN entra con UI de admin con un toque (`consultar` → `tiene_pin=false` → `entrar` con `permiso: 1`). La 004 impide **crear** nuevos o quitarle el PIN a uno, pero no hace nada con las filas que ya existen. Ese admin no puede autorizar ninguna RPC, así que el impacto es solo de UI | `src/services/vendedoresService.js:88-96`; `src/domain/vendedores.js:102-120`; `004_baja_vendedores.sql:219-228` (solo en escritura) | ABIERTO | Código de este run: en `vendedorDeSesion`, permiso 1 con `tiene_pin` distinto de `true` pasa a 2. Dueño: correr la consulta de control antes de aplicar la 004 | Nuevo |
| Bajo (CVSS 2.7) | **S-VEN-03 (nuevo)**: la 003 no exige `activo`. Hoy no se puede explotar, porque la baja borra `pin_hash` y `verificar_pin` da false. Pasa a explotarse si alguien vuelve a correr la 002 PASO 1 (versión vieja de `admin_guardar_vendedor`, sin `vendedor_inactivo`) y un admin le vuelve a poner PIN a un dado de baja: ese usuario cierra y anula comisiones y edita vendedores por RPC, aunque no pueda entrar a la UI | `003_comisiones.sql:245-252,506-512` (`permiso = 1`, sin `activo`); `002_seguridad_recomendada.sql:131-176` | ABIERTO | SQL 004 antes de aplicarla (trigger) y guarda en la 002 (ver Detalle) | Nuevo (C6) |
| Bajo (CVSS 2.6) | **S-PLA-03 (nuevo)**: `resolverVendedor` toma el **primer** activo que coincide por `claveUnica`. Con dos "Carlos" activos (posible por S-COM-19/S-VEN-01), el cliente queda asignado al nombre igual, sin aviso. `resolverProveedor` sí rechaza los homónimos | `src/domain/plantillas.js:236-242` frente a `:221-233` | ABIERTO | Código de este run: `filter` y, si hay más de uno, error "Hay N vendedores llamados…" | Nuevo (REQ-PLA) |
| Bajo (CVSS 2.6) | **S-BUL-09 (nuevo, residual de S-BUL-06)**: el tope está en las pantallas, pero no en el ledger. `movimientosParaPedido` emite `delta` sin tope y sin exigir enteros. Un pedido con cantidad 2.000.000 o 2,5 (legacy, o plantado por PATCH con S-01) genera al facturarse un movimiento que el servidor rechaza (`abs(cantidad) <= 1000000`, `integer`). Ese movimiento queda pendiente para siempre en el dispositivo. En Armado, un renglón que no está duplicado no pasa por `validarCantidadesItems` | `src/domain/stock.js:67-90` (sin `MAX_CANTIDAD`); `src/pages/Armado.js:491-506` | ABIERTO | Código de este run: en `movimientosParaPedido`, rechazar o partir en tramos los `delta` con `!Number.isInteger` o `abs > MAX_CANTIDAD` y avisar | Nuevo |
| Bajo (CVSS 3.1) | **S-HDR-01**: la CSP está en `Content-Security-Policy-Report-Only` | `public/_headers:7` | ABIERTO | Dueño (infra) | Preexistente |
| Info | **S-VEN-04 (nuevo)**: (1) Supabase aplica `statement_timeout` de unos 3 s al rol `anon`. Un cierre grande, o uno que espera el lock global detrás de otro, puede cancelarse (`57014`) sin quedar a medias, porque es una sola transacción. (2) TOCTOU: `cerrar_comisiones` lee al admin sin lock, así que una baja concurrente puede commitear justo antes del cierre | `003_comisiones.sql:244-266` | ABIERTO | Dueño: probar en staging (paso manual 3). Si hace falta, `alter role anon set statement_timeout` o `set local` dentro de la RPC | Nuevo |
| Info | **S-COM-22**: login *fail-open* si falta la 002 PASO 1 (rama LEGACY). Ahora toma el permiso y el nombre del servidor y exige que la fila exista | `src/services/vendedoresService.js:83-88` | ABIERTO (mejorado en C5) | Orden de despliegue | Preexistente |
| Medio → resuelto (CVSS 5.4) | **S-COM-18**: el login confiaba en el registro local. **Ataque A** (local `permiso 1`): la sesión sale de la fila del servidor. **Ataque B** (`remoteId` cambiado): la fila se lee por el **mismo** `remoteId` que verificó el PIN, así que la sesión es la del dueño del PIN. **Caso (c)**, solo-local: permiso 2. Si la lectura falla, no entra (fail-closed). La sesión se persiste sobre el registro local y `recargar` no vuelve a subir el permiso. `vendedorDeSesion` nunca copia `pin` y valida el permiso con `permisoValido`. Residual post-login en S-BUL-01 | `src/services/vendedoresService.js:38-50,64-97,120-139`; `src/domain/vendedores.js:84-86,102-134`; `src/components/SelectorVendedor.js:100-106,133-138` | CORREGIDO (login) | `SelectorVendedor.test.js:191-255`, `vendedoresService.test.js:205+`, `vendedores.test.js:176-215`, `useAppContext.test.js:271`, `security.vendedores.run2106.test.js` (ataque B, permisos raros) | Este run (C5) |
| Bajo → resuelto (CVSS 2.7) | **S-COM-20**: la 004 redefine `admin_guardar_vendedor` con la misma firma y los mismos defaults que la 002, y `search_path = public, extensions, pg_temp`. Orden: `verificar_pin` siempre → `return null` (sin raise) si el admin no es `permiso 1 and activo and pin_hash is not null` → validación → lock `vendedores_baja` → `for update` del destino → `vendedor_inexistente`, `vendedor_inactivo`, `admin_sin_pin`, `ultimo_admin` (cuenta solo admins activos con PIN) → insert/update. Los `raise` van después de autorizar, así que no habilitan fuerza bruta. El cliente lo espeja (`chequeoUltimoAdmin`) y mapea los motivos | `004_baja_vendedores.sql:168-266`; `src/domain/vendedores.js:219-243,284-293`; `src/services/vendedoresService.js:150-154` | CORREGIDO (SQL sin aplicar; ojo con volver a correr la 002, ver S-VEN-03) | `migracion004.test.js:88-150`, `vendedores.baja.test.js`, `vendedoresService.test.js` (T-17), `security.vendedores.run2106.test.js` | Este run (C5b/C6) |
| Bajo → resuelto (CVSS 3.7) | **S-COM-21**: un único lock global (`comisiones_global`) en `cerrar_comisiones` y en `anular_cierre_comisiones`, tomado después de autorizar y antes de la idempotencia y del `for update`. Se borraron los loops por pedido. Sin deadlock con la 004 (ver Resumen) | `003_comisiones.sql:253-266,513-517` | CORREGIDO (SQL sin aplicar; probar en staging) | `security.comisiones.iter2.test.js:162,188`, `security.comisiones.auditoria.test.js:135`, `security.vendedores.run2106.test.js` (claves disjuntas, sin locks cruzados) | Este run (C7) |
| Bajo → resuelto (CVSS 2.6) | **S-BUL-06**: las cantidades tipeadas tienen tope. `cantidadTipeada` acepta un entero entre 1 y `MAX_CANTIDAD`, "1.000" se lee como 1000 y "2,5", NaN, negativos o más de 16 dígitos dan null. `sumarCantidades` se usa en las fusiones de Armado. `validarCantidadesItems` (con `previos`, para que un legacy sin cambios pase) corre antes de guardar en Nuevo Pedido y Facturación. Residual en el ledger: S-BUL-09 | `src/domain/bultos.js:152-212`; `NuevoPedido.js:50-62,332-333`; `Facturacion.js:102-104,507-508,618-631`; `Armado.js:433-438,467,491-506` | CORREGIDO (UI) | `security.bultos.test.js:207-245`, `bultos.pedido.test.js:250-290`, `bultos.facturacion.test.js:353-400`, `bultos.armado.test.js:307-360` | Este run (C3) |
| Info → resuelto | **S-BUL-08**: `productoParaBulto` resuelve solo por id (`Map`) y nunca por nombre. Sin match devuelve null y no hay botón. `getProductoActual` (con el fallback por nombre) queda solo para el precio de lista | `src/domain/bultos.js:221-227`; `Facturacion.js:464,935`; `Armado.js:457,660,667` | CORREGIDO | `bultos.test.js:170-190`, `bultos.facturacion.test.js:414`, `bultos.armado.test.js:365` | Este run (C4) |
| — | **C-VEN-01**: baja lógica por RPC `security definer`. `verificar_pin` siempre, un solo `no_autorizado`, `propio_admin`, `ultimo_admin` con PIN, lock y `for update`, `activo=false` más el borrado del PIN. Sin `delete`. `revoke public` + `grant` | `004_baja_vendedores.sql:82-155` | CORREGIDO | `migracion004.test.js`, `bajaVendedores.test.js` | REQ-VEN |
| — | **C-VEN-02**: la anon key no puede cambiar `activo` (trigger que corre aunque sea `security definer`, porque compara `current_user`). Un insert por anon fuerza `activo=true`. Solo se da `grant select (activo)`, nunca de `pin`/`pin_hash` | `004_baja_vendedores.sql:53,60-74` | CORREGIDO | `migracion004.test.js:78-86`, `security.vendedores.run2106.test.js` | REQ-VEN |
| — | **C-VEN-03**: el cliente de la baja es fail-closed. Sin red, sin `remoteId` o sin PIN no llama. Una respuesta rara se toma como `no_autorizado`. Lo local se marca `activo:false` **solo** después del OK y el registro no se borra. El PIN se vacía del estado antes de llamar | `src/services/vendedoresService.js:191-213`; `src/domain/vendedores.js:333-347`; `src/pages/Configuracion.js:296-322` | CORREGIDO | `bajaVendedores.test.js`, `bajaVendedores.page.test.js` | REQ-VEN |
| — | **C-VEN-04**: cierre de sesión del dado de baja. Al restaurar (`!estaActivo` → limpia) y en el merge después del pull (`!estaActivo` → `limpiarSesion` + `removeItem`). En el ingreso, `interpretarEstadoRemoto` y `interpretarFilaIngreso` frenan `activo=false` aunque el dispositivo no haya sincronizado | `src/hooks/useAppContext.js:262-268,376-384`; `src/domain/vendedores.js:126-134,158-168` | CORREGIDO | `useAppContext.test.js`, `qa.vendedores.dispositivoDesactualizado.test.js:135` | REQ-VEN |
| — | **C-VEN-05**: los inactivos se filtran en el ingreso, en Configuración, en ListaPedidos y en los selectores de Comisiones y Cliente (conservando el valor ya asignado). Solo es UI: no es un control de acceso | `SelectorVendedor.js:175`; `Configuracion.js:381,726`; `ListaPedidos.js:326`; `Comisiones.js:142` | CORREGIDO | `listaPedidos.vendedores.test.js`, `comisiones.page.test.js` (T-22) | REQ-VEN |
| — | **C-PLA-01**: sin prototype pollution en el mapeo. `exactos` es un `Map`, las claves de `indices` salen solo de campos conocidos, `extraerValores` itera esas claves y `tiene()` usa `hasOwnProperty`. `normalizarEncabezado` saca `_` (`__proto__` queda `proto`) | `src/domain/plantillas.js:17,152-185,260,330,367-371` | CORREGIDO | `security.plantillas.test.js` (bloque "prototype pollution") | REQ-PLA |
| — | **C-PLA-02**: formula injection en la importación. `textoSeguro = csvSafe(texto())` en todos los textos de producto y cliente, y `csvSafe` en la unidad. CUIT y celular quedan solo con dígitos. Provincia e IVA deben pertenecer a una lista cerrada. Las fórmulas del XLSX no se leen (`raw:false` usa el valor cacheado) | `src/domain/plantillas.js:193,277-281,311-312,340-345`; `src/domain/validacion.js:82-88`; `src/domain/clientes.js` (`soloDigitos`) | CORREGIDO | `security.plantillas.test.js` (6 payloads × producto y cliente) | REQ-PLA |
| — | **C-PLA-03**: formula injection en la plantilla exportada. Todas las celdas pasan por `csvSafe`, incluidos los nombres de vendedores y proveedores de "Valores válidos". `aoa_to_sheet` escribe strings (`t:'s'`) y no fórmulas. Escribir con `xlsx` no expone la superficie de S-DEP-01 | `src/domain/plantillas.js:545,556`; `src/services/plantillaExcel.js:18-34` | CORREGIDO | `security.plantillas.test.js`, `plantillaExcel.test.js` | REQ-PLA |
| — | **C-PLA-04**: el stock entra solo por el ledger. Solo en altas, con `ajustarStock(..., { inicial: true })` (entero entre 0 y 1.000.000). En un existente se ignora (`stockIgnorado`). Si el movimiento falla, el producto queda marcado como "creado SIN stock inicial" y no se escribe ningún número (C9). Re-importar no duplica | `src/pages/Configuracion.js:76-101`; `src/domain/plantillas.js:299-301`; `src/domain/productos.js:94-98`; `src/services/stockService.js:61-66` | CORREGIDO | `security.plantillas.test.js` (bloque regla 4), `plantillas.test.js` (T-25), `plantillas.page.test.js` (T-26) | REQ-PLA / C9 |
| — | **C-PLA-05**: solo admin y tope de 5 MB. Toda la pantalla Configuración queda detrás de `isAdmin`. Solo es UI (ver S-BUL-01), pero el que importa solo se ataca a sí mismo: el riesgo real es el archivo de un tercero (S-DEP-01/S-PLA-01). Comisión excluida (AC-PLA-4). El vendedor se resuelve solo entre activos | `src/pages/Configuracion.js:46,52,166,186-196`; `src/domain/plantillas.js:71-76,236-242` | CORREGIDO | `plantillas.page.test.js` (T-24, permisos 2 y 3), `security.plantillas.test.js` | REQ-PLA |

## Detalle

### S-BUL-01: cómo se saltea C5 después del login (Alto, ABIERTO)
1. El vendedor entra normal con su PIN (o sin PIN). La sesión queda con permiso 2 y `persistirSesion` lo graba en IndexedDB.
2. En DevTools → IndexedDB → `vendedores`, en su registro, pone `permiso: 1`.
3. Cualquier `recargar()` (sync, guardar algo) dispara el efecto de `useAppContext.js:371-391`: `next = { ...vendedorActual, ...found }` y ya tiene la UI de admin. También funciona un reload de la página, porque `init` restaura `found` si `!tienePin(found)` o si la sesión de 12 h está validada (`:262`).

**Mitigación en código de este run (no cierra el hallazgo; reduce la ventana):**
```js
// useAppContext: al restaurar y en el merge, si hay red, la verdad es la fila del servidor
if (navigator.onLine && found?.remoteId != null) {
  const r = await leerFilaVendedor(found.remoteId);           // exportarla desde vendedoresService
  const s = r.error ? null : vendedorDeSesion(found, r.data);
  if (!s) { seleccionarVendedor(null); return; }               // dado de baja / no existe
  found = { ...found, permiso: s.permiso, nombre: s.nombre, zona: s.zona };
}
```
Offline el problema sigue. La solución real es Supabase Auth con claim `permiso` (002 PASO 5).

### S-DEP-01 / S-PLA-01: parseo de planillas de terceros (Alto / Medio)
**Correcciones en código de este run:**

1. **Aislar el parser en un Web Worker.** Un prototype pollution queda en el realm del worker, que se descarta después de cada archivo. Un ReDoS o un zip bomb se corta con un timeout. El hilo principal recibe solo `string[][]`:
```js
// src/services/leerPlanilla.worker.js
import * as XLSX from 'xlsx';
self.onmessage = ({ data: buf }) => {
  const wb = XLSX.read(buf, { type: 'array', sheetRows: MAX_FILAS_IMPORT + 1, cellFormula: false,
    cellHTML: false, cellStyles: false, bookVBA: false, bookFiles: false, WTF: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true });
  self.postMessage(rows.map(r => r.slice(0, MAX_COLUMNAS).map(c => String(c).slice(0, 500))));
};
// Configuracion.leerFilas: new Worker(new URL('../services/leerPlanilla.worker.js', import.meta.url));
// setTimeout(() => { worker.terminate(); reject(new Error('El archivo tardó demasiado')) }, 15000)
```
2. **Aceptar solo `.xlsx` y `.csv`**, sin `.xls`. Verificar los magic bytes: `PK\x03\x04` para xlsx.
3. **Poner límites en el dominio:** `MAX_FILAS_IMPORT = 5000` y `MAX_COLUMNAS = 40` en `planificarImportacion`. Si se superan, devolver `{ ok:false, error:'El archivo tiene más de 5000 filas: partilo en varios' }`. Además, recortar los rechazos que se muestran (los primeros 200 y "… y N más").
4. **Para el CSV:** cortar en `MAX_FILAS_IMPORT + 1` líneas antes de `parseCSVLine`.

**Dueño:**
```bash
npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
# y mover react-scripts a devDependencies
```

### S-VEN-01: re-alta de un dado de baja (Medio, ABIERTO)
- **Ataque:** "Carlos" queda dado de baja → abre la PWA → "+ Agregar vendedor" → escribe "Carlos" → entra con permiso 2. El pull de pedidos por `vendedorNombre = 'Carlos'` le baja la cartera, y lo que cargue cuenta para las comisiones de "Carlos".
- **Corrección en código de este run:** en `handleAgregar`, rechazar si `vendedores.some(v => claveUnica(v.nombre) === claveUnica(nuevoNombre))`, incluidos los inactivos. Lo ideal es quitar el botón, porque las altas ya se hacen por `admin_guardar_vendedor`.
- **SQL**, después de revisar que no haya duplicados:
```sql
create unique index if not exists vendedores_nombre_uq on public.vendedores (lower(trim(nombre)));
revoke insert on public.vendedores from anon, authenticated;   -- altas solo por admin_guardar_vendedor
```

### S-VEN-02: admins existentes sin PIN (Bajo, ABIERTO)
**Antes de aplicar la 004, correr esta consulta de control:**
```sql
select id, nombre from public.vendedores where permiso = 1 and pin_hash is null;
```
Si devuelve filas, ponerles PIN por `admin_guardar_vendedor` o degradarlas.

**En el cliente** (`vendedorDeSesion`), cuando la fila trae `tiene_pin`:
```js
const p = permisoValido(Number(fila.permiso)) ?? ROLES.VENDEDOR;
permiso: p === ROLES.ADMIN && fila.tiene_pin === false ? ROLES.VENDEDOR : p,
```
Así un admin sin PIN nunca obtiene la UI de admin. Un admin sin PIN igual no puede autorizar nada en el servidor, así que no se pierde ninguna capacidad.

### S-VEN-03: volver a correr la 002 después de la 004 (Bajo, ABIERTO, SQL sin aplicar)
**Agregar en la 004**, dentro del `begin/commit`, un trigger que la 002 no pisa:
```sql
create or replace function public.tg_vendedor_inactivo_sin_pin() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.activo = false then
    new.pin := null; new.pin_hash := null; new.tiene_pin := false;
  end if;
  return new;
end $$;
drop trigger if exists vendedor_zz_inactivo_sin_pin on public.vendedores;   -- "zz": corre después de vendedor_hashear_pin
create trigger vendedor_zz_inactivo_sin_pin before insert or update on public.vendedores
  for each row execute function public.tg_vendedor_inactivo_sin_pin();
```
Con este trigger, ningún camino deja un dado de baja con `pin_hash`: ni la `admin_guardar_vendedor` vieja ni un cliente viejo. Y `verificar_pin` sigue dando false para él.

**En la 002 PASO 1**, para que volver a correrla no degrade la función, envolver el `create or replace function public.admin_guardar_vendedor` en:
```sql
do $do$ begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'vendedores' and column_name = 'activo') then
    execute $f$ create or replace function public.admin_guardar_vendedor(...) ... $f$;
  end if;
end $do$;
```
Si no, alcanza con dejar documentado que hay que volver a correr la 004: ya está en las dos cabeceras (`002:128-130`, `004:30-31`).

**Defensa adicional:** en la 004, `create or replace` de `cerrar_comisiones` y `anular_cierre_comisiones` agregando `and coalesce(ve.activo, true)` a la búsqueda del admin. Es más invasivo; el trigger ya alcanza.

### C5b/C6: verificación de la 004 redefinida
- **Firma y defaults** idénticos a los de la 002 (lo verifica `migracion004.test.js:95`), así que `create or replace` no falla y no crea una sobrecarga.
- **Sin oráculo.** `verificar_pin` se llama siempre, antes de mirar si el id es admin. El `return null` es el mismo para los dos casos.
- **Raise solo después de autorizar.** Todos los `raise` (`permiso invalido`, `vendedor_inexistente`, etc.) van después de un `verificar_pin` exitoso. El rollback descarta solo un intento `ok=true`, así que el contador de fallos no se puede borrar.
- **Ninguna escritura sin lock.** El cálculo de `v_queda_pin` y el conteo de `ultimo_admin` se hacen bajo el lock `vendedores_baja`, con `for update` del destino. Ningún otro camino de escritura de `permiso` o `pin_hash` evita el lock:
  - la anon key no puede, por el trigger `vendedor_esc_sin_escalada` de la 002;
  - `verificar_pin` no escribe en `vendedores`.
- **Autoedición cubierta.** Que el admin se degrade a sí mismo está cubierto por `ultimo_admin`.

### C7: análisis de deadlock (sin hallazgo)

| Transacción | Locks que toma, en orden |
|---|---|
| `cerrar_comisiones` | `insert` en `vendedores_pin_intentos` → `comisiones_global` → `insert` en `comisiones_*` |
| `anular_cierre_comisiones` | `insert` en `pin_intentos` → `comisiones_global` → `for update` en `comisiones_cierres` → `update` en `comisiones_*` |
| `admin_baja_vendedor` y `admin_guardar_vendedor` | `insert` en `pin_intentos` → `vendedores_baja` → `for update` en `vendedores` → `update` en `vendedores` |

- No hay ningún recurso que una familia tome y la otra espere.
- Los `select` sobre `vendedores` de la 003 no bloquean.
- `pin_intentos` no tiene índice único, así que los `insert` no se bloquean entre sí.

Por eso no puede formarse un ciclo. Lo verifica `security.vendedores.run2106.test.js`.

### S-BUL-09: tope en el ledger (Bajo, ABIERTO)
```js
// src/domain/stock.js movimientosParaPedido, antes de out.push:
if (!Number.isInteger(delta) || Math.abs(delta) > MAX_CANTIDAD) {
  invalidos.push({ productoId: k, delta });   // devolver { movimientos, invalidos } o lanzar
  continue;                                   // y que la pantalla avise antes de facturar
}
```
Ojo: hoy `movimientosParaPedido` devuelve un array. Cambiar el contrato requiere tocar `stockService` y sus tests.

### Notas que no son de seguridad (para QA)
- `src/pages/Configuracion.js:582` dice "los 17 campos del alta de clientes", pero la plantilla ahora tiene 16 (Comisión excluida, AC-PLA-4).
- El repo versiona `distribuidora_documentacion.docx` y un PDF de pedidos. No se revisó si contienen datos personales de clientes (Ley 25.326): conviene que el dueño lo confirme.

## Corregido en esta corrida

**Verificado con evidencia archivo:línea y con tests verdes:**
- S-COM-18: login (C5).
- S-COM-20: SQL 004, sin aplicar (C5b/C6).
- S-COM-21: SQL 003, sin aplicar (C7).
- S-BUL-06: UI (C3).
- S-BUL-08 (C4).
- Controles C-VEN-01..05 (REQ-VEN) y C-PLA-01..05 (REQ-PLA).

**Tests agregados por esta auditoría.** No se tocó código de producción.

| Archivo | Qué prueba | Resultado |
|---|---|---|
| `src/domain/__tests__/security.plantillas.test.js` | Prototype pollution: encabezados y celdas `__proto__`/`constructor`, duplicados de códigos hostiles. Formula injection en la importación: 6 payloads (`= + - @ \t \r`) en producto y cliente, y Comisión con fórmula. Plantilla exportada con nombres hostiles. `csvSafe`. Regla dura 4: existente con Stock, y stock inicial y precio inválidos (`-5`, `1e9`, `NaN`, `Infinity`, `2,5`, fórmula). Vendedor dado de baja y proveedor homónimo | 2 `test.todo`: S-PLA-01 y S-PLA-03 |
| `src/domain/__tests__/security.vendedores.run2106.test.js` | C7: claves de lock disjuntas, sin locks cruzados, orden lock → `for update`. Volver a correr la 002: grant dinámico, avisos en las dos cabeceras, la 002 no conoce `activo`. La 004 sin grants de `pin`. C5: ataque B y permisos raros del servidor, solo-local con permiso 2. C5b: un admin sin PIN o dado de baja no cuenta | 2 `test.todo`: S-VEN-01 y S-VEN-02 |

Resultado: `CI=true npx react-scripts test --watchAll=false <esas 2 suites>` → 2 suites OK, 50 passed, 4 todo. Las 14 suites `security.*` del repo pasan.

**Suite completa.** Corrida en el momento de esta auditoría: 67 suites, 6 fallan (9 tests). Las 6 son archivos `qa.*` que el QA está escribiendo en paralelo, más `encoding.regla7.test.js`, que falla **por** el contenido de `qa.encoding.test.js` (tiene mojibake a propósito como fixture). Ninguna falla viene de esta auditoría ni de código de producción. `node harness/gates/run-gates.mjs --fast`: `coverage-domain`, `traceability`, `secret-scan` y `security-rules` dan PASS; `unit-tests` da rojo solo por esos archivos `qa.*`.

**Se puede corregir en código de este run (implementador):**

| Hallazgo | Severidad | Corrección |
|---|---|---|
| S-DEP-01 | Alto, mitigación | Parser en Web Worker con timeout, sin `.xls`, opciones de `XLSX.read` |
| S-BUL-01 | Alto, mitigación parcial | Revalidar la fila del servidor al restaurar y en el merge cuando hay red |
| S-PLA-01 | Medio | `MAX_FILAS_IMPORT`/`MAX_COLUMNAS` en el dominio, `sheetRows` y recorte de la lista de rechazos |
| S-VEN-01 | Medio | Rechazar la auto-alta con un nombre existente (o quitar el botón, si el dueño lo decide) |
| S-VEN-02 | Bajo | Admin sin PIN entra como 2 |
| S-PLA-03 | Bajo | Homónimos en `resolverVendedor` |
| S-BUL-09 | Bajo | Tope y entero en `movimientosParaPedido` |

**Se puede corregir en el SQL antes de aplicarlo:**
- S-VEN-03: trigger `vendedor_zz_inactivo_sin_pin` en la 004 y guarda `DO` en la 002.
- S-VEN-01: índice único por nombre, después de revisar duplicados.

## Requiere acción del dueño

1. **Antes de aplicar la 003 y la 004:**
   - confirmar que nunca se corrieron (si alguna se corrió, ir por una 005 con los mismos `create or replace`);
   - correr la consulta de control de S-VEN-02.
2. **Orden de despliegue** (con backup): 002 PASO 1 → 002 PASO 2 (descomentarlo) → 003 → 004 → publicar el build → todos recargan la PWA. **No volver a correr la 002 PASO 1 después de la 004**; si se vuelve a correr, correr de nuevo la 004 (S-VEN-03).
3. **Staging:**
   - un cierre con miles de pedidos y una anulación en paralelo (S-COM-21 / S-VEN-04: mirar el `statement_timeout` de `anon`);
   - degradar o quitarle el PIN al único admin con PIN (tiene que dar `ultimo_admin`);
   - editar a un dado de baja (tiene que dar `vendedor_inactivo`);
   - dar de baja y volver a intentar el login desde otro dispositivo.
4. **S-COM-19 / S-VEN-01:** decidir si se quita la auto-alta. La recomendación es quitarla, más `revoke insert` y el índice único por nombre.
5. **S-DEP-01:** instalar `xlsx` desde cdn.sheetjs.com (0.20.3 o mayor) y mover `react-scripts` a `devDependencies`. Mientras tanto, importar solo planillas de origen confiable.
6. **S-01 / S-BUL-01 / S-COM-06 (Crítico/Alto):** aplicar los pasos 3 y 4 de la 002 y planificar el paso 5 (Supabase Auth con claim `permiso`). Es la única protección real del rol y de `pedidos`.
7. **S-COM-14:** bloqueo por origen y PIN de admin de 6 o más dígitos.
8. **S-HDR-01:** pasar la CSP de `Report-Only` a `Content-Security-Policy`.
9. **Rotar los PIN** de todos los usuarios que tuvieron PIN en texto plano, después del PASO 2 (pendiente de la corrida 20261007-2022).

### Limitaciones
- El SQL de la 003 y la 004 no se ejecutó contra Postgres. Lo cubren los tests estáticos (regex) y la réplica de las reglas en JS.
- No se armó un archivo XLSX malicioso para reproducir GHSA-4r6h/5pgg: la vulnerabilidad es de la librería y está documentada por el proveedor.
