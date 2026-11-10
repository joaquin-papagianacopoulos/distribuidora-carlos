# Plan RUN 20261110-t0 — REQ-PVC + REQ-SEG2

Insumos: `harness/reports/20261110-lote/diagnostico-precio-costo.md` (casos A-D) y `security-report.md` (S-1110-02..09, 14, 17, 20).

## Supuestos / Decisiones (autorizadas por el dueño: lo más simple y recomendable)
- D1 **DB_VERSION queda en 12**: no hay stores ni índices nuevos. Campos nuevos aditivos: `pedidos.clientUuid`, `clientes.updatedAt`.
- D2 Clientes: borrado **físico por RPC con PIN** (`admin_borrar_cliente`), con copia previa en `clientes_borrados` (jsonb). Nada cambia en el pull ni en dispositivos viejos. Si la fila tiene FK → `{ok:false, motivo:'tiene_referencias'}`.
- D3 Proveedores: siempre **baja lógica** (`activo=false`, migración 021), también sin ingresos. Se quita el delete directo.
- D4 Deudas: el delete remoto pasa a la **anulación** que ya existe offline (`monto 0, pagada, concepto 'Anulada'`), online también. Se ocultan las anuladas en la lista.
- D5 Faltantes: RPC `borrar_faltantes(p_ids text[])` **sin PIN** (hoy los borran vendedor/armador), tope 200 ids por llamada, copia en `faltantes_borrados`. Frena el `DELETE ?id=gt.0` masivo; el arreglo de fondo sigue siendo S-1110-01.
- D6 Movimientos `ajuste`/`inicial`: trigger **SECURITY INVOKER** que los rechaza si `current_user in ('anon','authenticated')` (errcode 23514), y RPC `admin_registrar_ajustes_stock` con PIN. Tope `0 < |cantidad| <= 1_000_000` (= `MAX_CANTIDAD` de `domain/stock.js`) para que no se rechace nada legítimo.
- D7 Ajustes sin 023 aplicada: el upsert anon sigue andando. Con la 023 aplicada lo rechaza fila por fila (`pushPendientes` ya lo maneja con `esErrorDeDato`), queda `pendingSync` y sube con "Subir productos" (PIN). El stock local se ve al instante.
- D8 "Borrar caché" forzado (exportar respaldo + escribir `BORRAR`): disponible para **cualquier rol** (exporta datos que ya están en el dispositivo). El botón suelto "Exportar respaldo" de Configuración es solo para admin (AC-SEG2-6).
- D9 Todo el SQL tolera objetos ausentes o ya creados: `to_regclass` en bloques `DO`, `if not exists`, `drop ... if exists`, constraints `not valid`, sin `drop table`/`truncate`/`delete` fuera de los RPC.
- D10 Precio con ganancia **desconocida** (`undefined`, costos sin bajar con PIN) ≠ 0: nunca se recalcula ni se autocompleta.
- D11 Fallbacks: si falta un RPC (`PGRST202`/`42883`) o la columna `client_uuid` (`esColumnaInexistente`), se usa el flujo de antes y se avisa una sola vez por consola.

## Modelo de datos
| UI | Interno (IndexedDB) | Remoto (Supabase) | AC |
|---|---|---|---|
| (oculto) id de idempotencia | `pedidos.clientUuid` (UUID, `crypto.randomUUID()`) | `pedidos.client_uuid uuid` + `unique index pedidos_client_uuid_uk` | SEG2-3 |
| badge "Sin subir" | `pedidos.synced === false` (ya existe) | — | SEG2-3 |
| (oculto) versión local | `clientes.updatedAt` (lo ponen `addCliente`/`updateCliente`) | — | SEG2-7 |
| Borrar cliente | — | RPC `admin_borrar_cliente` → `clientes_borrados` | SEG2-1 |
| Eliminar faltante | — | RPC `borrar_faltantes` → `faltantes_borrados` | SEG2-1 |
| Ajuste de stock | `movimientosStock` (sin cambios, `pendingSync`) | RPC `admin_registrar_ajustes_stock` | SEG2-5 |

## Migración `supabase/migrations/023_no_perder_datos.sql` (idempotente)
1. Por cada tabla de {clientes, deudas, faltantes, proveedores, pedidos} dentro de un `DO` con `to_regclass`: `revoke delete, truncate ... from anon, authenticated`. Se borran **todas** las policies `cmd='DELETE'` de esas tablas leyendo `pg_policies` (incluye `clientes_delete` de la 020 y `proveedores_delete` de la 002).
2. `create table if not exists public.clientes_borrados` / `faltantes_borrados` (`id uuid pk default gen_random_uuid()`, `origen_id text`, `datos jsonb not null`, `borrado_por text`, `borrado_en timestamptz default now()`), con RLS activado, sin policies y `revoke all from anon, authenticated`.
3. `admin_borrar_cliente(p_admin_id text, p_admin_pin text, p_cliente_id text) returns jsonb`: copia exacta del patrón de `admin_baja_producto` (007:180-214): `security definer set search_path = public, pg_temp`, admin activo con `permiso=1` + `verificar_pin`, `return` en vez de `raise`. Hace insert en `_borrados` y `delete where id::text = p_cliente_id`; si ya no estaba → `ya_borrado`; captura `foreign_key_violation`. `revoke all from public; grant execute to anon, authenticated`.
4. `borrar_faltantes(p_ids text[]) returns jsonb`: security definer, `cardinality <= 200`, archiva y borra `where id::text = any(p_ids)`, devuelve `{ok, borrados}`. Mismos revoke/grant.
5. Si existe `public.pedidos`: `alter table ... add column if not exists client_uuid uuid` y `create unique index if not exists pedidos_client_uuid_uk on public.pedidos (client_uuid)` (no parcial, así sirve para `on_conflict` de PostgREST; varios null no chocan).
6. `movimientos_stock` (si existe): `drop constraint if exists movimientos_cantidad_chk` + `add ... check (cantidad <> 0 and abs(cantidad) <= 1000000) not valid`. Función `tg_movimiento_tipo_admin()` **sin** security definer (si no, `current_user` sería el dueño) + `drop trigger if exists` / `create trigger ... before insert or update`. En INSERT anon con tipo inicial/ajuste → `raise ... using errcode='23514'`. En UPDATE solo si cambian tipo/cantidad/producto_id hacia o desde esos tipos.
7. `admin_registrar_ajustes_stock(p_admin_id text, p_admin_pin text, p_movs jsonb) returns jsonb`: PIN como en 3, hasta 500 filas, valida id UUID, `tipo in ('inicial','ajuste')`, `ref ~ '^ajuste:'` y cantidad en rango. `insert ... on conflict (id) do nothing`, devuelve `{ok, ids}` (insertados + ya existentes). El implementador verifica las columnas reales contra `001_altas_y_stock.sql` y `movimientoToRemote`.
8. Al final, queries de verificación comentadas (grants, policies, índice).

## Funciones puras nuevas / cambiadas en `src/domain/`
- `precioCosto.js` (nuevo):
  - `gananciaConocida(p) → boolean` (false con undefined/null/'').
  - `precioEsCalculado(p) → boolean`: precio = `calcularPrecioVenta(p).precioVenta1`, con costos conocidos.
  - `debeRecalcularPrecio(existente, form) → boolean`: true solo si la ganancia efectiva (la de la fila o la conocida del existente) es > 0 **y** el precio anterior era el calculado o estaba vacío/0. (PVC-1)
  - `autocompletarPrecio(next, { precioManual, gananciaDesconocida }) → string|null`: null = no tocar; null si ganancia ≤ 0 o desconocida. (PVC-3)
  - `productosConPrecioSospechoso(productos) → [{id, codigo, nombre, precio, costoNeto}]`: costo conocido > 0 y `precio <= costoNeto`; saltea costos `undefined`. (PVC-4)
- `productos.js` `validarProducto`: devuelve además `avisos` (`{ok, errores, avisos, producto, stock}`, aditivo). Precio vacío + ganancia vacía/0/desconocida + costo > 0 ⇒ `errores.precio = 'Falta el precio de venta o el % de ganancia'`. Precio manual = costo neto (> 0) ⇒ `avisos.precio` sin bloquear. (PVC-2)
- `plantillas.js`: en `validarFilaProducto:349-351` se reemplaza la regla por `!existente ? '' : debeRecalcularPrecio(...) ? '' : se conserva existente.precio`; propaga `avisos` en el resultado; texto `INFO_PRODUCTO.ganancia/precio` (:40-41) corregido. (PVC-1/2/5)
- `respaldo.js` (nuevo):
  - `esPendiente(store, row)`: `pendingSync`, `synced===false`, `extrasPendientes`, `entregaPendiente`; en faltantes `!remoteId`; `comisionesBorradores`/`comprobantesPendientes` cuentan siempre (son solo locales); `costosVenta` nunca. Un store desconocido usa la regla por defecto.
  - `contarPendientes(snapshot) → {total, porStore}`; `textoPendientes(porStore) → string`.
  - `decidirBorradoCache({ total, online }) → {permitir, motivo:'ok'|'pendientes'|'offline'}`; `confirmacionEscritaValida(txt)` ('BORRAR', trim, sin distinguir mayúsculas).
  - `armarRespaldo(snapshot, { now, dbVersion }) → object`: saca recursivamente `pin|pinHash|pin_hash|adminPin|pinAdmin` y cambia Blob/ArrayBuffer por `"[archivo no incluido]"`.
  - `nombreArchivoRespaldo(now) → 'respaldo-distribuidora-AAAA-MM-DD-HHmm.json'`.
- `pedidosIdempotencia.js` (nuevo): `asegurarClientUuid(p, genId=nuevoId)`, `clientUuidToRemote(p) → {client_uuid}|{}`, `mapearRemoteIds(enviados, filas) → [{localId, remoteId}]` (cruce por client_uuid, no por índice), `vincularPorClientUuid(locales, remotos) → {vinculos, descartarRemoteIds}`.
- `syncGuardas.js` (nuevo): `idsSinCambios(enviados:[{id,updatedAt}], actuales) → ids`, `puedeMarcarSynced(actual, updatedAtEnviado)`, `idsFaltantesABorrar(locales, remotos, { completo }) → localIds` (devuelve [] si `!completo` o si remotos viene vacío).
- `deudas.js` (crear si no existe): `anularDeuda(d, now) → d'` (misma forma que hoy) y `esDeudaAnulada(d)`.

## Archivos, en orden de implementación
1. `src/domain/precioCosto.js`, `productos.js`, `plantillas.js` + tests — PVC-1/2/3/4/5.
2. `src/components/ProductoForm.js:69-79`: autocompleta con `autocompletarPrecio` (`gananciaDesconocida = inicial && inicial.ganancia === undefined`); muestra `errores.precio` en el campo y `avisos.precio` sin bloquear — PVC-2/3.
3. `src/pages/Configuracion.js` (tab productos, solo admin): aviso "N productos con precio igual o menor al costo" + lista con botón Editar; no corrige solo. En la importación muestra los avisos de las filas — PVC-4.
4. `src/domain/respaldo.js`, `pedidosIdempotencia.js`, `syncGuardas.js`, `deudas.js` + tests — SEG2-2/3/4/6/7.
5. `supabase/migrations/023_no_perder_datos.sql` + `src/domain/__tests__/migracion023.sql.test.js` — SEG2-1/3/5.
6. `src/db/index.js`: `leerTodosLosStores()` (recorre `objectStoreNames`); `addCliente`/`updateCliente` ponen `updatedAt: Date.now()`; `clearClientesPendingSync(enviados)` acepta ids (legacy) u objetos `{id, updatedAt}` y limpia solo lo que no cambió; `markPedidoSynced(id, remoteId, { updatedAtEnviado })` guarda siempre el remoteId pero deja `synced:false` si cambió — SEG2-3/7.
7. `src/services/pedidoRepository.js` `crearPedidoOnlineFirst`: (a) `addPedido(asegurarClientUuid(p))` siempre primero; (b) si hay red, `upsert(row, {onConflict:'client_uuid', ignoreDuplicates:true}).select('id,client_uuid')` y, si no vuelve fila, `select ... eq client_uuid`; (c) `markPedidoSynced`; (d) con error devuelve `{localId, mode:'pendiente', error}` **sin throw**. `toRemoteRow` suma `clientUuidToRemote` — SEG2-3.
8. `src/pages/NuevoPedido.js:433` (try/catch, toast "Guardado en este dispositivo, sin subir" si `mode==='pendiente'`; tolera `res` undefined de los mocks) y `src/pages/ListaPedidos.js` (badge "Sin subir" si `!p.synced && !p.borrado`) — SEG2-3.
9. `src/sync/syncService.js`:
   - `pedidoToRemoteRow` + `client_uuid`.
   - `syncPedidosPendientes`: antes de subir, asigna el UUID a los pendientes sin remoteId (`patchRegistros`); upsert por lote con ignoreDuplicates; mapeo con `mapearRemoteIds`; `markPedidoSynced` con updatedAt.
   - `mapPedidoRemoto` lee `clientUuid`; `putPedidosRemotosSinPisarLocales` usa `vincularPorClientUuid` (vincula el remoteId al local en vez de duplicarlo).
   - `syncFaltantes` (:1315-1349): pull paginado `.order('id').range` y paso 3 con `idsFaltantesABorrar`.
   - `syncClientes` (:799-805): 401/403 ⇒ `{ok:false, motivo:'sin_permiso', mensaje}` y el orquestador lo muestra; `clearClientesPendingSync(batch → {id, updatedAt})` — SEG2-3/4/7.
10. Bajas: `Configuracion.js:450-464` (modal con PIN, igual que la baja de vendedores → `admin_borrar_cliente`, fallback al delete directo sin la 023) y `:492-503` (proveedor → `putProveedor({activo:false})`); `src/services/clientesAdminService.js` (nuevo, orquesta el RPC); `deudaRepository.js:73,167,228` (→ `anularDeuda`); `Faltantes.js:273` y `faltanteRepository.js:23` (→ `borrar_faltantes`, fallback) — SEG2-1.
11. `src/services/stockService.js` + `productosAdminService.subirProductosConPin`: sube los `ajuste`/`inicial` que siguen pendientes con `admin_registrar_ajustes_stock` (misma credencial) — SEG2-5.
12. `src/services/respaldoService.js` (nuevo: `exportarRespaldo()` arma un Blob y lo descarga con `<a download>`; `evaluarBorradoCache()`), `limpiarCache.js` (no borra si `decidirBorradoCache` no lo permite, salvo `{forzado:true}`), `App.js:105-112` (flujo: todo subido + online ⇒ confirm; si no, lista lo pendiente y ofrece exportar + `prompt` BORRAR), `Configuracion.js` (botón "Exportar respaldo", admin) — SEG2-2/6.
13. `.gitignore`: `backups/`, `supabase/limpieza_datos.sql`, `supabase/truncate_todas.sql` — SEG2-6.

## Riesgos de concurrencia offline / multidispositivo
- Respuesta del insert perdida → reintento: `client_uuid` único + `on conflict do nothing` y se lee el id por UUID ⇒ un solo pedido. El cruce es por UUID (antes era por índice, S-1110-05).
- Insert que llegó pero el dispositivo no se enteró y después un pull: `vincularPorClientUuid` engancha la fila remota al pedido local; no hay copia local doble.
- Edición mientras sube (pedido/cliente): se limpia el flag solo si `updatedAt` es el que se envió (patrón `clearPendingSiNoCambio`); si no, queda pendiente y sube en la próxima.
- Pedidos viejos sin UUID: ya subidos (remoteId) no cambian. Los pendientes reciben UUID antes del primer intento ⇒ desde ahí es idempotente. Sin la 023 se sigue con el insert de siempre (riesgo de hoy, avisado).
- Dos dispositivos con el mismo pedido offline: tienen UUID distintos (son pedidos distintos de verdad). No se toca S-1110-11.
- Faltantes: con una página con error no hay purga; con remoto vacío tampoco (mismo criterio que proveedores).
- Ledger: los movimientos siguen con UUID; el ajuste rechazado no se pierde (queda `pendingSync`). El stock nunca se sube como número.
- Borrar caché: se cuenta sobre **todos** los stores; los binarios de `comprobantesPendientes` no entran en el JSON ⇒ siempre cuentan como pendientes y exigen el camino forzado.

## Riesgos de regresión
- Altas por planilla o formulario con costo y sin precio ni ganancia, que antes pasaban, ahora se rechazan (es el pedido del AC).
- Admin sin la 023 en el servidor: todos los fallbacks dejan el comportamiento actual.
- Un vendedor que ajusta stock: hoy solo lo hace Configuración (admin). Verificar con Grep que no haya otro `movimientoAjuste`.
- Mocks de `../db` con listas explícitas: si el código llama a `leerTodosLosStores` o `patchRegistros`, hay que sumarlos a los mocks.

## Tests existentes que cambian
- `src/components/__tests__/ProductoForm.test.js:71-84` (precio '1000'/'900'/'855' sin ganancia ⇒ queda vacío hasta ganancia > 0), `:107-108` (ganancia 0 ya no lleva el precio a 1200).
- `src/domain/__tests__/plantillas.test.js:192-197` (confirmar que `PRODUCTOS[0]` tiene ganancia > 0 y precio calculado; si no, ajustar el fixture), y filas con costo sin precio/ganancia en `qa.plantillas.bordes`, `plantillas.precioBulto`, `grupoBulto`, `importacion` (correr y ajustar los fixtures, no la regla).
- `src/services/__tests__/deudaRepository*.test.js` (delete online ⇒ anulación), `src/pages/Configuracion.test.js` (borrar cliente con PIN/RPC), `src/services/__tests__/pedidoRepository.test.js` (crear: local primero, sin throw), `entregadoSync.test.js` / `syncLote011.test.js` (firma de `markPedidoSynced`, client_uuid en las filas).

## Plan de pruebas (por AC)
| AC | Test | Tipo |
|---|---|---|
| PVC-1 | `precioCosto.test.js` (debeRecalcularPrecio) + `plantillas.pvc.test.js` casos B, C y D con `planificarImportacion` | unit dominio |
| PVC-2 | `productos.pvc.test.js` (error, aviso precio=costo) + caso A por planilla | unit dominio |
| PVC-3 | `ProductoForm.pvc.test.js`: sin ganancia no autocompleta; `inicial.ganancia` undefined no toca el precio | componente (jsdom) |
| PVC-4 | `productosConPrecioSospechoso` (≤, costo desconocido, costo 0) + `Configuracion.pvc.test.js` aviso solo admin | unit + página |
| PVC-5 | snapshot del texto `INFO_PRODUCTO` + casos A/B/C | unit |
| SEG2-1 | `migracion023.sql.test.js` (revoke delete/truncate ×5, sin grant delete a anon en 023, RPC con definer/search_path/revoke/grant/verificar_pin, archivos `_borrados`, sin drop/truncate); `clientesAdminService.test.js` (RPC + fallback) | estático SQL + servicio |
| SEG2-2 | `respaldo.test.js` (esPendiente por store, decidirBorradoCache, BORRAR) + `limpiarCache.test.js` (no borra con pendientes/offline; forzado sí) | unit + servicio |
| SEG2-3 | `pedidosIdempotencia.test.js`; `pedidoRepository.idempotencia.test.js` (red cae ⇒ queda local `synced:false`; reintento con el mismo UUID ⇒ un upsert con onConflict client_uuid; columna ausente ⇒ fallback); `syncPedidos.uuid.test.js` (respuesta parcial mapeada por UUID; pull vincula) | unit + servicio (supabase mock) |
| SEG2-4 | `syncGuardas.test.js` (idsFaltantesABorrar) + `syncFaltantes.paginado.test.js` (1500 filas en 2 páginas; página con error ⇒ no purga) | unit + servicio |
| SEG2-5 | `migracion023.sql.test.js` (trigger sin security definer, errcode 23514, check not valid, RPC ajustes) + `stockService.ajustesPin.test.js` (rechazo anon ⇒ queda pendiente; sube con PIN) | estático + servicio |
| SEG2-6 | `respaldo.test.js` (sin pin/pinHash, nombre con fecha) + test estático de `.gitignore` (backups/, *.sql sueltos) + botón solo admin | unit + estático + página |
| SEG2-7 | `syncClientes.permisos.test.js` (403 ⇒ ok:false con mensaje; edición durante la subida sigue `pendingSync`) | servicio |

Gates: `CI=true npx react-scripts test --watchAll=false`, `npx react-scripts build`, `node harness/gates/run-gates.mjs`.
