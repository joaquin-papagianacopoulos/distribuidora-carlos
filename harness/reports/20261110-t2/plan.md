# Plan RUN 20261110-t2 — REQ-RTO, REQ-HRU, REQ-RED, REQ-DMP

## Supuestos y decisiones (conservadoras, anotadas)
- S1 (AC-RED-2, interpretacion): `total` (local y columna `pedidos.total`) sigue siendo la **suma de renglones** (campo legacy, regla 3). El total redondeado se guarda en `totalRedondeado` / `total_redondeado` y el ajuste en `redondeo`. Motivo: `cerrar_comisiones` (014, `_pedido_total_comision`) valida contra `pedidos.total`; si `total` pasara a redondeado, el servidor rechazaria cierres y las comisiones cambiarian. Asi "comisiones sobre renglones" sale gratis y las apps viejas que recalculan `total` desde items no rompen nada.
- S2: todo consumidor de "lo que se cobra" usa `totalACobrar(pedido)` (dominio). Se **deriva** de `total` + `redondeoMultiplo` congelado (no del `redondeo` guardado) para que una edicion desde una app vieja (que no conoce las claves) no deje un redondeo viejo.
- S3: el multiplo se **congela** en el pedido al facturar (`redondeoMultiplo`). Pedidos facturados antes de este cambio (sin la clave) nunca se redondean. Cambiar el ajuste no recalcula facturados. Editar items de un facturado recalcula con SU multiplo congelado. Revertir a pendiente limpia las 3 claves (null); re-facturar usa el ajuste vigente.
- S4: si `total > 0` y el redondeo daria `<= 0` (ej. $200 a $500), no se redondea (redondeo 0): nunca se regala un pedido ni se pierde la deuda. `redondearTotal` es matematica pura; esta regla vive en `aplicarRedondeoPedido`.
- S5: pedidos **pendientes** impresos (remito / hoja de ruta) muestran el redondeo de **vista previa** con el ajuste actual (no se guarda). Asi remito y hoja de ruta coinciden.
- S6 (AC-RTO-1): sin tipo guardado, `tipoFacturaEfectivo` devuelve `'ninguna'` (sugerido). `sugerirTipoFactura` queda exportada sin cambios (se puede mostrar como pista). El reporte "Facturas a emitir" (`armarReporteFacturas`) deja de usar la sugerencia: solo entran pedidos marcados A/B explicitamente (coherente con el selector). Riesgo: facturados viejos sin marca salen del reporte; se avisa en la UI ("pedidos sin marcar no se listan").
- S7: el reporte del contador (`admin_facturas_a_emitir`) **no se toca**: monto fiscal = renglones (el redondeo no es venta). Panel de ganancia (`panel.js`) tambien queda sobre renglones. Reportes de cobranza/ventas de la app (ListaPedidos, ReportesVentas, Deudas, hoja de ruta) usan `totalACobrar`.
- S8 (ajuste sincronizado): no hay tabla generica de ajustes; se reusa el singleton existente `tienda_config` (id=1) con columna nueva. Lectura publica por RPC sin PIN (dato no sensible); escritura solo por RPC con PIN de admin (`tienda_admin_ok`), online. Cache local en `localStorage['ajustesApp']` (default 500 si nunca bajo). Sin store nuevo => **DB_VERSION queda en 12**.
- S9 (AC-DMP-1): no existe historial por cobro; se agrega a la deuda `medioPago` (ultimo medio o `'mixto'`), `referenciaPago` y `cobros: [{id(uuid), montoCents, medio, referencia, at, por}]`. Totales por medio salen de `cobros`; deudas con `montoPagado>0` sin `cobros` cuentan como "sin dato". Cobros aplicados por Rendicion usan medio interno `'rendicion'` (no elegible en UI).
- S10: saldo anterior = deuda pendiente del cliente (`saldoDeuda` > 0) excluyendo la deuda del pedido actual **y** las de otros pedidos incluidos en la misma hoja de ruta (evita doble conteo con 2 pedidos del mismo cliente). Saldo a favor (REQ-REN) se sigue mostrando como hoy y no suma a "Total a cobrar".
- S11: el remito no tiene "localidad" (el cliente no tiene ese campo); se muestra `direccion` y, si hay, `zona`.
- Seguridad: sin datos nuevos expuestos a anon salvo `redondeo_total`; `medio_pago`/`referencia_pago` validados por CHECK (largo 60, csvSafe en UI); PIN nunca se guarda.

## Modelo de datos
| UI | Interno (IndexedDB) | Remoto | Nota |
|---|---|---|---|
| Redondeo ±$X | `pedido.redondeo` (number, puede ser <0) | `pedidos.redondeo numeric(14,2)` | snapshot al facturar |
| (ajuste congelado) | `pedido.redondeoMultiplo` 0/500/1000 | `pedidos.redondeo_multiplo int` | fuente de verdad del calculo |
| TOTAL | `pedido.totalRedondeado` | `pedidos.total_redondeado numeric(14,2)` | = total + redondeo |
| Subtotal | `pedido.total` (sin cambio) | `pedidos.total` | suma de renglones |
| Redondeo del total (Config) | `localStorage.ajustesApp.redondeoTotal` | `tienda_config.redondeo_total int default 500` | RPC |
| Medio de pago | `deuda.medioPago` | `deudas.medio_pago text` | efectivo/transferencia/mixto/rendicion |
| Referencia | `deuda.referenciaPago` | `deudas.referencia_pago text` | <= 60 |
| Historial de cobros | `deuda.cobros[]` | `deudas.cobros jsonb` (array) | ids UUID |

IndexedDB: sin stores nuevos ni indices, `DB_VERSION` = 12 (campos nuevos en objetos existentes; registros viejos sin la clave = legacy).

## Migracion `supabase/migrations/025_remito_redondeo_medio_pago.sql` (tolerante, idempotente)
1. Guardas `to_regclass('public.pedidos'|'public.deudas'|'public.tienda_config')`.
2. `pedidos`: `add column if not exists redondeo`, `redondeo_multiplo` (check in (0,500,1000)), `total_redondeado`. Sin backfill (null = legacy).
3. `deudas`: `medio_pago` (check null o en lista), `referencia_pago` (check char_length<=60), `cobros jsonb` (check null o array, <= 200 elementos).
4. `tienda_config`: `redondeo_total integer not null default 500 check (redondeo_total in (0,500,1000))`.
5. `public.ajustes_app_leer()` security definer, `returns jsonb {redondeo_total}`; grant execute anon, authenticated.
6. `public.admin_guardar_redondeo(p_admin_id text, p_admin_pin text, p_multiplo int)` con `tienda_admin_ok`; valida multiplo; devuelve `{ok, motivo}`; revoke public, grant anon/auth.
7. No toca `productos` (sin grants por columna), ni `cerrar_comisiones`, ni `admin_facturas_a_emitir`.

## Funciones puras nuevas (src/domain/)
`src/domain/redondeo.js` (nuevo)
- `MULTIPLOS_REDONDEO = [0, 500, 1000]`, `REDONDEO_DEFAULT = 500`
- `normalizarMultiplo(v) -> 0|500|1000` (invalido => 500 si undefined/null, 0 si 0, si no 500)
- `redondearTotal(total, multiplo) -> number` — en centavos: `floor(c/m + 0.5)*m`; mitad exacta hacia arriba (+inf, tambien en negativos: -250 a 0); multiplo 0/invalido => total con 2 decimales; no finito => 0.
- `aplicarRedondeoPedido(pedido, multiplo) -> { redondeo, redondeoMultiplo, totalRedondeado }` — aplica S4; no muta.
- `totalACobrar(pedido, { multiploVistaPrevia } = {}) -> number` — S2/S3/S5: con `redondeoMultiplo` congelado recalcula; facturado sin clave => `total`; pendiente => vista previa si se pasa multiplo.
- `desgloseTotalRemito(pedido, opts) -> { subtotal, redondeo, total }` (para el pie del remito).
- `alFacturar(pedido, multiplo)` / `alRevertirPendiente(pedido)` -> pedido nuevo con claves puestas / en null. Idempotente: si ya tiene `redondeoMultiplo` no lo cambia.
- `redondeoToRemote(p)` (solo claves conocidas, `!== undefined`), `redondeoFromRemote(r, local)`, `sinColumnas025(row)`, `nombraColumna025(error)` (patron 011/024).

`src/domain/cobranza.js` (nuevo)
- `saldoAnteriorCliente(deudas, pedido, { excluirPedidos = [] }) -> number` (reusa `deudaEsDePedido`/`saldoDeuda`, ignora anuladas).
- `filasHojaRuta(gruposZona, { deudas, multiploVistaPrevia, direccionDe }) -> { filas: [{zona, orden, clienteNombre, direccion, importe, saldoAnterior, totalACobrar}], totales: {pedidos, importe, saldoAnterior, totalACobrar} }` — `gruposZona` = salida de `calcularOrdenPorZona`; S10.
- `MEDIOS_PAGO = ['efectivo','transferencia']`, `ETIQUETA_MEDIO`.
- `validarCobro({ medio, referencia, monto }, deuda) -> { ok, errores, cobro }` (medio obligatorio; referencia opcional <=60, trim).
- `registrarCobroEnDeuda(deuda, cobro, { now, genId }) -> deuda` (suma `montoPagado`, agrega a `cobros`, `medioPago` = medio o `'mixto'`).
- `totalesPorMedio(deudas) -> { efectivo, transferencia, rendicion, sinDato }` (centavos).
- `deudaMedioToRemote(d)` / `deudaMedioFromRemote(r, local)` / `sinColumnasDmp(row)` / `nombraColumnaDmp(error)`.

Cambios en dominio existente
- `boletaLayout.js`: `encabezadoComprobante() -> 'REMITO'` (reemplaza a `encabezadoTipoFactura` en pdfGen; esta se conserva exportada). `ESTILO_TABLA_COMPACTA` (fontSize 8, cellPadding vertical 0.8 mm) y `ESTILO_TABLA_ANTERIOR` (fontSize 9, padding 2) como constantes; `altoFilaMm(estilo)` y `filasPorHoja({ pageH, startY, bottom, estilo })`. `layoutPieBoleta` pierde troquel: devuelve `subtotalY, redondeoY, totalesY, saldoAnteriorY, totalCobrarY, itemsY, obsY` sin `casillas/corteY` (corte = margen inferior).
- `gruposFactura.js`: `numerarFilasBoleta(filas) -> { filas: [...{nro}], items: N }` — `nro` solo en filas `tipo !== 'detalle'` (grupo REQ-AGR y linea REQ-GBU cuentan 1).
- `facturacionAB.js`: `tipoFacturaEfectivo` default `'ninguna'`; `armarReporteFacturas` sin sugerencia (S6).
- `precios.js`: sin cambio (`totalesBoleta` sigue sobre items).

## Archivos en orden

### Bloque A — dominio + redondeo + deudas + migracion
1. `supabase/migrations/025_remito_redondeo_medio_pago.sql` — REQ-RED, REQ-DMP.
2. `src/domain/redondeo.js` + `src/domain/__tests__/redondeo.test.js` — AC-RED-1/2.
3. `src/domain/cobranza.js` + `src/domain/__tests__/cobranza.test.js` — AC-RTO-5, AC-HRU-1, AC-DMP-1.
4. `src/domain/gruposFactura.js` (`numerarFilasBoleta`) + test en `grupos.numeracion.test.js` — AC-RTO-3.
5. `src/domain/facturacionAB.js` — AC-RTO-1 (default Sin factura).
6. `src/services/ajustesService.js` (nuevo): `leerRedondeoLocal()`, `bajarAjustes()` (RPC `ajustes_app_leer`, tolera falta de migracion => conserva cache), `guardarRedondeo(pin, multiplo)` — AC-RED-1.
7. `src/hooks/useAppContext.js` — llamar `bajarAjustes()` en el ciclo de sync (no bloqueante) y exponer `redondeoTotal` — AC-RED-1.
8. `src/sync/syncService.js` — `pedidoToRemoteRow`/`mapPedidoRemoto` con `redondeoToRemote/FromRemote`; `conFallbackEntrega` reintenta sin columnas 025; `syncDeudas` sube/baja `medio_pago, referencia_pago, cobros` con reintento sin ellas si faltan (aviso unico) — AC-RED-2, AC-DMP-1.
9. `src/services/pedidoRepository.js` — `toRemoteRow` + fallback 025 (igual que 011/024) — AC-RED-2.
10. `src/services/deudaRepository.js` — `registrarDeudaFacturado` usa `totalACobrar`; `actualizarMontoDeudaDePedido(pedido, nuevoTotal)` recibe ya `totalACobrar`; `cobrarDeuda(deuda, monto, por, { medio, referencia })` y `cobrarTodoDelCliente(..., { medio, referencia })` via `registrarCobroEnDeuda`; `deshacerCobros` limpia `cobros/medioPago/referenciaPago`; `cobrarLocal` (rendicion) medio `'rendicion'` — AC-RED-2, AC-DMP-1.
11. `src/pages/Facturacion.js` (solo logica): `marcarFacturado` aplica `alFacturar(p, redondeoTotal)`; `marcarPendiente` aplica `alRevertirPendiente`; guardar edicion recalcula con `aplicarRedondeoPedido(p, p.redondeoMultiplo)` si esta congelado y llama `actualizarMontoDeudaDePedido(p, totalACobrar(p))`; lista muestra `totalACobrar` — AC-RED-2.
12. `src/pages/Armado.js` (lineas ~710-722 y ~1027): mismo recalculo y monto de deuda — AC-RED-2.
13. `src/pages/ListaPedidos.js` (167, 336, 511), `src/pages/ReportesVentas.js` (46), `src/pages/Rendicion.js` (190): mostrar/sumar `totalACobrar` — AC-RED-2.

### Bloque B — PDF remito + hoja de ruta + UI
14. `src/domain/boletaLayout.js` — estilos compactos, `filasPorHoja`, pie sin troquel — AC-RTO-4/6.
15. `src/utils/pdfGen.js` `buildFacturaDoc`: titulo "REMITO" + "REMITO N° 000123"; sin "FACTURA A/B"; debajo del cliente `direccion` (+ `Zona: X`); "Vendedor: X" en bold 16 (= cliente); columna "N°" (`numerarFilasBoleta`) y "Items: N" al pie; `ESTILO_TABLA_COMPACTA`; pie "Subtotal / Redondeo ±$X / TOTAL" (solo con redondeo != 0, si no solo TOTAL) usando `desgloseTotalRemito`; "Saldo anterior: $X" + "Total a cobrar: $Y" si saldo > 0 (reemplaza "Deuda pendiente"); se borra el troquel. Firma igual; `opciones.redondeoVistaPrevia` opcional. Archivo `remito_<n>_<fecha>.pdf` — AC-RTO-1..6, AC-RED-2.
16. `src/utils/pdfGen.js` `generarHojaRutaFile(resultado, { fechas, zonas })` (nuevo): tabla Orden | Cliente | Direccion | Importe | Saldo ant. | Total a cobrar | Efectivo | Transf. | Transf. a prov. | Obs., agrupada por zona, totales al pie, apaisado, estilo compacto — AC-HRU-1, AC-RTO-6.
17. `src/utils/pdfGen.js` resto de PDFs con tabla (`buildResumenDoc`, faltantes, cierre comisiones, cambios de precio, facturas a emitir, ingresos, estado de cuenta, pedido proveedor, rendicion): `styles` -> `ESTILO_TABLA_COMPACTA` (excepto lista de clientes, que es para anotar a mano) — AC-RTO-4.
18. `src/pages/OrdenEntrega.js` — boton "Hoja de ruta" (mismas fechas/zonas) con `filasHojaRuta` + `generarHojaRutaFile`; remitos con `saldoAnteriorCliente` (excluye pedidos impresos) y `redondeoVistaPrevia` — AC-HRU-1, AC-RTO-5.
19. `src/pages/Facturacion.js` (UI): selector A/B con default "Sin factura"; texto aclaratorio de que no cambia el impreso; impresion via `cuentaBoleta` con saldo anterior — AC-RTO-1/5.
20. `src/components/ConfigRedondeo.js` (nuevo) + `src/pages/Configuracion.js` (admin, dentro de la pestaña existente `tienda` como tarjeta "Remito" para no agregar pestañas): radio Sin redondeo / $500 / $1000, PIN, requiere conexion — AC-RED-1.
21. `src/pages/Deudas.js` — modal de cobro (total/parcial/todo del cliente) con medio obligatorio (botones Efectivo/Transferencia) y referencia opcional; historial muestra medio ("sin dato" si falta) y totales por medio (`totalesPorMedio`) — AC-DMP-1.

## Donde se usa el total (verificado con Grep) y que pasa
| Lugar | Uso | Cambio |
|---|---|---|
| `domain/comisiones.js` 608/776/888, `cerrar_comisiones` (014) | comision | ninguno (sigue `total` = renglones) |
| `domain/rendicion.js` topes de credito | renglones | ninguno |
| `domain/panel.js` | ventas/ganancia | ninguno (S7) |
| `facturacionAB.js` / `admin_facturas_a_emitir` | reporte contador | ninguno en monto (S7) |
| `deudaRepository.registrarDeudaFacturado` / `actualizarMontoDeudaDePedido` | deuda | `totalACobrar` |
| `Facturacion.js` 843/852/1376, `Armado.js` 710/722/1027 | edicion / lista | recalculo + `totalACobrar` |
| `ListaPedidos.js` 167/336/511, `ReportesVentas.js` 46, `Rendicion.js` 190 | vista/suma | `totalACobrar` |
| `pdfGen` remito, hoja de ruta | impreso | `desgloseTotalRemito` / `filasHojaRuta` |
| `PedidosWeb.js`, `NuevoPedido.js`, `pedidosWeb.js` | pendientes | ninguno (no facturados) |

## Concurrencia offline / multidispositivo
- Redondeo: calculo determinista desde `total` + multiplo congelado => dos dispositivos que editan el mismo pedido llegan al mismo `totalACobrar`; `alFacturar` idempotente (no recongela). Pedido sigue LWW por fila como hoy (con `remoteUpdatedAt` de AC-EDP-3). Apps viejas no mandan las claves 025 (PostgREST no pisa columnas ausentes).
- Ajuste: config online + PIN; cada dispositivo usa su cache al facturar offline; el multiplo congelado en el pedido evita recalculos posteriores. Riesgo residual: dispositivo offline con cache vieja factura con el multiplo anterior (aceptado y documentado).
- Deudas: fila LWW como hoy (proteccion `RECENT_LOCAL_PROTECTION_MS`). `cobros[]` con UUID permite detectar duplicados; al bajar, si el local tiene cobros sin subir se conserva (regla actual). No se agrega merge nuevo (fuera de alcance; no empeora lo existente).
- Columnas faltantes: push de pedidos y deudas reintenta sin columnas 025, solo limpia `synced/pendingSync` de lo subido, aviso unico en consola.
- Stock: ningun cambio; redondeo no genera movimientos (ledger intacto).

## Plan de pruebas
| AC | Test | Tipo |
|---|---|---|
| AC-RED-2 `redondearTotal` | `redondeo.test.js`: 0, negativos (-250->0, -251->-500), mitad exacta (1250->1500 con 500; 1500->2000 con 1000), 1249->1000, sin redondeo (0/undefined/'x'), decimales (1249.99), no finito | unidad |
| AC-RED-2 pedido | `aplicarRedondeoPedido` (S4: 200 -> sin redondeo), `alFacturar` idempotente, `alRevertirPendiente`, `totalACobrar` (legacy facturado, congelado tras editar items, pendiente con vista previa), to/fromRemote tolerante | unidad |
| AC-RED-2 deuda | `deudaRepository.redondeo.test.js`: deuda = totalACobrar; editar facturado ajusta deuda con multiplo congelado | servicio (mock db) |
| AC-RED-2 comisiones | test: pedido con redondeo => `calcularComisiones` igual que sin redondeo | unidad |
| AC-RED-1 | `ajustesService.test.js` (RPC ok / falta migracion => cache / PIN malo); `ConfigRedondeo.test.js` (default 500, guarda) | servicio + RTL |
| AC-RTO-1 | `pdfBoleta011` reescrito: titulo "REMITO" siempre, nunca "FACTURA A/B" aun con tipo A; `facturacionAB.test` default `'ninguna'`; `facturasAB.facturacion.test` selector "Sin factura" | pdf mock + unidad + RTL |
| AC-RTO-2 | pdf: direccion y zona bajo el nombre; "Vendedor:" con fontSize >= el del cliente (espia `setFontSize`) | pdf mock |
| AC-RTO-3 | `numerarFilasBoleta`: grupo AGR = 1, linea GBU = 1, detalle sin nro, vacio => 0; pdf: "Items: N" | unidad + pdf |
| AC-RTO-4 | `boletaLayout.test`: `filasPorHoja(COMPACTA) >= ceil(1.3 * filasPorHoja(ANTERIOR))` en A4 con startY 28; pedido de 120 renglones => paginas compacto <= paginas anterior / 1.3 (redondeo arriba); `altoFilaMm(COMPACTA) >= fontSize mm` (sin superponer); pdf: autoTable recibe `ESTILO_TABLA_COMPACTA` en remito y en otro PDF (resumen) | unidad + pdf |
| AC-RTO-5 | `saldoAnteriorCliente` (excluye propio pedido, excluye pedidos de la hoja, ignora anuladas/pagadas); pdf: con saldo => "Saldo anterior" + "Total a cobrar" = total + saldo; sin saldo => ninguno; `pdfRendicion.test` actualizado ("Saldo anterior" en vez de "Deuda pendiente") | unidad + pdf |
| AC-RTO-6 | pdf: no aparece "Efectivo", "Transf. a proveedor", "Proveedor:" ni linea de corte; `layoutPieBoleta` sin `casillas` y boleta larga sin solapamiento | unidad + pdf |
| AC-HRU-1 | `cobranza.test`: `filasHojaRuta` (zonas, orden, importe con redondeo, saldo, total, totales, pedido sin cliente, 2 pedidos mismo cliente); pdf hoja de ruta: encabezados con las 3 columnas de cobro y fila de totales; `ordenEntrega.zonas.test` + boton | unidad + pdf + RTL |
| AC-DMP-1 | `validarCobro` (sin medio => error), `registrarCobroEnDeuda` (mixto), `totalesPorMedio` (sin dato); `syncDeudas` sin columna => reintenta sin ella; `Deudas` page: cobrar exige medio, historial muestra medio y "sin dato" | unidad + servicio + RTL |

Tests existentes que cambian: `domain/__tests__/boletaLayout.test.js` (AC-FAB-4 encabezado -> REMITO; AC-TRQ-1 casillas -> ausencia + layout compacto), `domain/__tests__/qaLote011.bordes.test.js` (TRQ 100-125 se reescriben; AC-FAB-3 lineas 38-60 si dependen de la sugerencia), `domain/__tests__/facturacionAB.test.js` (lineas 27-28 default), `utils/__tests__/pdfBoleta011.test.js` (FAB-4 y TRQ-1), `utils/__tests__/pdfRendicion.test.js` (texto de deuda), `utils/__tests__/pdfGen.smoke.test.js` (nombre de archivo si lo verifica), `pages/__tests__/facturasAB.facturacion.test.js` (default), `pages/__tests__/ordenEntrega.zonas.test.js` y `entregado.ordenEntrega.test.js` (mock de `generarFacturaFile` + `generarHojaRutaFile`). Se dejan en el commit con nota "modifica AC-FAB-1/4, AC-TRQ-1 por AC-RTO-1/6".

Gates: `CI=true npx react-scripts test --watchAll=false`, `npx react-scripts build`, `node harness/gates/run-gates.mjs` al final de cada bloque.
