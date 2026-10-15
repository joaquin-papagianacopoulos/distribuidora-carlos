# Implementación — RUN 20261015-1541 — REQ-INA, REQ-CPR, REQ-STB

Gates `--fast`: unit-tests, coverage-domain, traceability, secret-scan, security-rules en verde. `react-scripts build` (CI=true) sin warnings.

## Migración y base
- `supabase/migrations/012_lote_operacion_compras_stock.sql` (idempotente, sin drops): `productos.stock_minimo` + `admin_guardar_productos` (cuerpo de 010 + stock_minimo, conserva el valor si la clave no viene); tablas `ingresos_costos`, `cuenta_proveedores` (trigger de inmutabilidad: solo comprobante y anulación, una vez), `pedidos_proveedor`, `comprobantes_habilitados`: RLS on, `revoke all` a anon/authenticated, sin policies. RPC con `_es_admin_con_pin`: `admin_compras_guardar` (lote <= 500, reloj tope +5 min, LWW, `recibido` terminal), `admin_compras_bajar`, `admin_comprobante_subida` (10 min), `admin_comprobante_lectura` (2 min). Bucket privado `comprobantes-proveedores` (5 MB, jpg/png/webp/pdf), policies insert/select por nombre habilitado, sin update/delete.
- Desvío menor del plan: el nombre del comprobante es `pagos/<pago>-<uuid>.<ext>` (el proveedor no se conoce al pedir el nombre).
- `src/db/index.js`: `DB_VERSION` 9 -> 10, 4 stores nuevos (`ingresosCostos`, `cuentaProveedores`, `comprobantesPendientes`, `pedidosProveedor`) con `if (!contains)`; `addIngresoCompleto` (ingreso + costos + movimientos en una transacción); getters/put/clear (limpieza solo si `updatedAt` no cambió durante la subida).

## Dominio (puro) — `src/domain/`
- `compras.js` (nuevo): validar costos/A-B, subtotales A/B/sin dato, historial filtrable, por producto, `costoProductoDesdeIngreso`, compras derivadas, mapeos remotos. Los renglones guardan `unidades` para derivar la compra sin el ingreso.
- `cuentaProveedores.js` (nuevo): pagos/cargos (centavos enteros), adjuntos, anulación, estado de cuenta, saldos, mapeos.
- `pedidosProveedor.js` (nuevo): borrador/enviado/recibido, bultos a unidades, `marcarRecibido` idempotente + formulario de ingreso, texto para compartir.
- `stockBajo.js` (nuevo): estado, búsqueda sin tildes, filtros, contador, sugerido por bulto. `umbralStock` vive en `stock.js` (evita ciclo) y `productosStockBajo` delega en él.
- `stock.js`: `ingresoToRemote` whitelistea `items` (D2: costos/A-B nunca salen por anon). `productos.js`/`plantillas.js`: campo `stockMinimo` (formulario, validación, remoto, Excel opcional).

## Servicios / UI
- `stockService.registrarIngreso`: `form.costos` opcional; valida todo antes de grabar; tilde "actualizar costo" llama `updateProducto` (registra `cambiosPrecio`; el precio se recalcula solo si había ganancia y era automático).
- `comprasService.js` (nuevo): `subirCompras` (syncStock antes), `bajarCompras` (cursor + solape 5 min), `encolarComprobante`, `subirComprobantes`, `verComprobante` (blob local, sin URLs compartibles), `sondearMigracion012`. PIN solo por parámetro, nunca persistido ni logueado.
- `comprasLocalService.js` (nuevo): escrituras locales de pagos, anulaciones y pedidos.
- `pdfGen.js`: `generarComprobanteIngresoFile`, `generarIngresosFile`, `generarEstadoCuentaFile`, `generarPedidoProveedorFile`.
- `Stock.js` dividido en `pages/stock/*` (Listado, Reponer, Ingreso, Historial); `pages/Proveedores.js` y `components/ComprasSyncBar.js` (nuevos, solo admin); `App.js`: pestaña Proveedores, badge de stock bajo, precarga del ingreso al recibir un pedido; `useAppContext` carga los stores nuevos.

## AC cubiertos y tests
- AC-INA-1..5: `compras.test.js`, `stock.test.js` (whitelist), `stockService.ingresoCostos.test.js`, `stock.stockBajo.test.js`, `pdfGen.compras.test.js`, `migracionV10.test.js`.
- AC-CPR-1..5: `cuentaProveedores.test.js`, `pedidosProveedor.test.js`, `comprasService.test.js`, `comprasLocalService.test.js`, `proveedores.test.js`, `app.stockBajo.test.js`.
- AC-STB-1..3: `stockBajo.test.js`, `stock.stockBajo.test.js`, `app.stockBajo.test.js`.
- Seguridad (AC-SEC-4/5): `migracion012.sql.test.js` (+ `security.migracion.test.js` recorre la 012).

## Tests existentes actualizados (contrato nuevo, no desactivados)
`DB_VERSION` 9 -> 10 en migracionV5..V9 y `security.comisiones.iter2`; columnas de plantilla/formulario (+ "Stock mínimo") en plantillas, productos_proveedores, qa.plantillas.bordes, security.plantillas, ProductoForm; columnas del renglón de ingreso en `Stock.test.js`.

## Para el dueño / auditor
- Aplicar la 012 a mano en Supabase después de 010 y 011 (hacer backup). Sin la 012 todo sigue local con aviso "Falta la migración 012".
- D7 sigue abierto: `productos.costo_final` es legible con anon (007); AC-INA-4 lo actualiza pero no empeora la exposición.
- El costo final actualizado sube con "Subir productos" (flujo existente de productos con PIN).
- No se tocó `security-report.md` ni `harness/gates/**`.

## Vuelta 2 (seguridad + QA obs 1)
- S-012-01: nueva `013_productos_costos_privados.sql` (revoke select de tabla; grant por columna a todas menos costo_final, descuento1, descuento2, ganancia y precio_venta2, que se decidió interna porque no la usa venta ni tienda). RPC `admin_productos_costos` (PIN, search_path fijo, keyset por id). Pull con `COLUMNAS_PRODUCTO_PUBLICAS` (reintenta sin la columna que falte). Costos bajan solo con PIN (`costosProductosService`, en "Subir productos" y "Bajar de otros dispositivos"). Sin PIN: se conservan los locales; un costo desconocido queda `undefined`, no viaja, y `admin_guardar_productos` conserva el del servidor si la clave no llega. La tienda no cambia (`tienda_catalogo` es security definer).
- S-012-02: `synced_at` (trigger `clock_timestamp()`) en las 3 tablas de compras; `admin_compras_bajar(p_cursor jsonb)` pagina por `(synced_at, id)`; cursor por tabla en `domain/cursorCompras.js`.
- S-012-03: sin `when others`; solo se capturan errores de dato (check, not_null, FK, casts, overflow, 22023, P0001).
- S-012-06: `admin_guardar_productos` rechaza NaN/±Infinity y acota precio/costo/pv2 (MAX_IMPORTE), descuentos 0–100, ganancia 0–1000.
- QA obs 1: `costoProductoDesdeIngreso` ignora un costo 0.
- Tests: `productos.costosPrivados`, `cursorCompras`, `migracion013.sql`, `syncCostosPrivados`, `comprasService` (bajar), `compras` (obs 1).
