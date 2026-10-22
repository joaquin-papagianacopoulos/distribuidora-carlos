# QA RUN 20261022-1200 (REQ-CON, REQ-DIR, REQ-FRB)

## AC -> test
| AC | Tests |
|---|---|
| AC-CON-1 | domain/__tests__/frb.contacto.test.js, migracion019.test.js, services/__tests__/syncTolerante.test.js, qa.dir.frb.con.bordes.test.js |
| AC-CON-2 | pages/__tests__/qa.plantillas.import.page.test.js (Excel viejo sin columna) |
| AC-DIR-1 | tienda/__tests__/checkout.direccion.test.js, pages/__tests__/nuevoPedido.direccion.test.js, domain/__tests__/tienda.checkout.test.js |
| AC-DIR-2 | domain/__tests__/migracion019.test.js (paridad SQL con fixtures) |
| AC-DIR-3 | domain/__tests__/direccion.test.js + bordes QA |
| AC-FRB-1/2/3 | frb.contacto.test.js, utils/__tests__/pdfBoleta011.test.js, bordes QA |

Todos los AC tienen test que los nombra. Agregado: `src/domain/__tests__/qa.dir.frb.con.bordes.test.js` (26 tests: undefined/number/objeto/tab/s/nada en direccion; 15.99 vs 16 u., bultoX 1, precioBulto > precio, descuentoPct, idempotencia, totales vacios/legacy/mezcla; contacto null/espacios/unicode).

## Suite completa
222 suites: 221 ok, 1 falla (la mía, ver bug). 3245 tests ok.

## Bugs
1. (menor) `clienteExtraToRemote({contacto:'   '})` sube `'   '` en vez de null (no recorta). Solo se da si no pasa por `validarCliente`, que si recorta. Test fallando con `// BUG:`.

## Observaciones (sin test fallando)
- `direccionExacta('1 de Mayo')` da ok (hay un numero, pero no es altura). Limite aceptado de la heuristica; el SQL tiene la misma regla.
- No se pudo verificar la migracion 019 contra Supabase real (solo paridad por texto).
