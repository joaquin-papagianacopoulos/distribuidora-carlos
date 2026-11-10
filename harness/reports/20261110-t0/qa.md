# QA RUN 20261110-t0 — REQ-PVC y REQ-SEG2

Tests nuevos: `src/domain/__tests__/qa.t0.bordes.test.js`, `src/services/__tests__/qa.t0.servicios.test.js` (30 tests, solo tests; sin tocar produccion).

## AC -> tests
| AC | Existentes | Sumados por QA (bordes) |
|---|---|---|
| PVC-1 | precioCosto.test (casos A-D, reglas) | precio a mano con ganancia 30; ganancia 0 explicita; nunca = costo; ganancia negativa/basura |
| PVC-2 | precioCosto.test, ProductoForm.pvc | ganancia undefined/null/''/'0'/0/'  ' con costo>0; precio undefined; planilla con ganancia 0 |
| PVC-3 | precioCosto.test, ProductoForm.pvc | sin hueco real |
| PVC-4 | precioCosto.test | null en lista, precio vacio, precio apenas > costo |
| PVC-5 | precioCosto.test | - |
| SEG2-1 | migracion023.sql.test, clientesAdminService.test | - |
| SEG2-2 | respaldo.test, limpiarCache.test | pendientes en otro store, offline con todo subido (sin cerrar DB), stores null, BORRAR variantes, lectura de DB que falla (BUG-1) |
| SEG2-3 | idempotencia, seg2.sync, seg2Sync | mismo client_uuid dos veces, fetch que rechaza, pedido viejo sin campos nuevos, UUID null/distintos |
| SEG2-4 | seg2.sync, seg2Sync | lectura incompleta no purga, pendientes/sin remoteId, ids num/string, null |
| SEG2-5 | stockService.ajustesPin, migracion023 | - |
| SEG2-6 | respaldo.test | PIN anidado/en arreglos/pin_hash ausente del JSON final; snapshot null |
| SEG2-7 | seg2.sync, seg2Sync | registro borrado / sin updatedAt / editado |

Casos obligatorios 1-7: todos cubiertos y verdes salvo el hallazgo BUG-1 (caso 4).

## Bugs
- BUG-1 (real, test FALLANDO): `src/services/limpiarCache.js` `limpiarCacheLocal()` — si `evaluarBorradoCache()` lanza (IndexedDB ilegible), hace `ev = null` y SIGUE borrando todo, sin respaldo. Repro: `leerTodosLosStores` rechaza -> se borran localStorage/IndexedDB con pendientes posibles. Esperado: bloquear (o exigir camino forzado). Test: `qa.t0.servicios` "si no se puede leer la base local NO borra".
- BUG-2 (menor, sin test): `respaldo.js` `CLAVES_SECRETAS` solo cubre pin/pinHash/pin_hash/adminPin/pinAdmin; si algun store guardara token/apikey/password se exportaria. Hoy ningun store lo hace.
- REGRESION de tests del implementador (por cambio concurrente en `pedidoRepository.js`, ahora hace `update` por id cuando el alta ya existia): fallan `pedidoRepository.idempotencia.test.js` ("si el alta ya existia...") y `seg2.sync.test.js` ("un reintento cuyo alta ya existia...") porque sus mocks no tienen `.update()`. Hay que adaptar los mocks (no toque esos archivos).

## Corrida completa
236 suites: 3 fallan / 3380 ok. Fallan: BUG-1 (a proposito) y las 2 regresiones de mock. `facturasAEmitir` (AC-FAB-3) ya no falla en esta corrida.
