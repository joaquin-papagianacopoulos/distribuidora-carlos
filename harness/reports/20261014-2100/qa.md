# QA 20261014-2100 (REQ-TIE, REQ-WEB)

- Todos los AC-TIE-1..15 y AC-WEB-1..7 tienen al menos un test que los nombra (domain, UI tienda, PedidosWeb, SQL, sync, aislamiento).
- Agregado: src/domain/__tests__/qa.tienda.bordes.test.js (8 tests): Dos Corazones, entradas invalidas, centavos, ofertas en el borde, totales grandes, tope 150, busqueda con tildes y filtros, filtros en URL.
- Suite completa: 125 suites OK (mas la nueva), 2133 tests passed, 1 skipped, 5 todo, 0 fallas. Nueva: 8/8.
- Bugs: ninguno encontrado.
- Notas: el servidor (RPC) solo se verifica por tests de texto sobre el SQL; no hay ejecucion real contra Postgres.

## Vuelta 2
- Cobertura: AC-WEB-2 (PedidosWeb.test.js, pedidosWeb.test.js), AC-WEB-3 (PedidosWeb.test.js, pedidosWebSync.test.js, migracion008.sql.test.js), AC-WEB-6 (pedidosWebSync, migracionV8, PedidosWeb.test.js), AC-TIE-15 (migracion008.sql.test.js, tienda.carrito.test.js, carrito.ui.test.js). Sin AC descubiertos.
- Tests UI agregados en src/pages/PedidosWeb.test.js: (1) sin PIN: "Datos de contacto no disponibles", sin dirección/CUIT/obs, renglones y total visibles; (2) PIN válido: trae contactos, recarga, muestra contacto y precarga el cliente nuevo. El caso RPC fallando ya existía (AC-WEB-3 S-WEB-01).
- Tests existentes: no se detectó ninguno debilitado (sin skips nuevos; suite pasa).
- Suite completa: 127 suites OK, 2176 passed, 1 skipped, 5 todo, 0 failed.
- Bugs: ninguno.
