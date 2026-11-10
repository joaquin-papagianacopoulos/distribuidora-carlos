# Implementacion BLOQUE A — RUN 20261110-t2 (REQ-RED, REQ-DMP, base de REQ-RTO/REQ-HRU)

## Hecho (pasos 1 a 13 del plan)
1. `supabase/migrations/025_remito_redondeo_medio_pago.sql` (NO aplicada en ninguna base): idempotente, guardas `to_regclass`,
   `pedidos.redondeo/redondeo_multiplo/total_redondeado`, `deudas.medio_pago/referencia_pago/cobros jsonb`,
   `tienda_config.redondeo_total` (default 500), `ajustes_app_leer()` (publica) y `admin_guardar_redondeo()` (PIN admin con
   `verificar_pin`, id invalido => no_autorizado antes del PIN, `search_path` fijo, revoke public + grant anon/authenticated).
   Constraints `not valid` (no rompen filas existentes). No toca productos, cerrar_comisiones ni admin_facturas_a_emitir.
2. `src/domain/redondeo.js`: `redondearTotal`, `normalizarMultiplo`, `aplicarRedondeoPedido`, `totalACobrar`,
   `desgloseTotalRemito`, `alFacturar`, `alRevertirPendiente`, `recalcularRedondeoCongelado` (extra del plan),
   `redondeoToRemote/FromRemote`, `sinColumnas025`, `nombraColumna025`.
3. `src/domain/cobranza.js`: `saldoAnteriorCliente`, `filasHojaRuta`, `MEDIOS_PAGO`, `validarCobro`, `registrarCobroEnDeuda`,
   `totalesPorMedio`, `deudaMedioToRemote/FromRemote`, `sinColumnasDmp`, `nombraColumnaDmp`.
4. `gruposFactura.numerarFilasBoleta` (AC-RTO-3).
5. `facturacionAB.tipoFacturaEfectivo`: default `'ninguna'`. `armarReporteFacturas` NO se toca: sigue sugiriendo por IVA a los
   facturados viejos sin marca (aclaracion del SPEC; se corrige el supuesto S6 del plan).
6. `src/services/ajustesService.js`: `leerRedondeoLocal` (default 500), `bajarAjustes` (tolera offline/falta de migracion),
   `guardarRedondeo(pin, multiplo)` (solo admin, online, PIN no se guarda).
7. `useAppContext`: baja ajustes en cada sync (no bloqueante) y expone `redondeoTotal` / `setRedondeoTotal`.
8. `syncService`: pedidos suben/bajan claves 025; `conFallbackEntrega` ahora reintenta en lazo sin las columnas 025/024/011 que
   falten (aviso unico); `syncDeudas` sube/baja `medio_pago, referencia_pago, cobros` y reintenta sin ellas si faltan.
9. `pedidoRepository`: `toRemoteRow` con 025 y fallback sin columnas.
10. `deudaRepository`: deuda = `totalACobrar`; `cobrarDeuda(deuda, monto, por, { medio, referencia })` y `cobrarTodoDelCliente`
    registran el cobro con UUID; `deshacerCobros` limpia historial/medio; rendicion usa medio interno `'rendicion'`.
11. `Facturacion.js` (logica): facturar => `alFacturar(p, redondeoTotal ?? leerRedondeoLocal())`; revertir => `alRevertirPendiente`;
    editar => `recalcularRedondeoCongelado` + deuda con `totalACobrar`; la lista muestra `totalACobrar`.
12. `Armado.js`: mismo recalculo y monto de deuda; lista con `totalACobrar`.
13. `ListaPedidos.js`, `ReportesVentas.js`, `Rendicion.js`: muestran/suman `totalACobrar`.

## Decisiones
- `pedido.total` sigue = suma de renglones (comisiones y panel intactos). El redondeado vive en `totalRedondeado`.
- Pedidos facturados antes (sin `redondeoMultiplo`) nunca se redondean. Si el redondeo dejara un pedido > 0 en <= 0, no se redondea.
- `cobrarDeuda` SIN `medio` conserva el cobro de siempre (queda "sin dato"): la obligatoriedad del medio la fuerza la UI de
  `Deudas.js` (bloque B). Con `medio` invalido lanza error y no cobra.
- Hoja de ruta: el saldo anterior de un cliente se cuenta una sola vez (primer pedido del cliente en la hoja).
- `TipoFacturaSelector` sigue mostrando "(sugerido por el IVA del cliente)" con el valor "Sin factura": texto a corregir en B.

## Tests nuevos
`redondeo.test.js`, `cobranza.test.js`, `grupos.numeracion.test.js`, `migracion025.sql.test.js` (incluye delimitadores `$` pareados),
`services/__tests__/{ajustesService,deudaRepository.redondeo,syncDeudas.medioPago,syncPedidos025}.test.js`.

## Tests viejos adaptados (// ADAPTADO, nada borrado ni salteado)
- `domain/__tests__/facturacionAB.test.js` (default sin marca = 'ninguna').
- `components/__tests__/facturacionAgrupar.test.js` y `pages/__tests__/facturasAB.facturacion.test.js` (selector arranca en "Sin factura").

## Gates
`CI=true npx react-scripts test --watchAll=false`: todo verde (tras el ultimo ajuste de test). `npx react-scripts build`: OK.

## Para el bloque B
Usar `totalACobrar`, `desgloseTotalRemito`, `numerarFilasBoleta`, `filasHojaRuta`, `saldoAnteriorCliente`, `validarCobro`,
`totalesPorMedio`, `guardarRedondeo`, `leerRedondeoLocal`, `redondeoTotal` (contexto).

## Correcciones (seguridad + QA, tanda 2)
- S-T2-01: `syncDeudas` reintenta sin columnas 025 solo si `esColumnaInexistente(error) && nombraColumnaDmp(error)`; un CHECK u otro error no marca la deuda como subida y se avisa (se relanza al final).
- S-T2-02: migracion 025 suma `octet_length(cobros::text) <= 60000` al CHECK `deudas_cobros_formato` (sin aplicar).
- S-T2-03: `unirCobrosDeuda` (cobranza.js): union por id de cobro, `montoPagado` recalculado (cobros + pagos viejos sin historial, tope = monto). Se usa al subir (lee la fila remota antes de pisarla) y al bajar (cambio local sin subir con cobros: une y deja la union pendiente de subir). `deshacerCobros` (cobros vacios) no resucita cobros.
- S-T2-06: `redondeoFromRemote` limpia las 3 claves si la fila remota no esta facturada; `marcarFacturado` parte de `alRevertirPendiente`.
- S-T2-07: importe de un pedido con deuda en la hoja = `min(totalACobrar, saldoDeuda)` (descuenta cobros parciales); saldo por `clienteId` (el match por nombre queda solo para deudas legacy sin `clienteId`).
- BUG-1: `totalesPorMedio` suma a `sinDato` lo que `montoPagado` supera al historial. BUG-2: `validarCobro` rechaza montos que en centavos son 0.
- Refacturar un pedido revertido que conservo deuda con cobros: la deuda acompana el nuevo `totalACobrar` sin tocar lo cobrado.
- Pendientes (Bajos): S-T2-04/05 (auth real, S-1110-01), S-T2-08 (bloqueo de PIN por RPC).
Tests: `seguridadT2.test.js`, `syncDeudas.seguridadT2.test.js`. Suite 262/262 verde, build OK.
