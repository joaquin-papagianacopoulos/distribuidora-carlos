# REQ-PLA — Plantillas Excel para productos y clientes (implementación 20261012-pla)

## Diseño

- **Una sola fuente de verdad**: las columnas de la plantilla salen de `CAMPOS_PRODUCTO` / `CAMPOS_CLIENTE`, los mismos arrays que dibujan `ProductoForm` y `ClienteForm` vía `CamposForm`. Cada fila se valida con `validarProducto` / `validarCliente`, las mismas funciones del formulario. No hay reglas duplicadas.
- **Producto**: el formulario actual **no tiene Unidad** (el alta la fija en `'unidad'`), así que la plantilla tiene exactamente los 13 campos de REQ-PROD. La importación igual acepta una columna `unidad` (archivos viejos).
- **Planificación pura → ejecución en la página**: `planificarImportacion(rows, entidad, ctx)` decide por fila `crear` / `actualizar` / `rechazar` / `fusionada`, sin efectos. `Configuracion.js` solo ejecuta el plan con las mismas funciones de persistencia del alta manual:
  - productos nuevos: `addProductoLocal`, y si traen Stock, `ajustarStock(id, stock, { usuario, inicial: true })`, que es el mismo camino del alta (genera el movimiento `inicial`, AC-PROD-3);
  - productos existentes: `updateProducto`; el Stock se ignora y se informa en el resumen (regla dura 4);
  - clientes: `addCliente` / `updateCliente` con `extrasDirty: true`, igual que `guardarCliente` del formulario, así que sincronizan igual (`pendingSync`, AC-CLI-5).
- **Modo legacy (AC-PROD-5)**: si el archivo no trae ninguna columna exclusiva de la plantilla (Proveedor, costos, %, Precio venta 2, Bulto, Mínimo, Stock) y el nombre no viene como "Descripción", se trata como archivo viejo:
  - el código no es obligatorio y el precio sí;
  - no se marca `extrasDirty`, así que sube solo lo básico, como antes;
  - una fila repetida pisa a la anterior (gana la última, como antes).

  En modo plantilla, un código repetido en el mismo archivo se rechaza.
- **Encabezados**: primero se compara la etiqueta exacta normalizada (sin tildes, mayúsculas, espacios ni símbolos). Después se prueban alias (`nombre`, `precio`, `clave`, `sku`, `razon social`, `domicilio`, `cp`, `iva`…). Al final, solo para productos y para los encabezados que todavía no matchearon, se aplican las coincidencias parciales de la importación vieja (`includes('nombre')`, `precio de venta`, `pcio`, `cod`/`ref`, `categ`/`familia`/`linea`, `unit`).
- **Upsert**:
  - productos: por código y, si no hay código, por nombre (como hoy);
  - clientes: por código de cliente.

  En las actualizaciones, una celda vacía conserva el dato existente. Precio venta 1 vacío se calcula con AC-PROD-1 en productos nuevos o cuando la fila cambia algún costo, descuento o ganancia. En un producto existente sin cambios de costo se conserva el precio.
- **Proveedor**: se busca por descripción, por código o por la etiqueta "COD — Descripción" del form, sin distinguir mayúsculas y con trim. Si hay dos con el mismo nombre se rechaza la fila y se pide usar el código.
- **Vendedor**: se busca solo entre los activos (`filtrarActivos`, REQ-VEN) y se guarda el nombre tal como está cargado.
- **Provincia y Tipo de IVA**: se aceptan sin tildes ni mayúsculas ("cordoba" → "Córdoba"). Fecha `DD/MM/AAAA` → ISO. Los `%` aceptan el sufijo "%".

## Archivos

| Archivo | Cambio |
|---|---|
| `src/domain/plantillas.js` | **Nuevo.** `COLUMNAS_PLANTILLA`, `NOMBRE_ARCHIVO_PLANTILLA`, `normalizarEncabezado`, `mapearEncabezados`, `normalizarFecha`, `resolverProveedor`, `resolverVendedor`, `validarFilaProducto`, `validarFilaCliente`, `planificarImportacion`, `resumirEntradas`, `textoResumen`, `filasInstrucciones`, `armarPlantilla`. Todas las celdas de texto pasan por `csvSafe(texto())`, tanto al importar como al exportar. |
| `src/services/plantillaExcel.js` | **Nuevo.** `libroPlantilla(XLSX, plantilla)` (con xlsx inyectado, para tests), `generarPlantillaXlsx` (`await import('xlsx')`, solo escritura), `descargarBlob`, `descargarPlantilla`. |
| `src/pages/Configuracion.js` | `importarRows`/`importarCSV`/`importarXLSX` reemplazados por `leerFilas` (5 MB, primera hoja, conserva números de fila), `importarProductos` e `importarClientes` (ejecutan el plan del dominio, y un error al guardar una fila se informa sin frenar el resto). Componente `ResultadoImport` (mensaje + "Creados · Actualizados · Rechazados" + lista "Fila N: motivo"). Botón "Descargar plantilla Excel" en la tarjeta de Productos. Tarjeta nueva "Importar / Actualizar clientes" en la pestaña Clientes. Toda la pantalla sigue siendo solo para admin. |
| `src/domain/__tests__/security.validacion.test.js` | Los 3 tests que escaneaban el código fuente de `importarRows` (`const nombre = csvSafe(texto(`, `if (precio > MAX_IMPORTE)`) ahora verifican lo mismo en su nuevo lugar (`plantillas.js`) y además prueban el comportamiento (fórmula neutralizada, `1.234,50`, precio > MAX_IMPORTE rechazado). No se relajó ninguna condición. |
| Tests nuevos | `src/domain/__tests__/plantillas.test.js` (41), `src/services/__tests__/plantillaExcel.test.js` (9, incluye round-trip con xlsx real), `src/pages/__tests__/plantillas.page.test.js` (14). |

Sin cambios de IndexedDB (`DB_VERSION` igual) y sin migración de Supabase: todas las columnas ya existían (001).

## AC cubiertos

| AC | Tests |
|---|---|
| AC-PLA-1 | Dominio: columnas == `CAMPOS_PRODUCTO`. Servicio: libro .xlsx con hojas Productos + Instrucciones, Blob, descarga. Página: el botón baja `plantilla_productos.xlsx` con los encabezados del form. |
| AC-PLA-2 | Dominio: 17 columnas == `CAMPOS_CLIENTE`, valores válidos (provincias, IVA, vendedores activos). Página: el botón en Clientes baja `plantilla_clientes.xlsx` y no aparece en Proveedores ni Vendedores. |
| AC-PLA-3 | Dominio: mapeo nuevo/viejo/parcial, % fuera de rango, bulto 0, mínimo decimal, proveedor inexistente/ambiguo, código obligatorio, código de otro producto, precio calculado con AC-PROD-1, stock solo en nuevos, modo legacy. Página: XLSX de plantilla crea con `ajustarStock(..., { inicial: true })` y actualiza sin tocar el stock. Siguen verdes todos los AC-PROD-5 de `ConfiguracionAltas.test.js`. |
| AC-PLA-4 | Dominio: CUIT inválido, normalizado `XX-XXXXXXXX-X`, provincia/IVA fuera de lista, comisión > 100, fecha inválida, vendedor inexistente o dado de baja, código repetido en el archivo, upsert por código. Página: CSV y XLSX de clientes, `extrasDirty: true`, y en las actualizaciones se conserva `boletaContraBoleta`. |
| AC-PLA-5 | Dominio: `resumirEntradas` / `textoResumen` con fila y motivo. Página: resumen y lista de rechazos; un error de guardado en una fila no frena el resto. |
| AC-PLA-6 | `=cmd` / `+` / `@` neutralizados al importar (dominio, round-trip) y al exportar (ninguna celda del .xlsx es fórmula). Límite de 5 MB para productos y clientes. Vendedor y armador no ven botones ni el input de archivo. |
| AC-PLA-7 | Funciones puras en `src/domain/plantillas.js` (cobertura de líneas 100%). Round-trip: plantilla → xlsx → completar → leer → `planificarImportacion`, con las 13 y las 17 columnas mapeadas a su campo y ninguna ignorada. |

## Resultados (corridos en esta sesión)

- `CI=true npx react-scripts test --watchAll=false`: **55 suites OK; 1003 passed, 1 skipped, 2 todo (1006)**. Antes eran 52 suites y 942 tests.
- `node harness/gates/run-gates.mjs` (completo, `--out harness/reports/20261012-pla/gates.json`): **todos PASS**. Detalle:
  - coverage-domain: líneas 100%;
  - traceability: 74/74 AC;
  - build: OK;
  - npm-audit: runtime high `[xlsx]`, que ya está en la baseline (sin críticas nuevas).
- `node harness/gates/run-gates.mjs --fast`: **todos PASS**.

## Notas / pendientes

- El CUIT duplicado entre clientes distintos **no** se rechaza: REQ-CLI no lo define como único y no se agregaron reglas nuevas. Sí se rechaza el **código** de cliente repetido en el mismo archivo y el código que ya usa otro cliente.
- En una actualización, una celda vacía no borra el dato existente. Para vaciar un campo hay que usar el formulario.
- Excel puede convertir códigos con ceros adelante ("0042") o fechas si la celda no está en formato texto. La hoja Instrucciones lo advierte.
- Se mantiene S-DEP-01/S-07: xlsx 0.18.5 se usa para parsear solo como admin y con archivos de hasta 5 MB. La generación de la plantilla solo escribe.
- Observación previa, sin tocar: el texto "ConfiguraciÃ³n" / "tenÃ©s" del bloque "sin permisos" de `Configuracion.js` tiene mojibake (estaba antes de este cambio).
