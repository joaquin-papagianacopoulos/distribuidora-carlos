# Implementacion BLOQUE B — RUN 20261110-t2 (PDF remito, hoja de ruta, UI)

## Hecho (pasos 14 a 21 del plan)
14. `src/domain/boletaLayout.js`: `encabezadoComprobante()` ('REMITO'), `ESTILO_TABLA_COMPACTA` (8 pt, padding vertical 0,8 mm) y
    `ESTILO_TABLA_ANTERIOR`, `altoFilaMm`, `filasPorHoja`. `layoutPieBoleta` sin troquel (sin casillas/corteY/proveedor); devuelve
    `itemsY, subtotalY, redondeoY, totalesY, descuentoY, saldoAnteriorY, totalCobrarY, obsY, limiteY` (`deudaY` = alias del saldo).
15. `pdfGen.buildFacturaDoc`: titulo "REMITO" + "REMITO N° 000123", direccion y `Zona:` bajo el cliente, "Vendedor:" en negrita 16 pt,
    columna N° (`numerarFilasBoleta`), "Ítems: N", Subtotal / Redondeo / TOTAL (`desgloseTotalRemito`, solo si hay ajuste),
    "Saldo anterior" + "Total a cobrar" solo con deuda, sin troquel ni pie. Archivo `remito_<n>_<fecha>.pdf`. Firma igual;
    `opciones.redondeoVistaPrevia` nuevo. Sigue usando helvetica (tildes y ñ OK).
16. `pdfGen.generarHojaRutaFile(resultado, { fechas, zonas })`: apaisada, agrupada por zona, columnas Orden / Cliente / Dirección /
    Importe / Saldo ant. / Total a cobrar / Efectivo / Transf. / Transf. a proveedor / Observaciones (las 4 ultimas vacias), totales al pie.
17. Resto de los PDF con tabla (resumen, faltantes, cierre de comisiones, cambios de precio, facturas a emitir, ingresos, estado de
    cuenta, pedido a proveedor, rendicion) usan `ESTILO_TABLA_COMPACTA`. La lista de clientes (para anotar a mano) queda como estaba.
18. `OrdenEntrega.js`: boton "Hoja de ruta (cobranza)" con las mismas fechas/zonas; `armarReparto` comun (mismo orden que los remitos);
    remitos con saldo anterior de `filasHojaRuta` (una sola vez por cliente, sin las deudas de los pedidos impresos) y vista previa del redondeo.
19. `TipoFacturaSelector`: ya no muestra "(sugerido por el IVA del cliente)" junto a "Sin factura" (solo con A/B sugerido); nota de que
    el remito impreso no cambia. Se mantiene el boton "Confirmar".
20. `components/ConfigRedondeo.js` + tarjeta en la pestaña Tienda de `Configuracion.js`: Sin redondeo / $500 / $1000 (default $500),
    solo admin, PIN, requiere conexion, guarda con `guardarRedondeo` (RPC `admin_guardar_redondeo`).
21. `Deudas.js`: los tres cobros (total, parcial, "Todo" del cliente) abren un modal con medio OBLIGATORIO (Efectivo / Transferencia,
    sin valor por defecto, "Confirmar cobro" deshabilitado hasta elegir) y referencia opcional (<= 60), validado con `validarCobro`.
    Historial por deuda con medio ("Sin dato" para pagos viejos) y panel "Cobrado por medio de pago" (`totalesPorMedio`).
    `cobrarDeuda` sin `medio` sigue funcionando en el repositorio (rendicion, compatibilidad); la obligatoriedad es de la UI.

## Tests
Nuevos: `utils/__tests__/pdfHojaRuta.test.js`, `pages/__tests__/deudas.medioPago.test.js`, `components/__tests__/ConfigRedondeo.test.js`;
AC-HRU-1/AC-RTO-5 en `ordenEntrega.zonas.test.js`; AC-RTO-1..6 y AC-RED-2 en `pdfBoleta011.test.js` (incluye AC-RTO-4: pedido de 120
renglones <= 3 hojas, 4 con el estilo anterior; `filasPorHoja` compacto >= ceil(1,3 x anterior)).
`// ADAPTADO` (nada borrado ni salteado): `boletaLayout.test.js`, `qaLote011.bordes.test.js` (bloque troquel -> AC-RTO-6),
`pdfBoleta011.test.js` (FAB-4 -> RTO-1, TRQ-1 -> RTO-6), `pdfRendicion.test.js` ("Deuda pendiente" -> "Saldo anterior"),
`ordenEntrega.zonas.test.js` y `entregado.ordenEntrega.test.js` (mock con `generarHojaRutaFile`), `facturacionAgrupar.test.js` y
`facturasAB.facturacion.test.js` (sin texto "sugerido" junto a Sin factura).

## Gates
`CI=true npx react-scripts test --watchAll=false`: 258 suites verdes (3640 tests). `npx react-scripts build`: Compiled successfully.

## Notas
- `console.log "2 units width could not fit page"` en el PDF de resumen es previo a este bloque (widths 180 en la tabla de resumen).
- `Facturacion.js` / `ListaPedidos.js` / `Armado.js` imprimen el remito con el saldo previo ya existente (`getDeudaPendienteParaPedido`),
  sin `redondeoVistaPrevia` (los facturados ya traen el multiplo congelado). Solo Orden de entrega muestra la vista previa de pendientes.

## Correcciones (seguridad + QA, tanda 2)
Ver seccion homonima en implementacion-A.md. Lado UI/PDF: sin cambios de pantalla; la hoja de ruta usa el monto pendiente real (S-T2-07)
y `Facturacion.marcarFacturado` limpia el redondeo previo y ajusta la deuda conservada al refacturar.
