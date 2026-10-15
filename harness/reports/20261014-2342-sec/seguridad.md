# Seguridad REQ-POR (portada y personalizacion de la tienda) - corrida 20261014-2342-sec

Alcance: 009_tienda_portada.sql, domain/tiendaPortada.js, src/tienda/*, ConfigTienda, tiendaConfigService, tiendaLinksService, public/_headers.
Tests: `src/domain/__tests__/security.portada.run2342.test.js` (24 tests, todos verdes; no se toco codigo de produccion).

## Veredicto
No hay hallazgos Criticos ni Altos. Las garantias pedidas se cumplen (detalle abajo). Quedan 2 Medios y 5 Bajos/Info.

## Tabla de hallazgos

| ID | Sev (CVSS aprox) | Archivo:linea | Descripcion | Recomendacion |
|----|------------------|---------------|-------------|---------------|
| SEC-POR-1 | Medio (4.3) | public/_headers:7 | La CSP sigue en `Report-Only`: no bloquea nada. `img-src ... https:` permite imagenes de cualquier host (un logo/banner/imagen_url externo filtra IP y Referer del cliente a un tercero). | Pasar a `Content-Security-Policy` enforced tras revisar reportes; acotar `img-src 'self' data: blob: https://<proyecto>.supabase.co` si todas las imagenes viven en Storage. |
| SEC-POR-2 | Medio (4.0) | 009:35,48,255,287 | El servidor valida solo `^https://` + largo 500. Acepta espacios, comillas, `<>` y cualquier host; el filtro estricto (`urlSegura`) existe solo en el cliente. Un cliente modificado con PIN de admin (o PIN robado) puede guardar URLs no https-seguras / de tracking; el front las descarta (urlSegura) pero otros consumidores no. | Endurecer el regex y el check de tabla: `~* '^https://[^\s"''<>]+$'`. Opcional: exigir prefijo `https://<proyecto>.supabase.co/storage/v1/object/public/tienda/`. |
| SEC-POR-3 | Bajo (3.1) | 009:309,48 / checks `precio > 0` | `nullif(v_x->>'precio','')::numeric(14,2)` acepta `'NaN'` (NaN > 0 es true en Postgres). Hoy es inocuo: `least(min(precio), lista)` ignora NaN, pero ensucia datos y podria romper reportes. Ademas no se exige `precio < precio de lista`. | Agregar `and (v_x->>'precio') !~* '(nan|inf)'` o `check (precio is null or (precio > 0 and precio <> 'NaN'))`. |
| SEC-POR-4 | Bajo (3.1) | 009:140 | `tienda_portada` publica `ofertas` crudas (productoId, precio) tambien de productos con `visible_tienda=false`: filtra ids y precios de productos ocultos. | Filtrar con `exists (select 1 from productos p where p.id::text=o.producto_id and coalesce(p.visible_tienda,true))`. |
| SEC-POR-5 | Bajo (3.5) | 008:`verificar_pin` + 009 (3 RPC nuevas) | Las 3 RPC admin nuevas comparten el contador de 5 fallos/15 min por `vendedor_id` (bien: no multiplican la fuerza bruta), pero cualquiera que conozca el id del admin puede bloquearlo 15 min repetidamente (DoS de config). PIN corto = ~20 dias de fuerza bruta lenta por id. Heredado, no nuevo. | PIN de admin >= 6 digitos; bloqueo tambien por IP/origen si se puede; alerta ante >N bloqueos. |
| SEC-POR-6 | Bajo (2.7) | 009:88-93,107 | Ticket de subida: 10 min, nombre `img/<uuid>.ext` generado por el servidor, sin policy update/delete/select. Se confirmo que NO se puede subir sin ticket, pisar (upsert exige update policy), listar el bucket ni enumerar nombres (uuid v4). Residuos: (a) el ticket no se consume (si la subida falla se puede reintentar hasta vencer; tras subir, un segundo insert colisiona); (b) `allowed_mime_types` valida el Content-Type declarado, no los magic bytes; solo un admin autenticado puede obtener tickets; (c) imagenes huerfanas nunca se borran (costo de storage); (d) un admin puede pedir tickets sin limite. | Aceptable. Opcional: limpiar tickets usados y limitar tickets vivos (ej. <= 20); job manual de limpieza de huerfanas. |
| SEC-POR-7 | Info | src/tienda/TarjetaProducto.js:7 | `imagenSegura` acepta `http://` (contenido mixto, el navegador lo bloquea/avisa). `productos.imagen_url` lo carga el admin. Sin XSS (React escapa; solo va a `<img src>`). | Aceptar solo `https://`. |

## Verificaciones pedidas (resultado)
- Anon sin acceso directo a tablas nuevas: OK. RLS on + `revoke all from anon, authenticated`, sin policies ni grants (test). Atencion: ver "Accion manual" punto 3 (default privileges de Supabase).
- `tienda_portada` / `tienda_catalogo`: OK. Solo columnas de vitrina; `disponible` booleano, sin costo/ganancia/stock exacto/PIN/tokens/limite_por_hora (test que escanea el cuerpo). `precioAnterior`/`enOferta` solo derivan de precios publicos. `tienda_precio_vigente` esta revocada a anon pero la llama una funcion definer: OK.
- `admin_tienda_guardar`: OK. Sin SQL dinamico (test: ningun `execute`); `tienda_admin_ok` antes de todo update/delete; jsonb mal tipado (config string, elementos no objeto, fechas invalidas, booleanos/ints invalidos) cae en `exception when invalid_text_representation/...` y revierte el bloque entero (todo-o-nada). Errores no listados (timeout 5s) abortan la transaccion igual: no puede quedar a medias. Los `delete ... where true` ocurren recien tras la auth (test de orden).
- Bypass de auth: `tienda_admin_ok` exige id existente, permiso=1, activo y PIN valido; respuesta uniforme `no_autorizado`.
- XSS: sin `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`window.open` en src/tienda (test). Favicon SVG: el color pasa por `normalizarConfigTienda` (solo `#rrggbb`, si no cae al default) antes de interpolarse; logo solo https sin comillas/espacios/`<>`. WhatsApp: `https://wa.me/<digitos>` + `noopener noreferrer`. Destinos de banner: siempre ruta `/tienda...` con `encodeURIComponent`/URLSearchParams y `pushState` (sin open redirect ni `javascript:`; test con `//evil.com`, `javascript:`, `\`).
- CSP vs Storage: `img-src https:` permite las imagenes de Storage; `script-src 'self'` sin unsafe-inline, el favicon `data:` esta en `img-src data:`. Compatible (ver SEC-POR-1 por el modo report-only).
- Fuerza bruta del PIN: ver SEC-POR-5.

## Corregido en esta corrida
Nada en produccion (regla de la corrida). Se agregaron 24 tests de regresion de seguridad (SQL estatico + dominio) que fallan si alguien: agrega un grant/policy a las tablas nuevas, quita la auth previa al delete, introduce SQL dinamico, permite SVG/HTML en el bucket, agrega policy select/update/delete a storage, expone costo/stock/PIN/tokens, o relaja la sanitizacion de URL/color/whatsapp/destinos.

## Requiere accion del dueno
1. Endurecer regex https en SQL (SEC-POR-2) y NaN (SEC-POR-3): ver "Accion manual".
2. Pasar la CSP a modo enforced (SEC-POR-1) cuando no haya reportes.
3. PIN de admin de 6+ digitos.

## Accion manual en Supabase
1. Aplicar 009 en SQL Editor (despues de 008, con backup). Idempotente.
2. Verificar que anon NO tiene acceso directo a las tablas nuevas (los default privileges de Supabase pueden otorgarlo):
   `select grantee, table_name, privilege_type from information_schema.role_table_grants where table_name in ('tienda_banners','tienda_ofertas','tienda_subidas') and grantee in ('anon','authenticated');` -> debe dar 0 filas. Si no, repetir `revoke all ... from anon, authenticated`.
3. Verificar el bucket: `select id, public, file_size_limit, allowed_mime_types from storage.buckets where id='tienda';` (public=true, 2097152, 3 mimes) y policies: `select policyname, cmd from pg_policies where schemaname='storage' and tablename='objects';` -> para el bucket `tienda` solo debe existir `tienda_insert_con_permiso` (INSERT). Borrar cualquier policy SELECT/UPDATE/DELETE amplia sobre storage.objects.
4. Endurecimiento sugerido (SEC-POR-2/3):
```sql
alter table public.tienda_banners drop constraint if exists tienda_banners_imagen_url_check;
alter table public.tienda_banners add constraint tienda_banners_imagen_url_check
  check (imagen_url ~* '^https://[^\s"''<>]+$' and char_length(imagen_url) <= 500);
alter table public.tienda_config drop constraint if exists tienda_config_logo_url_check;
alter table public.tienda_config add constraint tienda_config_logo_url_check
  check (logo_url is null or (logo_url ~* '^https://[^\s"''<>]+$' and char_length(logo_url) <= 500));
alter table public.tienda_ofertas add constraint tienda_ofertas_precio_finito check (precio is null or precio <> 'NaN'::numeric);
```
   (Revisar el nombre real de los constraints en `\d`/pg_constraint antes de dropear; replicar el regex en `admin_tienda_guardar`.)
5. Mantenimiento ocasional: borrar imagenes huerfanas del bucket `tienda` desde el dashboard y `delete from tienda_subidas where expira_at < now() - interval '7 days'`.
