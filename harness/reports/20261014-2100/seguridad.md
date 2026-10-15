# Seguridad — RUN 20261014-2100 (REQ-TIE + REQ-WEB)

Alcance: `supabase/migrations/008_tienda.sql`, `src/tienda/*`, `src/sync` (bandeja web). Revision estatica (la migracion no se ejecuto contra una base real; ver "No verificado"). Tests: `src/domain/__tests__/security.tienda.run2100.test.js` (25/25 verdes).

## Hallazgos priorizados

| Id | Sev (CVSS) | Hallazgo | Evidencia |
|---|---|---|---|
| S-WEB-01 (R1) | **Alto** (7.5) | `pedidos.web_contacto` (nombre, telefono, direccion, CUIT, observaciones de consumidores finales) es legible con la anon key: `GET /rest/v1/pedidos?origen=eq.web`. La anon key va tambien en el bundle publico de la tienda. Es dato personal nuevo y de gente ajena a la distribuidora. | 008:18-22, 52; `syncService.js` `select('*')` |
| S-TIE-01 | **Medio** (5.3) | Limite por hora falsificable: toma el PRIMER elemento de `x-forwarded-for`, que el cliente puede mandar. Rotando el header se evade el 5/h y se inunda la bandeja con pedidos basura (DoS de operacion, no de datos). Si el header falta, todos comparten un bucket (bloqueo mutuo: un atacante con 5 pedidos deja a todos sin comprar). | 008:355-362 |
| S-TIE-05 | **Medio** (5.3) | `tienda_catalogo` es publico, sin limite y con una subconsulta `sum(movimientos_stock)` por producto + `tienda_precio_vigente` por fila: amplificacion de carga sobre la base (DoS). | 008:223-241 |
| S-TIE-02 | Bajo (3.7) | Limite no atomico (cuenta y despues inserta sin lock): rafaga paralela supera el tope unas pocas unidades. | 008:359-361, 459 |
| S-TIE-03 | Bajo (3.1) | `productoId` con ceros a la izquierda (`"7"`, `"07"`...) crea claves distintas para el mismo producto: se esquiva el tope por renglon `max_unidades_renglon` y los renglones salen duplicados. El admin revisa antes de aceptar y no mueve stock. | 008:370-396 |
| S-TIE-04 | Bajo (3.1) | Tokens de vendedor en claro en `vendedores_tienda_tokens` (sin acceso anon, solo se leen por RPC con PIN admin). Si se filtra un backup, los links sirven. Hash (sha256) los haria inertes. | 008:131-136 |
| S-TIE-06 | Bajo (3.1) | Contacto validado solo por largo: telefono/CUIT sin formato, caracteres de control o `=cmd|...` pasan. React escapa (sin XSS), pero `cliente_nombre`/contacto pueden llegar a Excel/PDF: aplicar el saneo de formula existente (`planillaXlsx`) en toda exportacion de pedidos web. | 008:327-347 |
| S-ADM-01 | Bajo (heredado) | PIN admin de 4 digitos con 5 intentos/15 min por id: las RPC admin nuevas comparten el contador de `verificar_pin` (no empeora), pero permiten bloquear al admin a distancia. Ya conocido de 002. | 002:100-122 |
| S-CSP-01 | Bajo (heredado) | CSP solo en `Report-Only`; la tienda (publica) comparte origen con la app interna en `/tienda`, asi que un XSS en la tienda tocaria la IndexedDB interna. Hoy no hay sinks (sin `dangerouslySetInnerHTML`, `<a href>` solo internos). Preferir host separado (`REACT_APP_TIENDA_HOSTS`) y pasar la CSP a enforce. | `public/_headers` |

Sin hallazgos Criticos.

## Controles verificados (OK)
- Precio/total/bultos recalculados en servidor; `precioVisto` solo detecta cambio y el pedido no se crea (devuelve carrito corregido). Un precio manipulado no altera nada. Regex estrictas en `productoId` (`^[0-9]{1,15}$`) y `cantidad` (`^[0-9]{1,7}$`), tope 1.000.000 u., sin SQL dinamico con input (el `execute` esta en `tienda_precio_vigente` con parametros).
- Idempotencia: lookup previo + indice unico parcial + captura `unique_violation`. Honeypot antes de contar/insertar. Topes de renglones y total.
- `tienda_catalogo` devuelve solo campos publicos; `disponible` es booleano (no stock exacto). Sin costo, ganancia, precio 2.
- Tablas nuevas: RLS on + `revoke all` a anon/authenticated, sin policies. Helpers internos sin `execute` para anon. Solo 5 RPC otorgadas.
- Todas las funciones `security definer` con `search_path = public, [extensions,] pg_temp`.
- `admin_resolver_pedido_web`: PIN + `permiso=1` + `activo` (via `verificar_pin` con bloqueo), `for update`, accion idempotente por `web_accion_id`, estado terminal `ya_resuelto`. `admin_token_tienda`/`listar` idem.
- Trigger `tg_pedidos_web_guard`: la app interna (anon) no puede fabricar pedidos web, cambiar origen/estado/contacto ni tocar pedidos web no aceptados; las RPC definer lo atraviesan por `current_user`.
- Token: 256 bits (`gen_random_bytes(32)`), no enumerable (token invalido o vendedor de baja = mismo resultado que link general; sin endpoint de validacion). Referrer-Policy `strict-origin-when-cross-origin` evita fuga en navegacion externa.
- Aislamiento: `src/tienda/*` no importa db/sync/pages/useAppContext/sesion, solo `supabase.rpc`, sin `dangerouslySetInnerHTML`/`eval` (test).

## R1 — evaluacion y mitigaciones
Severidad real Alto: la anon key es publica por diseno, y ahora la tienda atrae trafico externo y guarda PII de terceros. Hoy `clientes` ya esta igual de expuesta (riesgo previo), pero R1 lo amplia a consumidores.
Mitigacion SIN romper la app interna (requiere cambio de codigo, no hecho en esta corrida porque no modifico `src/**`):
1. Mover el contacto a `public.pedidos_web_contacto (pedido_id, contacto jsonb)` sin grants ni policies; el insert lo hace `tienda_crear_pedido` (definer). En `pedidos` dejar solo `cliente_nombre`.
2. Nueva RPC `admin_listar_pedidos_web(p_admin_id, p_admin_pin)` (PIN admin, definer) que devuelve pedido + contacto; la bandeja la llama en lugar de leer `web_contacto` del pull. Se cachea en IndexedDB local como hoy.
3. Alternativa minima: `revoke select (web_contacto) on public.pedidos from anon, authenticated` mas lista explicita de columnas en los `select('*')` de `syncService` (el `select *` fallaria con permission denied); la bandeja pediria el contacto por RPC.
4. Estructural: pasar la app interna a rol `authenticated` (Supabase Auth) y retirar `select` a anon.
Hasta entonces: avisar al dueño en el aviso de privacidad de la tienda y limitar `observaciones`/CUIT a lo necesario.

## Remediaciones concretas
- S-TIE-01: usar el ULTIMO elemento anadido por el proxy confiable y combinar con un tope global:
  `v_ip := trim(split_part(coalesce(v_headers->>'cf-connecting-ip', regexp_replace(v_headers->>'x-forwarded-for', '^.*,\s*', '')), ',', 1));` y agregar `tienda_config.limite_global_por_hora` (p.ej. 60) contando todos los intentos de la ultima hora. Verificar en la instancia que header setea el proxy de Supabase.
- S-TIE-02: `perform pg_advisory_xact_lock(hashtext('tienda:' || v_hash));` antes del conteo.
- S-TIE-03: normalizar `v_pid := (v_pid::bigint)::text;` tras la regex.
- S-TIE-05: cachear en CDN/clientes (headers no aplican a RPC) o materializar el `disponible` en una vista/columna refrescada; como minimo, `statement_timeout` en la funcion (`set statement_timeout = '3s'`).
- S-TIE-04: guardar `encode(digest(token,'sha256'),'hex')` y devolver el token solo al generarlo (el listado requeriria regenerar).

## Corregido en esta corrida
Nada en produccion (regla: no modifico `src/**`; la migracion 008 aun no esta aplicada, asi que S-TIE-01/02/03/05 son corregibles editando 008 antes de aplicarla). Se agregaron los 25 tests de `security.tienda.run2100.test.js`, que fijan los controles OK y documentan los hallazgos (S-TIE-01..04, S-WEB-01): si se corrigen, esos tests fallan a proposito y hay que actualizarlos.

## Requiere accion del dueño / desarrollo
1. Decidir R1 (opciones 1-4) antes de publicar la tienda con trafico real; recomendado 1+2.
2. Aplicar en 008 los arreglos S-TIE-01/02/03 (SQL de arriba) antes de ejecutarla.
3. Servir la tienda en un host propio (`REACT_APP_TIENDA_HOSTS`) y pasar la CSP a enforce tras probar.
4. Confirmar que header de IP agrega el gateway de Supabase (prueba manual con dos `x-forwarded-for`).

## No verificado
Comportamiento real en Postgres (privilegios por defecto de Supabase, orden de triggers, cabeceras reales del proxy). Recomendado correr la 008 en un proyecto de prueba y verificar con la anon key: `select` sobre las 4 tablas nuevas debe dar 401/403 y `rpc/tienda_crear_pedido` con `precioVisto` alterado debe devolver `motivo: cambio`.

## Re-verificacion vuelta 2

| id | estado | evidencia |
|---|---|---|
| S-WEB-01 | Corregido | `pedidos_web_contacto` con RLS + `revoke all` anon/authenticated (008:144-161); `pedidos` ya no tiene la columna; `admin_listar_pedidos_web` valida PIN via `tienda_admin_ok` antes de leer, `search_path` fijo, tope 500 ids, `revoke from public` + grant solo anon/authenticated (necesario: es RPC con PIN). Front: `pullContactosPedidosWeb` sin cred devuelve `pin_requerido` y no consulta. |
| S-TIE-01/02/03/05 | Corregidos | ultimo XFF/cf-connecting-ip + tope global (008:363-381); advisory lock (371); normalizacion de id (393); `statement_timeout 3s` en catalogo (224). |
| PIN | OK | solo en variable de modulo; sin console.* en servicio ni bandeja; no va a IndexedDB/localStorage. |

Hallazgos nuevos (vuelta 2):
- S-WEB-07 Bajo (3.1): `pedidos.cliente_nombre` (y `total`/items) del pedido web sigue legible con anon key: expone el nombre del consumidor, no telefono/direccion/CUIT. Remediacion: guardar un rotulo ("Pedido web #id") en `cliente_nombre` y dejar el nombre real solo en el contacto.
- S-WEB-08 Bajo (2.0): el contacto bajado se persiste en IndexedDB (`webContacto`) del admin; sin cifrado, mismo riesgo que el resto de datos locales. Purgar al aceptar/rechazar.
- S-ADM-01 (heredado): `admin_listar_pedidos_web` permite fuerza bruta/bloqueo del PIN igual que las demas RPC admin; no empeora.
- tienda_admin_ok devuelve null igual ante id inexistente/PIN malo (sin oraculo de usuarios).

Tests: `security.tienda.run2100.test.js` 28 casos (se agrego el de la RPC), verde.
