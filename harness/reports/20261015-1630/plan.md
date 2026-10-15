# Plan RUN 20261015-1630 — REQ-REN (Rendición: devoluciones, cambios y notas de crédito)

Alcance: AC-REN-1..6. Contexto: REQ-STK (ledger), AC-COM-13/AC-COMR-14 (ajustes), REQ-FAB (A/B), principios del lote.

## 1. Decisiones de diseño (resumen)
- **Rendición = documento inmutable** (UUID). Se crea una vez; el único cambio posterior es `estado: vigente → anulada` (con motivo). Nada se borra.
- **Stock**: movimientos nuevos en `movimientosStock` con `ref = rendicion:<uuid>` (NUNCA `pedido:*`: `revisarMovimientosPedido` reconcilia por ref de pedido y "corregiría" la devolución). Tipo nuevo `devolucion` (+). En cambio, el producto que sale va como `venta` (−). Merma: renglón con `vuelveAlStock:false` ⇒ sin movimiento, se registra en la rendición.
- **IDs deterministas derivados del UUID** para movimientos y asientos de cuenta: `<rendId>:<idx>:a` (alta) y `<rendId>:<idx>:x` (anulación). Cualquier dispositivo que (re)genere los movimientos produce los mismos ids ⇒ upsert por id no duplica (AC-REN-2). Largo ≤ 64 (CHECK de 002).
- **Plata (AC-REN-3)**: crédito neto en centavos `creditoCents` (+ a favor del cliente, − a cargo). Efecto sobre `deudas` (tabla legacy) se aplica UNA vez, recién cuando el servidor confirmó la rendición, por el dispositivo que la creó: cobros parciales sobre las deudas más viejas (`pagadaPor: 'Rendición #xxxx'`); el resto ⇒ asiento `saldo_favor` en ledger privado `cuentaClientes`. Cargo (diferencia del cambio a pagar) ⇒ deuda nueva (`addDeuda`, concepto `Cambio rendición #xxxx`).
- **Anulación (AC-REN-4)**: solo online, vía RPC atómica (`vigente→anulada` gana un solo dispositivo). El ganador genera: movimientos compensatorios (ids `:x`), asiento compensatorio del saldo a favor (id `<rendId>:favor:x`), deuda nueva `Reversión rendición #xxxx` por lo aplicado a deudas (aditivo, no se reescriben cobros), y anula la deuda de cargo si no tiene cobros (patrón `quitarDeudaDePedido`); si ya se cobró, asiento `saldo_favor` por lo cobrado.
- **Comisiones (AC-REN-5)**: cada rendición congela `comisionRenglones: [{rubroClave, rubro, subtotalCents}]` (negativos por devolución/NC, positivo por lo que sale en el cambio) y `creditoComisionCents`. Cliente y servidor usan esos números congelados (el servidor no recalcula prorrateos). Pedido no cerrado ⇒ baja la base del período; pedido cerrado ⇒ aparece como ajuste pendiente por el mecanismo existente (total/base actual − cerrado).

## 2. Modelo de datos

### IndexedDB (`src/db/index.js`) — `DB_VERSION` 10 → 11, solo se AGREGAN stores
| Store | keyPath | Índices | Notas |
|---|---|---|---|
| `rendiciones` | `id` (UUID) | `pedidoId`, `clienteId`, `fecha`, `estado` | cabecera+renglones; `pendingSync`, `updatedAt`, `efectoAplicado`, `efecto`, `syncError` |
| `cuentaClientes` | `id` (determinista o UUID) | `clienteId`, `rendicionId` | ledger privado de saldo a favor; solo se agregan filas |
`movimientosStock` no cambia de estructura (tipo nuevo `devolucion`).

### Supabase — `supabase/migrations/014_lote_operacion_rendicion.sql` (idempotente, sin drop de datos)
- `public.rendiciones`: `id uuid pk`, `pedido_id text not null`, `cliente_id text`, `cliente_nombre text`, `fecha date`, `tipo text check in ('devolucion','cambio','nc')`, `renglones jsonb`, `credito_cents bigint`, `credito_comision_cents bigint`, `comision_renglones jsonb`, `tipo_factura text check in ('A','B') or null`, `nro_nc text (≤30)`, `motivo text (≤300)`, `efecto jsonb`, `estado text check in ('vigente','anulada')`, `anulada_at`, `anulada_por`, `motivo_anulacion`, `usuario`, `created_at`, `updated_at`, `synced_at` (trigger `tg_compras_synced_at` de 012). Índices `(synced_at,id)`, `(pedido_id)`.
- `public.cuenta_clientes`: `id text pk (≤64)`, `cliente_id text`, `rendicion_id uuid null`, `tipo text check in ('saldo_favor','uso_saldo')`, `monto_cents bigint` (check abs ≤ tope), `fecha`, `usuario`, `synced_at`.
- Ambas: `enable row level security`, **sin políticas**, `revoke all from anon, authenticated`. Trigger de inmutabilidad en `rendiciones`: solo permite el update de los campos de anulación y `efecto`; prohíbe `anulada→vigente`.
- `movimientos_stock`: drop/re-add `NOT VALID` de `movimientos_stock_tipo_check` (+`devolucion`), `movimientos_signo_chk` (`devolucion` > 0; `anulacion` < 0 solo si `ref ~ '^rendicion:'`; resto igual), `movimientos_ref_chk` (+prefijo `rendicion`). Trigger nuevo `tg_movimiento_rendicion_con_cabecera`: ref `rendicion:*` exige fila en `rendiciones` (igual que ingreso/cabecera de 002).
- RPC `security definer` + `_es_admin_con_pin` (011): `admin_rendiciones_guardar(p_admin_id,p_admin_pin,p_lote jsonb)` (insert `on conflict (id) do nothing`; valida cantidades ≤ facturado − devuelto vigente contra `public.pedidos.items`, Σ`comision_renglones` = −`credito_comision_cents`, topes; devuelve `{ok, confirmados[], rechazados[{id,motivo}]}`), `admin_rendicion_anular(p_admin_id,p_admin_pin,p_id,p_motivo)` (→ `{ok, ya_anulada}`), `admin_rendicion_efecto(…, p_id, p_efecto)` (solo si `efecto is null`), `admin_cuenta_clientes_guardar(…, p_lote)` (`on conflict do nothing`), `admin_rendiciones_bajar(…, p_cursor)` (paginado `(synced_at,id)` para ambas tablas, 1000 filas).
- Comisiones: helper `_pedido_total_comision(pid)` = `greatest(p.total − Σ credito_comision_cents vigentes/100, 0)`; `create or replace comision_rubro_base` = base actual `union all` `comision_renglones` de rendiciones vigentes (agrupado por clave); `create or replace cerrar_comisiones` copiando la versión de 005 y cambiando SOLO los `p.total` de 5a/6a por el helper. Mismos grants/revokes que 005.
- No toca `productos` (regla 8 no aplica).

### Mapeo UI → interno → remoto
| UI | Interno (IndexedDB) | Remoto |
|---|---|---|
| Pedido (buscar cliente/n.º/fecha) | `pedidoId` (= `pedido.remoteId`, string) | `pedido_id` |
| Tipo: Devolución/Cambio/Nota de crédito | `tipo` `devolucion`/`cambio`/`nc` | `tipo` |
| Producto/cantidad devuelta | `renglones[{productoId,nombre,cantidad,precioCents,vuelveAlStock,sentido:'entra'}]` | `renglones` jsonb |
| Producto que sale (cambio) | `renglones[{…, sentido:'sale', precioCents}]` | `renglones` |
| "No vuelve al stock (roto/vencido)" | `vuelveAlStock:false` (merma) | idem |
| Monto NC | `creditoCents` | `credito_cents` |
| Factura A/B · n.º NC | `tipoFactura` · `nroNc` | `tipo_factura` · `nro_nc` |
| Motivo / Motivo de anulación | `motivo` / `motivoAnulacion` | `motivo` / `motivo_anulacion` |
| Saldo a favor (boleta) | Σ `cuentaClientes.montoCents` del cliente | `cuenta_clientes` |

## 3. Funciones puras nuevas — `src/domain/rendicion.js` (AC-REN-6)
- `disponiblesParaDevolver(pedido, rendiciones) → Map<productoId,{facturado, devuelto, disponible, precioCents, nombre, rubro}>`: facturado (ítems no eliminados) − Σ renglones `entra` de rendiciones **vigentes** del pedido.
- `validarRendicion(form, {pedido, rendiciones, productos, usuario, now, genId}) → {ok, rendicion}|{ok:false, errores}`: pedido facturado, no borrado y con `remoteId`; cantidades enteras >0 y ≤ disponible; NC con monto >0 y ≤ tope; motivo 3..300; `nroNc` ≤30; `tipoFactura` vía `normalizarTipoAB` (compras.js); calcula `creditoCents`, `comisionRenglones`, `creditoComisionCents`.
- `diferenciaCambioCents(renglonesEntra, renglonesSale) → number` (+ crédito, − a pagar). Precio del que sale = `precio` actual del producto (supuesto S3).
- `creditoRendicion(rendicion) → cents` (devolución: Σ precio facturado × cant, mermas incluidas; NC: monto; cambio: diferencia).
- `comisionRenglonesDe(rendicion, pedido, productosById) → [{rubroClave, rubro, subtotalCents}]` (NC: prorrateo por rubro del pedido, resto mayor en centavos).
- `movimientosRendicion(rendicion) → movimientos[]` (alta: `devolucion` + por `entra` con `vuelveAlStock`, `venta` − por `sale`; ids `<id>:<idx>:a`).
- `movimientosAnulacionRendicion(rendicion) → movimientos[]` (tipo `anulacion`, cantidad opuesta, ids `<id>:<idx>:x`).
- `planEfectoCuenta(creditoCents, deudasCliente) → {cobros:[{deudaId, montoCents}], saldoFavorCents, cargoCents}` (deudas más viejas primero, usa `saldoDeuda`).
- `planAnulacionCuenta(rendicion, deudas, cuenta) → {saldoFavorCompensaCents, deudaReversionCents, anularDeudaCargoId|null, saldoFavorPorCargoCobradoCents}`.
- `saldoAFavorCliente(cuentaClientes, clienteId) → cents`; `cuentaParaBoleta(deudaPendiente, saldoFavorCents) → {deudaPendiente, saldoAFavor}` (saldo negativo ⇒ suma a deuda).
- `resumenRendicionDia(rendiciones, fecha) → {filas, totales:{devueltoCents, ncCents, cambiosCents, mermaCents, mermaUnidades, anuladas}}` (anuladas listadas, no suman).
- `pedidoTieneRendicionVigente(pedido, rendiciones) → bool` (guarda de revertir/borrar/editar pedido).
- `pedidoNetoParaComision(pedido, rendicionesVigentes) → pedido'` (`total` − crédito comisión) y extensión aditiva `baseRubrosPedido(pedido, productosById, { extras = [] })` en `comisiones.js` (default sin cambios ⇒ tests existentes verdes).
- `rendicionToRemote / rendicionFromRemote`, `cuentaClienteToRemote / FromRemote`, `interpretarRpcRendicion({data,error})` (motivos: `pin_incorrecto`, `falta_migracion`, `rechazada`, `ya_anulada`).
- `src/domain/stock.js`: `TIPOS_MOVIMIENTO` + `'devolucion'`; `esRefRendicion(row)`.

## 4. Archivos (en orden)
1. `supabase/migrations/014_lote_operacion_rendicion.sql` — REQ-REN AC-REN-1..5 (tablas, RLS, RPC, CHECKs de ledger, comisiones).
2. `src/domain/stock.js` — AC-REN-2 (tipo `devolucion`, `esRefRendicion`).
3. `src/domain/rendicion.js` (nuevo) — AC-REN-1..6.
4. `src/domain/comisiones.js` — AC-REN-5 (`extras` en `baseRubrosPedido`, uso en `armarLinea*`/`ajusteRubro` vía `ctx.rendicionesPorPedido`).
5. `src/db/index.js` — DB_VERSION 11, stores `rendiciones` y `cuentaClientes`; `addRendicionConMovimientos(rend, movs)` en UNA transacción (patrón `addIngresoConMovimientos`), getters/put/`clearPendingSiNoCambio`.
6. `src/services/stockService.js` — AC-REN-2: en `syncStock` retener movimientos `rendicion:*` cuya rendición local siga `pendingSync` (además de `esRefLocal`).
7. `src/services/rendicionService.js` (nuevo) — orquesta: `registrarRendicion(form, ctx)`, `subirRendiciones(cred)` (RPC; al confirmar aplica efecto en deudas UNA vez: `efectoAplicado` local + `admin_rendicion_efecto` remoto con `efecto is null`), `anularRendicion(cred, id, motivo)` (online), `bajarRendiciones(cred)` con cursor (`cursorCompras`-like, clave propia en localStorage), `saldoAFavor(clienteId)`.
8. `src/services/deudaRepository.js` — aditivo: `aplicarCreditoADeudas(plan, ref)` y `crearDeudaCargo/Reversion(...)` reutilizando `cobrarDeuda`/`addDeuda`; chequeo local por concepto con `#id corto` antes de crear (anti-duplicado).
9. `src/utils/pdfGen.js` — AC-REN-3/4: `opciones.saldoAFavor` en `buildFacturaDoc` (línea "Saldo a favor: $X" en verde, reusa lugar de deuda en `layoutPieBoleta`); `generarRendicionDiaFile(resumen, {fecha})`.
10. `src/pages/Rendicion.js` (nuevo) + `src/App.js` (tab `rendicion` solo `isAdmin`) — AC-REN-1/4 (buscar pedido, form 3 tipos, lista del día, PDF, anular con motivo, PIN de admin como FacturasAEmitir).
11. `src/pages/Facturacion.js` — AC-REN-3: boleta con `cuentaParaBoleta` (solo admin con datos bajados); guarda `pedidoTieneRendicionVigente` antes de revertir/borrar/editar ítems.
12. `src/services/comisionesService.js` — AC-REN-5: carga rendiciones vigentes y las pasa a `armarDashboard` (ctx).
13. Tests (ver §6).

## 5. Seguridad (decisiones delegadas por el dueño)
- D1. Rendiciones, NC (n.º, A/B, montos, motivos) y saldos a favor: tablas con RLS cerrada y solo RPC `security definer` con PIN de admin (patrón 011/012). La anon key no lee ni escribe nada de eso.
- D2. Movimientos de stock de la rendición van a `movimientos_stock` (ya legible por anon, como todo el ledger): solo cantidades, `nota` sin montos ni motivo. Trigger exige cabecera en `rendiciones` ⇒ no se pueden forjar `devolucion` con anon.
- D3. El efecto en `deudas` (cobro parcial/deuda de cargo) queda en la tabla legacy, que ya expone montos a anon: se acepta porque los vendedores necesitan la deuda correcta en sus boletas; el detalle de la NC queda privado. `pagadaPor`/concepto solo llevan `Rendición #<8 chars>`.
- D4. Pantalla Rendición solo admin (`isAdmin` en App y PIN en cada RPC). Anulación solo online y atómica en el servidor.
- D5. Validaciones duplicadas cliente (dominio) y servidor (RPC): cantidades vs facturado−devuelto, topes, enums, largos; el servidor manda.

## 6. Concurrencia offline / multidispositivo
| Riesgo | Mitigación |
|---|---|
| Reintento de sync duplica movimientos/asientos | ids deterministas + upsert/`on conflict do nothing`; `pendingSync` se limpia solo de ids confirmados (`clearPendingSiNoCambio`) |
| Dos dispositivos devuelven el mismo ítem offline (exceso) | RPC valida disponible al confirmar; la segunda queda `rechazada`: se generan sus movimientos `:x` localmente (neto 0) y se avisa; los `:a` nunca salieron antes (retenidos) |
| Movimientos de rendición llegan antes que la cabecera | retención en `syncStock` + trigger de cabecera en servidor |
| Doble aplicación del crédito en deudas | efecto solo post-confirmación, solo por el creador, flag local `efectoAplicado` + `efecto is null` en servidor (si ya hay efecto remoto no se reaplica) |
| Dos anulaciones simultáneas | anulación online-only; RPC `update … where estado='vigente'` ⇒ un solo ganador aplica reversos; el otro recibe `ya_anulada` y solo baja |
| Revertir/borrar pedido con rendición ⇒ stock devuelto dos veces | guarda `pedidoTieneRendicionVigente` en Facturación (anular rendición primero) |
| Deudas legacy: insert sin clave idempotente | chequeo local por concepto `#id` antes de `addDeuda`; riesgo residual preexistente anotado |
| Cursor con relojes desfasados | `synced_at` de servidor + desempate por id + solape 5 min (como 012) |
| Cerrar comisiones con datos locales desactualizados | servidor recalcula con rendiciones vigentes (helpers de 014); si difiere ⇒ `montos_inconsistentes` (comportamiento existente) |

## 7. Plan de pruebas
| AC | Test | Tipo |
|---|---|---|
| AC-REN-1 | `validarRendicion` (3 tipos, límites de cantidad, motivo, A/B, n.º NC, pedido no facturado/sin remoteId) | unit dominio `src/domain/__tests__/rendicion.test.js` |
| AC-REN-1 | Rendicion.js: solo admin, buscar pedido, alta, PIN requerido | page test (jsdom, servicios mockeados) |
| AC-REN-2 | `movimientosRendicion`/`movimientosAnulacionRendicion`: signos, merma sin movimiento, ids deterministas iguales en dos llamadas; stock vuelve al valor previo tras anular | unit dominio |
| AC-REN-2 | `syncStock` retiene `rendicion:*` pendientes; reintento no duplica (upsert por id) | service test (mock supabase/db) `stockService.test.js` |
| AC-REN-3 | `planEfectoCuenta` (con/sin deuda, parcial, cargo), `saldoAFavorCliente`, `cuentaParaBoleta` | unit dominio |
| AC-REN-3 | efecto aplicado una sola vez (reintento de `subirRendiciones`, `efectoAplicado`) | service test `rendicionService.test.js` |
| AC-REN-3 | boleta muestra "Saldo a favor" / deuda neta | PDF test (patrón `pdfBoleta011.test.js`) |
| AC-REN-4 | `resumenRendicionDia` totales (anuladas excluidas), `planAnulacionCuenta`; PDF del día | unit dominio + PDF test |
| AC-REN-4 | `anularRendicion`: online-only, `ya_anulada` no reaplica, nada se borra | service test |
| AC-REN-5 | `pedidoNetoParaComision` + `calcularAjustesPendientes`: pedido cerrado ⇒ ajuste; abierto ⇒ baja la línea; modelo cliente y rubro; `extras` vacío no cambia resultados | unit dominio `comisiones.test.js` |
| AC-REN-5/D1 | 014: RLS sin políticas, revokes, `_es_admin_con_pin` en todas las RPC, CHECKs NOT VALID, sin `drop table`/`delete` | test estático de SQL (patrón `security.lote011.*.test.js`) |
| AC-REN-6 | cobertura de todas las funciones de §3 | unit dominio |
| Regresión | AC-STK-1..8, COM/COMR, FAB existentes verdes; DB v11 migra sin borrar stores | `npm test` + `npm run build` |

## 8. Supuestos (opción conservadora)
- S1. Solo se rinden pedidos `facturado`, no borrados y **ya sincronizados** (`remoteId`); evita refs locales.
- S2. Crédito por devolución = precio facturado del renglón (con descuento del pedido si lo tiene, prorrateado) × cantidad; las mermas también acreditan.
- S3. En cambios, el producto que sale se valora al `precio` actual del producto; se puede cambiar por el mismo producto (diferencia 0).
- S4. NC sin mercadería reduce la comisión prorrateando por rubro del pedido; queda congelado en la rendición.
- S5. El efecto en deudas/saldo se ve en otros dispositivos recién tras sincronizar; el saldo a favor solo se imprime en boletas generadas por un admin con datos bajados (vendedores ven la deuda ya descontada, no el saldo a favor).
- S6. Usar el saldo a favor contra deudas futuras es manual (botón "Aplicar saldo a favor" en Deudas, admin) — fuera de alcance si no entra en esta tanda; AC-REN-3 solo exige mostrarlo.
- S7. Anular una rendición requiere conexión; el alta no.
- S8. La redefinición de `cerrar_comisiones` en 014 copia 005 textual salvo el total neto: el auditor debe diffear contra 005.
