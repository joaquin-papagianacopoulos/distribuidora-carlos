# Implementacion — RUN 20261015-1513 (REQ-FAB, REQ-AGR, REQ-TRQ, REQ-ZON)

Plan implementado completo. Gates `--fast`: unit-tests, coverage-domain, traceability, secret-scan, security-rules en verde. `react-scripts build` con CI=true: verde.
Stock: ningun camino nuevo toca `movimientosStock` (tipo de factura se guarda con `patchRegistros`, grupos con el guardado normal sin `iniciarStock`).

## Migracion
- `supabase/migrations/011_lote_operacion_facturacion_zonas.sql` (idempotente, RLS, sin drops):
  - `pedidos.grupos jsonb`; `clientes.orden_zona` + check > 0 + inicializacion UNICA (dia lunes..domingo, `orden_entrega`, nombre, id; no toca dia/orden).
  - `pedidos_factura` (tipo A/B/ninguna): RLS activo, `revoke all` a anon/authenticated, sin policies. `pedido_id` toma el tipo de `pedidos.id` dinamicamente.
  - Helper `_es_admin_con_pin` (sin grant) + RPC `admin_guardar_tipos_factura` (LWW por `updated_at`, tope 500) y `admin_facturas_a_emitir` (rango max. 366 dias, solo `facturado`). Ambas con PIN de admin (patron 007/010).
- `DB_VERSION` sin cambios (solo campos opcionales).

## Dominio (`src/domain/`) con test (AC-* en titulos)
- `facturacionAB.js` (AC-FAB-1/2/3): sugerencia por IVA, marcado masivo, aviso CUIT, filas/lotes de RPC, interpretacion de respuestas, reporte A/B con subtotales, `aplicarTiposLocales`.
- `gruposFactura.js` (AC-AGR-1..4): crear/renombrar/deshacer, saneo, `textoBultosGrupo`, `filasBoleta` (detalle / solo_grupos, sin doble conteo), helpers de sync (`gruposToRemote` omite la clave si el pedido no la tiene).
- `boletaLayout.js` (AC-TRQ-1, AC-FAB-4): pie sin solapamientos, hoja nueva si no entra, casillas Efectivo / Transferencia / Transf. a proveedor + "Proveedor: ____".
- `zonas.js` (AC-ZON-1..4): `claveZona`, `listarZonas`, `clientesDeZona` (init perezosa por dia+orden), `moverEnZona` (solo devuelve cambiados), `ordenZonaTrasCambioZona`, `calcularOrdenPorZona`.

## Sync / servicios
- `syncService.js`: `grupos` solo si el pedido lo tiene; `mapPedidoRemoto` sanea grupos y conserva `tipoFactura*` local; reintento sin `grupos` (PGRST204) antes del fallback de entrega; `orden_zona` en clientes con `upsertTolerante` (tambien en filas basicas) y `ordenZona` tolerante al bajar.
- `pedidoRepository.js`: mismo `grupos` + reintento sin la columna.
- `facturacionService.js` (nuevo): marca local, subida por lotes limpiando SOLO lo confirmado y no re-marcado durante la subida, consulta del reporte, `aplicarTiposRemotos` (no pisa pendientes), sonda de la 011. El PIN no se guarda ni se loguea.

## UI / PDF
- `pdfGen.js`: `buildFacturaDoc(..., opciones)` (`tipoFactura`, `modoGrupos`; retrocompatible), encabezado FACTURA A/B, filas con grupos, pie por `layoutPieBoleta`, troquel solo en la ultima hoja; `generarFacturasAEmitirFile` (nombre sin CUIT).
- `TipoFacturaSelector`, `AgruparRenglones` (nuevos); `Facturacion.js`: selector por pedido, marcado masivo, "Subir tipos de factura (N)" con PIN, agrupar en el editor, modo de impresion de grupos (todo solo admin; la pantalla ya era solo admin).
- `FacturasAEmitir.js` + tab "A emitir" en `App.js` solo si admin (guard doble: tab y pagina). Requiere conexion + PIN; sin `console.*` de filas.
- `OrdenEntrega.js`: selector de zona (ficha del cliente), reordenar con ▲/▼ o numero, `updateCliente` solo de los cambiados (con spread: dia/orden de entrega se conservan); impresion por fecha(s) de pedido + zonas, ORDEN de la boleta = numero de zona. `Configuracion.js`: al cambiar la zona de un cliente `ordenZona` pasa a null (va al final de la nueva).

## Tests nuevos
`facturacionAB`, `gruposFactura`, `boletaLayout`, `zonas`, `migracion011.sql` (domain); `facturacionService`, `syncLote011` (services); `pdfBoleta011` (jsPDF real con subclase espia); `facturacionAgrupar` (componentes); `facturasAB.facturacion`, `facturasAEmitir.page`, `ordenEntrega.zonas` (paginas).

## Notas para el auditor
- Decisiones S1..S5 del plan aplicadas tal cual. `clientes.cuit/tipo_iva` ya eran legibles con anon (fuera de alcance, sin ampliar exposicion).
- `admin_facturas_a_emitir` devuelve CUIT: solo con PIN de admin activo; el PIN se limpia del estado antes de llamar.
- El ancho de columnas de la boleta cambio (Cant. 28, Subtotal 32) para que entre "3 bultos (36 u.)".
- Pendiente manual del dueño: aplicar la 011 en Supabase. Sin ella la app sigue andando (grupos y orden_zona caen a modo local con aviso; tipos A/B quedan pendientes).

## Vuelta 2
- zonas.js: calcularOrdenPorZona ignora pedidos null/no-objeto (AC-ZON-2); se quito el // BUG: del test.
- 011: orden_zona normaliza dia_entrega (btrim + translate sin unaccent); updated_at topado con least(..., now()+5min) (S-011-04); constraint pedidos_grupos_size_chk not valid (S-011-05).
- gruposFactura.js: normalizarGrupos topa el tamano (MAX_BYTES_GRUPOS). Tests estaticos en migracion011.sql.test.js y gruposFactura.test.js.
