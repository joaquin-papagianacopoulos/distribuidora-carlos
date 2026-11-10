# QA RUN 20261110-t3 — REQ-ESC

Tests nuevos (solo tests; produccion intacta):
- `src/domain/__tests__/qa.escalas.bordes.test.js` (bordes de dominio)
- `src/pages/__tests__/escalas.armadoFacturacion.test.js` (UI Armado y Facturacion, 8 casos)

Ya existian (implementador): precios.escalas, productos.escalas, plantillas.escalas, grupoBulto.escalas, tienda.escalas, migracion026.sql, ProductoForm.escalas, escalas.pantallas (Nuevo Pedido).

| AC | Cobertura | Tests |
|---|---|---|
| AC-ESC-1 | Form (3 filas, deshabilitado con Bulto x<=1, guarda, error por campo), dominio productos, plantilla (alias, vacio conserva, "-" borra, anti formula, Bulto x=1), validar (4 filas, pct 100/neg, desde 1) | ProductoForm.escalas, productos.escalas, plantillas.escalas, qa.escalas.bordes (importacion vieja sin columna conserva; alta sin columna vacia) |
| AC-ESC-2 | Borde N-1/N bultos (bultoX 12), solo bultos completos, escala mas alta, redondeo ($800-8%=736; $333-7%=310), manual respetado, congelado ante cambio de escalas del producto, grupo GBU suma con escala propia de cada producto, escalaDesde/Pct del cliente ignorados | precios.escalas, grupoBulto.escalas, qa.escalas.bordes |
| AC-ESC-3 | Etiqueta en Nuevo Pedido (existente) y ahora Armado y Facturacion (sin etiqueta, con etiqueta, +Bulto cruza 4->5 bultos y guarda total 50x920, manual sin etiqueta); edicion hostil; boleta guion ASCII y total 46000; tienda | escalas.pantallas, escalas.armadoFacturacion, grupoBulto.escalas, tienda.escalas, qa.escalas.bordes |
| AC-ESC-4 | Regresion REQ-PBU ($900/$800 x16: 10u=9000, 16u=12800), sin escalas = shape identico, null/undefined/NaN, escalas invalidas (N<2, pct 0/100/neg/NaN/Inf/texto, >3, duplicadas, desordenadas) | precios.escalas (fixture 24 casos), qa.escalas.bordes |

## Bugs / observaciones
1. BUG (bajo): `aplicarDescuentoEscala(Infinity, 8)` lanza `RangeError` (`BigInt(Infinity)` en precios.js:68). Funcion exportada; por el camino normal `precioConEscala` filtra con `aPrecio`, asi que no se llega con Infinity. Test dejado fallando a proposito: "AC-ESC-2 aplicarDescuentoEscala(Infinity) no tira" (marcado `// BUG:`). Arreglo: `Number.isFinite` antes de BigInt.
2. Observacion de diseno (no bug segun spec): escalas desordenadas `[{10,12},{5,8}]` dejan solo la de 10 (se pierde la de 5 en silencio). El formulario/plantilla la rechazan con error, asi que solo afecta datos remotos. Pineado en test.

## Pendiente / no verificable
- SQL 026 (RPC `tienda_catalogo`, `tienda_crear_pedido`) no se ejecuto (sin psql): solo tests estaticos; correr `supabase/verificacion/026_escalas_casos.sql` en Supabase.
- Remito/PDF real (pdfGen) mockeado en UI; ASCII verificado en funciones de dominio.

## Suite completa
272 suites: 271 OK, 1 falla (el test BUG de arriba). 3883 tests OK, 1 fallido, 1 skipped, 5 todo.
