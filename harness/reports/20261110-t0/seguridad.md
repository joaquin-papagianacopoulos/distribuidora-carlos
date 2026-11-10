# Seguridad tanda 0 (REQ-PVC / REQ-SEG2) - RUN 20261110-t0

Alcance: diff + archivos nuevos. Solo lectura de codigo; no se ejecuto SQL. Crítico: 0, Alto: 0, Medio: 5, Bajo: 5.
No se encontro PIN/clave en logs ni en el respaldo (regex de claves). Migracion 023: idempotente, search_path fijo, PIN validado con verificar_pin (con limite de 5 intentos de la 002).

## Medio

**M-1 limpiarCache falla abierto** - src/services/limpiarCache.js:52-53 y src/App.js:112-116.
Si `evaluarBorradoCache` lanza (IndexedDB bloqueada, upgrade en curso, store ilegible), se hace `ev = null` y se BORRA igual, sin respaldo ni PIN. Escenario: lectura falla justo cuando hay pedidos sin subir. Correccion: ante excepcion devolver `{ bloqueado: true, motivo: 'no_se_pudo_leer' }` y en App.js tratar `ev == null` como bloqueado (camino forzado con respaldo).

**M-2 Respaldo con costos/datos de admin para cualquier rol** - src/App.js:123-127 (camino forzado, lo ve todo usuario) + src/domain/respaldo.js:45-56.
`armarRespaldo` solo saca claves `pin*`. Se exportan tal cual `costosVenta`, `ingresosCostos`, `cuentaProveedores`, `comisionesCierres/Rubro`, `cambiosPrecio` y `productos.costo*` si en ese dispositivo hubo sesion de admin (los costos bajan con PIN de admin). Un vendedor en el celular compartido se lleva un JSON con costos. Correccion: pasar `esAdmin` a `exportarRespaldo`; si no es admin, filtrar esos stores y las claves de costo/ganancia/descuento de `productos` e items de `pedidos`.

**M-3 Edicion perdida cuando el alta ya existia en la nube** - src/services/pedidoRepository.js:64-80 y 125-130; src/sync/syncService.js:539-575.
El upsert usa `ignoreDuplicates: true` (DO NOTHING). Escenario: el alta llego pero la respuesta se perdio, el usuario edita el pedido (cantidades, items) antes de que el pull enganche el remoteId; el reintento "conflicta", se ignora, se devuelve el id existente y el local queda `synced:true` con la version vieja en la nube; el proximo pull pisa la edicion local. Correccion: si el id vino por la busqueda por UUID (no estaba en la respuesta del upsert), hacer luego `update(row).eq('id', id)` antes de marcar synced.

**M-4 borrar_faltantes sin PIN: el tope es por llamada, no total** - supabase/migrations/023:108-127.
Con la anon key, un atacante itera ids (200 por RPC) y vacia la tabla. Queda archivado en faltantes_borrados (recuperable), pero se pierde el dato operativo. Correccion minima: exigir que el faltante tenga mas de N min / limitar por fecha (`f.fecha >= current_date - 60`) y registrar cuenta; ideal: rate-limit con tabla de intentos como vendedores_pin_intentos.

**M-5 Los datos siguen sobrescribibles/borrables por UPDATE** - supabase/migrations/023:19-35.
Se quita DELETE pero las policies `using(true)` de UPDATE siguen: anon puede vaciar campos o poner `monto=0, pagada=true` (la app misma "anula" asi). El objetivo "no perder datos" solo se cumple contra DELETE. Residual conocido; correccion: trigger de auditoria/version (historial) en clientes, deudas, pedidos o RPCs con PIN. Tambien persiste: anon puede insertar movimientos 'ingreso'/'anulacion' (hasta 1.000.000) e inflar stock (el trigger solo frena 'ajuste'/'inicial').

## Bajo

**B-1 Ajustes de stock solo suben con "subir productos con PIN"** - src/services/productosAdminService.js:72-76. Quedan `pendingSync` y, para no-admin, para siempre: cuentan como pendientes y bloquean "Borrar cache" (obliga al camino forzado). El stock no se ve en otros dispositivos hasta que el admin suba. Correccion: avisar en UI "ajustes sin subir: N".

**B-2 Pull por client_uuid solo contempla locales con remoteId vacio** - src/domain/pedidosIdempotencia.js:48-65. Si un pedido clonado heredara clientUuid (hoy no hay clonado: NuevoPedido crea uno nuevo) se fusionaria con el original en silencio. Correccion: al duplicar, `delete clientUuid`.

**B-3 Rendiciones 'rechazada' no cuentan como pendientes** - src/domain/respaldo.js:14-17 (pendingSync false). El borrado de cache las pierde sin aviso. Otros stores (cambiosPrecio, comisionesCierres/Rubro, pedidosWebAcciones, cuentaClientes, pedidosProveedor) no se verificaron: confirmar que su marca sea pendingSync/synced:false. Correccion: contar `syncEstado === 'rechazada'`.

**B-4 anularDeuda pisa el monto original** - src/domain/deudas.js:7-8. Antes el delete tambien lo perdia, pero ahora seria recuperable: guardar `montoOriginal` antes de poner `monto: 0`.

**B-5 Migracion 023 usa columna `activo` (004) y pin_hash** - supabase/migrations/023:76 y 209. El encabezado dice "requisito 002"; sin la 004 las RPC fallan en runtime (no al crear). Agregar la 004 al requisito. Ademas `faltantes` paginado ordena por `id`: si se borra una fila entre paginas se omite otra y el local se purga (se vuelve a bajar en el siguiente sync, sin perdida real).

## Verificado sin hallazgo
- Trigger de stock: SECURITY INVOKER, `current_user` distingue anon de la RPC definer; los push con 23514 reintentan fila por fila (pushPendientes), un ajuste rechazado no frena ventas/ingresos. Movimientos viejos: el check es NOT VALID y el UPDATE de re-keyeo de ref (venta) no se bloquea.
- Revoke DELETE: no queda ningun `.delete()` de la app sobre clientes/deudas/faltantes/proveedores/pedidos sin RPC o fallback (productos usa admin_baja_producto, fuera de alcance).
- Idempotencia: respuesta parcial cruzada por UUID (no por posicion); sync concurrente con crearPedidoOnlineFirst no duplica; error de red deja el pedido local y visible (mode 'pendiente').
- Faltantes: no se purga con lectura incompleta ni con remoto vacio; no se purgan pendientes ni sin remoteId.
- limpiarCache: con pendientes u offline bloquea; camino forzado exige respaldo + escribir BORRAR.
