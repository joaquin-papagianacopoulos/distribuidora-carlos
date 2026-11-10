# Seguridad — Tanda 1, bloque A (RUN 20261110-t1)

Alcance: migración 024, permisos.js, edicionPedido.js, vendedorPedido.js, pedidoRepository.js, syncService.js (pedidos), comisiones.js. No se tocó producción.

## Resumen
Crítico: 0, Alto: 1, Medio: 4, Bajo: 4. La 024 está bien armada: `tienda_crear_pedido` es copia exacta de la 019 salvo la condición REQ-MUL (diff verificado); mismo `security definer`, `search_path`, revoke/grant; conserva precios del servidor, `direccion_exacta` (REQ-DIR), stock, límites e idempotencia.

## Hallazgos

| Id | Sev | Hallazgo | Evidencia |
|---|---|---|---|
| T1-A-01 | Alto | La autorización de edición/asignación es solo de cliente; `pedidos` es escribible por anon sin RLS (002:223 solo revoca delete) y la 024 agrega `cargado_por`/`vendedor_id` sin protegerlos | permisos.js:41-65; 008:71-104 (guard no los cubre) |
| T1-A-02 | Medio | Vendedor puede subir precio manual en renglones NUEVOS o cambiar `precio` sin marcar flag: `congelarPrecios` solo detecta `precioManual`/`descuentoPct` nuevos | edicionPedido.js:36-46 |
| T1-A-03 | Medio | Pedido recién subido por INSERT no guarda `remoteUpdatedAt` (solo `versionPorId` de updates) => su primera edición tiene base null => update incondicional, sin detección de conflicto | syncService.js:584-657, pedidoRepository.js:128 |
| T1-A-04 | Medio | Escritores sin `versionBase` (Facturación, marcarEntregado, borrar, Armado hasta B3) mandan la fila completa con items viejos y pisan la edición de otro dispositivo (el conflicto solo protege al editor) | pedidoRepository.js:290-296, 220-223 |
| T1-A-05 | Medio | `puedeEditarPedido` deja al vendedor editar un pedido `entregado` o ya incluido en un cierre de comisiones: cambia `total` tras cobrar/cerrar | permisos.js:41-54 |
| T1-A-06 | Bajo | `tienda_cantidad_valida` y `tg_set_updated_at` sin `set search_path` (linter Supabase); la 024 la recrea sin cambiar eso | 024:51, 85 |
| T1-A-07 | Bajo | "Tolerancia": la sección 4/5 corre aunque falten 019/tienda; plpgsql compila igual y la tienda falla en runtime (`direccion_exacta` inexistente). Todo dentro de un `begin/commit`, así que una falla en la creación revierte todo | 024:101-342 |
| T1-A-08 | Bajo | Identidad por nombre normalizado (sin tildes/mayúsculas): dos vendedores "José"/"Jose" se editan mutuamente; `vendedorId` no se cruza con el nombre | permisos.js:33,52; comisiones.js:425 |
| T1-A-09 | Bajo | `pullPedidosPendientes` pagina con `order('fecha')` no único => filas duplicadas/salteadas entre páginas; tope 3000 silencioso; `select *` | syncService.js:1060-1066 |

Estado de todos: ABIERTO (CORREGIDO: ninguno; no se modificó producción).

## Detalle y escenarios
- **T1-A-01** Un vendedor con la anon key hace `PATCH /pedidos?id=eq.X {vendedor:"yo", vendedor_id:"..", cargado_por:".."}` y se queda con la comisión o edita pedidos ajenos/facturados; también puede forjar `permiso` en IndexedDB (preexistente). Comisiones usa el nombre del pedido (comisiones.js:425), así que reasignar desvía la comisión; la cierra el admin con PIN, que es el único control real. Corrección mínima: RPC `asignar_vendedor_pedido(id, vendedor, pin)` (security definer, valida PIN admin como `verificar_pin`) y trigger que, para `anon/authenticated`, deje `vendedor`/`vendedor_id`/`cargado_por` inmutables salvo vía la RPC (flag `set_config` local). Aceptable a corto plazo: auditar en el cierre de comisiones los pedidos cuyo `vendedor` difiere del original (ya hay ajuste `vendedor_asignado`).
- **T1-A-02** Corrección: para no-admin, en `congelarPrecios` forzar `precio = o.precio` (y flags) en todo renglón existente salvo que lo re-precie la regla de bulto; para renglones nuevos recalcular precio desde catálogo en el dominio, ignorando `precioManual`/`descuentoPct`.
- **T1-A-03** Corrección: en el insert (rama `porUuid`) y el fallback pedir `select('id,client_uuid,updated_at')` y poblar `versionPorId`; o hacer `traerPedidoRemoto` al abrir edición si falta `remoteUpdatedAt`.
- **T1-A-04** Corrección: pasar `versionBase: p.remoteUpdatedAt` en Facturación/Armado/entregado/borrar (como asignar/confirmar) y manejar `mode:'conflicto'`. Con la 024 el trigger ya bumpea `updated_at` en cada update, así que habrá falsos conflictos inocuos tras un `marcarEntregado`: refrescar `remoteUpdatedAt` con el `updated_at` devuelto en todo guardado.
- **T1-A-05** Corrección: en `puedeEditarPedido` rama vendedor, `if (pedido.entregado === true) return no('Ya fue entregado')`; el admin con la validación de `cerradoEn` existente.
- **T1-A-06/07** `create or replace function ... set search_path = pg_temp` y envolver la sección 5 en `if to_regprocedure('public.direccion_exacta(text)') is not null` (si no, `raise exception` explícito pidiendo la 019).
- **T1-A-09** Agregar `.order('id')` como desempate; avisar en consola al llegar a MAX_TOTAL.

## Verificado sin hallazgo
- 024 idempotente: `add column if not exists`, constraints guardados por `pg_constraint`, `drop trigger if exists`, `create index if not exists`, `create or replace`; checks `not valid` no rompen datos existentes. Trigger `set_updated_at` ordena antes que `tg_pedidos_web_guard`; el guard devuelve OLD en web no aceptado (no se pisa). Sin grants nuevos; `tienda_crear_pedido` conserva `revoke all from public` + grant anon/authenticated.
- `tienda_cantidad_valida`: inmutable, sin acceso a tablas, división protegida por `coalesce(p_min,0)<=1`; usa `minimo_venta` crudo y `v_u < v_min` sigue aparte.
- Update condicional por `updated_at`: 0 filas => `conflicto`, revierte local y no toca stock; sync no lanza y no reintenta solo; "usar la mía" re-lee la versión.
- Whitelist de `aplicarEdicion` (solo items/total/observaciones): un vendedor no puede cambiar `vendedor`, `cargadoPor`, `estado` por esa vía; `asignarVendedor` exige admin (repo y UI); armador y permisos no numéricos denegados; facturado solo admin. Web sin vendedor => `sin_comision` + aviso, no suma a nadie; `vendedorAlAceptar` es decisión del admin.
- `pullPedidosPendientes` filtra con `.eq()` parametrizado (sin inyección); la exposición a vendedores es la preexistente (select abierto), no se agrega campo sensible (contacto web va en tabla aparte).

## Corregido en esta corrida
CORREGIDO: ninguno.

## Requiere acción del dueño
- Decidir T1-A-01 (RPC con PIN para reasignar vendedor) antes de confiar en `cargado_por`.
- Aplicar 024 a mano tras 023 y backup; verificar que la 019 ya esté aplicada.
- Pasar T1-A-02..05 al bloque B/QA (tocan Facturación/Armado y sync).
