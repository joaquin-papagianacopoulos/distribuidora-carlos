# Informe de seguridad — REQ-PAN Panel (run 20261015-2019)

## Resumen ejecutivo
Alcance: migración 015, panelService, itemsSinCostos en pedidoRepository/syncService, Panel.js, App.js.
Crítico: 0, Alto: 0, Medio: 1, Bajo: 3. No hay fuga de costos con la anon key ni escalada de privilegios.
La decisión del arquitecto (snapshot de costo capturado por el servidor en tabla privada, lectura solo por RPC con PIN)
se VALIDA: el costo sale de `productos` en el servidor, nunca de lo que mande el cliente.
Se corrigió en la 015 un problema de rendimiento del trigger (SEC-PAN-02). Tests: `src/__tests__/security.panel.auditor2019.test.js`.
`npm audit` no se re-ejecutó: no hay dependencias nuevas en esta corrida (CORREGIDO: solo SEC-PAN-02).

## Tabla de hallazgos
| Id | Severidad | Hallazgo | Evidencia | Estado | Dónde se corrige |
|---|---|---|---|---|---|
| SEC-PAN-01 | Medio | Anon puede "congelar" el costo de un pedido (primero gana): crear/editar un pedido facturado antes que el vendedor fija el costo vigente en ese instante; también puede fabricar pedidos facturados que inflan ventas del Panel (riesgo previo: anon escribe `pedidos`) | 015_lote_operacion_panel.sql:86-119 | ABIERTO | Requiere acción del dueño (exigir auth/RPC para escribir `pedidos`) |
| SEC-PAN-02 | Bajo | Trigger hacía `join productos p on p.id::text = it.pid`: cast sobre la columna impide usar la pk, un seq scan de productos por cada pedido facturado guardado (upserts en lote lentos); un `productoId` no numérico no puede romper el cast | 015:107 (antes) | CORREGIDO | 015 (join por pk + regex `^[0-9]{1,18}$` antes del cast) |
| SEC-PAN-03 | Bajo | `pedidos_costos_errores` crece sin tope ni retención y no hay RPC para leerla (solo SQL Editor) | 015:53-60 | ABIERTO | Limpieza manual periódica (ver Detalle) |
| SEC-PAN-04 | Bajo | El costo es el vigente al llegar el pedido al servidor, no al facturar offline (deriva acotada: los costos solo cambian online con PIN) | 015:86-119, plan.md supuestos | ABIERTO | Aceptado por diseño; documentado |

## Detalle
**Verificaciones sin hallazgo (OK)**
- Fuga de costos: `pedidos_costos` y `pedidos_costos_errores` con RLS on, sin policies, `revoke all` a public/anon/authenticated
  (015:45-46, 59-60). No hay vistas ni `grant select`. `itemsSinCostos` (panel.js:34) quita costoUnitario/costoFinal/costoNeto/costo/
  descuento1/2/ganancia en los DOS caminos de subida (pedidoRepository.js:26, syncService.js:162). El trigger nunca copia nada de
  `new.items` salvo `productoId`; el costo viene de `productos.costo_final/descuento1/descuento2` (015:99).
- Trigger `security definer` con `search_path = public, pg_temp` y todo calificado `public.`; `revoke all` de ejecución a anon/authenticated
  (el trigger igual dispara: el privilegio EXECUTE se chequea al crearlo, no al disparar). Anon no puede invocarlo ni leer lo que escribe;
  no acepta parámetros, así que no hay vector de escalada. `_costo_neto_producto` es `immutable`, sin acceso a tablas, sin grants.
- `on conflict`: `excluded.costos || c.costos` da prioridad a lo existente (jsonb `||` gana el lado derecho): no se pisa un costo ya
  capturado; `where ... is distinct from` evita updates vacíos. Es idempotente frente a reintentos.
- Extracción de `productoId`: solo number/string, items `eliminado` excluidos, ids no numéricos o gigantes se descartan (regex), claves
  duplicadas colapsadas con `distinct on`; el tamaño del objeto queda acotado por la cantidad de productos del catálogo y por el check
  `pg_column_size < 262144`. `pedido_id` = `new.id::text`, acotado por check 1..64.
- Trigger no bloquea el guardado: es AFTER, filtra por `estado='facturado'` y por cambio real de estado/items, y ante cualquier error
  hace `raise warning` + fila en errores (subtransacción, no aborta el pedido). Costo por fila: un hash join sobre productos.
- RPC `admin_costos_venta_bajar`: `security definer`, `search_path` fijo, `_es_admin_con_pin` (011: id vacío o >64 => false sin
  verificar PIN; PIN con bloqueo en `verificar_pin`), respuesta uniforme `no_autorizado`, página fija 1000, cursor con `::timestamptz`
  capturado (`lote_invalido`) e id truncado a 64. Sin SQL dinámico. `revoke ... from public` + grant solo a anon/authenticated (el PIN es el
  control, igual que 012/014). La sonda con id vacío no consume intentos de PIN.
- Cliente: `panelService` no guarda ni loguea el PIN (solo viaja en la llamada); Panel.js usa input `type=password` y estado local;
  el cursor en localStorage no contiene datos sensibles. Sin `dangerouslySetInnerHTML`. La pestaña `panel` se renderiza solo con `isAdmin`
  (App.js:241), pero el control real está en el servidor (PIN), no en el rol local: forjar `permiso` en IndexedDB solo muestra la
  pantalla vacía.
- IndexedDB v12 solo agrega el store `costosVenta` (cache de solo lectura, sin pendingSync). No toca stock ni movimientos.

**SEC-PAN-01 (envenenamiento).** El atacante NO puede elegir el valor del costo (lo pone el servidor), solo el momento de captura y qué
productos entran. Efecto: márgenes del Panel algo desviados si el costo cambió entre ambos instantes; no hay fuga de confidencialidad.
Como `pedidos` es escribible con anon (hallazgo previo, riesgo aceptado en plan.md supuesto 7), un atacante con la anon key ya puede
alterar totales/estado directamente; esto no agrega un vector nuevo de peso. Mitigación práctica sin romper la app offline:
(a) hacer que la captura ocurra solo en la transición a `facturado` (quitar el disparo por cambio de items) para reducir la ventana;
(b) a mediano plazo, pasar la escritura de `pedidos` a RPC con validación de vendedor. Recomendación: aceptar por ahora.

**SEC-PAN-03.** Mantenimiento sugerido (SQL Editor): `delete from public.pedidos_costos_errores where created_at < now() - interval '90 days';`
Para revisar fallos: `select * from public.pedidos_costos_errores order by id desc limit 50;`.

## Corregido en esta corrida
- SEC-PAN-02: en `supabase/migrations/015_lote_operacion_panel.sql` el join a productos usa la pk y el cast del id está protegido por regex.
  Validado con `security.panel.auditor2019.test.js` (8 suites security, 90 tests verdes). Aún no aplicada en Supabase (la 015 se corre a mano).
- Decisiones del arquitecto validadas sin cambios: tabla privada + trigger server-side + RPC con PIN + `itemsSinCostos` en ambos uploads.

## Requiere acción del dueño
1. Aplicar la 015 a mano en el SQL Editor (después de 011, 012, 013; backup previo). Verificar después:
   `select has_table_privilege('anon','public.pedidos_costos','select');` debe dar `false`.
2. Decidir sobre SEC-PAN-01 (aceptar el riesgo o limitar el disparo a la transición a `facturado`).
3. Programar la limpieza de `pedidos_costos_errores` (SEC-PAN-03) y revisarla tras los primeros días.
4. Pedidos viejos (anteriores a la 015) se muestran como "costo estimado": es esperado, no hay backfill.
