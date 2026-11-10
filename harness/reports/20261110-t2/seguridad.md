# Seguridad — Tanda 2 (REQ-RTO/HRU/RED/DMP) — RUN 20261110-t2

Alcance: migracion 025, sync de deudas/pedidos, dominio redondeo/cobranza, PDF remito/hoja de ruta, cache del ajuste.
Critico: 0 · Alto: 0 · Medio: 3 · Bajo: 5. No se escribio en src/ ni en migraciones.

## Veredicto de la migracion 025
- SQL valido: `$mig$` 3 pares (l.20/36, 41/65, 70/84) y `$$` 2 pares (l.91/101, 111/139); `begin`/`commit` cierran. `return` dentro de DO es valido.
- Idempotente (`add column if not exists`, constraints guardadas por `pg_constraint`, `create or replace`), tolerante (`to_regclass`), sin drop ni backfill; constraints `not valid` no rompen filas viejas.
- `search_path = public, pg_temp` fijo en ambas RPC; `revoke all ... from public` + grant a anon/authenticated (mismo patron que 024).
- `ajustes_app_leer` devuelve SOLO `{redondeo_total}`: no expone costos, PIN ni datos de negocio. OK.
- `tienda_config` conserva RLS + `revoke all` de la 008; la 025 no agrega grants ni policies: anon NO escribe directo. Solo `admin_guardar_redondeo` (definer) la modifica. OK.
- `admin_guardar_redondeo`: id invalido => no_autorizado antes del PIN; `verificar_pin` SIEMPRE se llama; admin+PIN incorrecto devuelven lo mismo; multiplo validado en {0,500,1000}. PIN no se guarda ni se loguea (`ajustesService.js:90-92`). OK.

## Tabla de hallazgos
| Id | Sev. | Hallazgo | Evidencia | Estado |
|---|---|---|---|---|
| S-T2-01 | Medio | Fallback `nombraColumnaDmp` se dispara por violacion de CHECK (no solo columna inexistente): reintenta sin cobros/medio/referencia, marca `synced:true` y el historial de cobros nunca sube | `syncService.js:1609` (sin `esColumnaInexistente`), `cobranza.js:215` | ABIERTO |
| S-T2-02 | Medio | `cobros` jsonb sin tope de bytes (solo 200 elementos): un anon puede subir filas de varios MB por fila (DoS de storage/pull `select('*')` paginado) | `025.sql:60-63` | ABIERTO |
| S-T2-03 | Medio | Cobros last-write-wins: dos dispositivos que cobran la misma deuda offline pisan `cobros` y `monto_pagado` completos; se pierde un cobro (y su medio). Sin merge por UUID entre dispositivos | `syncService.js:1590-1596` (update de fila entera), `1685-1690` (el remoto reemplaza `cobros` local) | ABIERTO |
| S-T2-04 | Bajo | S-1110-01 no empeora en lo esencial, pero `cobros`/`medio_pago` son falseables por anon y no hay consistencia server-side con `monto_pagado`: un cobro falso queda "con rastro" solo si el atacante lo escribe | `025.sql:48-50`; (S-1110-01) | ABIERTO |
| S-T2-05 | Bajo | `redondeo_multiplo`, `redondeo`, `total_redondeado` escribibles por anon (multiplo 0 permitido): cambia el total a cobrar de un facturado. `total_redondeado` es inerte (se recalcula de `total`+multiplo), pero `multiplo` no. Mismo vector que S-1110-01 (anon ya puede editar `total`/`deudas.monto`) | `025.sql:27-34`, `redondeo.js:56-60` | ABIERTO |
| S-T2-06 | Bajo | Facturado->pendiente hecho por app vieja deja el multiplo remoto (no envia las claves); la app nueva lo baja, `totalACobrar` usa el multiplo viejo y `alFacturar` lo reusa en vez del ajuste vigente | `redondeo.js:56-60,84-87` | ABIERTO |
| S-T2-07 | Bajo | Hoja de ruta: saldo anterior excluye por completo la deuda de otros pedidos de la hoja y suma `totalACobrar` del pedido; si esa deuda ya tenia cobro parcial, se cobra de mas en la hoja. Homonimos sin `clienteId` unifican saldos (`mismoCliente` por nombre) | `cobranza.js:25-45` | ABIERTO |
| S-T2-08 | Bajo | `verificar_pin` bloquea 15 min tras 5 fallos por `vendedor_id`: cualquiera con la anon key bloquea al admin llamando la RPC (heredado, ahora tambien bloquea el guardado del redondeo) | `002.sql:108-111` | ABIERTO |

## Detalle
- S-T2-01. Escenario: referencia >60 o cobros >200 (o app modificada) => error `deudas_*_largo/formato`; el regex `medio_pago|referencia_pago|cobros` coincide con el nombre del constraint, se sube la fila sin esas claves, `updateDeuda(synced:true)` y el cobro con medio queda solo local; tras aplicar la 025 jamas se re-sube. Correccion minima: `if (error && esColumnaInexistente(error) && nombraColumnaDmp(error))` (igual que `conFallbackEntrega`) y no marcar `synced` si el reintento omitio columnas con la 025 ya aplicada.
- S-T2-02. Correccion: en la 025 agregar `check (cobros is null or octet_length(cobros::text) <= 60000)` (not valid) a `deudas_cobros_formato`.
- S-T2-03. Preexiste para `monto_pagado`; `cobros` agrega el mismo riesgo al historial. Correccion minima: al bajar, unir por `id` los cobros locales sin subir con los remotos (union) y recalcular `montoPagado` = suma (tope monto); o RPC `append_cobro` server-side (largo plazo, ligada a S-1110-01).
- S-T2-04/05. No empeora S-1110-01: el mismo anon ya puede escribir `deudas.monto/monto_pagado/pagada` y `pedidos.total`. Mitigacion real = auth real (S-1110-01). Parche barato: trigger BEFORE UPDATE en deudas que rechace (para anon) reducir `jsonb_array_length(cobros)` o `monto_pagado` sin cobro nuevo (append-only auditable).
- S-T2-06. Correccion: `alFacturar` debe ignorar el multiplo previo si `estado` no es facturado (`esFacturado(pedido)` antes de respetar el congelado), o limpiar al pasar a pendiente en `redondeoFromRemote` cuando `estado='pendiente'`.
- S-T2-07. Correccion: excluir de `saldoAnterior` solo el `saldoDeuda` (no el total) de los pedidos de la hoja y usar `totalACobrar` menos lo ya cobrado; preferir `clienteId` siempre.
- S-T2-08. Aceptado/heredado; mitigar con limite por IP en Edge Function cuando haya auth real.

## Revisado sin hallazgos
- Calculo: `redondearTotal` en centavos enteros, NaN/Infinity => 0; nunca deja un pedido >0 en <=0 (`aplicarRedondeoPedido`). `totalACobrar` con multiplo congelado se recalcula desde `total`, no confia en `total_redondeado` remoto. `registrarCobroEnDeuda` idempotente por UUID local y acota el cobro al saldo; `cobrarDeuda` acota negativos/NaN/Infinity.
- Saldo anterior: no se duplica (primer pedido del cliente) ni se pierde (`excluirPedidos` solo de pedidos de la hoja).
- PDF (jsPDF `doc.text`/autoTable, sin HTML): nombres y direcciones no inyectan; direccion acotada a 200 (`cobranza.js` `texto`). Sin formulas CSV en esta tanda.
- Cache `localStorage['ajustesApp']`: solo `{redondeoTotal}`; se normaliza a {0,500,1000} al leer (`leerRedondeoLocal`), un valor manipulado cae al default 500; no otorga rol ni PIN. La fuente de verdad al facturar queda congelada en el pedido.
- Sin secretos nuevos, sin `dangerouslySetInnerHTML`, sin logs de PIN.

## Corregido en esta corrida
CORREGIDO: ninguno (la auditoria no modifica src/ ni migraciones).

## Requiere accion del dueño
1. Aplicar la 025 recien tras corregir S-T2-02 (una linea de CHECK) o aceptarlo; hacer backup antes, correr despues de 024.
2. Pedir al agente de implementacion S-T2-01 (regex sin gate) y S-T2-03/06 antes de uso multi-dispositivo intensivo.
3. S-1110-01 (auth real) sigue siendo la causa raiz de S-T2-04/05.
