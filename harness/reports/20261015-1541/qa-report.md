# QA report — RUN 20261015-1541 — REQ-INA, REQ-CPR, REQ-STB

Todos los AC del alcance ya tenian tests del implementador (Grep de ids: INA-1..5, CPR-1..5, STB-1..3 con 9 a 34 menciones c/u).
Se sumo solo casos borde en `src/domain/__tests__/qa.compras.bordes.test.js` (16 tests, 16 verdes).

| AC | Test QA (borde agregado) |
|---|---|
| AC-INA-1 | costo 0 valido / negativo / texto; tipo sin cabecera; centavos 0.1+0.2 y 1.005; `ingresoToRemote` no emite costo/tipo (D2) |
| AC-INA-2 | ingreso mixto A/B: A=10u/$101,00, B=8u/$0,30, total 18u/$101,30; renglon sin costo suma unidades, no importe |
| AC-INA-4 | `costoProductoDesdeIngreso`: igual/vacio => null; precio manual se respeta; recalcula con ganancia |
| AC-INA-5 | ingreso viejo sin costos => todo "sinDato", sin compra derivada |
| AC-CPR-1 | saldo = compras + cargos - pagos, anulados fuera, saldo a favor negativo, otro proveedor |
| AC-CPR-2 | "directa" con cliente/pedido opcionales; en efectivo se descartan; monto 0 y medio vacio rechazados |
| AC-CPR-3 | totales por medio sin anulados; filtro de medio no altera saldo; saldo inicial por `desde` |
| AC-CPR-4 | bultos a unidades (2x12=24); cantidades 0/decimales ignoradas; recibido idempotente, no vuelve a enviado, no admite agregar |
| AC-CPR-5 | anular: motivo en blanco, doble anulacion, sin mutar el original |
| AC-STB-1 | `stockMinimo` vacio/null/negativo => minimoVenta; 0 explicito gana |
| AC-STB-2 | estados negativo/sin_stock/bajo/ok (limites 0, =umbral); busqueda sin tildes, mayusculas, orden libre, espacios |
| AC-STB-3 | contador incluye bajo+sin stock+negativo; sugerido redondeado a bulto; filtro por proveedor |

## Bugs
Ninguno confirmado en dominio. Hallazgos menores / observaciones (no bloqueantes):
1. `costoProductoDesdeIngreso` con costo `0` valido (AC-INA-1 lo permite) pondria `costoFinal` = 0 al tildar "actualizar costo"; la UI deberia avisar o ignorar 0. Decision de negocio, no cubierta por el SPEC.
2. `stockBajo.stockDeMapa` solo resuelve claves string en el Map (`calcularStock` las genera asi, por eso no es bug hoy); un Map con claves numericas daria stock 0 silencioso.
3. `estadoStock`: producto con umbral 0 y stock 0 cuenta como "sin stock" en el contador (S4, intencional), puede inflar el aviso con productos nunca cargados.

## No cubierto por QA
UI (RTL) de Proveedores/Stock y servicios con IDB/supabase: ya tienen tests del implementador (`proveedores.test.js`, `stock.stockBajo.test.js`, `comprasService.test.js`, `stockService.ingresoCostos.test.js`); no se duplicaron ni se re-corrieron. Suite completa: la corre el gate.
