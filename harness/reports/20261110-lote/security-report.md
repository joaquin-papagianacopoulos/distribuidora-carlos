# Auditoria de seguridad - RUN 20261110-lote (perdida y filtracion de datos)

## Resumen ejecutivo
Crítico: 2, Alto: 6, Medio: 8, Bajo: 4. Alcance: toda la app, foco del dueño: no perder datos, no filtrar datos. No se modifico `src/**`; no se leyo `.env`; no se aplico SQL.
No se pudo verificar el estado REAL de Supabase: no hay herramientas MCP de Supabase en esta corrida. Todo lo de RLS/grants sale de las migraciones 001-022 (se aplican a mano; las tablas base `pedidos`, `clientes`, `deudas`, `faltantes`, `vendedores`, `productos` NO se crean en ninguna migracion, su RLS es desconocido). Queries de verificacion al final.
Lo mas grave: la anon key (publica en el bundle) lee y escribe los datos operativos y puede BORRAR clientes/deudas/faltantes; ademas "Borrar cache" y el alta online de pedidos pueden perder trabajo sin avisar.

## Tabla de hallazgos
| Id | Severidad | Hallazgo | Evidencia | Estado | Dónde se corrige |
|---|---|---|---|---|---|
| S-1110-01 | Crítico | Sin auth real: la anon key lee/escribe pedidos, clientes (CUIT, tel, direccion, contacto), deudas, faltantes, proveedores, movimientos; el PIN solo protege la UI y las RPC admin (heredado S-01 de 20261007) | 002:1-12,370-383; syncService.js:553,1004,1426 | ABIERTO | Supabase Auth/Edge Function + RLS (paso 5 de la 002) |
| S-1110-02 | Crítico | DELETE anonimo masivo: `DELETE /rest/v1/clientes?id=gt.0` vacia el maestro (la 020 devolvio delete a anon); deudas, faltantes y proveedores tambien (002 solo revoca truncate/delete en pedidos, clientes, vendedores, ledger) | 020:4-7; 002:223-238,359; Configuracion.js:457,497; deudaRepository.js:73,167,228 | ABIERTO | SQL de abajo + baja logica en cliente |
| S-1110-03 | Alto | "Borrar cache" no cuenta ni bloquea pendientes: borra TODA la IndexedDB, borradores y cursores; permite seguir offline; "tocá Sync" no alcanza (productos/costos/compras/rendiciones/cambios de precio quedan pendientes hasta que un admin los suba con PIN; comprobantes y borradores son solo locales) | App.js:107-112; limpiarCache.js:21-52 | ABIERTO | Cliente: contar `pendingSync/synced:false` y bloquear |
| S-1110-04 | Alto | Alta de pedido online sin idempotencia ni respaldo local: con `navigator.onLine` true y red mala, el insert falla/timeout, no se guarda local y `guardar` no tiene try/catch (sin aviso). Si el insert llego pero la respuesta se perdio, reintentar duplica el pedido | pedidoRepository.js:53-69; NuevoPedido.js:384-441 | ABIERTO | Cliente: guardar local primero + `idempotencia` unico |
| S-1110-05 | Alto | Pedidos tambien se duplican en el sync offline: insert por lote sin clave de idempotencia; si `ids.length != toInsert.length` o se corta la respuesta, los no marcados se reinsertan (ademas 150 por corrida) | syncService.js:516-538 | ABIERTO | Columna `client_uuid` unica + upsert |
| S-1110-06 | Alto | syncFaltantes baja `select('*')` sin paginar (tope 1000 de PostgREST) y el paso 3 borra localmente todo lo que no vino: pasados ~1000 faltantes los viejos desaparecen del dispositivo y no vuelven. Subida sin id propio: respuesta perdida = faltante duplicado | syncService.js:1316-1346,1289-1303 | ABIERTO | Paginar o quitar el paso 3 |
| S-1110-07 | Alto | Ledger forjable: anon inserta `movimientos_stock` tipo `ajuste`/`inicial` de cualquier signo y magnitud (el check solo restringe venta/ingreso/anulacion); no se puede borrar pero ensucia stock y `tienda_catalogo.disponible` | 001:150; 002:290-297 | ABIERTO | Check de magnitud (SQL abajo) |
| S-1110-08 | Alto | No hay estrategia de backup/export: no existe exportar JSON (solo `importBackup`, que ademas borra 5 stores antes de validar y no se usa en UI). Backups de Supabase no verificables (plan Free no incluye) | db/index.js:714-747 | ABIERTO | Dueño (ver abajo) |
| S-1110-09 | Medio | Edicion perdida: `markPedidoSynced` y `clearClientesPendingSync` limpian el flag sobre el registro ACTUAL; una edicion hecha mientras sube queda marcada synced y nunca sube (los stocks admin si usan `clearPendingSiNoCambio`) | db/index.js:379-393,551-558; syncService.js:540-541 | ABIERTO | Comparar `updatedAt` enviado |
| S-1110-10 | Medio | Last-write-wins sin aviso: update de pedidos/clientes sin condicion de version; `updated_at` lo pone el cliente; dos dispositivos pisan campos (direccion, telefono, items). Deudas: un cobro local con >10 min sin subir lo pisa el remoto | syncService.js:490-495,1393,1459; pedidoRepository.js:44 | ABIERTO | `where updated_at = <visto>` o RPC |
| S-1110-11 | Medio | Doble descuento de stock si dos dispositivos facturan el mismo pedido offline (movimientos con UUID distinto, mismo ref `pedido:N`) | stockService.js:62-77; 002:290 | ABIERTO | Unique parcial por (ref, producto, tipo='venta') |
| S-1110-12 | Medio | `comisiones_cierres` legible por anon con `totales/detalle/lineas` (comisiones por vendedor); solo se revoco `comisiones_cierre_pedidos` | 003:589,595; 005:845 | ABIERTO | `revoke select`; leer por RPC con PIN |
| S-1110-13 | Medio | PIN de 4 digitos: lockout 5 fallos/15 min por vendedor. Un anonimo bloquea al admin indefinidamente (DoS de costos, compras, rendicion, tienda) y adivina 4 digitos en ~10-20 dias; tabla de intentos sin purga | 002:97-120; 004:226 (`^\d{4,8}$`) | ABIERTO | PIN >= 6, purga, aviso |
| S-1110-14 | Medio | `backups/` (clientes_rows: CUIT, tel, direccion, contacto de ~93 clientes) sin trackear y SIN `.gitignore`; el proyecto vive en OneDrive (copia en la nube) | .gitignore; backups/ | ABIERTO | Agregar `backups/` a .gitignore, mover cifrado |
| S-1110-15 | Medio | `npm audit --omit=dev`: 57 (3 crit, 27 altos), casi todo build-time (react-scripts). Runtime: `xlsx@0.18.5` (prototype pollution y ReDoS, sin fix en npm; se parsean planillas locales) | package.json:17; planillaXlsx.js:66-74 | ABIERTO | xlsx 0.20.x del CDN de SheetJS o exceljs |
| S-1110-16 | Medio | Disponibilidad offline: App.js desregistra los service workers en cada carga y `_headers` pone `no-store` en `/` e index.html: sin red, una PWA cerrada no abre (datos intactos pero inaccesibles) | App.js:119-125; public/_headers:9-14 | ABIERTO | No desregistrar el SW; cachear app shell |
| S-1110-17 | Bajo | `truncate_todas.sql` / `limpieza_datos.sql` (untracked, en carpeta supabase/): vacian todo el schema public (salvo vendedores) con un Run, sin guarda de proyecto/confirmacion | truncate_todas.sql:28-37 | ABIERTO | Mover fuera del repo o agregar guarda |
| S-1110-18 | Bajo | CSP sigue en `Report-Only` (no bloquea); `img-src https:` y `style-src unsafe-inline` (heredado SEC-POR-1) | public/_headers:7 | ABIERTO | Pasar a enforced |
| S-1110-19 | Bajo | Paginas de pull sin `order` (productos/clientes `.range` sin orden): puede saltear filas y el prune local de productos borra los que no vinieron (se restauran en el pull siguiente) | syncService.js:1117-1120,1203-1209 | ABIERTO | `.order('id')` |
| S-1110-20 | Bajo | `clientes` push con 401/403 devuelve `{ok:true, skipped}` y el usuario cree que sincronizo | syncService.js:812-816 | ABIERTO | Mostrar aviso |
| CORREGIDO | - | CORREGIDO: ninguno (esta corrida no modifica produccion) | - | CORREGIDO: ninguno | - |

## Detalle
**Mapa de acceso (segun migraciones; real sin verificar).**
| Tabla / RPC | Lee | Escribe | Riesgo |
|---|---|---|---|
| pedidos, clientes, deudas, faltantes | anon (select *) | anon (insert/update; delete en clientes/deudas/faltantes) | Critico S-01/02 |
| vendedores | anon solo columnas sin `pin`/`pin_hash` (002 paso 2: no aplicado=PIN visible) | anon insert fuerza permiso 2; permiso/pin/activo solo por RPC | Medio |
| productos | anon columnas publicas (013/016); costos/ganancia solo RPC con PIN admin | solo RPC admin (007) | OK |
| movimientos_stock, ingresos_mercaderia, proveedores | anon | anon insert, update restringido por trigger, sin delete (proveedores si) | Alto S-07 |
| comisiones_cierres / _pedidos | anon / nadie (005) | solo RPC admin | Medio S-12 |
| cambios_precio | anon por columnas (sin usuario_id) | RPC admin | OK |
| ingresos_costos, cuenta_proveedores, pedidos_proveedor, rendiciones, cuenta_clientes, pedidos_costos, pedidos_factura, tienda_* , pedidos_web_contacto | nadie (revoke all) | RPC con PIN admin | OK |
| tienda_catalogo | anon: precio publico, `disponible` booleano; sin costo ni stock exacto | - | OK |
| tienda_crear_pedido | anon | recalcula precio/minimos en servidor, honeypot, limite por IP hash y global, tope, idempotencia | OK (spam llena bandeja: Bajo) |
| verificar_pin y RPC admin_* | anon con PIN (`security definer`, search_path fijo, `return` no `raise` para registrar el fallo) | - | S-13 |
Storage: `comprobantes-proveedores` privado, tickets de 10 min/2 min por RPC admin (OK). XSS: sin `dangerouslySetInnerHTML`. Formula injection: no hay export CSV/XLSX con datos (solo plantilla estatica). Sin sourcemaps en `build/`, sin `.env` trackeado, sin claves en logs. Rol en cliente: la sesion se resuelve contra el servidor (fail-closed), pero un vendedor o un anon salta la UI y habla con la API REST directo (S-01).
**Pull vs pendientes (ok):** `putPedidosRemotosSinPisarLocales`, `mergeRemotos`, `downloadMaestros` no pisan `pendingSync`; el limpiado es por ids subidos (ledger: upsert por UUID, idempotente). `onupgradeneeded` (DB v12) solo crea stores faltantes; la unica migracion de datos (v<6) quita el PIN local, sin borrar registros. Fallback de columnas faltantes (`tolerancia.js`) reintenta sin la columna y marca pendiente: sin perdida.
**SQL propuesto S-02 (no aplicado; requiere cambiar Configuracion/deudaRepository a baja logica):**
```sql
revoke delete on public.clientes, public.deudas, public.faltantes, public.proveedores from anon, authenticated;
drop policy if exists clientes_delete on public.clientes;  drop policy if exists proveedores_delete on public.proveedores;
alter table public.clientes add column if not exists borrado_en timestamptz;
create or replace function public.admin_borrar_cliente(p_admin_id text, p_admin_pin text, p_id text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin if not public._es_admin_con_pin(p_admin_id, p_admin_pin) then return false; end if;
  update public.clientes set borrado_en = now() where id::text = p_id; return found; end $$;
revoke all on function public.admin_borrar_cliente(text,text,text) from public;
grant execute on function public.admin_borrar_cliente(text,text,text) to anon, authenticated;
```
**SQL propuesto S-07:** `alter table public.movimientos_stock add constraint movs_magnitud_chk check (abs(cantidad) <= 100000 and tipo in ('venta','ingreso','anulacion','inicial','ajuste')) not valid;`
**S-12:** `revoke select on public.comisiones_cierres from anon, authenticated;` (y leer por RPC con PIN como `admin_leer_comisiones_rubro`; la app usa Comisiones solo siendo admin).
**S-01 minimo viable:** Edge Function `login-vendedor` (verificar_pin + JWT con claim `permiso`), `revoke all ... from anon`, politicas por `auth.jwt()`; no hay atajo seguro mientras todo entre como anon.
**S-03/04/05 cliente:** antes de borrar, sumar pendientes de todos los stores y no continuar si > 0 (ni offline); alta de pedido: `addPedido` local con `idempotencia uuid` y subir por sync; columna `pedidos.client_uuid unique` y `upsert onConflict`.
**Archivos sueltos:** `limpieza_datos.sql` borra pedidos, deudas, stock, compras, rendiciones, cierres (no clientes/productos/vendedores; hay lineas comentadas para esos); `truncate_todas.sql` hace `truncate ... cascade` de todo public salvo vendedores. Ninguno esta en .gitignore (si se ejecutan por error, se pierde todo sin Undo). `backups/` contiene dos exports de la tabla clientes con datos personales (no se imprimieron).
**Backup recomendado (lo mas simple):** (1) Supabase Pro con backups diarios, o `supabase db dump` semanal desde la PC a un disco cifrado; (2) boton "Exportar respaldo" (JSON de clientes, pedidos, deudas, faltantes, ledger) en Configuracion y obligatorio antes de Borrar cache.

## Corregido en esta corrida
CORREGIDO: ninguno. Sin cambios en `src/**`, migraciones ni tests.

## Requiere acción del dueño
1. Verificar el estado real en el SQL Editor y pegarme el resultado: `select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') order by 2,1;` y `select tablename, rowsecurity from pg_tables where schemaname='public';` y `select tablename, policyname, cmd from pg_policies where schemaname='public';` y `select column_name from information_schema.column_privileges where table_name='vendedores' and grantee='anon' and privilege_type='SELECT';` (no debe aparecer `pin` ni `pin_hash`).
2. Activar backups (S-08) y hacer uno AHORA antes de cualquier script; no correr `truncate_todas.sql`/`limpieza_datos.sql` sin backup (S-17).
3. Agregar `backups/` a .gitignore y mover esos CSV fuera de OneDrive o cifrarlos (S-14).
4. Aprobar S-02 (baja logica de clientes/deudas/faltantes) y S-12; subir PIN de admin a 6+ digitos (S-13).
5. Hasta corregir S-03: no usar "Borrar cache" con pendientes; sincronizar y que un admin suba productos/costos con PIN antes.
