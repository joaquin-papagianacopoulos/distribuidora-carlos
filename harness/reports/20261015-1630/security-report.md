# Security report — RUN 20261015-1630 (REQ-REN: rendición, devoluciones, cambios y NC)

## Resumen ejecutivo
Alcance: migración 014, rendicionService, stockService, deudaRepository, comisionesService, Rendicion.js, Facturacion.js, ListaPedidos.js, pdfGen.js, App.js.
Vuelta 2 (verificada en el SQL): Crítico: 0, Alto: 0, Medio: 0, Bajo: 3 abiertos. CORREGIDOS: S-REN-01, 02, 03, 04 y 06 (1 Alto, 3 Medio, 1 Bajo). Inicial de la vuelta 1: Alto 1, Medio 3, Bajo 2.
Lo central está bien: anon no lee ni escribe `rendiciones` ni `cuenta_clientes` (RLS sin policies + revoke all), todas las RPC validan PIN admin con `search_path` fijo, la anulación es de una sola vez y `cerrar_comisiones` coincide con la 005 salvo el total. El punto débil es el trigger de movimientos (S-REN-01/02).
Decisiones del arquitecto: D1 validada; D2 corregida y ya implementada (S-REN-01/02); D3 validada; D4 validada; D5 validada con reserva (S-REN-04).

## Tabla de hallazgos
| Id | Severidad | Hallazgo | Evidencia | Estado | Dónde se corrige |
|---|---|---|---|---|---|
| S-REN-01 | Alto | `tg_movimiento_rendicion_con_cabecera` NO es `security definer`: corre como `anon`, que no tiene SELECT sobre `rendiciones` ⇒ todo INSERT de movimiento `rendicion:*` falla con "permission denied" (rompe AC-REN-2 en producción; fail-closed) | 014:172-196, 014:74 | CORREGIDO | 014 (agregar `security definer`) (vuelta 2) |
| S-REN-02 | Medio | El trigger solo verifica que exista la cabecera: con la anon key se puede insertar `devolucion`/`venta`/`anulacion` con cualquier producto y cantidad contra un `rendicion:<uuid>` real (los UUID son públicos en `movimientos_stock`). D2 ("no se pueden forjar devoluciones") es falsa. Equivale a la brecha previa de `ajuste` (movs_insert `with check (true)`), no la agrava, pero no la cierra | 014:172-196, 001:149-151, 014:156-162 | CORREGIDO | 014 (validar contra `renglones`) (vuelta 2) |
| S-REN-03 | Medio | `admin_rendicion_efecto` (alta) no exige `estado='vigente'`: si otro admin anula antes de que el creador reclame el efecto, se aplica crédito/cobro sobre una rendición anulada y nadie lo revierte (el plan de anulación usa `efecto` local nulo) | 014:425-429, rendicionService.js:121-139, :270-273 | CORREGIDO | 014 (vuelta 2) |
| S-REN-04 | Medio | El servidor no recalcula `credito_cents` ni `credito_comision_cents` desde renglones/pedido (solo la NC tiene tope). Un admin (o quien robe su PIN) puede acreditar hasta 10^9 pesos y mover la comisión; D5 "el servidor manda" solo se cumple en cantidades | 014:269-308, 345-352 | CORREGIDO | 014 (vuelta 2) |
| S-REN-05 | Bajo | `movimientos_stock` (legible por anon) expone qué producto/cantidad se devolvió, cuándo y el UUID de la rendición. No hay montos, motivo ni cliente (D2 correcto en eso) | stockService.js, 014:195 | ABIERTO | aceptar |
| S-REN-06 | Bajo | `admin_cuenta_clientes_guardar` acepta asientos sin `rendicion_id`, con cualquier `cliente_id`/monto; `uso_saldo` sin control de saldo disponible (solo admin con PIN) | 014:437-484 | CORREGIDO | 014 (vuelta 2) |
| S-REN-07 | Bajo | Residuales tras la vuelta 2: (a) varios asientos `saldo_favor` con ids distintos por la misma rendición, cada uno ≤ crédito, sin tope acumulado; (b) en `cambio` el `precioCents` de lo que sale no se valida contra el catálogo (queda acotado por el tope de créditos ≤ total del pedido); (c) el ledger sigue aceptando `ajuste` con cualquier signo desde anon (brecha previa 001) | 014 admin_cuenta_clientes_guardar, 001:149-151 | ABIERTO | 014 / REQ aparte |

## Detalle
**S-REN-01 (CVSS ~6.5, disponibilidad).** Un trigger corre con los privilegios del rol que hace el INSERT. La 014 hace `revoke all on public.rendiciones from public, anon, authenticated` y el trigger lee esa tabla sin `security definer`. `syncStock` sube movimientos con la anon key, así que cada devolución/cambio/anulación da error 42501 y los movimientos quedan pendientes para siempre. El trigger análogo de ingresos funciona porque `ingresos_mercaderia` es legible. No da acceso a nada, pero invalida la funcionalidad y el test estático previo no lo detecta.
Fix: `create or replace function public.tg_movimiento_rendicion_con_cabecera() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$ ... $$;` (el `revoke execute` existente no impide que el trigger dispare).

**S-REN-02 (CVSS ~5.3).** Con la anon key, `insert into movimientos_stock (...) values (..., 'devolucion', 999999, 'rendicion:<uuid real>')` pasa CHECK y trigger. El CHECK relajado NO abre por sí solo una vía nueva: `devolucion` exige cantidad>0, `venta` <0, y `anulacion` negativa solo con ref `rendicion:*` y rendición anulada; pero `ajuste` ya aceptaba cualquier signo (brecha previa). Remediación (en el mismo trigger, ya definer):
```sql
-- dentro de la rama ref ~ '^rendicion:'
if abs(new.cantidad) > (select coalesce(sum((x->>'cantidad')::int),0)
      from public.rendiciones r, jsonb_array_elements(r.renglones) x
     where 'rendicion:'||r.id::text = new.ref and x->>'productoId' = new.producto_id
       and ((new.tipo in ('devolucion','anulacion') and x->>'sentido'='entra')
         or (new.tipo in ('venta','anulacion') and x->>'sentido'='sale'))) then
  raise exception 'movimiento de rendicion fuera de los renglones';
end if;
```
Sumar además lo ya registrado por (ref, producto, tipo) para no superar el tope. Cierre total real: restringir `movs_insert` de anon y mover el alta de movimientos a una RPC con PIN (requiere cliente nuevo, REQ aparte).

**S-REN-03 (CVSS ~4.3).** En `admin_rendicion_efecto`, rama alta: `where id = p_id and efecto is null and estado = 'vigente'`. El cliente ya trata `aplicado=false` como "no reaplicar".

**S-REN-04 (CVSS ~4.9, requiere PIN admin).** Para `devolucion` exigir `v_cred = Σ(precioCents×cantidad de renglones entra)`; para `cambio`, `Σentra − Σsale`; y `abs(v_cred_com) <= abs(v_cred)`. Hoy un lote con renglones válidos y `credito_cents=100000000000` se acepta.

**Verificado sin hallazgo**
- Anon sin acceso a rendiciones/NC/saldos: RLS, sin policies, `revoke all`. Lectura solo por `admin_rendiciones_bajar` (PIN admin, 1000 filas por tabla).
- PIN: `_es_admin_con_pin` (permiso=1, activo) + `verificar_pin` con bloqueo de 5 intentos/15 min. El PIN vive en estado React, se limpia tras usarlo, no se guarda ni se loguea. (El bloqueo permite DoS al admin: riesgo previo, no nuevo.)
- RPC: `security definer set search_path = public, pg_temp`, `revoke from public` + grant explícito, lotes ≤200/500, regex en cada campo, errores acotados por sub-bloque. Helpers y triggers sin execute.
- Idempotencia: `on conflict (id) do nothing`; ids de movimientos y asientos deterministas.
- Anulación una sola vez: `update ... where estado='vigente'` atómico + trigger de inmutabilidad (sin `anulada→vigente`, sin DELETE, `efecto`/`efecto_anulacion` write-once). `cuenta_clientes` es append-only.
- Sobre-devolución: lock `pg_advisory_xact_lock` por pedido + `entra ≤ floor(facturado) − vigentes`; NC topada por total menos créditos vigentes.
- `cerrar_comisiones`: diff contra la 005 (401-841 vs 585-1017): cambian solo 2 líneas (5a y 6a: `greatest(round(total,2),0)` por `_pedido_total_comision`). Se omite el comentario del bloque de permisos; el `revoke select on comisiones_cierre_pedidos` de la 005 sigue vigente. Grants idénticos. `comision_rubro_base` conserva firma y filtros y suma `comision_renglones` validados por regex. Cubierto por test.
- PDF: jsPDF dibuja texto plano; motivos truncados y nombre de archivo saneado. Sin XSS ni formula injection (no hay CSV/XLSX en el alcance). Sin `dangerouslySetInnerHTML` en Rendicion.js.
- UI: pestaña `rendicion && isAdmin` y PIN validado en servidor en cada RPC. Las guardas de Facturacion/ListaPedidos son de UX: el servidor no impide revertir un pedido con rendición (doble reposición solo por usuarios autorizados).
- Dependencias: sin cambios en package.json en esta corrida.

## Corregido en esta corrida
Vuelta 2, verificado leyendo `014_lote_operacion_rendicion.sql` y con `security.rendicion.run1630.test.js` (16 tests verdes):
- S-REN-01: el trigger es `security definer set search_path = public, pg_temp` y sin execute para anon (el trigger igual dispara).
- S-REN-02: el trigger exige id `<uuid>:<idx>:a|x` con uuid = ref, producto, tipo, signo y cantidad iguales al renglón; merma (`vuelveAlStock:false`) no admite movimiento; el id es PK, así que cada renglón admite un solo movimiento de alta y uno de anulación; `x` solo con rendición anulada. Corre en `before insert or update`: sobre una fila de rendición se revalida y no se puede cambiar la ref; para movimientos no-rendición el trigger no hace nada y la inmutabilidad de la 002 (`tg_movimiento_inmutable`: solo pedido-local→pedido) sigue mandando, así que el definer no abre otra vía. Para anon queda cerrado todo lo que use ref `rendicion:*`. No cerrado: la brecha previa de `ajuste` (S-REN-07 c).
- S-REN-03: `where id = p_id and efecto is null and estado = 'vigente'`.
- S-REN-04: crédito recalculado en servidor (devolución = Σ entra; cambio = Σ entra − Σ sale; comisión = crédito), precio de lo que entra ≤ menor precio facturado, y Σ créditos vigentes ≤ total del pedido para todos los tipos, con lock por pedido.
- S-REN-06: `saldo_favor` exige rendición del mismo cliente y monto ≤ su crédito; `uso_saldo` negativo y ≤ saldo disponible, con lock por cliente.

## Requiere acción del dueño
1. Aplicar la 014 corregida (si una versión anterior ya se corrió, volver a correrla: es idempotente).
2. Decidir sobre S-REN-07(c): cerrar `ajuste` abierto a anon exige una RPC con PIN para movimientos (cambio de cliente, REQ aparte). S-REN-05 y S-REN-07(a,b): aceptar o pedir.
4. Backup antes de correr la 014 y probar: devolución, subir, ver stock remoto, anular desde dos dispositivos.
