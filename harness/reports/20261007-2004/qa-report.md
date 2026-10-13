# QA report - RUN 20261007-2004 - REQ-BUL

## Resultado
`CI=true npx react-scripts test --watchAll=false`: 26 suites passed, 435 passed, 1 skipped (436). Antes de QA eran 426 passed; se agregaron 9 tests.

## Matriz AC -> tests (todos ejercitan comportamiento, no solo el ID)
| AC | Dominio | Componente | Pagina |
|---|---|---|---|
| AC-BUL-1 | bultos.test (etiqueta, tieneBulto, bordes QA: "12", 0.5, -3, MAX) | BultoControl (1, '', undefined, 0, '12,5', -12) | pedido, facturacion (+ bultoX texto "12" y 0.5, QA), armado (incl. item tachado) |
| AC-BUL-2 | 0->36, 5->41, MAX_CANTIDAD, "12" texto, undefined | onSumar | pedido 5+3=41; facturacion +3 guarda 41 y no inicia stock; armado 5+3=41 |
| AC-BUL-3 | 41->29, piso 0/1, bordes QA (negativa, undefined, 13->1) | "-" deshabilitado <=1 | pedido, facturacion, armado: 5->1, renglon sigue; QA: +/- vuelve a 5 |
| AC-BUL-4 | 36/41, singular, bultoX actual 12->6, texto | desglose | pedido 12->6 |
| AC-BUL-5 | tabla decimal/negativo/texto/ausente/NaN/Infinity/>MAX | - | - |
| AC-BUL-6 | - | - | pedido: minimo 24 y stock 30 siguen la cantidad resultante (1 -> aviso minimo; 25 -> sin avisos; 37 -> stock) |
| AC-BUL-7 | armado.test (diff, fusion, corrupto) | - | stockService: 5->41 emite solo -36 e idempotente; facturacion: draft de texto no pisa (QA: tipear 7, +bulto = 19); armado: cambios acumulado con sesiones previas; QA: ida y vuelta = cambios vacio; QA: cambios previo no-array |
| AC-BUL-8 | matriz permisos | visible=false | pedido 1/2 si, 3 no; facturacion 2/3 denegado; armado 1/3 si, 2 no |

## Tests agregados por QA
- `src/domain/__tests__/bultos.test.js`: 4 (bultoX "12"/" 12 "/0.5/-3/MAX_CANTIDAD, cantidades negativas/undefined, desglose con textos).
- `src/pages/__tests__/bultos.facturacion.test.js`: 3 (draft tipeado + bulto = 19; +/- vuelve a 5; bultoX texto).
- `src/pages/__tests__/bultos.armado.test.js`: 2 (ida y vuelta sin cambios; cambios previo corrupto).

## Bugs encontrados
Ninguno funcional en REQ-BUL: todos los tests nuevos pasaron sin tocar produccion.

Observaciones menores (no bloqueantes, ya notadas en implementacion.md):
- `Facturacion.aplicarBulto` hace efectos (draftRef, setDraftByPid) dentro del updater de `setItemsEdit`. Hoy es idempotente, pero es fragil bajo StrictMode/concurrent rendering.
- Textos con tildes rotas preexistentes en Facturacion.js / NuevoPedido.js (fuera de alcance).
- Gate `traceability` falla solo por AC-COM-1..16 (REQ-COM, otro alcance); ningun AC-BUL sin test (segun implementacion.md; no re-corrido por QA).
- No se midio cobertura separada; los gates coverage-domain pasaron segun implementacion.md.
