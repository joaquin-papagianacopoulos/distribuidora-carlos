# Veredicto REQ-REN — RUN 20261015-1630

VEREDICTO: APROBADO

## Base
- gates.json: los 7 gates PASS (3008 tests, cobertura dominio 99.86 %, 171/171 AC con test, build ok, sin secretos). npm-audit: solo xlsx (previo, sin nuevos).
- Seguridad (vuelta 2): 0 Critico / Alto / Medio abiertos. Bajos abiertos: S-REN-05 y S-REN-07, aceptables.
- QA: sin bugs reproducibles; 14 tests de bordes sumados.

## Revision del diff (codigo de produccion)
- Stock: movimientos con ref `rendicion:<uuid>` (domain/stock.js:48-53), nunca `pedido:*`, asi que `revisarMovimientosPedido` no los "corrige". Tipo `devolucion` agregado; ids deterministas (`<uuid>:<idx>:a|x`) hacen idempotente el reintento y el segundo dispositivo.
- Rendicion y movimientos se graban en una sola transaccion IndexedDB (db/index.js addRendicionConMovimientos). `syncStock` retiene los movimientos hasta que el servidor confirma la cabecera (stockService.js retenerMovimientoRendicion). Rechazada => se compensa local (neto 0).
- Deudas: el efecto se "reclama" en el servidor antes de aplicarlo local (rendicionService.js aplicarEfectoAlta); crearDeudaRendicion tiene anti-duplicado por concepto; el cobro esta topado al saldo. No se duplica.
- DB 10->11: solo `createObjectStore` condicional por `contains` (db/index.js:157-174); no se toca ni borra nada. Tests migracionV5..V11 actualizados por el numero de version.
- cerrar_comisiones: segun seguridad, el diff contra la 005 cambia solo el calculo del total; grants identicos.
- Bloqueo de revertir/borrar/editar con rendicion vigente: Facturacion.js:341 y ListaPedidos.js handleCancelar. Es solo de UX (el servidor no lo impide).

## AC verificados a mano
- AC-REN-2 (idempotencia/transaccion): addRendicionConMovimientos usa `add` (falla si el id existe) + test stockService/rendicionService. OK.
- AC-REN-4 (bloqueo con rendicion vigente): listaPedidos.rendicion.test.js:54 avisa y no borra; codigo en ListaPedidos.js. OK.
- AC-REN-3 (deuda sin duplicar): aplicarEfectoAlta solo actua si `aplicado===true`; test deudaRepository.rendicion. OK.

## Cambios requeridos
Ninguno bloqueante. Seguimientos (no frenan el merge):
1. Servidor no impide revertir un pedido con rendicion (solo la UI) — REQ aparte.
2. `ajuste` desde anon con cualquier signo (brecha previa 001, S-REN-07c).
3. Corte del dispositivo justo despues del reclamo: el efecto local se pierde y queda anotado en el servidor (documentado).
4. QA riesgo 1: confirmar que `item.precio` ya es neto de descuento (el servidor igual topa el credito al total del pedido).

## Pasos manuales para el dueño
1. Backup de Supabase y exportar datos antes de empezar.
2. Aplicar `supabase/migrations/014_lote_operacion_rendicion.sql` en el SQL editor, DESPUES de 011/012/013 y ANTES de publicar la app.
3. Prueba con dos dispositivos: misma devolucion desde ambos (no debe duplicar) y excedente (cantidad_excedida).
4. Probar anular una rendicion y confirmar que el stock vuelve exacto.
5. Publicar. Ver `manual.md`.
