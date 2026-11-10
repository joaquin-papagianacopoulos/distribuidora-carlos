# Revision final RUN 20261110-t0 (REQ-PVC, REQ-SEG2)
VEREDICTO: APROBADO

Tests re-corridos: 236 suites, 3391 passed, 1 skipped (it.skip AC-SEC-4 preexistente), 5 todo preexistentes. gates.json en verde.

## AC -> test (todos nombrados en tests)
- PVC-1: precioCosto.test, qa.t0.bordes | PVC-2: ProductoForm.pvc.test, precioCosto.test, qa.t0.bordes
- PVC-3: ProductoForm.pvc/ProductoForm.test, precioCosto.test | PVC-4: precioCosto.test, qa.t0.bordes (aviso en Configuracion.js:549, solo admin)
- PVC-5: precioCosto.test
- SEG2-1: migracion023.sql.test, clientesAdminService.test, ConfiguracionAltas.test, deudaRepository.rendicion.test
- SEG2-2: limpiarCache.test, respaldo.test, qa.t0.servicios | SEG2-3: pedidoRepository.idempotencia/seg2.sync/migracion023 + otros
- SEG2-4: seg2.sync.test, seg2Sync.test | SEG2-5: migracion023.sql.test, stockService.ajustesPin.test
- SEG2-6: respaldo.test, migracion023.sql.test; .gitignore tiene backups/ y .sql de limpieza
- SEG2-7: seg2.sync.test, syncLote011, syncTolerante, seg2Sync.test

## Medios de seguridad (verificado en codigo)
- M-1 corregido: limpiarCache.js:50-53 falla cerrado (no_se_pudo_leer); App.js ev==null -> camino forzado con respaldo + BORRAR.
- M-2 corregido: respaldo.js filtra STORES_FINANCIEROS y claves costo/ganancia/descuento/margen si no es admin; App.js pasa esAdmin.
- M-3 corregido: pedidoRepository.js:76-80 hace update por id tras conflicto; si falla, error y queda pendiente.
- M-4 corregido: migracion 023 borrar_faltantes tiene tope por ventana (200 / 10 min) via faltantes_borrados.
- M-5 (UPDATE sigue abierto, inflado de stock por 'ingreso') queda como residual documentado, fuera de AC; decision del dueno.

## Migracion 023
Idempotente (if exists / if not exists / create or replace / to_regclass), sin DROP de datos (solo policies DELETE y constraint/trigger propios), tolera tablas ausentes, check NOT VALID, transaccional. Requiere 002 y 004 (columna activo): el encabezado solo cita la 002 (menor, ver 3).

## Tests viejos
Sin .skip/xit nuevos. Tres tests modificados (no borrados) por cambio de contrato deliberado: AC-PROV-3, AC-PROV-4 (delete -> baja logica), AC-REN-4 (anular en lugar de borrar); mocks de pedidoRepository/entregadoSync/syncLote011/syncTolerante adaptados a upsert. Justificado por AC-SEG2-1/3.

## Reglas duras
Stock solo por movimientos (ajustes via RPC admin); UUID para client_uuid y ids de movs; sin logs de claves; sin mojibake; sin columnas nuevas publicas en productos.

## Observaciones no bloqueantes
1. Corregir el encabezado de 023: requisitos 002 y 004.
2. B-3: rendiciones 'rechazada' no cuentan como pendientes (el borrado de cache las perderia); B-4: guardar montoOriginal en anularDeuda.
3. Pasos manuales dueno: aplicar 023 en SQL editor (tras 002/004), correr las consultas de verificacion del pie, desplegar la app DESPUES de la migracion (sin ella el alta cae al insert viejo con aviso).
