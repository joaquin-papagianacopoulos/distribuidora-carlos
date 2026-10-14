# QA REQ-VTA — RUN 20261014-1621
| AC | Tests |
|---|---|
| AC-VTA-1 | marcas.test, productos.unidadVenta.test, unidadVenta.test, ProductoForm.test, SelectorRubro.test, plantillas.unidadVenta.test (Excel viejo incluido), qa.unidadVenta.bordes |
| AC-VTA-2 | unidadVenta.test, NuevoPedido/Facturacion/Armado.ventaPor ("3 Display (48 u.)") |
| AC-VTA-3 | unidadVenta.test, las 3 pantallas ventaPor (admin vs vendedor/armador) |
| AC-VTA-4 | unidadVenta.test (Dos Corazones), qa.unidadVenta.bordes (bultoX vacio/0/1/decimal/texto/null, centavos) |
| AC-VTA-5 | syncTolerante.test, migracion006.sql.test, productos.unidadVenta.test |
Agregado: src/domain/__tests__/qa.unidadVenta.bordes.test.js (7 tests). Bugs: ninguno.
