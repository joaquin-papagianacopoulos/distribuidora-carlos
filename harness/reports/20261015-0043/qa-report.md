# QA report — RUN 20261015-0043 (REQ-PBU, REQ-MIN, REQ-SST, REQ-HPR)

Resultado: 0 bugs encontrados. Cobertura de AC ya completa por el implementador; sume solo bordes.
Nuevo: `src/domain/__tests__/qa.precioMinimoStock.bordes.test.js` (21 casos, todos verdes).
Corrida de los suites tocados/relacionados: 8 suites, 70 tests, verdes.

| AC | Tests (archivo principal) |
|---|---|
| AC-PBU-1 | ProductoForm.test, precios.test, productosAdmin.migracion010, syncTolerante |
| AC-PBU-2 | plantillas.precioBulto.test |
| AC-PBU-3 | precios.test, precioMinimoStock.{pedido,facturacion,armado}, bultos.pedido |
| AC-PBU-4 | tienda.precioBulto, precioBulto.ui, migracion010.sql, QA: paridad tienda==precioAplicado (1..100 u.) y precio manipulado ignorado |
| AC-PBU-5 | precios.test (ejemplo $900/$800 x16: 10u $9.000, 16u $12.800, 20u $16.000) |
| AC-MIN-1 | minimos.test, precioMinimoStock.pedido, tienda.precioBulto, QA: null/''/0/1/negativo/texto, eliminado, decimal |
| AC-MIN-2 | minimos.test, precioMinimoStock.{facturacion,armado}, QA: matriz de permisos/pantalla |
| AC-MIN-3 | minimos.test, tienda.precioBulto, QA: 12 queda 12, 13->18, bultoX 0 no explota |
| AC-SST-1 | sinStock.test, precioMinimoStock.{pedido,facturacion,armado}, bultos.pedido |
| AC-SST-2 | sinStock.test, Stock.test |
| AC-SST-3 | tienda.precioBulto |
| AC-HPR-1 | cambiosPrecioService.test, cambiosPrecio.tx.test, migracionV9, precios.test, migracion010.sql, QA: "900.00" vs 900 no registra, solo precioBulto registra, null/alta en 0, medianoche UTC-3 |
| AC-HPR-2 | CambiosPrecio.page.test, pdfCambiosPrecio.test, precios.test, QA: anterior 0 => variacion null, primero/ultimo, rango, entradas invalidas |
| AC-HPR-3 | pdfCambiosPrecio.test, precios.test |
| AC-HPR-4 | CambiosPrecio.page.test |

Solo admin en CambiosPrecio: CambiosPrecio.page.test (permiso 2 => `cambios-precio-solo-admin`).

## Bugs
Ninguno reproducido.

## Observaciones (no son bugs)
- `precioAplicado` con precioBulto > precio cobra el menor (consistente con el aviso de AC-PBU-1).
- No hay test E2E de la funcion SQL `tienda_crear_pedido` contra Postgres real; la paridad servidor se cubre solo por texto del SQL (migracion010.sql.test) y por el calculo JS de la tienda. Verificar a mano en Supabase tras aplicar la 010.
- La suite completa y build quedan para el gate.
