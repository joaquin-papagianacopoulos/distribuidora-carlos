# Veredicto tech lead — RUN 20261007-2022 — REQ-COM (AC-COM-1..16) + login online (S-COM-13)

VEREDICTO: APROBADO

No hay cambios de código bloqueantes. La aprobación es **para mergear y publicar el cliente**. Las migraciones SQL (002 PASO 1/PASO 2 y 003) **no se ejecutaron nunca contra un Postgres real**: aplicarlas en producción queda condicionado a los pasos manuales 1 a 3 de abajo (staging y chequeo de PIN de los admins), que son **obligatorios**.

Alcance revisado:
- `harness/SPEC.md` (AC-COM-1..16), `plan.md`, `implementacion.md` (iteraciones 1 a 3), `qa-report.md`, `security-report.md` (actualizado después de la iteración 3) y `gates.json` (7/7 PASS).
- Código: `src/domain/{comisiones,vendedores,permisos}.js`, `src/services/{comisionesService,vendedoresService,pedidoRepository,sesion}.js`, `src/db/index.js`, `src/sync/syncService.js` (vendedores y entregado), `src/components/SelectorVendedor.js`, `src/hooks/useAppContext.js`, `src/pages/{Comisiones,Configuracion,Facturacion,OrdenEntrega}.js`, `src/App.js`, `supabase/migrations/002_seguridad_recomendada.sql` y `003_comisiones.sql`.
- No hay git en el proyecto, así que la revisión se hizo sobre el código actual.

## Gates y tests
- `gates.json`: unit-tests, coverage-domain (100 %), traceability (60/60), build, secret-scan, security-rules y npm-audit PASS. En npm-audit queda `xlsx` en high, que es S-DEP-01, preexistente.
- Lo volví a correr yo: `CI=true npx react-scripts test --watchAll=false` dio 47 suites OK; 874 passed, 1 skipped, 2 todo (877). El build no lo volví a correr: tomo el PASS de `gates.json`, que es sobre el código final.

## Revisión

### Correctitud contra los AC-COM
Los 16 AC tienen implementación y test con su ID. Los puntos más finos son estos.

**Coherencia entre el cliente y el servidor** (`comisiones.js` contra `003:371-442`):
- Los dos calculan la comisión con aritmética exacta: el cliente en centavos enteros con redondeo half-up, el servidor con `numeric` y `round`, que para montos no negativos dan lo mismo.
- El % viaja congelado con 2 decimales (`pctCongelado`).
- `total_vendido` suma solo los renglones `pedido`.
- `total_comision` excluye los `sin_comision`, igual que `resumirPorVendedor`.
- Los ajustes usan el % congelado del servidor.
- No encontré ningún camino en el que el flujo normal reciba `montos_inconsistentes`.

**AC-COM-16:**
- El índice único parcial (`003:126-130`) más los locks por pedido (`003:312-316`) impiden que un pedido quede en dos cierres vigentes.
- `unique_violation` revierte todo el cierre y devuelve `ya_cerrado`.
- No hay política ni grant de DELETE, y el trigger bloquea el borrado (`003:145-147`).

**AC-COM-1:**
- `marcarEntregadoOnlineFirst` (`pedidoRepository.js:208-214`) no pasa por el stock (regla dura 4).
- Offline usa el `updatePedido` local de siempre, y la columna inexistente se tolera con reintento y `entregaPendiente` (`pedidoRepository.js:91-99`).

### IndexedDB 4 → 5 → 6, sin pérdida de datos
- La v5 solo **agrega** dos stores con `if (!contains)` (`db/index.js:77-86`).
- La v6 recorre `vendedores` con un cursor dentro de la transacción de upgrade y hace `cursor.update(sinPinLocal(v))` solo si hay campos secretos (`db/index.js:94-103`). No hay `delete`, `clear` ni `deleteObjectStore`.
- Un usuario en v4 pasa directo a v6 en un solo `onupgradeneeded`. La lógica es lineal, aunque no hay un test de ese salto (sugerencia 9).
- Todas las escrituras de vendedores pasan por `sinPinLocal`, incluido `importBackup` (`db/index.js:206,331,449,574`).
- Que se quite `pin` es decisión del dueño y está justificado: es una credencial, no un dato de negocio. Hay un caso borde que **sí** se pierde y que el dueño tiene que saber (paso manual 2): un PIN que se cambió desde Configuración en la versión vieja quedó **solo en ese dispositivo**, porque las ediciones viejas no subían al servidor. Después de la v6, el PIN que vale es el del servidor.

### SQL 003
- Es coherente e idempotente:
  - `if not exists` en tablas, columnas, índices y constraint;
  - `create or replace` en las funciones;
  - `drop function if exists` de las firmas viejas;
  - todo dentro de `begin/commit`.
- Aborta sin tocar nada si falta `verificar_pin` (`003:50-55`).
- Las RPC son `security definer`, con `search_path` fijo, `revoke ... from public` y respuesta única `no_autorizado`. El intento fallido queda grabado porque rechazan con `return` y no con `raise`.
- RLS de solo lectura.
- Revisé a ojo la sintaxis de los bloques más delicados: `except`/`union all` entre paréntesis, `filter`, el `for ... in select ... order by 1` y el bloque `exception when unique_violation`. No encontré errores, pero **no reemplaza** la corrida en staging.

### Orden de despliegue
**Hay una contradicción entre documentos:**
- `implementacion.md:178-186` y el `security-report.md` ponen el **PASO 2 antes** de la 003 y de publicar.
- La propia `002_seguridad_recomendada.sql:12-13` dice que los pasos "REQUIERE CLIENTE NUEVO" (el PASO 2 lo es, `002:180`) se corren **después** de publicar.

**El orden que vale es el de este veredicto** (ver Pasos manuales). Deja el PASO 2 después de publicar, así los dispositivos viejos no pierden la sincronización completa. Cumple las dos restricciones de seguridad que importan:
- la 002 PASO 1 va antes de publicar, porque sin `verificar_pin` nadie con PIN puede entrar;
- la rotación de PINs va **después** del PASO 2, porque antes `pin_hash` se puede leer con la anon key y un PIN de 4 dígitos se rompe offline en minutos.

### Offline-first
- **Lo que sigue andando sin conexión:** la sesión ya iniciada se restaura offline (`useAppContext.js:261`); el borrador de comisiones, la marca de entregado y todo lo demás funcionan offline como antes.
- **Lo que pide conexión, por diseño:** el ingreso nuevo, cerrar y anular.
- **Matiz importante para el dueño (sugerencia 2):** a un usuario **con PIN** la sesión se le restaura solo durante 12 h desde el último ingreso. `marcarSesionValidada` no se renueva al restaurar (`sesion.js:19-21`). Después de ese plazo, sin señal no puede entrar. Antes de esta iteración podía hacerlo con el PIN local. A los usuarios sin PIN no les afecta.

### Reglas duras de CLAUDE.md
- **Regla 4:** el entregado no toca el stock.
- **Regla 5:** los cierres usan UUID (`nuevoId`); los borradores, la clave del período.
- **Regla 6:** cumplida con la salvedad del PIN, que es credencial y fue decisión del dueño.
- **Sin secretos ni logs con PIN:** verificado en el código y por secret-scan.
- **Regla 7, mojibake:** `Configuracion.js:210,213` ("ConfiguraciÃ³n", "tenÃ©s") **no lo introdujo esta corrida**. Ya figura en `harness/reports/20261007-run1/qa-report.md:124` ("Ya estaba antes de este commit, está en HEAD~1"). Lo mismo pasa con `Facturacion.js:262,265,519` y `NuevoPedido.js:89`, que ya registró el veredicto de 20261007-2004. Los archivos nuevos de esta corrida están en UTF-8 limpio. Queda como sugerencia 8.

### Código muerto y nombres
- Los nombres son claros y en español.
- Hay código muerto menor: el `permiso` que devuelve `iniciarIngreso` nadie lo usa (sugerencia 1) y en `SelectorVendedor.js:4-5` hay un import duplicado de `syncService`.

## Verificación manual de 3 AC

**1. AC-COM-4** — Cumple.
- Tests: `comisiones.test.js:167-189` (tabla de 18 casos: redondeo, sin %, total inválido) y `comisiones.test.js:446-450` (`armarLinea` con cliente sin %: comisión 0 y aviso `sin_pct`).
- Código: `comisiones.js:163-207` (`aCentavos`, `mulDivRedondeo` half-up en enteros, `comisionCentavos`) y `comisiones.js:392-430`. El aviso se muestra en `Comisiones.js:50` ("cliente(s) sin % de comisión").
- El servidor aplica la misma fórmula (`003:371-386`).

**2. AC-COM-7** — Cumple.
- Tests: `comisiones.test.js:206-289` (ficha, cargador y dividir con 50/50 por defecto; suma ≠ 100; más de 2 decimales; NaN y negativos) y `comisiones.page.test.js:150`.
- Código: `comisiones.js:284-330` (`validarAsignacion`).
  - La suma se compara en centésimos enteros: `pctABase(pf) + pctABase(pc) !== 10000`.
  - `repartirCentavos` (`comisiones.js:211-220`) le da el resto a la última parte, así la suma da exacta al centavo.
  - La opción "Dividir" solo aparece en pedidos con aviso (a) (`Comisiones.js:92`).

**3. AC-COM-12** — Cumple.
- Tests: `comisiones.test.js:522-535` (motivo de 3 a 300 caracteres, solo vigente, quién y cuándo), `comisiones.test.js:318-322` (al anular se liberan los pedidos), `qa.comisiones.test.js:87`, `comisiones.page.test.js:262` (historial con anulados) y `security.comisiones.iter2.test.js:170-180` (se bloquea si hay ajustes dependientes).
- Código:
  - `comisiones.js:687-698` (`validarAnulacion`);
  - `comisionesService.js:246-285`: con la red caída el cierre **sigue vigente** y queda `anulacionPendiente`, sin PIN guardado;
  - `003:480-541`: el servidor fija `anulado_por` y los renglones pasan a `vigente=false`, lo que libera el índice único;
  - `003:162-167`: un cierre anulado no se puede volver a tocar.

## Cambios requeridos (bloqueantes)
Ninguno.

## Sugerencias (no bloqueantes, ordenadas por prioridad)

1. **S-COM-18, Medio: el login usa el registro local después de verificar en el servidor.** Lugares:
   - `src/components/SelectorVendedor.js:102` y `:131` llaman a `seleccionarVendedor(v)` con el `v` local;
   - `src/services/vendedoresService.js:43` devuelve `permiso` y no se usa;
   - `src/domain/vendedores.js:77` deja entrar a un registro solo-local con el permiso que tenga.

   Arreglo: entrar con `{ ...v, permiso: r.permiso }` cuando lo devuelve el servidor, traer la fila del servidor después de `verificar_pin` y forzar `ROLES.VENDEDOR` para un solo-local.

   No bloquea por dos motivos:
   - S-BUL-01, preexistente, ya permite forjar la UI de admin desde localStorage, así que esto no abre una capacidad nueva;
   - el pull de maestros vuelve a fijar `permiso` desde el servidor (`useAppContext.js:370-379`). Las RPC de comisiones y vendedores siguen pidiendo el PIN del admin.
2. **Sesión de 12 h sin renovación para usuarios con PIN** (`src/services/sesion.js:19-21`, `src/hooks/useAppContext.js:261`). Hay que confirmarlo con el dueño. Si molesta en la calle, hay dos opciones:
   - renovar el TTL cada vez que se restaura una sesión todavía válida (ventana deslizante);
   - dar un TTL más largo a los roles 2 y 3.
3. **S-COM-21, Bajo: un advisory lock por pedido** (`supabase/migrations/003_comisiones.sql:312-316` y `:522-526`). Con hasta 5000 por transacción se puede agotar la tabla de locks compartida. Conviene cambiarlo antes de aplicar la 003 en producción por un único `pg_advisory_xact_lock(hashtext('comisiones_global'))` en cerrar y en anular, y ajustar el test de S-COM-15. Si se mantiene, probar en staging un cierre con miles de pedidos.
4. **S-COM-20, Bajo: `admin_guardar_vendedor` no exige en el servidor que un admin tenga PIN y permite degradar al último admin** (`supabase/migrations/002_seguridad_recomendada.sql:142-172`). Agregar los chequeos del `security-report.md` (sección S-COM-20) antes de correr el PASO 1.
5. **Comentario inexacto en `002_seguridad_recomendada.sql:40-41`.** Dice "se hashea y se limpia al vuelo", pero el trigger (`:42-50`) no pone `pin` en null. Está bien que no lo haga mientras existan clientes viejos, pero hay que corregir el comentario y, después del PASO 2, limpiar `pin` en el trigger.
6. **Documentación:** alinear el orden de `implementacion.md:178-186` con el de este veredicto y con `002:12-13`.
7. **`src/pages/Configuracion.js:276-285`:** los dos PIN se borran del estado **antes** de la validación de dominio. Ante un error de validación (por ejemplo, un admin sin PIN), el usuario tiene que volver a tipear los dos. Validar con `validarFormVendedor` primero y borrar después. Es solo UX.
8. **Regla 7, preexistente:** mojibake en `src/pages/Configuracion.js:210,213`, `src/pages/Facturacion.js:262,265,519` y `src/pages/NuevoPedido.js:89`. Corregirlo en un cambio chico aparte, con un editor en UTF-8.
9. **`src/db/__tests__/migracionV6.test.js`:** agregar un caso con `oldVersion = 4`, el salto directo v4 → v6 que va a pasar con los dispositivos que no actualizaron durante esta corrida.
10. **`src/components/SelectorVendedor.js:4-5`:** juntar los dos imports de `../sync/syncService`.
11. **QA hallazgo 1, teórico:** `aCentavos` (`src/domain/comisiones.js:169`) redondea para arriba valores con 9 o más decimales. No afecta montos de 2 decimales.

## Pasos manuales para el dueño (en este orden)

1. **Staging primero (obligatorio).** Crear un proyecto Supabase de prueba con una copia del esquema y datos de ejemplo. Correr ahí la 002 PASO 1 y la 003 y probar:
   - login con PIN bueno, con PIN malo y con 5 intentos malos (bloqueo);
   - alta de un admin por Configuración;
   - marcar entregado;
   - cerrar un período;
   - cerrar dos veces el mismo período desde dos navegadores (el segundo tiene que recibir "Otro admin ya cerró…");
   - anular con motivo;
   - anular un cierre base que tiene ajustes en otro cierre (tiene que dar `tiene_ajustes_vigentes`).

   Si algo del SQL falla, no seguir.
2. **Chequear los PIN de los admins (obligatorio).** Sin un admin con PIN en el servidor no se pueden cerrar comisiones ni administrar vendedores desde la app.
   - Antes del PASO 1, en el SQL Editor:
     `select id, nombre, (pin is not null and trim(pin::text) <> '') as tiene_pin from public.vendedores where permiso = 1;`
   - Si algún admin tiene `false`, o si cambió su PIN desde Configuración en la versión vieja (ese cambio quedó solo en su celular), definirle uno en el servidor **después** del PASO 1:
     `update public.vendedores set pin_hash = extensions.crypt('NUEVO_PIN', extensions.gen_salt('bf', 10)) where id = <id>;`
     El trigger pone `tiene_pin = true`.
   - Lo mismo aplica a cualquier usuario que haya cambiado su PIN desde la versión vieja: después de actualizar, el PIN que vale es el del servidor.
3. **Backup** (Supabase → Database → Backups).
4. **002 PASO 1** en el SQL Editor.
5. **003:** correr `supabase/migrations/003_comisiones.sql` completa. Aborta sola si falta el PASO 1.
6. **Deploy de la app:** `npx react-scripts build` y publicar como siempre.
   - Pedir a todos que cierren y abran la PWA **con conexión**.
   - Si queda otra pestaña abierta con la versión anterior, la app avisa al subir IndexedDB a v6 y hay que cerrarla.
   - Desde ahora, entrar con un usuario nuevo pide conexión.
7. **002 PASO 2, el mismo día:** descomentar `002:199-211` y correrlo. Hasta este paso, `pin` y `pin_hash` se pueden leer con la anon key. Los dispositivos que todavía no recargaron pierden la sincronización completa hasta que lo hagan.
8. **Rotar los PIN** desde Configuración → Vendedores de la app nueva, **después** del PASO 2: el del admin y los de todos los que tenían PIN, porque fueron legibles en texto plano.
9. **Prueba de humo en producción:**
   - entrar con el admin;
   - marcar y desmarcar entregado un pedido facturado y verificar que el stock no se mueve;
   - abrir Comisiones con el mes en curso.
10. **Decisiones pendientes del dueño:**
    - ¿"Entregado" o "A reparto"? Si elige "A reparto", hay que cambiar juntos `CONFIG_COMISIONES.criterioEntregado` y la RPC (`003:350-363` y `:404-408`).
    - ¿Comisionan los pedidos WEB o los cargados por el admin?
    - ¿Se aceptan ajustes negativos?
    - ¿Se mantiene la auto-alta "+ Agregar vendedor" sin PIN (S-COM-19)?
    - ¿Alcanza la sesión de 12 h para los usuarios con PIN (sugerencia 2)?
11. **Pendientes de seguridad preexistentes:** 002 pasos 3 y 4, Supabase Auth (paso 5) para S-01 y S-BUL-01, `xlsx` desde el CDN de SheetJS (S-DEP-01) y la CSP en modo enforce (S-HDR-01).
