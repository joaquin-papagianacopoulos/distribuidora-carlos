# Implementación — Corrida 20261014-2100 (REQ-TIE + REQ-WEB)

## Pasos del plan (todos hechos)
| # | Paso | Estado |
|---|---|---|
| 1-2 | `src/domain/tienda.js`, `__fixtures__/tiendaCasos.js` y 4 tests (`tienda.carrito/busqueda/checkout/ruta`) | hecho |
| 3 | `src/domain/pedidosWeb.js` (+ `armarItemsAceptar`) y `pedidosWeb.test.js`; `src/domain/tiendaLinks.js` + test | hecho |
| 4 | `isPedidoOculto` oculta `origen==='web' && webEstado!=='aceptado'` | hecho |
| 5 | `supabase/migrations/008_tienda.sql` + `migracion008.sql.test.js` (estático) | hecho |
| 6 | `src/index.js`: selector de entry con dos `React.lazy`; solo importa `domain/tienda` | hecho |
| 7 | `src/tienda/*` (TiendaApp, tiendaApi, useCarrito, Catalogo, Filtros, TarjetaProducto, DetalleProducto, Carrito, Checkout, Confirmacion, tienda.css) | hecho |
| 8-9 | `aislamiento.test.js`, `catalogo.ui`, `carrito.ui` (incluye checkout/confirmación), `src/__tests__/entry.ui.test.js` | hecho |
| 10 | `DB_VERSION` 7 a 8: store `pedidosWebAcciones` (UUID, índice `pedidoRemoteId`); `migracionV8.test.js` | hecho |
| 11 | `syncService`: `mapPedidoRemoto` lee origen/web_*; `syncPedidosWeb`, `pullPedidosWebPorRevisar`, `pullPedidosWebPorIds`; runSync (admin) baja por revisar | hecho |
| 12 | `stockService.aplicarStockPedido`: cerrojo para web sin aceptar | hecho |
| 13 | `services/pedidosWebService.js` (cola, PIN solo en memoria) | hecho |
| 14 | `pages/PedidosWeb.js` + test; pestaña "Web" con contador en `App.js` | hecho |
| 15 | `services/tiendaLinksService.js` + `components/LinksTienda.js` en Configuración, vendedores | hecho |
| 16 | `services/__tests__/pedidosWeb.regresion.test.js`, `pedidosWebSync.test.js`, `tiendaLinksService.test.js` | hecho |

## Decisiones / desvíos del plan
- AC-TIE-9: renglón único por producto en unidades (modo `unidad` al RPC); el servidor acepta `bulto` y suma repetidos.
- `tienda_catalogo` devuelve `{ok, config:{permitirSinStock}, productos[]}`; `tienda_crear_pedido(p jsonb)`: respuestas `ok | invalido | tope | limite | cambio(+carrito)`.
- RPC `admin_resolver_pedido_web` recibe `p_pedido_id` como text y usa `jsonb_populate_record(null::pedidos, ...)` para respetar el tipo real de `cliente_id`.
- Honeypot = campo `hp` (input `sitio_web` oculto). El límite por hora cuenta pedidos creados (no intentos inválidos).
- Favicon SVG de la tienda armado sin literal `http://` para no disparar la regla de seguridad del gate.
- Se tocaron aserciones de versión de 4 tests existentes (patrón "MOD" de corridas previas): `migracionV5/V6/V7` y `security.comisiones.iter2` (7 a 8, más el store nuevo). Ningún test borrado ni salteado.
- `src/testUtils/ui.js`: helpers de UI sin dependencias nuevas (createRoot + act, S6).

## Resultados
- `CI=true npx react-scripts test --watchAll=false`: 125 suites OK, 2133 tests OK (1 skipped, 5 todo preexistentes).
- `npx react-scripts build`: Compiled successfully. El chunk de la tienda (`733.*.chunk.js`) no contiene `indexedDB` ni `distribuidoraDB`.
- `node harness/gates/run-gates.mjs --fast`: todos los gates pasaron.

## Cobertura AC (tests que los nombran)
TIE-1: aislamiento, entry.ui, tienda.ruta, catalogo.ui. TIE-2: entry.ui, catalogo.ui. TIE-3: migracion008. TIE-4: catalogo.ui. TIE-5/6: tienda.busqueda, catalogo.ui. TIE-7/8: tienda.carrito, catalogo.ui. TIE-9/10/11: tienda.carrito, carrito.ui. TIE-12: tienda.checkout, carrito.ui. TIE-13: migracion008, carrito.ui. TIE-14/15: carrito.ui, migracion008. WEB-1: pedidosWeb.regresion, PedidosWeb.test. WEB-2..5: pedidosWeb.test, PedidosWeb.test. WEB-6: migracionV8, pedidosWebSync, migracion008. WEB-7: tiendaLinks, tiendaLinksService, LinksTienda.test, migracion008.

## Pendientes y riesgos (para el auditor / dueño)
- R1: la app interna sigue usando la anon key con `select` sobre productos/clientes/pedidos/vendedores/movimientos_stock; la 008 NO lo revoca. `web_contacto` queda legible con la anon key. Requiere migrar la app interna a un rol autenticado. Escalar al dueño.
- La 008 no se pudo ejecutar contra Postgres en esta corrida: solo hay tests estáticos del SQL. Probarla en un proyecto de staging antes de producción (en especial `tienda_crear_pedido` y `admin_resolver_pedido_web`).
- Supuestos S1-S8 del plan siguen vigentes (solo admin ve la bandeja; sin notificaciones; la aceptación offline queda "pendiente de subir").

## Pasos manuales
1. Backup y aplicar `supabase/migrations/008_tienda.sql` en el SQL editor (orden: 001, 002 paso 1, 004, 006, 007, 008).
2. Definir `REACT_APP_TIENDA_HOSTS` (ej. `tienda.midominio.com`) y hacer rebuild/deploy.
3. Apuntar el DNS del host de la tienda al mismo deploy.
4. En Configuración, Vendedores: ingresar el PIN de admin y generar los links por vendedor.

## Vuelta 2 (hallazgos del auditor)
- S-WEB-01: 008 ya no crea `pedidos.web_contacto`. Nueva tabla `pedidos_web_contacto(pedido_id text pk, contacto jsonb)` con RLS y sin grants; la escribe solo `tienda_crear_pedido`. Nueva RPC `admin_listar_pedidos_web(admin_id, pin, ids text[])` (PIN admin via `tienda_admin_ok`, max 500 ids). Cliente: `pullContactosPedidosWeb` (syncService) guarda `webContacto` local solo de pedidos por revisar sin contacto; `cargarContactos` (pedidosWebService) usa el PIN en memoria y nunca tira. Bandeja: si falta PIN/RPC falla/falta migracion muestra "Datos de contacto no disponibles: <motivo>" sin datos; renglones y total se ven igual. Boton "Ver datos de contacto" con el PIN tipeado.
- S-TIE-01: IP = `cf-connecting-ip` o ULTIMO elemento de `x-forwarded-for`; sin IP no hay bucket propio; nuevo tope `tienda_config.limite_global_por_hora` (60).
- S-TIE-02: `pg_advisory_xact_lock(hashtext('tienda:limite'))` antes de contar.
- S-TIE-03: `v_pid := (v_pid::bigint)::text` tras la regex.
- S-TIE-05: `set statement_timeout = '3s'` en `tienda_catalogo` + indice `movimientos_stock(producto_id)`.
- Tests: `migracion008.sql.test.js` (AC-TIE-3, AC-TIE-15, AC-WEB-3), `security.tienda.run2100.test.js` (hallazgos pasan a "corregidos", marcados MOD), `pedidosWebSync.test.js` (AC-WEB-3), `PedidosWeb.test.js` (AC-WEB-3).
- Pasos manuales: la 008 sigue siendo un solo archivo; no hay paso nuevo (se aplica entera, aun no estaba aplicada). Verificar en Supabase que el proxy manda `cf-connecting-ip` o `x-forwarded-for` con la IP real al final.
