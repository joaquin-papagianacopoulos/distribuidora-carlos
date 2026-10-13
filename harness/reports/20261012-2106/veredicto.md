# Veredicto del tech lead — RUN 20261012-2106 (corrida de cierre, todo el SPEC)

VEREDICTO: APROBADO

No hay bloqueantes. Abajo van las sugerencias (no frenan el merge), las observaciones sobre los puntos que pidió el orquestador y el orden de despliegue consolidado para el dueño.

## Qué se revisó

- `harness/SPEC.md` (incluye AC-PLA-2/4 sin Comisión, AC-PLA-3b, REQ-VEN, REQ-PLA), `CLAUDE.md`, `plan.md`, `implementacion.md` (iter. 1 y 2), `qa-report.md`, `security-report.md` (escrito antes de la iteración 2) y `gates.json`.
- `git diff` completo (37 archivos modificados) y los archivos nuevos (`importacion.js`, `lectorPlanillas.js`, `planillaXlsx.js`, `leerPlanilla.worker.js`, `workerXlsx.js`, `testUtils/mojibake.js` y los tests).
- Corrida independiente: `CI=true npx react-scripts test --watchAll=false` da **73 suites OK, 1512 passed, 1 skipped, 3 todo, 0 failed (1516)**. Coincide con `gates.json`. El build no se volvió a correr (no escribo fuera de `harness/reports/`); `gates.json` lo da PASS sobre el código final.
- Traceability: el SPEC tiene 75 AC distintos y el gate cuenta 74, porque su regex (`harness/gates/run-gates.mjs:93`) lee AC-PLA-3b como AC-PLA-3. AC-PLA-3b sí tiene tests (verificado a mano, abajo). Ver la sugerencia S6.

## Verificación manual de 3 AC

1. **AC-PLA-3b (opcionales en productos).** `src/domain/plantillas.js:200-202`: `CAMPOS_OPCIONALES_PRODUCTO` y `celdaSinDato` (vacío, espacios, guion, guion largo). En `:271-272`, `tiene()` toma esas celdas como ausentes. En un alta, `strOr(undefined)` deja una cadena vacía y `validarProducto` la lleva a 0 (`productos.js:68,80`). Mínimo venta queda en 1 (`:286`) y el 0 pasa a 1 en `:295`. En un existente se conserva lo que tenía, y un guion no cuenta como cambio de costo, así que el precio no se recalcula. `validarProducto` no se aflojó. Test: `src/domain/__tests__/plantillas.opcionales.test.js:30-56`, con round-trip sobre un .xlsx real en `:73`. **OK.**
2. **AC-PLA-4 (Comisión ignorada).** `plantillas.js:346-374`: la comisión no se copia del existente al form ni sale del archivo. En un alta queda `null`; en una actualización se borra la clave del valor, así el merge con el existente conserva la de la ficha. `mapearEncabezados` la deja en `excluidas` y el resumen lo avisa. Tests: `plantillas.test.js:59-68` (16 columnas) y `:224-241` (comisión `null` en el alta, se conserva en la actualización), más `plantillas.page.test.js`. **OK.**
3. **AC-STK-5 (idempotencia).** `src/domain/stock.js` `revisarMovimientosPedido` compara contra los movimientos que ya tiene el pedido por `refs` y saltea delta 0. `aplicarStockPedido` no inicia el ledger para pedidos legacy sin movimientos. Tests: `stockService.test.js:131-138` (facturar dos veces da `[]` y `addMovimientosStock` se llama 1 sola vez) y `:271-287` (legacy). **OK.**

## Puntos pedidos por el orquestador

### 1) Tests modificados fuera de lo pedido

- **Fixture ANSI** (`src/pages/__tests__/qa.plantillas.import.page.test.js:57-62`). El cambio es legítimo: se agregó `arrayBuffer()`, que un `Blob` real tiene. La aserción no cambió (que la ñ llegue bien). Antes el fixture no podía pasar en jsdom. Aceptado.
- **`stockService.test.js` "AC-STK-2 cantidades decimales"** (S-BUL-09). Aceptado. Por qué no rompe AC-STK con pedidos legacy:
  - la columna `movimientos_stock.cantidad` es `integer` con `check abs <= 1000000` desde la 001 (`001_altas_y_stock.sql:65`). Un movimiento de -1,5 **nunca** se pudo subir: quedaba pendiente para siempre;
  - `pushPendientes` reintenta fila por fila (`stockService.js:100-116`), así que no trababa el resto, pero el stock de los otros dispositivos ya no coincidía con el local;
  - la UI anterior (HEAD) siempre parseó cantidades con `parseInt`, así que un decimal solo puede venir de datos adulterados o importados por fuera de la app;
  - el aviso existe: en Facturación, `alert(avisoInvalidos)` antes de facturar (`Facturacion.js:698`). En los demás caminos (revertir, borrar, guardar desde Armado o Lista) solo hay `console.warn` (`stockService.js:56`). **Ahí el stock queda mal sin aviso visible**: ver S1. Es residual y de muy baja probabilidad; no bloquea.
- **Fechas cortas (mdy en XLSX, dmy en CSV).** En XLSX, una celda **de fecha** se convierte a ISO antes de `sheet_to_json` (`planillaXlsx.js:55-62`), así que no hay ambigüedad. El `mdy` solo se aplica a un **texto** d/m/aa dentro de un .xlsx (celda con formato Texto o con apóstrofo), que en es-AR casi siempre es D/M. Además es incoherente con D/M/AAAA, que siempre se lee como dmy. Hoy, en un .xlsx con texto, 1/10/26 da 10 de enero y 1/10/2026 da 1 de octubre. Solo afecta "Fecha de alta", que es informativa. Ver S2.

### 2) SQL 003/004 modificados antes de aplicarse

- **Idempotencia.** Todo es `create or replace`, `drop trigger if exists` y `add column if not exists`, dentro de `begin/commit`. La 003 y la 004 abortan si falta `verificar_pin` (002 PASO 1). OK.
- **Orden 002 PASO 1 → 003 → 004.** Es correcto. `vendedor_habilitado()` (`003_comisiones.sql:78-91`) mira `information_schema` en cada llamada: sin la columna `activo` devuelve true (comportamiento previo) y empieza a regir apenas corre la 004, sin volver a correr la 003. No tiene `execute` para anon/authenticated, y las RPC `security definer` la llaman como owner. Un id inexistente devuelve false (`coalesce(..., false)`), que es fail-closed. OK.
- **Trigger `vendedor_zz_inactivo_sin_pin`** (`004:93-103`). Corre después de `vendedor_hashear_pin` por orden alfabético. La baja (`activo=false` con `pin`/`pin_hash` en null en el mismo `update`) pasa. Impide re-ponerle PIN a un dado de baja aunque se vuelva a correr la 002. Efecto colateral aceptable: un cliente **viejo** que suba un registro de un dado de baja con `pin` en texto plano recibe error en esa fila.
- **`admin_guardar_vendedor` redefinida** (`004:197-295`). La firma y los defaults son idénticos a los de la 002 (text, text, text, text, text, int, text default null, boolean default false), así que `create or replace` no crea una sobrecarga. Los `raise` van después de autorizar, el lock `vendedores_baja` es el mismo que en la baja y vuelven `revoke`/`grant`. Revisé la lógica de `v_queda_pin` y de último admin: correcta.
- **Sobrante:** `v_pid text;` sigue declarado sin uso en `003_comisiones.sql:259` y `:524`. `implementacion.md` dice que se quitaron. Es inofensivo; ver S5.

### 3) Revalidación de sesión S-BUL-01 (`src/hooks/useAppContext.js:107-145, 180-181, 310-311`)

- Sin red: no hace nada (`!navigator.onLine` sale de entrada; no se importa el servicio).
- Si la red falla: `revalidarSesion` atrapa la excepción y devuelve `mantener` (`vendedoresService.js:72-76`). Un `error` de PostgREST también da `mantener` (`vendedores.js:135`), y cualquier excepción del hook se atrapa (`console.warn`). **Un error de red no cierra ninguna sesión.** Tests: `useAppContext.revalidacion.test.js:101,108` y `vendedoresService.iter2.test.js:72,91`.
- Hay guarda de reentrada (`revalidandoRef`) y no pisa si cambió el usuario (`actual.id !== v.id`).
- Las dependencias de `init` ahora incluyen `revalidarSesionActual`, que depende solo de `recargar`: la estabilidad es la misma que antes.
- **Riesgo a futuro (info):** `data: null` sin error da `cerrar` (`vendedores.js:136`). Si algún día se activa RLS en `vendedores` sin una política de select para anon (por ejemplo, al hacer el PASO 5/Auth), todas las sesiones online se cerrarían en cada sync. Tenerlo en cuenta cuando se haga Auth (S3).

### 4) Worker XLSX con fallback y CSP

- Correcto: el parser corre en el worker (`leerPlanilla.worker.js`) con timeout de 20 s, `terminate` siempre, solo vuelven strings, opciones acotadas (`planillaXlsx.js:11-27`), magic bytes `PK`, sin `.xls` (con mensaje claro, `importacion.js:22,32`). El fallback en el hilo principal funciona si no existe `Worker`.
- CSP actual (`public/_headers`, Report-Only): no tiene `worker-src`, así que cae a `script-src 'self'`. El chunk del worker es same-origin y está permitido.
- **Imprecisión de la documentación:** si una CSP **bloquea** el worker, el navegador no lanza nada en `new Worker()`; dispara `onerror` de forma asincrónica. En ese caso `leerXlsx` **rechaza** con "No se pudo leer el archivo XLSX." (`lectorPlanillas.js:57`) y **no** cae al hilo principal. Eso contradice `implementacion.md` (paso manual 3) y el comentario de `lectorPlanillas.js:40`. Fallar cerrado está bien por seguridad, pero el dueño tiene que saber que, al pasar la CSP a enforce, `worker-src 'self'` es **obligatorio** para importar XLSX. Ver S4.
- `xlsx` ya se importaba de forma dinámica en HEAD, así que offline no empeora nada (`sw.js` no cachea `/static/`).

### 5) Reglas duras

- **Stock solo por movimientos:** sí. Importación con `ajustarStock(..., { inicial: true })` solo en altas (C9), S-BUL-09 omite movimientos y nunca escribe un número de stock. Sin cambios en `DB_VERSION` (sigue en 6) ni stores nuevos.
- **UTF-8 sin mojibake:** `encoding.regla7.test.js` y `qa.encoding.test.js` pasan con un detector unificado (`src/testUtils/mojibake.js`). OK.
- **No borrar datos de usuario:** no hay `delete` nuevo en Supabase ni en IndexedDB. La baja de vendedores es lógica. La importación hace upsert y nunca borra. OK.
- IDs nuevos con UUID: no hay tablas nuevas. Campos legacy: se conservan.

## Cambios requeridos

Ninguno bloqueante.

## Sugerencias (no bloqueantes, para una próxima corrida)

1. **S1 — Aviso visible de S-BUL-09 fuera de Facturación.** En `src/services/stockService.js:56`, los movimientos omitidos solo van a `console.warn`. Al revertir, borrar o editar desde Armado o Lista un pedido con una cantidad legacy decimal, el stock local queda desfasado sin que el usuario se entere. Propuesta: que `aplicarStockPedido` devuelva `invalidos` y que `pedidoRepository.sincronizarStock` (`src/services/pedidoRepository.js:179-187`) lo muestre (o lo deje en un registro que se vea en la pantalla de Stock).
2. **S2 — Fecha corta en XLSX como dmy.** En `src/pages/Configuracion.js:36-38`, pasar `fechaCorta: 'dmy'` también para `xlsx`: las celdas de fecha ya llegan en ISO (`planillaXlsx.js:55-62`), así que `mdy` solo afecta a textos tipeados por argentinos. Mantener `mdy` como default del dominio si el test de QA lo necesita, o directamente rechazar el d/m/aa ambiguo con un mensaje claro.
3. **S3 — Revalidación y RLS futura.** En `src/domain/vendedores.js:136`, cuando se encare Auth/RLS en `vendedores`, revisar que `data: null` sin error no cierre sesiones por un tema de visibilidad. Se puede distinguir "0 filas" de "sin permiso" o exigir una política de select explícita.
4. **S4 — Comentario y documentación de la CSP.** Corregir `src/services/lectorPlanillas.js:40` y el paso manual 3 de `implementacion.md`: una CSP que bloquea el worker hace que la lectura **falle** (no cae al hilo principal). Opcional: en `onerror`, si el worker no llegó a responder, reintentar en el hilo principal. Es una decisión de seguridad: hoy falla cerrado, y eso está bien.
5. **S5 — Variables sin uso** en `supabase/migrations/003_comisiones.sql:259` y `:524` (`v_pid text;`). Se pueden borrar antes de aplicar la 003, que todavía no se aplicó; los tests de regex no dependen de esa línea.
6. **S6 — Gate de traceability** (`harness/gates/run-gates.mjs:93`). Agregar a la regex un sufijo opcional de una letra minúscula después del número, para que AC-PLA-3b (y futuros AC con sufijo) se tracen por separado.
7. **S7 — Producto (dueño):** con S-VEN-01, `validarNombreNuevoVendedor` (`src/domain/vendedores.js:296`) impide volver a dar de alta a un vendedor dado de baja con el mismo nombre, y no existe una RPC para reactivarlo (`admin_guardar_vendedor` rechaza `vendedor_inactivo`). Si se reincorpora a alguien, hoy hay que usar otro nombre. Decidir si hace falta "Reactivar vendedor".
8. **S8 — `.xls` ya no se acepta** (S-DEP-01). AC-PROD-5 habla de CSV/XLSX, así que no lo rompe, pero el dueño tiene que saberlo: hay que guardar como .xlsx o como CSV. El mensaje en pantalla ya lo explica.

## Pasos manuales para el dueño — orden de despliegue consolidado

Todo en Supabase → SQL Editor. **Hacer un backup antes** (Database → Backups). Ningún paso borra datos.

1. **Confirmar** que la 003 y la 004 **nunca** se corrieron en Supabase. Se editaron en el lugar porque no estaban aplicadas. Si alguna ya se corrió, **no** re-correrla sobre datos reales: pedir una `005_consolidacion.sql` con los mismos `create or replace`.
2. **002 PASO 0 + PASO 1** (pgcrypto, `pin_hash`, `verificar_pin`, triggers, `admin_guardar_vendedor` vieja), si todavía no se aplicaron. El cliente actual y el nuevo funcionan con esto.
3. **003_comisiones.sql** completa. Crea `vendedor_habilitado()`, que por ahora deja pasar a todos.
4. **Consulta de control S-VEN-02** antes de la 004:

       select id, nombre from public.vendedores where permiso = 1 and pin_hash is null;

   Si devuelve filas, ponerles PIN (con `admin_guardar_vendedor`, que es la versión de la 002 en este momento) o bajarlas a permiso 2. Verificar que quede **al menos un admin con PIN**.
5. **004_baja_vendedores.sql** completa. Agrega la columna `activo`, el trigger anti-resurrección, el trigger `vendedor_zz_inactivo_sin_pin`, `admin_baja_vendedor` y la `admin_guardar_vendedor` nueva. Desde este momento `vendedor_habilitado()` exige `activo`.
   - **No volver a correr la 002 PASO 1 después de esto.** Si se corre por error, volver a correr la 004.
6. **Publicar el build nuevo** (`npx react-scripts build` y deploy) y pedir que **todos recarguen la PWA**. A partir de esta versión, el login con PIN necesita conexión también para leer la fila del servidor (fail-closed).
7. **Pruebas en staging o producción con cuidado:**
   - un cierre de comisiones grande y una anulación en paralelo desde otro dispositivo (lock global; revisar el `statement_timeout` de `anon`);
   - degradar o quitarle el PIN al único admin con PIN: tiene que dar "No se puede quitar el último admin activo con PIN.";
   - editar a un vendedor dado de baja: tiene que dar "Ese vendedor está dado de baja.";
   - dar de baja a un vendedor y probar su login desde otro dispositivo sin sincronizar;
   - importar un CSV guardado como "CSV (delimitado por comas)" desde Excel es-AR (con `;`, coma decimal y ANSI) y un .xlsx con "Fecha de alta" como fecha.
8. **Cuando todos los dispositivos tengan la versión nueva:** 002 **PASO 2** (ocultar `pin`/`pin_hash` a anon) y después **PASO 3** (revoke delete). Después, **rotar los PIN** de todos los que tuvieron PIN en texto plano.
9. **Dependencia XLSX (S-DEP-01, sigue Alto/Medio):** instalar xlsx 0.20.3 desde cdn.sheetjs.com (`npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`) y mover `react-scripts` a `devDependencies`. Mientras tanto, importar solo planillas de origen confiable.
10. **CSP (S-HDR-01):** al pasar de `Content-Security-Policy-Report-Only` a `Content-Security-Policy` en `public/_headers`, agregar `worker-src 'self'`. Sin eso, **la importación de .xlsx falla** (ver S4).
11. **Pendientes de fondo (no son de esta corrida):** S-01/S-BUL-01/S-COM-06 (Supabase Auth con claim `permiso`, 002 PASO 4-5), S-COM-14 (PIN de admin de 6 o más dígitos), S-COM-19/S-VEN-01 (decidir si se quita la auto-alta de vendedores, más `revoke insert` y un índice único por nombre).
