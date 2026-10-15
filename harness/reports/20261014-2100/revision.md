# Revision 20261014-2100 (REQ-TIE, REQ-WEB)

VEREDICTO: APROBADO

Gates (gates.json): 7/7 verdes; 2176 tests passed; cobertura dominio 99.83%; trazabilidad 116/116.

## AC -> test -> resultado (todos OK)
| AC | Tests principales |
|---|---|
| TIE-1 | aislamiento.test, entry.ui.test, catalogo.ui.test |
| TIE-2 | entry.ui.test, catalogo.ui.test |
| TIE-3 | migracion008.sql.test (solo texto SQL) |
| TIE-4/5/6 | catalogo.ui.test, tienda.busqueda, qa.tienda.bordes |
| TIE-7/8 | catalogo.ui.test, tienda.ruta |
| TIE-9/10/11 | carrito.ui.test, tienda.carrito, qa.tienda.bordes (Dos Corazones) |
| TIE-12/13/14 | tienda.checkout, carrito.ui.test, migracion008.sql.test |
| TIE-15 | migracion008.sql.test, tienda.carrito, qa.tienda.bordes |
| WEB-1 | pedidosWeb.regresion, PedidosWeb.test, pedidosWeb.test |
| WEB-2/3/4/5 | PedidosWeb.test, pedidosWeb.test, pedidosWebSync |
| WEB-6 | pedidosWebSync, migracionV8, migracion008.sql.test |
| WEB-7 | LinksTienda.test, tiendaLinksService.test |

## Regresion
- isPedidoOculto oculta web no aceptado; Armado, OrdenEntrega, Facturacion y comisiones usan isPedidoVisible/isPedidoOculto. Pedidos viejos (sin origen) siguen visibles (test).
- aplicarStockPedido devuelve [] para web no aceptado: no mueve stock.
- DB_VERSION 8 con migraciones V5-V7 ajustadas (no borradas); sin tests saltados.
## Aislamiento
- index.js usa React.lazy; src/tienda no importa db/sync/sesion/pages (grep y test). 
## Reglas duras
- Sin secretos ni push; UUID de idempotencia; stock solo por movimientos; campos legacy intactos.
## Riesgos / pendientes (no bloquean)
- RPC/RLS solo verificadas por tests de texto; falta correr 008 en Postgres de prueba.
- Abiertos Bajos: S-WEB-07, S-WEB-08, S-TIE-04, S-TIE-06, S-ADM-01, S-CSP-01. xlsx high preexistente.
## Pasos manuales del dueno
1. Aplicar supabase/migrations/008_tienda.sql en el SQL editor (primero en proyecto de prueba; probar anon: select a tablas nuevas = 401/403).
2. Definir REACT_APP_TIENDA_HOSTS y DNS del dominio de la tienda.
3. Verificar que header de IP setea el proxy de Supabase.
