# Implementación RUN 20261110-t0 — REQ-PVC + REQ-SEG2

Resultado: tests 3349 ok / 3 fallan (`facturasAEmitir.page.test.js`, AC-FAB-3, ya fallaban antes, no tocan este lote). `CI=true react-scripts build` OK sin warnings. Gate `traceability` en rojo solo por `AC-GBU-4` (lote anterior, sin test); los AC de este lote están cubiertos.

## Por AC
**REQ-PVC**
- PVC-1: `domain/precioCosto.js` (`debeRecalcularPrecio`, `precioEsCalculado`, `gananciaConocida`); `plantillas.js` `validarFilaProducto` conserva el precio del existente salvo ganancia > 0 y precio anterior calculado o vacío/0.
- PVC-2: `validarProducto` devuelve `avisos` y `errores.precio = 'Falta el precio de venta o el % de ganancia'`; precio manual = costo neto ⇒ aviso. Las filas propagan `avisos` y la pantalla de importación los lista.
- PVC-3: `ProductoForm` usa `autocompletarPrecio`; ganancia desconocida (`inicial.ganancia === undefined`) no toca el precio. El botón "Usar precio calculado" solo aparece si calculado > costo.
- PVC-4: `productosConPrecioSospechoso` + tarjeta en Configuración > Productos (solo admin) con botón Editar; no corrige solo.
- PVC-5: textos `INFO_PRODUCTO.ganancia/precio` corregidos.

**REQ-SEG2**
- SEG2-1: migración 023 (revoke delete/truncate ×5, drop de policies DELETE, `clientes_borrados`/`faltantes_borrados`, RPC `admin_borrar_cliente` con PIN, `borrar_faltantes`). App: `services/clientesAdminService.js` + modal con PIN en Configuración; proveedores siempre baja lógica; deudas se anulan (`domain/deudas.js`, ocultas en Deudas); faltantes por `borrarFaltanteRemoto`. Todos con fallback al flujo viejo si falta la RPC.
- SEG2-2: `domain/respaldo.js`, `services/respaldoService.js`, `limpiarCache.js` (bloquea con pendientes/offline salvo `{forzado:true}`), flujo en `App.js` (aviso de qué falta, exportar respaldo y escribir BORRAR; cualquier rol).
- SEG2-3: `domain/pedidosIdempotencia.js`; `pedidoRepository.crearPedidoOnlineFirst` escribe primero en IndexedDB con `clientUuid`, sube con upsert `onConflict client_uuid`, sin throw (`mode:'pendiente'`); `syncPedidosPendientes` asigna UUID, mapea por UUID y vincula en el pull; badge "Sin subir" y toast en NuevoPedido/ListaPedidos.
- SEG2-4: `syncFaltantes` paginado + `idsFaltantesABorrar`.
- SEG2-5: migración 023 (check de cantidad `not valid`, trigger invoker 23514, RPC `admin_registrar_ajustes_stock`); `stockService.subirAjustesConPin`, llamado desde `subirProductosConPin`.
- SEG2-6: botón "Exportar respaldo" en Configuración (admin); `.gitignore` con `backups/` y los dos `.sql` sueltos.
- SEG2-7: `syncClientes` 401/403 ⇒ `{ok:false, motivo:'sin_permiso', mensaje}` (se muestra en `useAppContext`); `clearClientesPendingSync` y `markPedidoSynced` limpian solo si `updatedAt` no cambió; `addCliente/updateCliente` ponen `updatedAt`.

`DB_VERSION` sigue en 12 (campos aditivos). `db.leerTodosLosStores()` nuevo.

## Tests nuevos
`precioCosto.test.js`, `ProductoForm.pvc.test.js`, `respaldo.test.js`, `seg2Sync.test.js`, `migracion023.sql.test.js`, `services/__tests__/{clientesAdminService,stockService.ajustesPin,seg2.sync,pedidoRepository.idempotencia,limpiarCache}.test.js`.

## Tests viejos adaptados (ninguno borrado ni salteado)
- `ProductoForm.test.js` (2): sin ganancia el precio no se autocompleta; ganancia 0 no lleva el precio al costo.
- `plantillas.opcionales.test.js` (2 filas), `qa.plantillas.bordes.test.js` (1), `importacion.test.js` (1), `qa.plantillas.import.page.test.js` (3 CSV): fixtures con costo ahora llevan precio.
- `pedidoRepository.test.js`: mock con `upsert`; alta sin remoteId es upsert idempotente.
- `entregadoSync.test.js`: lote de altas = upsert con `client_uuid`, respuesta cruzada por UUID.
- `syncLote011.test.js`, `syncTolerante.test.js`: `clearClientesPendingSync` recibe `{id, updatedAt}`.
- `ConfiguracionAltas.test.js` (AC-PROV-3/4): proveedor sin productos = baja lógica; se agregó `syncStock` al mock.
- `deudaRepository.rendicion.test.js` (AC-REN-4): con remoteId se anula en vez de borrar en Supabase.

## Pasos manuales (dueño)
1. Aplicar `supabase/migrations/023_no_perder_datos.sql` en el SQL editor (no se aplicó en ninguna base). Requiere la 002 (`verificar_pin`). Correr al final las queries comentadas de verificación.
2. Hasta aplicarla, todo sigue como antes (fallbacks con aviso único por consola).
3. Después de aplicarla: los ajustes de stock hechos por Stock quedan "pendientes" y suben con "Subir productos" (PIN de admin).
4. Admin: revisar la tarjeta "N productos con precio igual o menor al costo" en Configuración > Productos (requiere haber bajado costos con PIN).
5. Pendiente de decisión del dueño: S-1110-01 (Auth real de Supabase); `AC-GBU-4` sin test del lote anterior.

## Correccion seguridad (Medios)
- M-1 limpiarCache falla cerrado (`no_se_pudo_leer`); App.js trata ev null como bloqueado (camino forzado con respaldo).
- M-2 armarRespaldo({esAdmin}): no-admin sin stores financieros ni claves costo/ganancia/descuento/margen; nunca pin/token/apikey/password/clave/secret.
- M-3 alta ya existente: update por id (repo y sync); si falla no se marca synced.
- M-4 borrar_faltantes: tope 200 borrados por 10 min (contando faltantes_borrados), motivo `limite_ventana` (migracion 023, sin aplicar).
- Pendientes (no tocados): M-5 y hallazgos Bajos.
