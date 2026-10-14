# Seguridad — RUN 20261014-2036 — S-VTA-01 (seguimiento REQ-VTA)

Alcance: 007_productos_escritura_admin.sql, syncService (productos), productosAdminService, productosRpc, Configuracion.
Hallazgos previos referenciados, no repetidos: S-VTA-01 (cerrado en el repo, pendiente de aplicar), S-COM-01/16 (PIN, patron 002/004).

## Veredicto
S-VTA-01 queda **cerrado en el codigo**. No hay Critico ni Alto nuevos. Efectivo solo cuando el dueño corra la 007 y publique la build.

## Verificaciones pedidas
| Punto | Resultado |
|---|---|
| Cierra INSERT/UPDATE/DELETE para anon | Si. `revoke insert, update, delete ... from anon, authenticated` (007:46). Los grants se chequean antes que RLS, asi que las policies `using(true)` (fuera del repo) quedan inertes. El revoke de tabla tambien quita los privilegios por columna. TRUNCATE ya lo revoca la 002:228. |
| Otras vias de escritura | No hay en el repo: ninguna otra funcion definer ni vista escribe `productos` (grep en 001-006). Los triggers de 001/002 son de stock/vendedores. Unica via restante: RPC 007 con PIN admin. |
| Rol authenticated | Cubierto (revoke y sin uso en la app). |
| Lectura sigue | Si. `grant select ... to anon, authenticated`; no se toca RLS; pull usa `fetchAll('productos')`. |
| search_path fijo | Si: `public, pg_temp` en ambas RPC. Todo objeto va calificado (`public.`). |
| PIN sin oraculo de mensaje | Si. Todas las fallas = `no_autorizado`; `verificar_pin` se llama siempre y se hace `return` (no `raise`), asi el intento fallido se registra. |
| Limite de intentos | Si, hereda `verificar_pin` (5 fallos / 15 min por vendedor_id). |
| SQL dinamico / select * | No hay `execute`, `format` ni `select *`. |
| Stock | No viaja. Whitelist de columnas en el insert; la clave `stock` se ignora. `filaProductoRpc` no la arma. |
| Grants execute | `revoke all ... from public` y `execute` solo a anon/authenticated (necesario: la app no usa Supabase Auth). Minimo viable. |
| PIN en cliente | No se guarda ni se loguea: `prodPin` y `borrarProdPin` se copian a una constante y se vacian antes del await (Configuracion:334-356). No hay `console.*` en productosAdminService ni productosRpc. `cred` se arma por llamada. |
| Idempotente / no destructiva | Si. `create or replace`, revoke/grant repetibles, upsert por id, baja con `ya_borrado`, `begin/commit`, do-block de prerrequisitos. Solo borra con `admin_baja_producto`. |

## Hallazgos
| Id | Sev (CVSS aprox.) | Archivo | Descripcion | Recomendacion |
|---|---|---|---|---|
| S-010 | Medio (4.3) | 007:92-168 | El bloque `exception` por fila no captura `foreign_key_violation` (proveedor_id inexistente) ni `unique_violation`. Una fila mala aborta TODO el lote (error 500 generico), y el cliente reintenta eternamente. No es un bypass, es disponibilidad/integridad de la subida. | Agregar `or foreign_key_violation or unique_violation` a la lista de excepciones (007:164). |
| S-011 | Medio (4.0) | 002:100-122 (heredado) | Cualquiera con la anon key puede bloquear al admin 15 min enviando 5 PIN erroneos para su id (los ids de vendedores son legibles). Ahora tambien frena "Subir productos" y el cierre de comisiones. Ya existia con vendedores. | Aceptar y documentar; o bloquear por (id, IP) en una Edge Function. La mitigacion real es no exponer ids de admin en el select de vendedores. |
| S-012 | Bajo (3.1) | 002:115-119 (heredado) | Oraculo de tiempo: un id inexistente o sin PIN responde sin bcrypt y sin registrar intento; uno con PIN tarda bcrypt. Permite distinguir ids con PIN y sondear sin limite. Impacto bajo: los ids ya son publicos. | En `verificar_pin`, hacer un `crypt` ficticio cuando `v_hash is null` y registrar el intento tambien. |
| S-013 | Bajo (2.7) | 007:46 | El revoke cubre solo anon/authenticated. Si algun grant se hizo a `PUBLIC`, la escritura seguiria abierta. En Supabase no es lo normal. | Verificar tras aplicar (ver abajo). Si aparece PUBLIC, agregar `revoke ... from public`. |
| S-014 | Bajo (2.0) | Configuracion:284-293, productosAdminService:58-67 | Si la sonda falla por red o excepcion devuelve `faltaMigracion:true` y se intenta el delete directo. Es fail-closed (con la 007 da 42501), pero muestra el error de RLS y no pide PIN. | Cosmetico: distinguir error de red de "falta funcion"; tratar la red como `offline`. Duplicado de `borrarProductoRemoto` en Configuracion: borrarlo cuando se retire el modo compatible. |
| S-015 | Bajo (2.0) | 007:75-81, 189-195 | No se valida que `p_filas` no repita ids dentro del lote (el ultimo gana). Inocuo, upsert idempotente. | Ninguna. |
| S-016 | Info | 007:205 | Baja fisica sin chequear movimientos de stock: el ledger queda con ids huerfanos. Ya esta marcado "a confirmar" en el plan. | Decidir con el dueño baja logica (`borrado_en`). |

## Requiere accion del dueño
1. Publicar la build nueva ANTES o junto con la 007 (clientes viejos reciben 42501 al subir productos).
2. Verificar 002 PASO 1, 004 y 006 aplicadas (la 007 aborta si no).
3. Correr la 007 con backup. Consulta de control de admins sin PIN: `select id, nombre from public.vendedores where permiso = 1 and pin_hash is null;`
4. Verificacion posterior (debe dar 0 filas):
   `select grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='productos' and privilege_type in ('INSERT','UPDATE','DELETE') and grantee in ('anon','authenticated','PUBLIC');`
5. Prueba externa: `curl -X PATCH "$URL/rest/v1/productos?id=eq.1" -H "apikey: $ANON" -d '{"precio":0}'` debe dar 401/403.
6. Confirmar S-016 y la friccion de PIN por subida.

## Corregido en esta corrida
S-VTA-01 (escritura anon de productos). Sin cambios de produccion por parte de la auditoria. No se agregaron tests: `migracion007.productos.test.js` y `productosRpc.test.js` ya cubren grants, definer, search_path, ausencia de SQL dinamico y stock.
