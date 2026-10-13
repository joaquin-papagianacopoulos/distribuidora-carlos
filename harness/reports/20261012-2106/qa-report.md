# QA — RUN 20261012-2106

Alcance: todo el SPEC, con foco en lo cambiado en la corrida (C1..C9), REQ-VEN (AC-VEN-1..6) y REQ-PLA (AC-PLA-1..7, con Comisión fuera de la plantilla de clientes). No se tocó código de producción. Los bugs quedan como tests rojos con comentario `// BUG:`.

## Números reales

| Comando | Resultado |
|---|---|
| Línea base antes de mis tests: `CI=true npx react-scripts test --watchAll=false` | 58 suites OK; 1157 passed, 1 skipped, 2 todo |
| Final: `CI=true npx react-scripts test --watchAll=false --coverage` | 67 suites: 62 pasan y 5 fallan. 1415 tests: **1400 passed, 8 failed, 1 skipped, 6 todo** |
| Los 8 que fallan | Son los 8 tests `BUG` que dejé a propósito (abajo). Ningún test preexistente falla. |
| `node harness/gates/run-gates.mjs --only traceability,coverage-domain,secret-scan,security-rules` | Todos PASS. (`unit-tests` fallaría hasta arreglar los 8 bugs.) |
| Cobertura `src/domain` | 99.43 % statements, 95.22 % branches, 100 % funciones, 100 % líneas. `plantillas.js` 100 % líneas, `vendedores.js` 100 %, `bultos.js` 100 %, `comisiones.js` 100 %. |
| Otros archivos tocados | `Configuracion.js` 86.9 % líneas, `Comisiones.js` 95.7 %, `vendedoresService.js` 100 %, `plantillaExcel.js` 100 %. |

Nota: en el medio aparecieron `security.plantillas.test.js` y `security.vendedores.run2106.test.js`, que no son míos (otro agente trabajando en paralelo). Los conté en los totales.

Tests nuevos míos (7 archivos):
- `src/domain/__tests__/qa.plantillas.bordes.test.js` (32 casos)
- `src/pages/__tests__/qa.plantillas.import.page.test.js` (19 casos)
- `src/services/__tests__/qa.vendedores.dispositivoDesactualizado.test.js` (12 casos)
- `src/domain/__tests__/qa.anulacion.consistencia.test.js`
- `src/pages/__tests__/qa.comisiones.anulacion.page.test.js` (6 casos)
- `src/domain/__tests__/qa.bultos.tope.test.js` (65 casos)
- `src/domain/__tests__/qa.encoding.test.js` (14 casos)

## Bugs encontrados (8 tests rojos)

Severidad: M = media, B = baja.

### BUG-PLA-02 (M, el más importante): CSV con `;` y coma decimal sin comillas corre las columnas, SIN aviso
- Test: `qa.plantillas.import.page.test.js` › "CSV con ';' y coma decimal sin comillas (1234,50)". Mismo origen: "una coma dentro del domicilio sin comillas".
- Causa: `parseCSVLine` (`src/pages/Configuracion.js:29`) corta en `,` **y** en `;` a la vez.
- Repro: subir en Configuración → Productos un CSV de Excel es-AR:
  ```
  Código;Descripción;Costo final;Precio venta 1;Bulto x
  D1;Decimal;1234,50;1500,75;12
  ```
  Resultado real: `costoFinal 1234`, `precio 50`, `bultoX 1500`. Se crea el producto con datos equivocados y el resumen dice "1 creado".
- Contradice la hoja Instrucciones ("acepta coma decimal: 1234,50"). En clientes, `Mitre 123, piso 2` sin comillas parte el domicilio y corre Ciudad.
- Arreglo sugerido: detectar el delimitador por archivo (el que más aparece en el encabezado fuera de comillas) y usar solo ese. Además hacer que una fila con más celdas que el encabezado se rechace.

### BUG-PLA-03 (M): CSV guardado como "ANSI" desde Excel no se importa
- Test: "CSV guardado como ANSI/Windows-1252 desde Excel". `leerFilas` usa `file.text()`, que siempre decodifica UTF-8.
- Repro: bajar la plantilla, abrirla en Excel, "Guardar como CSV (delimitado por comas)" en es-AR (Windows-1252) y subirla. `Descripción` llega como `Descripci(U+FFFD)n` y da "No se encontró columna de nombre". Si el encabezado fuera reconocible, las `ñ` y tildes quedarían rotas.
- Arreglo sugerido: leer con `arrayBuffer()`; intentar `TextDecoder('utf-8', {fatal:true})` y, si falla, `windows-1252`.

### BUG-PLA-01 (M): "Fecha de alta" como celda de fecha de Excel se rechaza
- Test: `qa.plantillas.bordes.test.js` › "Fecha de alta escrita como fecha de Excel".
- Repro: en el XLSX, escribir `1/10/2026` en Fecha de alta (Excel la guarda como tipo fecha). `sheet_to_json(..., {raw:false})` entrega `10/1/26` (formato m/d/aa, año de 2 dígitos) y `normalizarFecha` solo acepta año de 4 dígitos: la fila se rechaza con "Fecha de alta inválida".
- Sin el arreglo, hay que escribir la fecha como texto, y la hoja Instrucciones no lo dice.
- Arreglo sugerido: en `leerFilas` usar `cellDates: true` y `dateNF: 'yyyy-mm-dd'`, o convertir las celdas `t:'d'` a ISO antes de armar las filas.

### BUG-PLA-04 (B): texto desactualizado "los 17 campos"
- Test: "la ayuda de la tarjeta de clientes no dice '17 campos'". `Configuracion.js:582` sigue diciendo "los 17 campos del alta de clientes" y la plantilla tiene 16 (sin Comisión). Cambiar a "los 16 campos" y mencionar que la comisión se carga desde la ficha.

### BUG-COM-01 (B): si `anularCierre` lanza una excepción, el formulario de anulación no muestra nada
- Test: `qa.comisiones.anulacion.page.test.js` › "si el servicio lanza una excepcion…".
- `Comisiones.anular` hace `try/finally` sin `catch`. Si el servicio rechaza la promesa (por ejemplo un error de IndexedDB), no hay mensaje: el PIN ya se borró y el formulario queda como si nada. Arreglo: `catch` que devuelva `{ ok:false, mensaje }`.

### BUG-BUL-01 (B): `cantidadTipeada('0.500')` devuelve 500
- Test: `qa.bultos.tope.test.js` › "0.500 y 0.001 (decimales)". La regla de miles `/^\d{1,3}(\.\d{3})+$/` acepta un primer grupo `0` o con ceros: `0.500 → 500`, `0.001 → 1`, `00.100 → 100`. En Nuevo Pedido (texto crudo) quien tipea un decimal se lleva 500 unidades. Arreglo: exigir que el primer grupo no empiece con `0` (`/^[1-9]\d{0,2}(\.\d{3})+$/`).

### BUG-ENC-01 (B, del test, no de producción): el detector de `encoding.regla7.test.js` no ve mayúsculas acentuadas rotas
- Test: `qa.encoding.test.js` › "el detector de encoding.regla7.test.js también marca Ñ/É/Ó/Ú rotas".
- Su clase `[\u0080-¿]` no cubre lo que Windows-1252 hace con los bytes 0x80-0x9F (`‰`, `“`, `Š`, `‘`…). `Ñ`, `É`, `Ó` y `Ú` rotas pasan sin detectar. El detector completo que escribí recorre `src`, `supabase`, `public`, `SPEC.md` y `CLAUDE.md`: el repo hoy está limpio (UTF-8 válido, sin mojibake, sin BOM en .js). Arreglo: copiar la regex de `MOJIBAKE_COMPLETO` a `encoding.regla7.test.js`.

## Observaciones sin test rojo (decisión del dueño o de diseño)
- **Decimales con punto**: `toNum("1.234")` da 1.234 (decimal). Un usuario argentino que escriba `1.234` pensando en mil doscientos treinta y cuatro carga un precio 1000 veces menor. Solo afecta CSV/texto: las celdas XLSX numéricas llegan bien (probado).
- **Sesión restaurada sin PIN en un dispositivo desactualizado**: `useAppContext.init` restaura offline a un vendedor SIN PIN que ya fue dado de baja en el servidor, hasta el primer pull (el efecto de `estaActivo` lo cierra después). Es coherente con "offline-first". Los que tienen PIN siguen limitados a 12 h por `sesionValidada`.
- **Actualizar un cliente legacy**: la validación vuelve a correr sobre los datos viejos del cliente (`telefono` corto, `provincia` fuera de lista). Una fila que solo cambia el domicilio de un cliente así se rechaza. Es lo mismo que haría el formulario, pero conviene saberlo antes de importar a clientes viejos.
- La coma decimal dentro de comillas (`"1.234,50"`) sí funciona (probado).
- Un cierre anulado no sale con el botón de anulación dos veces: el botón queda deshabilitado mientras `procesando` (probado).

## Matriz AC → tests

Convención de archivos: D = `src/domain/__tests__`, P = `src/pages/__tests__`, S = `src/services/__tests__`, C = `src/components/__tests__`, H = `src/hooks/__tests__`. `*` = test nuevo mío.

### REQ-VEN (todos cubiertos)
| AC | Tests |
|---|---|
| AC-VEN-1 (RPC, requiere conexión, local solo con OK) | S `bajaVendedores.test.js` (RPC con ids en texto, sin conexión, red caída, PIN incorrecto); D `vendedores.baja.test.js` (args e interpretación); P `bajaVendedores.page.test.js`; D `migracion004.test.js` (firma, `security definer`, `search_path`); S* `qa.vendedores.dispositivoDesactualizado` (baja idempotente, segunda baja no llama al servidor) |
| AC-VEN-2 (`activo=false`, sin PIN, no borra) | S `bajaVendedores.test.js`; C `SelectorVendedor.test.js`; S `vendedoresService.test.js` (`ingresarConPin`, fila inactiva); S* `qa.vendedores.dispositivoDesactualizado` (8 escenarios de login de un dado de baja desde un dispositivo sin sincronizar) |
| AC-VEN-3 (oculto en ingreso, Configuración, selectores; el pull no lo resucita) | D `vendedores.baja.test.js`; S `bajaVendedores.test.js` (pull); P `bajaVendedores.page.test.js`; P `comisiones.page.test.js`; P `listaPedidos.vendedores.test.js`; C `SelectorVendedor.test.js`; D* `qa.plantillas.bordes` (columna Vendedor e Instrucciones); P* `qa.plantillas.import.page` |
| AC-VEN-4 (propio admin, último admin con PIN, cierra sesión) | D `vendedores.baja.test.js`; S `bajaVendedores.test.js`, `vendedoresService.test.js` (T-17); P `bajaVendedores.page.test.js`; H `useAppContext.test.js` (cierre de sesión); D `migracion004.test.js` |
| AC-VEN-5 (migración idempotente, tolerancia a 004 sin aplicar) | D `migracion004.test.js`; S `bajaVendedores.test.js` (pull sin `activo`); P `bajaVendedores.page.test.js` ("Falta la migración 004"); S* `qa.vendedores.dispositivoDesactualizado` (login sin la columna `activo`) |
| AC-VEN-6 (lógica pura) | D `vendedores.baja.test.js`, `vendedores.test.js` |

Revisión estática de `004_baja_vendedores.sql`: sin hallazgos. Idempotente, locks consistentes con `admin_guardar_vendedor`, el trigger impide resucitar con el anon key, sin `delete`.

### REQ-PLA (todos cubiertos; los bugs arriba)
| AC | Tests |
|---|---|
| AC-PLA-1 (botón y `plantilla_productos.xlsx`) | D `plantillas.test.js`; S `plantillaExcel.test.js`; P `plantillas.page.test.js` |
| AC-PLA-2 (16 columnas, sin Comisión) | D `plantillas.test.js` (16 columnas, ni columna ni instrucciones); S `plantillaExcel.test.js`; P `plantillas.page.test.js`; D* `qa.plantillas.bordes` (16 encabezados en MAYÚSCULAS/sin tildes); P* (BUG-PLA-04) |
| AC-PLA-3 (productos: columnas, validación, upsert, legacy) | D `plantillas.test.js`; P `plantillas.page.test.js`; D* `qa.plantillas.bordes` (celdas numéricas y con formato %, encabezados con tildes/NFD/NBSP/BOM, 1000 filas, legacy); P* (CSV con `;` y `,`, BOM, 1000 filas con 500 movimientos iniciales, legacy por pantalla) |
| AC-PLA-4 (clientes, Comisión ignorada) | D `plantillas.test.js`; P `plantillas.page.test.js`; S `plantillaExcel.test.js` (XLSX viejo con Comisión); D* `qa.plantillas.bordes` (CUIT con dígito verificador 11→0 y 10, CUIT inválido entre filas válidas, vendedor dado de baja alta/actualización, homónimo activo); P* (CSV con Comisión en el medio, XLSX de 1000 clientes) |
| AC-PLA-5 (resumen y rechazos por fila) | D `plantillas.test.js`; P `plantillas.page.test.js`; D* (números de fila exactos con 1000 filas y renglones vacíos); P* (100 rechazos listados) |
| AC-PLA-6 (formula injection, 5 MB, solo admin) | D `security.plantillas.test.js`; D `plantillas.test.js`; S `plantillaExcel.test.js`; P `plantillas.page.test.js` (permisos 2 y 3, 5 MB); D* (5 payloads en todos los campos de texto); P* (CSV `=cmd`) |
| AC-PLA-7 (funciones puras y round-trip) | D `plantillas.test.js`; S `plantillaExcel.test.js` (round-trip con xlsx real); D* `qa.plantillas.bordes` (round-trip con celdas tipadas) |

### Lo nuevo de C1..C9
| Cambio | Tests |
|---|---|
| C1 Mojibake (regla 7) | D `encoding.regla7.test.js`; D* `qa.encoding.test.js` (detector completo, UTF-8 estricto, BOM; BUG-ENC-01) |
| C2 UX de anulación (AC-COM-12) | D `comisiones.anulacion.ux.test.js`; P `comisiones.page.test.js` (6 casos); D* `qa.anulacion.consistencia.test.js` (45 motivos hostiles: el botón se habilita si y solo si `validarAnulacion` acepta); P* `qa.comisiones.anulacion.page.test.js` (cierres independientes, error inline, doble click, PIN fuera del DOM; BUG-COM-01) |
| C3 `MAX_CANTIDAD` tipeado (AC-BUL-6/7, AC-STK-8, AC-SEC-2) | D `security.bultos.test.js`; P `bultos.pedido/facturacion/armado.test.js`; D* `qa.bultos.tope.test.js` (bordes exactos 999999/1000000/1000001, 40 entradas inválidas, `previos` R10; BUG-BUL-01) |
| C4 Bulto solo por id (AC-BUL-1/4) | D `bultos.test.js`; P `bultos.facturacion.test.js` (homónimo); D* `qa.bultos.tope.test.js` (`__proto__`, id 0, mapa inválido) |
| C5 Login con fila del servidor (S-COM-18) | S `vendedoresService.test.js`; C `SelectorVendedor.test.js`; H `useAppContext.test.js`; S* `qa.vendedores.dispositivoDesactualizado` (servidor con estado, `verificar_pin` roto, fila borrada, red caída) |
| C5b Admin activo = activo + PIN | D `vendedores.baja.test.js` (T-16); S `vendedoresService.test.js` (T-17); D `migracion004.test.js` |
| C9 Stock inicial fallido | D `plantillas.test.js` (T-25); P `plantillas.page.test.js` (T-26); P* (1000 filas: un movimiento `inicial` por cada producto con stock) |

### Resto del SPEC
`traceability` pasa. Los AC de REQ-CLI, REQ-PROD, REQ-ING, REQ-STK, REQ-SEC, REQ-BUL y REQ-COM mantienen sus tests. La suite entera sigue verde salvo los 8 tests `BUG`.

## Para el orquestador
1. Corregir BUG-PLA-02, 03 y 01 antes de que el dueño importe con Excel real: son los tres que pasan en la vida real.
2. Los 8 tests rojos son las pruebas de aceptación del arreglo. Cuando se arreglen, el comentario `// BUG:` se puede borrar.
3. Hasta entonces `node harness/gates/run-gates.mjs` falla en `unit-tests`. Si hace falta un gate verde, se pueden marcar los 8 como `it.skip`.
