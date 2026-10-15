# Implementación RUN 20261015-1630 — REQ-REN (Rendición)

Gates `--fast`: unit-tests, coverage-domain, traceability, secret-scan y security-rules en **verde**. Build no corrido (fuera de `--fast`).

## Ítems del plan → estado
| # | Ítem del plan | Estado | Archivos / tests |
|---|---|---|---|
| 1 | Migración 014 (tablas, RLS sin policies, RPC con PIN, CHECK NOT VALID, trigger de cabecera, comisiones) | Hecho | `supabase/migrations/014_lote_operacion_rendicion.sql` · `migracion014.sql.test.js` |
| 2 | `stock.js`: tipo `devolucion`, `esRefRendicion`, `refRendicion`, `idRendicionDeRef` | Hecho | `rendicion.test.js` |
| 3 | `domain/rendicion.js` (todas las funciones de §3) | Hecho (100 % de líneas) | `rendicion.test.js` (31 tests) |
| 4 | `comisiones.js`: `baseRubrosPedido(..., { extras })`, `pedidoNetoParaComision`, `armarDashboard({ rendiciones })` | Hecho | `comisiones.rendicion.test.js` |
| 5 | `db/index.js` v10→11: stores `rendiciones`, `cuentaClientes`; `addRendicionConMovimientos` (1 transacción) | Hecho | `migracionV11.test.js`; V5..V10 y `security.comisiones.iter2` ajustados (MOD) |
| 6 | `syncStock` retiene `rendicion:*` hasta que la rendición esté `confirmada` | Hecho | `stockService.test.js` (3 tests nuevos) |
| 7 | `services/rendicionService.js` (registrar, subir, efecto 1 vez, anular online, bajar con cursor) | Hecho | `rendicionService.test.js` (17 tests) |
| 8 | `deudaRepository.js` aditivo (cobros, deuda de cargo/reversión con anti-duplicado, anular/ajustar cargo) | Hecho | `deudaRepository.rendicion.test.js` |
| 9 | `pdfGen.js`: `opciones.saldoAFavor` en la boleta y `generarRendicionDiaFile` | Hecho | `pdfRendicion.test.js` |
| 10 | `pages/Rendicion.js` + pestaña en `App.js` (solo `isAdmin`) | Hecho | `rendicion.page.test.js`, `app.stockBajo.test.js` (AC-REN-1) |
| 11 | Facturación: boleta con `cuentaParaBoleta`; bloqueo revertir/borrar/editar con rendición vigente | Hecho | `rendicion.facturacion.test.js` |
| 11b | ListaPedidos: bloqueo de "Borrar pedido" facturado con rendición vigente (extra) | Hecho | `listaPedidos.rendicion.test.js` |
| 12 | `comisionesService`: pasa rendiciones **confirmadas** a `armarDashboard` | Hecho | `comisionesService.rendicion.test.js` |
| — | `cursorCompras.js`: parámetro `tablas` (aditivo) + `TABLAS_CURSOR_RENDICION` | Hecho | `cursorCompras.test.js` |

## Decisiones / puntos para el auditor
- **Movimientos**: ref `rendicion:<uuid>` (nunca `pedido:*`); ids `<id>:<idx>:a` / `:x`. Merma (`vuelveAlStock:false`) no mueve stock pero acredita.
- **CHECK** de `movimientos_stock` reemplazados con `drop constraint if exists` + `add ... not valid` (3). `anulacion < 0` solo con ref `rendicion:`. Trigger nuevo: `devolucion` exige ref de rendición; ref `rendicion:*` exige cabecera; `anulacion` exige rendición `anulada`.
- **cerrar_comisiones**: copia textual de la 005 (última definición; ninguna migración posterior la redefine). Solo cambian las 2 expresiones de total (5a y 6a) por `_pedido_total_comision`. El test lo verifica: `c14 === c05.replace(viejo, nuevo)`. `comision_rubro_base` se redefine con `union all` de `comision_renglones` vigentes (5b y 6b lo heredan).
- **Efecto en la cuenta (AC-REN-3)**: solo el dispositivo creador (`creadaAqui`), solo con la rendición `confirmada`, y solo si gana el reclamo `admin_rendicion_efecto` (`efecto is null`). Reclamo antes de aplicar ⇒ nunca doble; riesgo residual: corte entre reclamo y aplicación local ⇒ efecto perdido (queda anotado en el servidor).
- **Rechazo del servidor** (p. ej. `cantidad_excedida` por otro dispositivo): se generan los `:x` locales (neto 0) y nada queda pendiente.
- **Anulación**: online-only; `bajarRendiciones` antes (efecto fresco); el ganador genera `:x` siempre (forzado) y revierte la plata con asientos/deudas compensatorias (`favor:x`, `cargo:x`, "Reversión rendición #xxxx"); la deuda de cargo sin cobros se anula como `quitarDeudaDePedido`; con cobros parciales se baja su monto a lo cobrado y lo cobrado vuelve como saldo a favor. `ya_anulada` ⇒ solo stock (ids idénticos).
- **Comisiones**: el cliente usa solo rendiciones `confirmadas` (igual que el servidor) ⇒ sin `montos_inconsistentes` por pendientes locales.
- **Boleta**: si el cliente tiene saldo a favor se netea con la deuda; sin saldo la llamada a `generarFacturaFile` queda idéntica a la anterior.
- **Requisito**: la rendición exige pedido facturado, no borrado, con `remoteId` y `clienteId` (S1).
- `deudas` (tabla legacy, anon) solo recibe `Rendición #<8 chars>` en `pagadaPor`/concepto (D3).

## Pendiente / fuera de alcance
- S6 "Aplicar saldo a favor" en Deudas (manual): no implementado (AC-REN-3 solo exige mostrarlo).
- Aplicar la 014 a mano en Supabase (después de 005, 011, 012). Sin la 014 la app guarda local y avisa `falta_migracion`.
- `Facturacion.js` tiene avisos de hooks preexistentes (no introducidos en esta corrida).

## Vuelta 2 (S-REN-01..06, riesgo QA 1)
- 014: `tg_movimiento_rendicion_con_cabecera` ahora `security definer set search_path = public, pg_temp` (sin execute para anon) y valida id `<uuid>:<idx>:a|x`, producto, tipo, signo y cantidad contra el renglon `<idx>` (merma no mueve; `:x` solo con rendicion anulada). Trigger `before insert or update`.
- 014: `admin_rendiciones_guardar` recalcula credito (devolucion = entra, cambio = entra - sale), exige `credito_comision_cents = credito_cents`, precio del renglon <= menor precio facturado, y topa la suma de creditos vigentes al total del pedido para todo tipo (`credito_inconsistente` / `monto_excedido`).
- 014: `admin_rendicion_efecto` (alta) exige `estado='vigente'`.
- 014: `admin_cuenta_clientes_guardar`: saldo_favor exige rendicion del mismo cliente y |monto| <= |credito|; uso_saldo negativo y <= saldo disponible (lock por cliente).
- Dominio: `topeCreditoPedidoCents` + tope en devoluciones/cambios; `MOTIVOS_RECHAZO.credito_inconsistente`.
- Tests: `src/__tests__/security.rendicion.run1630.test.js` (todos -> 7 tests reales), `src/domain/__tests__/rendicion.tope.test.js`. Gates --fast en verde.
