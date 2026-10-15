# Implementacion RUN 20261015-0043 (REQ-PBU, REQ-MIN, REQ-SST, REQ-HPR)

Verificacion de la corrida interrumpida: se recorrio el plan seccion 4 contra el working tree
(grep + git diff por archivo). No faltaba codigo: los 19 items estaban implementados y con tests.
No se modifico codigo en esta pasada; solo se verifico y se corrieron los gates.

## Tabla item del plan -> estado
| # | Item | Estado | Evidencia |
|---|---|---|---|
| 1 | domain/precios.js + tests | hecho | precios.test.js, resumirCambiosPrecio, interpretarRegistrarCambiosPrecio |
| 2 | domain/minimos.js + tests | hecho | minimos.test.js |
| 3 | stock.js / productos.js (avisos, precioBulto, toRemote) | hecho | sinStock.test.js, productos_proveedores.test.js |
| 4 | bultos.js renglonNuevo | hecho | bultos.pedido.test.js |
| 5 | plantillas.js columna precioBulto + alias | hecho | plantillas.precioBulto.test.js |
| 6 | productosRpc.js precio_bulto | hecho | diff en productosRpc.js |
| 7 | tienda.js + fixture | hecho | tienda.precioBulto.test.js, textoPrecioBulto ("Llevando el display: $X c/u") |
| 8 | migracion 010 | hecho | supabase/migrations/010_..., migracion010.sql.test.js |
| 9 | db/index.js v9, cambiosPrecio, tx atomica | hecho | migracionV9.test.js, cambiosPrecio.tx.test.js |
| 10 | cambiosPrecioService | hecho | subir (solo aceptados), bajar (90 dias), online; cambiosPrecioService.test.js |
| 11 | syncService / productosAdminService | hecho | subirCambiosPrecio tras PIN; pull llama bajarCambiosPrecio (syncService:1146); sonda 010 |
| 12 | ProductoForm | hecho | ProductoForm.test.js |
| 13 | Configuracion.js usuario en altas/ediciones | hecho | ConfiguracionAltas.test.js |
| 14 | NuevoPedido | hecho | precioMinimoStock.pedido.test.js |
| 15 | Facturacion | hecho | precioMinimoStock.facturacion.test.js |
| 16 | Armado (stockMap, avisos, piso minimo) | hecho | precioMinimoStock.armado.test.js |
| 17 | tienda (ficha/tarjeta/carrito/useCarrito) | hecho | precioBulto.ui.test.js |
| 18 | CambiosPrecio.js + generarCambiosPrecioFile | hecho | boton en Configuracion (solo admin), CambiosPrecio.page.test.js, pdfCambiosPrecio.test.js |
| 19 | Stock.js solo test | hecho | Stock.test.js |

## Gates
`node harness/gates/run-gates.mjs --fast`: todos PASS (unit-tests, coverage-domain, traceability, secret-scan, security-rules).

## Pendiente manual
- Aplicar supabase/migrations/010_lote_operacion_precios.sql en el SQL editor ANTES de publicar la app.

## Vuelta 2 (seguridad S-010-01..04)
- S-010-01: cambios_precio con grant select por columnas (sin usuario_id); leerRango usa COLUMNAS_CAMBIOS en vez de select('*').
- S-010-02: NaN rechazado en precio, precio_bulto y los 4 precios de admin_registrar_cambios_precio.
- S-010-03: revoke all from public, anon, authenticated antes del grant select.
- S-010-04: revoke/grant de tienda_catalogo y tienda_crear_pedido re-emitidos antes del commit.
- Tests: security.lote010.test.js (S-010-01..04). Gates --fast en verde.
