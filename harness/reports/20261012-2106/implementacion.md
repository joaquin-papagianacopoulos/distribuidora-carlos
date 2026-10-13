# Implementación — RUN 20261012-2106

Plan: `harness/reports/20261012-2106/plan.md` (C1..C9, T-01..T-26) + cambio extra del dueño (AC-PLA-2 / AC-PLA-4: sin Comisión en la plantilla de clientes).
Supuesto confirmado por el orquestador: la 003 y la 004 **no** se aplicaron en Supabase, así que se editaron en el lugar. Está documentado en la cabecera de cada SQL.

## Resultados (números reales)

| Comando | Resultado |
|---|---|
| `CI=true npx react-scripts test --watchAll=false` | 58 suites OK; 1157 passed, 1 skipped, 2 todo (1160 en total) |
| `npx react-scripts build` | Compiled successfully, sin warnings |
| `node harness/gates/run-gates.mjs --fast --out harness/reports/20261012-2106/gates.json` | Todo PASS: unit-tests; coverage-domain 100 % de líneas; traceability 74/74; secret-scan; security-rules |

## Cambios por C-id

### Extra del dueño: REQ-PLA sin Comisión (AC-PLA-2, AC-PLA-4)
- `src/domain/plantillas.js`:
  - `CAMPOS_EXCLUIDOS_PLANTILLA = { productos: [], clientes: ['comision'] }`. `COLUMNAS_PLANTILLA.clientes` queda con 16 columnas, mismo orden y etiquetas que el formulario, sin Comisión. Se sacó `comision` de las instrucciones.
  - `mapearEncabezados` devuelve `excluidas` (por ejemplo `["Comisión"]`). Esas columnas no se mapean y no cuentan como `ignoradas`.
  - `validarFilaCliente` nunca toma la comisión del archivo. En un alta queda `null`. En una actualización la clave se saca de `valor`, así `{...existente, ...valor}` conserva la comisión de la ficha. Una comisión legacy inválida en la ficha no frena la importación.
  - `planificarImportacion` devuelve `excluidas`. `resumirEntradas(entradas, { excluidas })` llena `resumen.columnasExcluidas`.
  - Nuevas `avisoColumnasExcluidas()` y `textoResumen` con el aviso "La columna "Comisión" se ignoró: la comisión se carga solo desde la ficha del cliente."
- `src/pages/Configuracion.js`: `importarClientes` pasa `plan.excluidas` al resumen. `ResultadoImport` muestra el aviso (`data-testid="resultado-clientes-excluidas"`).
- El formulario `ClienteForm` sigue teniendo los 17 campos (AC-CLI-1, sin cambios).

### C1 — Mojibake (regla dura 7)
- `Configuracion.js:167,170`, `Facturacion.js:262,265,519,538` ("invalido" pasa a "inválido") y `NuevoPedido.js:89`. Se corrigieron solo esos bytes, a UTF-8 sin BOM.

### C2 — UX de la anulación de cierres (AC-COM-12)
- `src/domain/comisiones.js`: `AYUDA_ANULACION` y `ayudaAnulacion(entrada) -> { habilitado, ayuda }`. Usa la misma normalización (`texto`) y los mismos `MIN_MOTIVO`/`MAX_MOTIVO` que `validarAnulacion`. Con null u objetos no lanza error.
- `src/pages/Comisiones.js` (`Historial`):
  - el botón usa `ayudaAnulacion` y su texto sigue siendo "Confirmar anulación";
  - mientras está deshabilitado se ve la ayuda `ayuda-anular-<id>`, enlazada con `aria-describedby`;
  - `onAnular` devuelve `{ ok, mensaje }`. El error del servidor aparece inline (`error-anular-<id>`, `role="alert"`) y el formulario queda abierto. Se borra al editar el motivo o el PIN, o con "Volver";
  - el mensaje global de arriba se mantiene.

### C3 — S-BUL-06: tope `MAX_CANTIDAD` (AC-BUL-6/7, AC-STK-8, AC-SEC-2)
- `src/domain/bultos.js`: `cantidadTipeada`, `sumarCantidades`, `validarCantidadesItems(items, { previos })` y `mensajeCantidadesInvalidas`. `"1.000"` se lee como 1000; `"2,5"` y `"1000001"` dan `null`.
- `NuevoPedido.js`:
  - change y blur usan `cantidadTipeada`. Un texto inválido no vacío vuelve a la última cantidad válida; vacío o 0 vuelve a 1, como antes;
  - `validarCantidadesItems` corre antes de cualquier efecto (también antes de dar de alta el cliente).
- `Facturacion.js`:
  - `handleCantidadBlur`, `draftCantidad` y `guardarEdicion` usan `cantidadTipeada`;
  - antes de guardar corre `validarCantidadesItems(itemsFinal, { previos: pedidoEditando.items })`. Si falla aparece el `alert` y no se guarda nada.
- `Armado.js`:
  - `setCantidadArmadoTexto` usa `cantidadTipeada`;
  - la fusión de `tocarTick` no fusiona si la suma supera el tope;
  - `guardarArmado` suma con `sumarCantidades`. Si da `null`, muestra el `alert` y no guarda.

### C4 — S-BUL-08: bulto solo por id (AC-BUL-1, 4)
- `bultos.js`: `productoParaBulto(item, productosById)`. Resuelve solo por id con un `Map`; nunca por nombre.
- `Facturacion.js`:
  - `aplicarBulto` y la prop `producto` de `FacturacionItemRow` usan `productoParaBulto`;
  - `getProductoActual` (con el fallback por nombre) queda solo para "precio de lista".
- `Armado.js`: `aplicarBultoArmado` y la prop `producto` usan `productoParaBulto`.

### C5 — S-COM-18: la sesión sale de la fila del servidor (AC-SEC-4, AC-VEN-2/3)
- `src/domain/vendedores.js`:
  - `vendedorDeSesion(local, fila)`, `interpretarFilaIngreso`, `MSG_NO_CONFIRMADO`;
  - `decidirIngreso`: el caso solo-local devuelve `permiso: 2`.
- `src/services/vendedoresService.js`:
  - `leerFilaVendedor`, interna. Prueba las columnas en orden `REMOTO → SIN_ACTIVO → LEGACY`;
  - `persistirSesion`: hace `updateVendedor({...local, ...sesion})`, sin crear ni borrar registros;
  - `ingresarConPin`, nueva: `verificarPinIngreso`, después la fila por el mismo remoteId, después persiste. Es fail-closed;
  - `iniciarIngreso` siempre devuelve `vendedor` en `entrar`. En `consultar` lee la fila completa. Con la fila LEGACY (fail-open de S-COM-22(1)) la sesión igual sale del servidor; si no hay fila, da `no_existe`. Un solo-local entra con permiso 2;
  - `verificarPinIngreso` no cambia.
- `src/components/SelectorVendedor.js`:
  - `trySelect` usa `seleccionarVendedor(r.vendedor)`;
  - `confirmarPin` usa `ingresarConPin`;
  - los imports de `syncService` quedaron unificados.
- `useAppContext.js` no se tocó.

### C5b — AC-VEN-4 en el cliente: admin activo **con PIN**
- `vendedores.js`:
  - `puedeDarDeBaja` cuenta solo a los admins activos con `tienePin`. Mensaje: "No se puede dar de baja al último admin activo con PIN.";
  - `chequeoUltimoAdmin({ previo, datos, vendedores })`, nueva;
  - `MENSAJES_GUARDAR` e `interpretarGuardarVendedor` mapean `admin_sin_pin`, `ultimo_admin`, `vendedor_inexistente` y `vendedor_inactivo`. `data === null` sigue siendo `no_autorizado`;
  - el `ultimo_admin` de la baja usa el texto nuevo.
- `vendedoresService.guardarVendedorAdmin`: recibe `vendedores` (si no viene, usa `getVendedores()`) y corre `chequeoUltimoAdmin` antes de la RPC cuando hay `previo`.
- `Configuracion.js`: le pasa `vendedores`.

### C6 — SQL 004 (todavía no aplicada)
- La cabecera documenta: "Modificada en RUN 20261012-2106 antes de aplicarse"; que la 004 redefine `admin_guardar_vendedor` de la 002; y que si se vuelve a correr la 002 PASO 1 hay que volver a correr la 004.
- `admin_baja_vendedor`: el conteo de otros admins ahora es `permiso = 1 and activo and pin_hash is not null`.
- Nueva sección 4: `create or replace function public.admin_guardar_vendedor(...)`. Tiene la misma firma y los mismos defaults que la 002, con `search_path = public, extensions, pg_temp`. Orden de los pasos:
  - a) autoriza: `verificar_pin` siempre y `return null` sin raise si el admin no es `permiso 1`, `activo` y con `pin_hash`;
  - b) valida los datos (también el formato del PIN);
  - c) toma `pg_advisory_xact_lock(hashtext('vendedores_baja'))`;
  - d) si el vendedor no existe, `vendedor_inexistente`; si está inactivo, `vendedor_inactivo`;
  - e) `admin_sin_pin`;
  - f) `ultimo_admin`;
  - g) insert/update como la 002; si el update no devuelve id, `vendedor_inexistente`;
  - al final, `revoke public` + `grant`. Todo va dentro del mismo `begin/commit`, después del chequeo del PASO 1 y de la columna `activo`.
- `002_seguridad_recomendada.sql`: solo un comentario arriba de `admin_guardar_vendedor` ("La 004 la redefine (S-COM-20 + activo)…"). El cuerpo no se tocó.

### C7 — SQL 003 (todavía no aplicada), S-COM-21
- La cabecera documenta el cambio.
- `cerrar_comisiones`: un único `perform pg_advisory_xact_lock(hashtext('comisiones_global'))`, después de `verificar_pin`/`no_autorizado` y antes de la idempotencia. Se borraron el lock `comisiones_cierre:` y el loop de `comisiones_pedido:`. El resto de las validaciones queda igual, ahora bajo el lock global.
- `anular_cierre_comisiones`: el mismo lock global, después de autorizar y antes del `select ... for update`. Se borró el loop. `tiene_ajustes_vigentes` sigue antes del `update`.
- Un comentario explica el orden (global primero, fila después: no hay deadlock) y por qué alcanza con serializar.
- Se quitaron las declaraciones `v_pid` que quedaron sin uso.

### C8 — Tests faltantes de REQ-VEN y REQ-PLA
- No hizo falta tocar código de producción.
- T-24 ya existía (`plantillas.page.test.js`, `it.each` de permisos 2 y 3). Se endureció con el texto exacto.

### C9 — AC-PLA-3 / AC-PROD-3: stock inicial en una importación parcial
- `plantillas.js`:
  - `resumirEntradas` acepta `stockFallido: true` en una entrada `crear`: cuenta como creado y se lista en `resumen.stockFallido` como `{ fila, motivo }`;
  - `textoResumen` agrega "N producto(s) creados SIN stock inicial: cargalo desde Stock (Ajuste).";
  - sin el flag, los conteos y los rechazos son idénticos a los de antes.
- `Configuracion.js` `importarProductos`:
  - `addProductoLocal` va en su propio try y `ajustarStock` en otro;
  - si falla el stock, la entrada se marca `stockFallido` (no "rechazada") y el resumen la lista (`resultado-productos-stock-fallido`);
  - nunca se escribe un número de stock.

## Tests (ID del plan → archivo)

| ID | Archivo | Nuevo/MOD |
|---|---|---|
| T-01 | `src/domain/__tests__/encoding.regla7.test.js` (incluye además `supabase/migrations/*.sql`) | nuevo |
| T-02 | `src/pages/__tests__/ConfiguracionAltas.test.js` (texto exacto y h1) | MOD (más estricto) |
| T-03 | `src/pages/__tests__/bultos.facturacion.test.js` ("Facturación" / "No tenés permisos para facturar") | nuevo caso |
| T-04 | `src/domain/__tests__/comisiones.anulacion.ux.test.js` | nuevo |
| T-05 | `src/pages/__tests__/comisiones.page.test.js` (6 casos de UX de anulación) | nuevos casos |
| T-06 | `src/domain/__tests__/security.bultos.test.js` (`cantidadTipeada`, `sumarCantidades`, `validarCantidadesItems`, mensaje) | nuevos casos |
| T-07 | `src/pages/__tests__/bultos.armado.test.js` (tipear, fusión por encima del tope, fusión normal, homónimo) | nuevos casos |
| T-08 | `bultos.facturacion.test.js` (tipeo > tope, blur, "+" por encima del tope, legacy decimal sin cambios) | nuevos casos |
| T-09 | `src/pages/__tests__/bultos.pedido.test.js` (tipeo > tope + blur, válidos, guardar bloqueado) | nuevos casos |
| T-10 | `src/domain/__tests__/bultos.test.js` (`productoParaBulto`) | nuevos casos |
| T-11 | `bultos.facturacion.test.js` (homónimo sin botón y con precio de lista) | nuevo caso |
| T-12 | `src/domain/__tests__/vendedores.test.js` (`vendedorDeSesion`, solo-local con permiso 2, `interpretarFilaIngreso`) | nuevos casos |
| T-13 | `src/services/__tests__/vendedoresService.test.js` (`ingresarConPin` e `iniciarIngreso`: 10 casos) | nuevos casos |
| T-14 | `src/components/__tests__/SelectorVendedor.test.js` (ataque A, ataque B, fail-closed, solo-local, inactivo) | nuevos casos |
| T-15 | `src/hooks/__tests__/useAppContext.test.js` (login real con `ingresarConPin` y después `recargar`: sigue con permiso 2) | nuevo caso |
| T-16 | `src/domain/__tests__/vendedores.baja.test.js` (admin sin PIN, `chequeoUltimoAdmin`, motivos nuevos) | nuevos casos. Los fixtures ya tenían `tienePin`: no se tocaron |
| T-17 | `vendedoresService.test.js` (`guardarVendedorAdmin` no llama a la RPC; con otro admin con PIN sí; `vendedor_inactivo`) | nuevos casos |
| T-18/T-19 | `src/domain/__tests__/migracion004.test.js` (6 casos estáticos) | nuevos casos |
| T-20 | `src/domain/__tests__/security.comisiones.iter2.test.js` (los 2 tests de S-COM-15, pasados al lock global, más "un solo lock") | MOD |
| T-21 | `src/domain/__tests__/security.comisiones.auditoria.test.js` (S-COM-09 con la clave nueva) | MOD |
| T-22 | `comisiones.page.test.js` (selector "Vendedor asignado": no aparecen los dados de baja y se conserva al ya asignado) | nuevos casos |
| T-23 | `src/pages/__tests__/listaPedidos.vendedores.test.js` | nuevo |
| T-24 | `src/pages/__tests__/plantillas.page.test.js` (ya existía; ahora con texto exacto y sin input de clientes) | MOD (más estricto) |
| T-25 | `src/domain/__tests__/plantillas.test.js` (`stockFallido`; sin el flag, el resultado es el mismo) | nuevos casos |
| T-26 | `plantillas.page.test.js` (falla `ajustarStock` → "creado SIN stock inicial") | nuevo caso |
| PLA extra | `plantillas.test.js`, `plantillaExcel.test.js`, `plantillas.page.test.js` (ver abajo) | nuevos y MOD |

### Tests MOD y por qué (ninguno se relajó salvo lo que cambió el dueño)
- **Comisión fuera de la plantilla (dueño, AC-PLA-2/4).**
  - `plantillas.test.js`: "17 campos" pasa a 16, y `LABELS_C` excluye `comision`.
  - "fila válida": `comision 5` pasa a `null`.
  - "obligatorios…": ahora verifica que **no** aparezca el error de comisión.
  - "actualizar": la comisión 3 se conserva vía el merge.
  - `plantillaExcel.test.js`: "17 encabezados" pasa a 16, sin Comisión ni en las instrucciones; el round-trip da `comision: null`.
  - `plantillas.page.test.js`: el CSV con Comisión ahora crea con `comision: null`; la fila 7 (150) se crea; el resumen pasa a 2/1/3 y muestra el aviso. El XLSX de la plantilla usa 16 columnas.
- **C5 cambió el contrato del login** (la garantía se mantiene o se endurece):
  - `vendedoresService.test.js`: el select de `consultar` ahora es `COLUMNAS_VENDEDOR_REMOTO` (sigue incluyendo `activo` y nunca `pin`). El caso sin la 002 ahora entrega la fila LEGACY del servidor;
  - `SelectorVendedor.test.js`: después del PIN se da la fila del servidor, y `seleccionarVendedor` se verifica con los datos del servidor (antes: el registro local);
  - `security.comisiones.iter2.test.js:96`: el selector usa `ingresarConPin`, y se verifica que este llame a `verificarPinIngreso` antes de leer la fila.
- **C6.** `migracion004.test.js` (AC-VEN-4): la regex del conteo exige además `pin_hash is not null`.
- **C7.** T-20 y T-21 conservan las aserciones de orden y agregan "un solo `pg_advisory_xact_lock`" y "no quedan locks por pedido ni por id".

## SQL tocado
- `supabase/migrations/003_comisiones.sql`: C7. Cabecera "Modificada en RUN 20261012-2106 antes de aplicarse (S-COM-21)".
- `supabase/migrations/004_baja_vendedores.sql`: C6. Cabecera "Modificada en RUN 20261012-2106 antes de aplicarse (S-COM-20 / AC-VEN-2 / AC-VEN-4)".
- `supabase/migrations/002_seguridad_recomendada.sql`: solo un comentario. El cuerpo no cambió.
- No hay tablas, columnas, stores ni IDs nuevos. `DB_VERSION` sigue en 6. Ningún `delete`.

## Pasos manuales
1. **Antes de aplicar**, confirmar con el dueño que la 003 y la 004 no se corrieron nunca en Supabase. Si alguna ya se corrió, no re-correr la versión editada sobre datos reales sin revisarla: armar una `005_consolidacion.sql` con los mismos `create or replace` (supuesto 1 del plan).
2. Orden en el SQL Editor (con backup): 002 PASO 1, después 003, después 004. Si en algún momento se vuelve a correr la 002 PASO 1, hay que volver a correr la 004 (restaura `admin_guardar_vendedor`).
3. En staging: probar un cierre de comisiones con miles de pedidos y una anulación en paralelo desde otro dispositivo (R8, lock global).
4. Probar desde la app, con la 004 aplicada:
   - degradar o quitarle el PIN al único admin con PIN: tiene que dar "No se puede quitar el último admin activo con PIN.";
   - editar un vendedor dado de baja: tiene que dar "Ese vendedor está dado de baja.".
5. Publicar el build y que todos recarguen la PWA. Un login con PIN ahora requiere conexión también para leer la fila después de verificar (fail-closed).

## Observaciones / desvíos
- **Finales de línea.** El repo es mixto (mayormente LF). El chequeo inicial con `grep $'\r$'` de Git Bash no era confiable (ignora el CR), y `sed -i` de Git Bash convierte CRLF a LF. `Armado.js` (CRLF según el orquestador y según el reporte 20261007-2004) pasó por `sed -i` y se **restauró a CRLF**; su diff contra HEAD es solo de contenido.
  - `Configuracion.js`, `Facturacion.js`, `NuevoPedido.js`, `plantillas.js`, `bultos.armado.test.js` y `migracion004.test.js` también pasaron por `sed -i` y quedaron en LF. Se asumió que ya eran LF: ningún reporte previo los marca como CRLF, y sus vecinos creados por agentes son LF. No se puede verificar contra git porque el repo guarda LF y `core.autocrlf=true`. Si alguno era CRLF, convertirlo es un cambio solo de espacios en blanco.
  - Los archivos que se editaron solo con herramientas que conservan los finales conservan los suyos: `SelectorVendedor.js`, `vendedores.js` y `vendedoresService.js` (y sus tests) en CRLF; `Comisiones.js`, `comisiones.js` y `bultos.js` en LF.
  - Los tests nuevos van en LF, como sus vecinos.
- En Facturación y en Armado el texto tipeado ya se limpiaba de no-dígitos antes de C3 (por ejemplo, "2,5" quedaba "25"). Se conservó; `cantidadTipeada` se aplica sobre ese texto. En Nuevo Pedido se aplica sobre el texto crudo, así que ahí "2,5" se rechaza.
- `sumarCantidades` solo acepta enteros. Dos filas duplicadas en Armado con una cantidad legacy decimal ahora no se fusionan al guardar: se muestra el aviso y no se guarda. Es un caso muy raro y queda documentado (R10).
- `iniciarIngreso` en modo LEGACY (sin la 002 PASO 1) ahora exige que la fila exista en el servidor. Antes entraba con el registro local.
- El residual S-BUL-01 (editar IndexedDB o localStorage **después** del login) sigue abierto: es una decisión del dueño (Auth).


---

# Iteración 2 (RUN 20261012-2106)

Entradas:
- `qa-report.md`: 8 tests rojos marcados `// BUG:`.
- `security-report.md`.
- `gates.json`: unit-tests en FAIL.
- El AC-PLA-3b nuevo de `harness/SPEC.md` (decisión del dueño, 2026-10-13).

La sesión se cortó y se retomó. Antes de seguir revisé cada archivo tocado: no había ediciones a medio aplicar y los finales de línea estaban bien.

## A. Bugs de QA: los 8 tests rojos pasan

| Bug | Arreglo |
|---|---|
| BUG-PLA-02 | En `src/domain/importacion.js`, `detectarDelimitador` toma el delimitador que más aparece en el encabezado, fuera de comillas (si empatan: `;`, después `,`, después tab). `partirLineaCSV` corta solo con ese delimitador y respeta las comillas (`""` es una comilla literal). En un CSV, `planificarImportacion(..., { celdasDeMas: true })` rechaza la fila que tiene celdas no vacías más allá del encabezado. Motivo que se muestra: "La fila tiene N columnas y el encabezado M: revisá que no haya comas o punto y coma sin comillas". |
| BUG-PLA-03 | El CSV se lee con `arrayBuffer()`. `decodificarTexto` intenta UTF-8 estricto (`TextDecoder` con `fatal: true`, o un decodificador propio igual de estricto si no hay `TextDecoder`). Si falla, usa Windows-1252 con una tabla propia para 0x80-0x9F. Se quita el BOM. Si el archivo solo tiene `text()`, se usa eso, sin BOM. |
| BUG-PLA-01 | En el XLSX, una celda con formato de fecha sale como `YYYY-MM-DD` (con `SSF.parse_date_code`, sin zona horaria). En el dominio, `normalizarFecha` y `fechaDesdeCelda` aceptan: `Date`, número de serie de Excel (20000-80000), ISO, D/M/AAAA y año de 2 dígitos. Para el año de 2 dígitos, ver la nota de abajo. |
| BUG-PLA-04 | La ayuda dice "los {COLUMNAS_PLANTILLA.clientes.length} campos…; la comisión se carga desde la ficha del cliente". |
| BUG-COM-01 | `Comisiones.anular` ahora tiene `catch`. Devuelve `{ ok:false, mensaje }`, que se muestra como error inline, y también pone el mensaje general. |
| BUG-BUL-01 | La regla de miles pasa a `/^[1-9]\d{0,2}(\.\d{3})+$/`. |
| BUG-ENC-01 | Un solo detector, en `src/testUtils/mojibake.js` (escrito solo con escapes `\u`). Lo importan `encoding.regla7.test.js` y `qa.encoding.test.js`; antes cada uno tenía su propia regex. Los dos saltean los archivos que tienen los patrones como fixtures (`ARCHIVOS_CON_FIXTURES`). La regla 7 suma casos de Ñ/É/Ó/Ú rotas. |

**Fechas con año de 2 dígitos (BUG-PLA-01).** Si el día o el mes son mayores que 12, no hay ambigüedad. Si no, decide la opción `corta`:
- `'mdy'` (por defecto): es lo que entrega xlsx con `raw:false` (`10/1/26`) y lo que pide el test de QA.
- `'dmy'`: es lo que tipea una persona en un CSV (`1/10/26`). Configuración la pasa solo en CSV.

**Desvío: fixture de QA.** Tal como estaba escrito, el test "CSV guardado como ANSI/Windows-1252" no podía pasar:
- su fixture `csvBytes` solo tenía `text()`, que llama a `TextDecoder`;
- en jsdom `TextDecoder` no existe, así que lanzaba ReferenceError;
- aunque existiera, la decodificación UTF-8 con pérdida ya habría borrado la ñ.

Agregué al fixture `arrayBuffer()`, que un Blob real del navegador tiene. La aserción no cambió. Es el único cambio a un test de QA, además de los de BUG-ENC-01.

**MOD a un test previo.** En `stockService.test.js`, el caso "AC-STK-2 cantidades decimales" esperaba que una cantidad de 1.5 descontara -1.5. Eso contradice S-BUL-09, que se pidió explícitamente: el servidor rechaza ese movimiento y queda pendiente para siempre. Ahora espera que el renglón se omita y se avise con `console.warn`. Quedó marcado como `MOD` en el test.

## AC-PLA-3b (decisión del dueño)

- **Campos:** en `src/domain/plantillas.js`, `CAMPOS_OPCIONALES_PRODUCTO` = Descuento 1, Descuento 2, % Ganancia, Precio venta 2 y Mínimo venta.
- **Vacío:** `celdaSinDato` toma como vacía la celda vacía, solo espacios, `-`, `–` o `—`.
- **Producto nuevo:** esos campos quedan en 0 y Mínimo venta en 1.
- **Producto existente:** conserva sus valores. Un `-` en un descuento no cuenta como cambio de costo, así que el precio no se recalcula.
- **Valores especiales:** `10%` se lee como 10 (ya pasaba con los porcentajes). Mínimo venta 0 (o `0,0`) se toma como 1.
- **Hoja Instrucciones:** dice "No (vacío = 0)" o "No (vacío = 1)".
- **Formulario manual:** `validarProducto` **no se tocó**. Sigue rechazando `-` y mínimo 0. En la importación, un valor realmente inválido (descuento 150, mínimo -3) sigue rechazando la fila.
- **Tests:** `src/domain/__tests__/plantillas.opcionales.test.js`, con un round-trip sobre un `.xlsx` real leído por `filasDesdeLibro`.

## B. Seguridad corregible en código

### S-DEP-01 (mitigación)
- **Worker:** el parser XLSX corre en un Web Worker (`src/services/leerPlanilla.worker.js`), creado por `workerXlsx.js` con `new URL(..., import.meta.url)`. Tiene un timeout de 20 s (`TIMEOUT_LECTURA_MS`), se termina siempre y devuelve solo strings.
- **Fallback:** si no hay Worker (jsdom) o crearlo falla (por ejemplo, por la CSP), se usa el mismo `filasDesdeLibro` en el hilo principal. Ese es el fallback testeable. `workerXlsx.js` solo se importa si existe `Worker`, así que jest nunca tiene que parsear `import.meta`.
- **Opciones de lectura acotadas:** `dense`, `sheets: 0` (solo la primera hoja) y `sheetRows`. Sin fórmulas, estilos, HTML, VBA, archivos internos ni WTF.
- **Formato:** se verifican los magic bytes `PK\x03\x04`. `.xls` salió de `accept` y de los formatos aceptados (`MSG_XLS`).
- **Build:** el worker sale como chunk aparte (verificado).
- **Tests:** `lectorPlanillas.test.js`, con un worker falso que cubre OK, timeout, error, respuesta tardía, `onerror`, fallback y bloqueo por CSP. También `importacion.test.js`.

### S-PLA-01
- **Topes:** `MAX_FILAS_IMPORT = 5000`, `MAX_COLUMNAS_IMPORT = 60` y `MAX_LARGO_CELDA = 1000`.
- **En `planificarImportacion`:** si el archivo entero pasa un tope, se rechaza con un mensaje claro. Una celda demasiado larga rechaza solo su fila.
- **En el lector CSV:** corta antes de parsear.
- **En el XLSX:** `sheetRows` más `!fullref` detectan el exceso y se pide "partilo en varios archivos". El rango de columnas se recorta.
- **Resumen:** lista los primeros 200 rechazos y agrega "... y N más".
- **Tests:** en `security.plantillas.test.js` el todo pasó a test. También `importacion.test.js` y `lectorPlanillas.test.js`.

### S-PLA-03
- `resolverVendedor` rechaza un nombre que coincide con 2 o más vendedores **activos**.
- Un homónimo dado de baja no cuenta, así que se mantiene el test de QA "se usa el activo".
- **Tests:** en `security.plantillas.test.js` el todo pasó a test.

### S-VEN-01
- **Regla:** `validarNombreNuevoVendedor` (dominio) compara el nombre normalizado (sin tildes, sin mayúsculas, espacios colapsados) contra todos los vendedores, activos o dados de baja.
- **Dónde se aplica:** en `SelectorVendedor.handleAgregar`, con mensaje inline, y en `guardarVendedorAdmin`, tanto en el alta como al renombrar. Editar a un vendedor sin cambiarle el nombre pasa.
- **Lo que no cambia:** la auto-alta en sí (S-COM-19 no se tocó). La importación no crea vendedores; con S-PLA-03 rechaza los homónimos activos.
- **Tests:**
  - en `security.vendedores.run2106.test.js` el todo pasó a test;
  - `security.iter2.run2106.test.js`;
  - `vendedoresService.iter2.test.js`;
  - `SelectorVendedor.test.js`.

### S-VEN-03
- **En la 004:** trigger `vendedor_zz_inactivo_sin_pin`.
  - Hace `raise 'vendedor_inactivo'` si queda `activo=false` con `pin_hash` o `pin`.
  - Corre después de `vendedor_hashear_pin`, por orden alfabético.
  - La 002 no lo toca.
- **En la 003 (decisión):** chequeo dinámico con `public.vendedor_habilitado(text)`, definido en la misma 003. Lo elegí en vez de redefinir las dos RPC enteras en la 004.
  - Mientras la columna `activo` no exista (la 003 se aplica antes que la 004), devuelve true: es el comportamiento anterior.
  - Apenas se aplica la 004 empieza a regir, sin volver a correr la 003.
  - Las RPC filtran con `... and ve.permiso = 1 and public.vendedor_habilitado(ve.id::text)`.
  - La función no tiene `execute` para anon/authenticated.
- **Idempotencia:** todo es `create or replace` y `drop trigger if exists`. La 004 sigue abortando si falta la 002 PASO 1.
- **Tests:** `security.iter2.run2106.test.js`. Siguen pasando los regex de `migracion003/004` y de `security.comisiones.*`.

### S-BUL-09
- `revisarMovimientosPedido` devuelve `{ movimientos, invalidos }`. Un delta no entero, o con `|delta| > MAX_CANTIDAD`, no se emite y se reporta.
- `movimientosParaPedido` conserva el contrato: sigue devolviendo un array.
- `aplicarStockPedido` hace `console.warn` y el sync no se traba.
- `previsualizarStockPedido` devuelve `avisoInvalidos`, y Facturación lo muestra con un `alert` antes de facturar.
- **Tests:** `security.iter2.run2106.test.js` y `stockService.test.js` (el MOD de arriba).

### S-BUL-01 (mitigación parcial)
- **Dominio y servicio:** `decidirRevalidacion` (dominio) y `revalidarSesion` (servicio). Con red, leen la fila del servidor con `leerFilaVendedor`, que usa el mismo fallback de columnas.
- **Qué hace según el resultado:**
  - si la fila difiere: la persiste en el registro local, recarga y aplica la del servidor;
  - si no existe o está dada de baja: cierra la sesión;
  - si la lectura falla: mantiene la sesión (offline-first);
  - si falta la columna `tiene_pin`: conserva el candado local.
- **Cuándo corre:** `useAppContext` lo llama al restaurar la sesión, en segundo plano y sin frenar el arranque, y después de cada `downloadMaestros` (el pull de vendedores).
- **Offline:** el servicio se importa de forma dinámica, así que sin red ni se carga y nada cambia.
- **Tests:** `security.iter2.run2106.test.js`, `vendedoresService.iter2.test.js` y `useAppContext.revalidacion.test.js`.

### S-VEN-02
Solo documentado, en la cabecera de la 004 y abajo. El `test.todo` de S-VEN-02 sigue como todo.

**Consulta de control antes de aplicar la 004.** Si devuelve filas, hay que ponerles PIN con `admin_guardar_vendedor` o degradarlas antes de correr la 004:

```sql
select id, nombre from public.vendedores where permiso = 1 and pin_hash is null;
```

No se tocaron S-01, S-COM-19, S-COM-03 ni Auth.

## Archivos

**Nuevos:**
- `src/domain/importacion.js`
- `src/services/lectorPlanillas.js`
- `src/services/planillaXlsx.js`
- `src/services/leerPlanilla.worker.js`
- `src/services/workerXlsx.js`
- `src/testUtils/mojibake.js`

**Tests nuevos:**
- `src/domain/__tests__/importacion.test.js`
- `src/domain/__tests__/plantillas.opcionales.test.js`
- `src/domain/__tests__/security.iter2.run2106.test.js`
- `src/services/__tests__/lectorPlanillas.test.js`
- `src/services/__tests__/vendedoresService.iter2.test.js`
- `src/hooks/__tests__/useAppContext.revalidacion.test.js`

**Modificados:**
- `src/domain/plantillas.js`
- `src/domain/vendedores.js`
- `src/domain/stock.js`
- `src/domain/bultos.js`
- `src/pages/Configuracion.js`
- `src/pages/Comisiones.js`
- `src/pages/Facturacion.js`
- `src/components/SelectorVendedor.js`
- `src/services/vendedoresService.js`
- `src/services/stockService.js`
- `src/hooks/useAppContext.js`
- `supabase/migrations/003_comisiones.sql`
- `supabase/migrations/004_baja_vendedores.sql`

**Tests modificados:**
- `encoding.regla7.test.js` y `qa.encoding.test.js` (BUG-ENC-01)
- `qa.plantillas.import.page.test.js` (solo el fixture `csvBytes`)
- `security.plantillas.test.js` y `security.vendedores.run2106.test.js` (todo → test)
- `SelectorVendedor.test.js` (caso S-VEN-01)
- `stockService.test.js` (MOD por S-BUL-09)

**Finales de línea:**
- Los verifiqué con Node (buscando `\r\n`). `grep $'\r'` da falsos positivos en este Git Bash.
- Siguen en CRLF: `SelectorVendedor.js`, `vendedores.js`, `vendedoresService.js` y `SelectorVendedor.test.js`. Solo se editaron con Edit.
- Siguen en LF: `plantillas.js`, `Configuracion.js`, `Comisiones.js`, `bultos.js`, `stock.js`, `stockService.js`, `useAppContext.js`, `Facturacion.js` y los SQL.
- `plantillas.js` quedó un momento en CRLF por un script y lo volví a LF, que es como estaba.
- Los archivos nuevos van en LF. No se usó `sed -i`.

Sin cambios de schema IndexedDB (`DB_VERSION` igual), sin tablas nuevas y sin `delete`.

## Números reales
- `CI=true npx react-scripts test --watchAll=false`: **73 suites OK; 1512 passed, 1 skipped, 3 todo, 0 failed (1516 total)**. Antes: 8 failed, 1400 passed, 6 todo.
- `CI=true npx react-scripts build`: OK. El worker sale como chunk aparte.
- `node harness/gates/run-gates.mjs --fast`: **PASS** en unit-tests, coverage-domain, traceability, secret-scan y security-rules.

## Pasos manuales nuevos
1. Antes de la 004, correr la consulta de control de S-VEN-02.
2. Aplicar en orden: 002 PASO 1 → 003 → 004. `vendedor_habilitado` empieza a exigir `activo` apenas existe la columna.
3. CSP (S-HDR-01): cuando se pase de Report-Only a enforce, incluir `worker-src 'self'` (y `blob:` si hiciera falta). Si la CSP bloquea el worker, la lectura cae al hilo principal: funciona, pero sin aislamiento.
4. S-DEP-01 sigue abierto como Medio. El arreglo real es pasar a `xlsx` ≥ 0.20.3 desde cdn.sheetjs.com.
