VEREDICTO: APROBADO

Revision RUN 20261110-t2 (REQ-RTO, REQ-HRU, REQ-RED, REQ-DMP).
Corridas propias: suite 262/262 suites, 3696 ok, 1 skipped (preexistente, AC-SEC-4, ya estaba en HEAD), 5 todo. Gates: TODOS PASARON (gates.json).

1. AC -> test: cada AC RTO-1..6, HRU-1, RED-1/2, DMP-1 tiene test que lo nombra (pdfBoleta011, boletaLayout, cobranza, pdfHojaRuta,
   redondeo, ConfigRedondeo, ajustesService, deudaRepository.redondeo, deudas.medioPago, syncDeudas, qaT2.*). Gate traceability OK.
2. Fixes en codigo: S-T2-01 syncService.js:1625 (esColumnaInexistente && nombraColumnaDmp, el error CHECK no marca synced);
   S-T2-02 CHECK octet_length<=60000 en 025; S-T2-03 unirCobrosDeuda (cobranza.js:227) usada al subir (1590) y bajar (1706);
   S-T2-06 alRevertirPendiente/redondeoFromRemote; S-T2-07 importe = min(totalACobrar, saldo). BUG-1 (sinDato por resto, cobranza.js:156)
   y BUG-2 (centavos<=0, cobranza.js:96) corregidos; sus tests ya pasan.
3. Migracion 025 leida linea a linea: 3 bloques DO con $mig$ pareados, 2 funciones con $$ pareados, sin '$' sueltos; comas/parentesis/comillas
   OK; add column if not exists, constraints con guarda en pg_constraint y NOT VALID, to_regclass tolera tablas ausentes, create or replace;
   sin drop ni delete; begin/commit. Idempotente. Hay test migracion024.sql; ver recomendacion 1 (no bloqueante).
4. Tests: no se borro ni salto ninguno de este lote. Los "-it" removidos son AC-TRQ-1 (troquel, eliminado por AC-RTO-6, reemplazados por
   tests AC-RTO-6 de no-solapamiento/margen) y AC-FAB-1/4 (default y titulo, AC-RTO-1); AC-PROV-3/4 y AC-REN-3/4 fueron renombrados/
   adaptados (SEG2 / AC-RTO-5), no borrados. Los ADAPTADO de este lote no debilitan garantias: mantienen aserciones equivalentes
   (REMITO, saldo anterior, mock de generarHojaRutaFile). Otros ADAPTADO en el diff (CBU, MUL, MIN2, ASV) son de lotes previos sin commitear.
5. Dinero: total (renglones) intacto para comisiones/cerrar_comisiones; totalACobrar usado en deuda, remito, hoja de ruta, reportes;
   suma en centavos; no redondea si deja <=0. Sin inconsistencias salvo observacion de abajo.
6. Reglas duras: sin .env/claves, sin autoIncrement nuevo, stock sin tocar, campos legacy intactos, sin mojibake; PDF con "Ítems",
   "Dirección", "Rendición" correctos.

Recomendaciones (no bloqueantes)
1. Agregar test estatico de balanceo de $$/$mig$ para 025 (como el de la 024).
2. "Facturas a emitir" (UI/PDF/RPC) suma pedido.total sin redondeo: confirmar con el dueno que es lo deseado (factura ARCA = renglones).
3. Revertir un facturado con cobros previos conserva la deuda con monto redondeado viejo (caso raro).
4. Abiertos aceptados: S-T2-04/05 (requieren auth real, S-1110-01), S-T2-08 (bloqueo de PIN heredado).

Pasos manuales para el dueno
- Backup en Supabase; correr 024 y luego supabase/migrations/025_remito_redondeo_medio_pago.sql en el SQL Editor (re-ejecutable).
- Sin la 025 la app anda igual (campos locales, aviso por consola); el ajuste "Redondeo del total" se sincroniza solo tras aplicarla.
- Deploy normal; los pedidos ya facturados no se recalculan.
