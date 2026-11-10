# QA Tanda 2 — RUN 20261110-t2 (REQ-RTO, REQ-HRU, REQ-RED, REQ-DMP)

Suite completa: 259/260 suites verdes, 3681 tests ok, 2 fallan a proposito (BUG-1, BUG-2). Nada de produccion tocado.
Tests nuevos: `src/domain/__tests__/qaT2.bordes.test.js` (33) y `src/pages/__tests__/qaT2.redondeo.facturacion.test.js` (8).

## AC -> test (principales; el implementador ya cubria el caso feliz de todos)
| AC | Cobertura previa | Aporte QA (hueco cerrado) |
|---|---|---|
| RTO-1 | pdfBoleta011 (titulo, nombre archivo), facturasAB.facturacion | tipoFacturaEfectivo default 'ninguna'; facturados viejos sin marca siguen en "Facturas a emitir" por IVA (sugerido), marcados 'ninguna' fuera |
| RTO-2/3/4/6 | pdfBoleta011 (direccion, vendedor, numeracion, 120 renglones, sin troquel) | sin hueco nuevo |
| RTO-5 | cobranza.test, pdfBoleta011 | clientes con ids distintos y mismo nombre no mezclan deuda |
| HRU-1 | cobranza.test, pdfHojaRuta, ordenEntrega.zonas | 3 pedidos del mismo cliente: saldo una vez; parcial/pagada/propia; importe = deuda redondeada; suma en centavos (0,1+0,2+0,3); hoja vacia |
| RED-1 | redondeo.test, ConfigRedondeo, ajustesService | sin hueco nuevo |
| RED-2 | redondeo.test, deudaRepository.redondeo | 12 bordes de redondearTotal (mitades, negativos, '1250', 0.005); multiplo 0/'0'/null/'sin redondeo'; $200 con 500 no se redondea; congelado en 0 no cae al default; cambiar config no recalcula facturados; viejo sin claves no se redondea al editar; total stale no manda; pagina Facturacion: facturar congela 500/1000/0, revertir limpia 3 claves, editar facturado usa SU multiplo y deuda = totalACobrar, viejo editado sin redondeo, lista muestra total redondeado |
| DMP-1 | cobranza.test, deudas.medioPago, syncDeudas | medio con espacios/mayus; 'mixto'/'rendicion'/'cheque' rechazados; idempotencia por UUID x3; deuda saldada/monto <=0 sin cambios; suma de medios |

## Bugs
**BUG-1 (medio) — "Cobrado por medio" pierde pagos viejos cuando la deuda se sigue pagando con medio.**
Test: `AC-DMP-1 totales por medio: pagos viejos y nuevos en la misma deuda no se pierden` (falla a proposito).
Repro: deuda $1000 con $300 pagados antes de la migracion (sin `cobros`), cobrar $200 en Efectivo.
`registrarCobroEnDeuda` crea `cobros=[200]`, `montoPagado=500`; `totalesPorMedio` solo mira `cobros` y da efectivo 200, sinDato 0.
Los $300 viejos desaparecen del panel y del total; la suma de medios != lo cobrado. Fix sugerido (src/domain/cobranza.js): en
`totalesPorMedio`, sinDato += max(0, montoPagado*100 - suma(cobros)). Tambien `medioResumen` dice 'efectivo' ocultando el tramo sin dato.

**BUG-2 (bajo) — `validarCobro` acepta montos menores a un centavo.**
Test: `AC-DMP-1 pago de $0,004 ... debe rechazarse` (falla a proposito). `monto: 0.004` da `ok:true, montoCents:0`;
`registrarCobroEnDeuda` lo ignora pero `cobrarDeuda` igual hace updateDeuda+sync y la UI cree que cobro. Rechazar si `centavos(pesos) <= 0`.

## Observaciones (sin test, decision de negocio)
- Reporte "Facturas a emitir" (UI y PDF, RPC `admin_facturas_a_emitir`) suma `pedido.total` (renglones, sin redondeo) mientras deuda,
  hoja de ruta y reportes de ventas usan `totalACobrar`. Es coherente con "factura en ARCA = renglones", pero confirmar con el dueno.
- Revertir un facturado que ya tenia cobros conserva la deuda con el monto redondeado viejo; al refacturar con otro multiplo
  `registrarDeudaFacturado` no crea otra y la deuda queda con el monto anterior (ya cubierto parcialmente por actualizarMontoDeudaDePedido solo al editar).
- Resto de totales revisados (ListaPedidos, ReportesVentas, Rendicion, Facturacion, Armado, PDF remito/hoja de ruta): todos usan `totalACobrar`; no hay inconsistencia.
- Comisiones: `pedido.total` intacto, cubierto por redondeo.test (neto de comision igual con y sin redondeo).
