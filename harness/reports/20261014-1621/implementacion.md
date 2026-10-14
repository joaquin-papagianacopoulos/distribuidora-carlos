# Implementacion — RUN 20261014-1621 — REQ-VTA

Estado: tests `CI=true npx react-scripts test --watchAll=false` verdes (1907 passed, 1 skipped, 5 todo preexistentes), `npx react-scripts build` OK, `run-gates.mjs --fast` todos PASS. Sin commit ni push.

## Archivos nuevos
- Dominio: `src/domain/unidadVenta.js` (AC-VTA-2/3/4), `src/domain/marcas.js` (AC-VTA-1).
- UI: `src/components/SelectorMarca.js` (wrapper de SelectorRubro).
- Migracion: `supabase/migrations/006_unidad_venta.sql` (idempotente, CHECK `not valid`, sin grants/policies, sin DROP).
- Tests: `unidadVenta.test.js`, `marcas.test.js`, `productos.unidadVenta.test.js`, `migracion006.sql.test.js`, `plantillas.unidadVenta.test.js` (domain), `NuevoPedido.ventaPor`, `Facturacion.ventaPor`, `Armado.ventaPor` (pages).

## Archivos modificados
- `rubros.js`: `listarRubros(..., { campo })` retrocompatible.
- `productos.js`: campos `marca`, `ventaPor`, `bultoNombre`, `visibleTienda`; `validarProducto` (+`marcas`, error en `errores.ventaPor`); `productoVentaToRemote`; `productoExtraFromRemote` con defaults.
- `bultos.js`: `renglonNuevo` usa `cantidadInicialRenglon`; `etiquetaBotonBulto(bultoX, nombre='Bulto')`.
- `plantillas.js`: 4 columnas (INFO, alias, SOLO_PLANTILLA), `validarFilaProducto` con `marcas`, dedupe de marcas en el plan.
- `SelectorRubro.js` (props opcionales name/etiqueta/testId), `CamposForm.js` (opciones objeto), `ProductoForm.js`, `BultoControl.js` (nombre y precio del bulto).
- `Configuracion.js`: `marcaParaGuardar` en form e importacion (marca manual > existente > `detectarMarca`).
- `NuevoPedido.js`, `Facturacion.js`, `Armado.js`: paso por bulto, aviso de no multiplo, bloqueo (vendedor/armador), admin en Facturacion confirma y guarda, congelado de `bultos/bultoX/bultoNombre`, texto "3 Display (48 u.)".
- `syncService.js`: `upsertEscalonado` (completo 001+006 -> solo 001 -> basico; baja a 001 solo si el error nombra una columna de la 006); `same` del pull con defaults en ambos lados y `marca`.
- `DB_VERSION` sin cambio (7): campos opcionales dentro de los objetos; sin test de upgrade nuevo.

## AC cubiertos (todos con test que los nombra)
- AC-VTA-1: marcas.test, productos.unidadVenta.test, ProductoForm.test (extendido), SelectorRubro.test (extendido), plantillas.unidadVenta.test.
- AC-VTA-2: unidadVenta.test (congelar, texto), NuevoPedido/Facturacion/Armado.ventaPor.
- AC-VTA-3: unidadVenta.test (avisos, permisos), las tres pantallas (admin confirma en Facturacion; vendedor/armador no).
- AC-VTA-4: unidadVenta.test (Dos Corazones 1 -> 16 u./$14.400, 3 -> 48 u./$43.200; bultoX vacio/0/1/decimal/texto; NaN/negativos/null; MAX_CANTIDAD; centavos).
- AC-VTA-5: syncTolerante.test (extendido), migracion006.sql.test, productos.unidadVenta.test (to/fromRemote).

## Tests existentes modificados (no borrados ni salteados)
Solo las listas de etiquetas/columnas de productos, que cambian por mandato del SPEC (17 columnas en vez de 13): `plantillas.test.js`, `productos_proveedores.test.js`, `ProductoForm.test.js` (titulo), `qa.plantillas.bordes.test.js` (las 5 variantes de encabezado + titulo), `security.plantillas.test.js` (fila posicional con 4 celdas mas).

## Decisiones / notas
- El upsert escalonado conserva el test existente AC-PROD-2 (error por `costo_final` cae directo al basico).
- `marca` manual tiene prioridad sobre `detectarMarca` (antes la importacion pisaba la existente con la detectada). Vaciar la marca en el form hace que se complete con la existente/detectada.
- Armado bloquea no multiplos para todos; solo Facturacion (admin) permite guardarlos con confirmacion. Pedidos viejos no se bloquean si la cantidad no cambio.
- Riesgo conocido (patron existente): una fila remota que viole un CHECK de la 006 hace fallar la tanda; `validarProducto` aplica la misma regla antes de guardar.

## Pasos manuales
- Correr `supabase/migrations/006_unidad_venta.sql` en el SQL editor (la app funciona sin ella; las 3 columnas nuevas quedan como extras pendientes). Revisa el auditor (punto 7 del SPEC).
- Pendiente de confirmar con el dueño: unidades sueltas de un producto "solo display" para el vendedor (por ahora no).
