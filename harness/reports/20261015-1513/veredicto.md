# Veredicto 20261015-1513 (REQ-FAB, REQ-AGR, REQ-TRQ, REQ-ZON)

VEREDICTO: APROBADO

## Evidencia
- gates.json: todos PASS (2610 tests, cobertura dominio 99.83%, 152/152 AC con test, build ok, sin secretos).
- No se re-corrio la suite (se confia en gates.json).
- Diff: 8 archivos modificados (+411/-237) y modulos nuevos en domain/services/pages/components + migracion 011.

## Revision de codigo
- Retrocompatibilidad: `buildFacturaDoc` recibe `opciones` opcionales; `grupos` solo viaja si el pedido lo tiene;
  `tipoFactura` va a tabla aparte (`pedidos_factura`), no a `pedidos`. Sin cambio de schema IndexedDB (no hace falta DB_VERSION).
- Offline / migracion 011 sin aplicar: sync reintenta sin `grupos` (PGRST204), `orden_zona` tolerante, tipos A/B quedan
  pendientes con aviso. Limpia SOLO ids confirmados. OK.
- Seguridad: RLS sin grants en `pedidos_factura`; RPC security definer con PIN admin (bcrypt + bloqueo). OK.
- Vuelta 2 verificada en codigo: zonas.js:93 ignora pedidos null; 011.sql:60-61 normaliza dia (btrim + translate);
  011.sql:142 `least(..., now()+5min)` (S-011-04); 011.sql:33-35 check de tamano `not valid` (S-011-05);
  gruposFactura.js:14 `MAX_BYTES_GRUPOS`. S-011-04 y S-011-05 quedan CERRADOS.
- Stock: agrupar no toca movimientos (AC-AGR-2). Sin codigo muerto relevante ni `console.*` de filas.

## AC verificados a mano
1. AC-ZON-2 (pedidos null): zonas.js:93 `if (!p || typeof p !== 'object') continue` satisface el test de qaLote011.bordes.
2. AC-FAB-2 (aviso A sin CUIT): `avisoFacturaA` (facturacionAB.js:46) + test en facturacionAgrupar.test.js:61-67 (aviso y no bloquea).
3. AC-ZON-3 (migracion sin perdida): 011.sql:60-61 inicializa por dia y luego orden; `ordenLegacy` espeja en JS; dia/orden se conservan.

## Cambios requeridos
Ninguno.

## Observaciones no bloqueantes
- Observaciones del troquel de mas de ~50 lineas no paginan (limite aceptado).
- S-011-01/02/03 heredados del modelo "todo anon" (CUIT y pedidos legibles/escribibles con la clave publica;
  DoS de PIN admin). Recomendado: migrar a Supabase Auth en una tanda propia.
- S-DEP-xlsx heredado (migrar a exceljs).

## Pasos manuales para el dueño
1. Backup de Supabase (y exportar datos de la app) antes de tocar nada.
2. Aplicar `supabase/migrations/011_lote_operacion_facturacion_zonas.sql` en el SQL editor, DESPUES de la 010.
3. Probar con la anon key: `select * from pedidos_factura` debe dar "permission denied".
4. Recien despues, publicar el deploy (build ya verde).
5. Probar en un dispositivo: marcar un tipo, subirlo con PIN, ver "A emitir", imprimir una boleta.
