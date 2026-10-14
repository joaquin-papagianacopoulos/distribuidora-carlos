# Plan — RUN 20261014-2036 — S-VTA-01 (seguimiento REQ-VTA)

Alcance: cerrar INSERT/UPDATE/DELETE de `public.productos` para la anon key y pasar la escritura a RPC
`security definer` con PIN de admin (patron `admin_guardar_vendedor` / `admin_baja_vendedor`, 002/004).
Cubre: S-VTA-01 (seguridad.md 20261014-1621), AC-SEC-1/2/4, AC-VTA-5 (tolerancia a migracion faltante).
Fuera de alcance: RPC publica de REQ-TIE, baja logica de productos, rate limiting (ver "Riesgos a futuro").

## Criterios de aceptacion de esta corrida (ids locales, los tests los nombran)
- **S01-1** La 007 revoca INSERT/UPDATE/DELETE de `productos` a `anon, authenticated`; SELECT se mantiene.
- **S01-2** RPC `admin_guardar_productos` y `admin_baja_producto`: autorizan solo admin activo con PIN; respuesta
  generica `no_autorizado`; lista blanca de columnas; sin SQL dinamico; sin `select *` en la salida.
- **S01-3** `syncProductos` funciona ANTES (directo) y DESPUES de la 007 (RPC con cred); sin cred y con escritura
  cerrada NO lanza: deja `pendingSync`, devuelve `requierePinAdmin` y el sync general sigue (clientes, pedidos).
- **S01-4** Se limpia `pendingSync` solo de los ids aceptados por el servidor Y no editados durante la subida.
- **S01-5** Borrar producto: con 007 pide PIN y usa la RPC; sin 007 sigue el flujo actual (delete + verificacion).
- **S01-6** Usuario no admin (permiso 2/3): nunca llama a las RPC admin; sus pendientes no se pierden ni se pisan.
- **S01-7** Ningun payload de producto lleva stock (stock solo por `movimientosStock`).

## Modelo de datos
### IndexedDB
- **Sin cambios de schema. `DB_VERSION` queda en 7.** Campo nuevo opcional (sin indice) en registros de
  `productos`: `syncRechazo: string|null` (motivo devuelto por la RPC para esa fila). Se escribe con
  `patchRegistros`, se limpia cuando la fila se acepta. Productos viejos sin el campo = `null`.

### Supabase — `supabase/migrations/007_productos_escritura_admin.sql`
- Sin tablas ni columnas nuevas. `begin; ... commit;`, idempotente (`create or replace`, `revoke`/`grant` repetibles).
- Paso 0 (do-block, aborta sin tocar nada): exige `public.verificar_pin(text,text)` (002 PASO 1), columna
  `vendedores.activo` (004) y columnas `productos.venta_por/bulto_nombre/visible_tienda` (006) via
  `to_regprocedure` / `information_schema.columns` (consultas estaticas, sin `execute`).
- Paso 1: `revoke insert, update, delete on public.productos from anon, authenticated;`
  `grant select on public.productos to anon, authenticated;` (re-asegura lectura). Los grants se chequean antes
  que RLS: cierra la escritura aunque existan policies `using(true)` creadas desde el dashboard (no estan en el
  repo, por eso no se las nombra ni se hace `drop policy` a ciegas). NO se toca `enable row level security`.
- Paso 2: `public.admin_guardar_productos(p_admin_id text, p_admin_pin text, p_filas jsonb) returns jsonb`
  - `security definer set search_path = public, pg_temp`. `revoke all ... from public`; `grant execute ... to anon, authenticated`.
  - Autorizacion identica a `admin_baja_vendedor`: id vacio o >64 => `{ok:false,motivo:'no_autorizado'}` ANTES de
    `verificar_pin` (sirve de sonda sin gastar intentos); luego `verificar_pin` SIEMPRE + exists(permiso=1, activo,
    pin_hash not null); cualquier falla => `no_autorizado` (return, no raise: el intento fallido queda registrado).
  - `p_filas` debe ser array de 1..500 elementos; si no => `{ok:false,motivo:'lote_invalido'}`.
  - Por fila (bloque `begin ... exception when check_violation or not_null_violation or invalid_text_representation
    or numeric_value_out_of_range`): `id` bigint > 0; `nombre` 1..200 chars trim; `precio` >= 0; `imagen_url` null o
    `^https?://` y <= 1000; textos acotados (codigo 64, unidad 32, categoria/marca 120, bulto_nombre 20).
    `insert ... on conflict (id) do update` con columnas listadas a mano. Si `fila->>'extras' = 'true'` actualiza
    tambien 001+006 (proveedor_id, costo_final, descuento1/2, ganancia, precio_venta2, bulto_x, minimo_venta,
    venta_por, bulto_nombre, visible_tienda); si no, solo basicas (preserva la regla "CSV no pisa extras").
    Claves desconocidas (p. ej. `stock`) se ignoran. Las constraints existentes (productos_valores_chk,
    productos_venta_bulto_chk) siguen aplicando y su violacion rechaza SOLO esa fila.
  - Respuesta: `{ok:true, aceptados:[id...], rechazados:[{id, motivo}]}`; motivos fila: `datos_invalidos`, `id_invalido`.
- Paso 3: `public.admin_baja_producto(p_admin_id text, p_admin_pin text, p_producto_id bigint) returns jsonb`
  - Misma autorizacion. `delete from public.productos where id = p_producto_id` (mismo efecto que el boton actual).
  - `{ok:true}`, `{ok:true, ya_borrado:true}` (idempotente si no existe), o `{ok:false, motivo}`.
  - No toca `movimientos_stock` (el ledger queda intacto).
- Comentario de cabecera: orden de aplicacion (001, 002 PASO 1, 004, 006, luego 007), consulta de control de
  admins sin PIN (la de la 004), y que tras correrla los cambios de productos se suben con PIN de admin.

### Mapeo campo UI -> interno -> remoto (payload jsonb de la RPC = nombres de columna)
| UI | Interno (IndexedDB) | Clave en `p_filas[i]` / columna |
|---|---|---|
| Nombre / Codigo / Precio venta 1 | `nombre`, `codigo`, `precio` | `nombre`, `codigo`, `precio` |
| Unidad / Rubro / Marca / Foto | `unidad`, `categoria`, `marca`, `imagen_url` | `unidad`, `categoria`, `marca`, `imagen_url` |
| Proveedor, costo, desc., ganancia, P.venta 2, bulto, minimo | `proveedorId`, `costoFinal`, `descuento1/2`, `ganancia`, `precioVenta2`, `bultoX`, `minimoVenta` | via `productoExtraToRemote` (001) |
| Se vende por / Etiqueta bulto / Mostrar en tienda | `ventaPor`, `bultoNombre`, `visibleTienda` | via `productoVentaToRemote` (006) |
| (control) | `extrasDirty || extrasPendientes` | `extras: true/false` |
| Stock | NO viaja (ledger `movimientosStock`) | — |

## Funciones puras de dominio (nuevo `src/domain/productosRpc.js`)
- `filaProductoRpc(p, { conExtras }) -> object` — fila con claves remotas; basicas siempre, 001+006 solo si
  `conExtras`; nunca claves de stock; `extras` booleano. Reusa `productoExtraToRemote`/`productoVentaToRemote`.
- `armarLotesProductosRpc(pendientes, tam = 500) -> Array<{ filas, ids, huellas: Map<id,string> }>` — descarta
  ids no enteros seguros (los reporta aparte, mismo criterio que hoy).
- `huellaProductoSync(p) -> string` — serializacion estable de los campos que viajan; sirve para limpiar solo
  lo que no cambio durante la subida (S01-4).
- `interpretarGuardarProductos({ data, error }) -> { ok, motivo?, mensaje?, aceptados: id[], rechazados: {id,motivo}[] }`
  — motivos: `no_autorizado`, `bloqueado` (P0001 "Demasiados intentos"), `falta_migracion` (funcion inexistente),
  `lote_invalido`, `respuesta_invalida` (data con forma inesperada => no limpia nada), `error`. Mensajes en
  `MENSAJES_PRODUCTOS` (rioplatense, sin exponer detalles del servidor).
- `interpretarBajaProducto({ data, error }) -> { ok, motivo?, mensaje?, yaBorrado? }`.
- `argsAdminProductos({ adminId, adminPin }) -> { p_admin_id, p_admin_pin }` (trim, string; el PIN no se guarda).
- `puedeEditarProductos(permiso) -> boolean` = `esAdmin(permiso)` (AC-SEC-4).
- En `src/sync/tolerancia.js` (puras, junto a `esColumnaInexistente`):
  - `esFuncionInexistente(error)` — `PGRST202`, `42883`, /could not find the function/.
  - `esEscrituraDenegada(error)` — `42501`, /permission denied|row-level security/.

## Archivos, en orden
1. `supabase/migrations/007_productos_escritura_admin.sql` (nuevo) — S01-1, S01-2, S01-7.
2. `src/sync/tolerancia.js` — `esFuncionInexistente`, `esEscrituraDenegada` — S01-3.
3. `src/domain/productosRpc.js` (nuevo) — funciones de arriba — S01-2/4/6/7, AC-SEC-2.
4. `src/db/index.js` — `clearProductosPendingSyncSiIgual(ids, huellas)` (aditiva: limpia solo si la huella local
   actual coincide; `clearProductosPendingSync` queda igual para no romper llamadores). Sin cambio de `DB_VERSION` — S01-4.
5. `src/sync/syncService.js` — `syncProductos({ cred } = {})`:
   - con `cred`: RPC por lotes de 500; `falta_migracion` => camino directo actual (`upsertEscalonado` + basico);
     `no_autorizado`/`bloqueado` => devuelve `{ok:false, motivo}` sin limpiar; aceptados => limpiar con huella +
     `extrasPendientes:false, extrasDirty:false, syncRechazo:null`; rechazados => `patchRegistros(..., {syncRechazo})`,
     siguen pendientes.
   - sin `cred`: camino directo actual; si `esEscrituraDenegada` => NO lanza, devuelve
     `{ ok:true, requierePinAdmin:true, pendientes:n }`, no limpia nada; flag de modulo para no reintentar el
     directo en la misma sesion (se resetea al recargar). Otros errores siguen lanzando como hoy.
   - `uploadSeedToSupabase`: si el upsert de productos da `esEscrituraDenegada`, error claro "usar Subir productos con PIN".
   - `downloadMaestros`: sin cambios (ya no pisa `pendingSync`).
6. `src/services/productosAdminService.js` (nuevo) — `credencialesAdminProductos(pin)` (mismo patron que
   `credencialesAdminRubro`: id remoto de la sesion, `validarPinIngresado`), `sondearMigracion007()` (RPC con id
   vacio; error de funcion inexistente => falta; cualquier excepcion => falta, flujo viejo),
   `subirProductosConPin(pin)` (exige `esAdmin(sesion)` y online), `borrarProductoAdmin({ pin, producto })`
   (con 007: RPC y luego `deleteProducto` local solo si ok; sin 007: flujo actual delete+select de verificacion,
   movido desde Configuracion), `contarProductosPendientes()` — S01-3/5/6.
7. `src/services/comisionesService.js` — en `confirmarCierre` pasar `syncProductos({ cred: cr.cred })` (ya tiene la
   credencial del admin; antes de la 007 el fallback deja todo como hoy) — S01-3.
8. `src/hooks/useAppContext.js` — `runSync`: si `syncProductos()` devuelve `requierePinAdmin`, setear `syncNote`
   (no `syncError`) "Hay N productos sin subir: un admin los sube desde Configuracion con su PIN" — S01-3/6.
9. `src/pages/Configuracion.js` — pestaña productos: aviso "N productos sin subir" + input PIN + boton "Subir
   productos" (llama `subirProductosConPin`; el PIN se borra del estado al enviar, como `bajaPin`); filas con
   `syncRechazo` marcadas. Borrar producto: `sondearMigracion007()`; si falta => flujo actual sin PIN (los tests
   existentes siguen verdes); si existe => modal de PIN (mismo patron que baja de vendedor) y `borrarProductoAdmin`.
   Mensaje post-CSV/guardado cuando `requierePinAdmin` — S01-3/5.
10. Tests (ver plan de pruebas) y `harness/reports/20261014-2036/` (reportes del pipeline).

## Comportamiento con permiso 2/3 (vendedor/armador) offline
- Hoy no pueden editar productos (Configuracion exige admin), pero un registro `pendingSync` puede existir en su
  dispositivo (datos viejos, sesion admin previa en el mismo equipo, procesos de fondo).
- Default elegido (no pierde datos y es el mas seguro): **nunca se descarta el cambio local**; `syncProductos()`
  sin cred intenta directo (antes de la 007 sube como hoy); despues de la 007 queda pendiente y se avisa con
  `syncNote`. `downloadMaestros` no lo pisa (regla existente). No se le pide PIN a un no admin ni se llama la RPC.
- Si un admin inicia sesion en ese dispositivo, puede subirlos con su PIN desde Configuracion.
- **A confirmar con el dueño:** si los pendientes de un no admin deberian descartarse y re-bajarse del servidor
  (opcion "Descartar cambios locales" para admin). Por ahora: se conservan.

## Riesgos de concurrencia offline / multidispositivo
| Riesgo | Mitigacion |
|---|---|
| Edicion del producto mientras el lote viaja | `clearProductosPendingSyncSiIgual` con huella por id (S01-4). |
| Reintentos / doble envio | RPC = upsert por `id` (idempotente); baja idempotente (`ya_borrado`). |
| Lote con una fila invalida bloquea todo | excepcion por fila => solo esa queda en `rechazados` con `syncRechazo`. |
| Respuesta parcial o malformada | `respuesta_invalida` => no se limpia ningun id. |
| Escritura directa cerrada en medio de un sync | `esEscrituraDenegada` => pendientes intactos, sync general sigue. |
| 007 aplicada con clientes viejos en otros equipos | clientes viejos reciben 42501 al subir productos y lanzan (como cualquier error hoy); sus cambios quedan locales, no se pierden. Publicar build nueva antes o junto con la 007. |
| Dos admins editan el mismo producto | last-write-wins por fila (igual que hoy); sin cambio de semantica. |
| Fuerza bruta de PIN via RPC | `verificar_pin` (5 fallos / 15 min); respuesta generica; el PIN no se guarda ni loguea (AC-SEC-1). |
| IDs | `productos.id` es bigint legacy (no tabla nueva): se mantiene; regla randomUUID no aplica. |
| Stock | ninguna ruta toca stock; whitelist SQL + test de dominio (S01-7). |

## Plan de pruebas
| Criterio | Test | Tipo |
|---|---|---|
| S01-1, S01-2 | `src/domain/__tests__/migracion007.productos.test.js` (lee el .sql): revoke insert/update/delete a anon y authenticated; ningun `grant (insert|update|delete|all)` sobre productos; sin `revoke select`; sin `drop table/column`, `truncate`, `drop policy`; `delete from public.productos` solo dentro de `admin_baja_producto`; sin `execute`/`format(`/`select *`; `security definer` + `set search_path`; `revoke all ... from public` + grant execute; `begin/commit`, `create or replace`; do-block de prerrequisitos; llamada a `verificar_pin`; limite 500 | estatico (Jest) |
| S01-2, S01-7, AC-SEC-2 | `src/domain/__tests__/productosRpc.test.js`: `filaProductoRpc` con/sin extras, sin `stock`, defaults de productos viejos; `huellaProductoSync` estable; `armarLotesProductosRpc` (500, ids invalidos); `interpretarGuardarProductos` (ok, parcial, no_autorizado, P0001, PGRST202, data null/forma rara); `interpretarBajaProducto`; `puedeEditarProductos` 1/2/3/invalido | unidad |
| S01-3 | `src/services/__tests__/syncTolerante.test.js` (extender, describe "S01 escritura de productos"): sin cred + 42501 => no lanza, `requierePinAdmin`, `pendingSync` intacto; sin cred + sin error => igual que hoy; con cred + PGRST202 => cae a `upsertEscalonado`; con cred + ok => una RPC por lote, sin `from('productos').upsert` | servicio (mock supabase/db) |
| S01-4 | mismo archivo: aceptados parciales => limpia solo esos; producto editado durante la subida sigue pendiente; rechazado => `syncRechazo` y pendiente | servicio |
| S01-5 | `src/services/__tests__/productosAdminService.test.js`: borrar con 007 (RPC ok => deleteProducto local; no_autorizado => no borra local); sin 007 => flujo viejo; offline => no toca nada; sondeo con excepcion => flujo viejo | servicio |
| S01-6 | productosAdminService + syncTolerante: sesion permiso 2/3 => nunca `rpc('admin_guardar_productos')`, pendientes conservados | servicio |
| S01-3, S01-5 (UI) | `src/pages/Configuracion.test.js` (extender sin modificar casos existentes): aviso de pendientes y subida con PIN; modal PIN de borrado cuando la sonda dice que hay 007; PIN se limpia del estado | Testing Library |
| S01-3 (cierre) | `src/services/__tests__/comisionesService.test.js` (extender): `confirmarCierre` pasa `cred` a `syncProductos` | servicio |
| Regresion | suite completa + build + `node harness/gates/run-gates.mjs`; ningun test existente borrado/salteado | gates |

## Supuestos
- Las policies `to anon ... using(true)` de productos se crearon fuera del repo; se cierra por GRANT (no depende de
  sus nombres). No se habilita RLS en productos (si no hubiera policy de select, se cortaria la lectura).
- La 004 y la 006 se aplican antes que la 007 (la 007 aborta con mensaje claro si faltan).
- La baja de producto sigue siendo fisica (igual que hoy, pero solo admin con PIN). **A confirmar:** pasar a baja
  logica (`borrado_en`) como sugiere la 002 PASO 3; y si se debe impedir borrar productos con movimientos de stock.
- El PIN no se recuerda en la sesion (criterio S-COM-01): por eso, tras la 007, los cambios de productos se suben
  con accion explicita del admin o en el cierre de comisiones. **A confirmar** si el dueño acepta esa friccion.
- `imagen_url` y `marca` cargadas por procesos de fondo (fotos, backfill) siguen el mismo camino que una edicion.

## Pasos manuales (dueño)
1. Publicar la build nueva. 2. Verificar 004 y 006 aplicadas. 3. Correr 007 en el SQL Editor (backup antes).
4. Probar: editar un producto, "Subir productos" con PIN; `curl` PATCH a `/rest/v1/productos` con anon key => 401/403.
