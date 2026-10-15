# QA REQ-REN — RUN 20261015-1630

Test nuevo: `src/domain/__tests__/rendicion.bordes.test.js` (14 tests, todos verdes). Se sumó a los ~140 tests AC-REN del implementador, sin duplicarlos. Solo corrí los tests que escribí; la suite completa y la cobertura las corre el gate.

## AC -> tests
| AC | Tests existentes (implementador) | Bordes sumados por QA |
|---|---|---|
| AC-REN-1 | rendicion.test, rendicion.page.test, rendicionService.test, app.stockBajo | Dos parciales + excedente rechazado. Todo devuelto (disponible 0). Cantidad decimal facturada 2.5 (hasta 2). Form null/undefined. Motivo de 2 letras o con espacios. NC con centavos, inválidos (0, -5, NaN, Infinity, null) y tope tras una devolución previa. |
| AC-REN-2 | rendicion.test, rendicionService.test, stockService.test | Devolución 100 % merma (sin movimientos ni anulación, igual acredita). Cambio del mismo producto (diferencia 0, sin ajuste de comisión, ids distintos). Anular devolución + cambio deja el stock exacto (suma de movimientos). Los ids de anulación no dependen de `now` (reintento no duplica). |
| AC-REN-3 | rendicion.test, deudaRepository.rendicion.test, rendicionService.test | Cambio con diferencia a favor y en contra (cargo). NC mayor que la deuda con centavos flotantes (cobros + saldo = crédito). `cuentaParaBoleta` sin pérdida de centavos. |
| AC-REN-4 | rendicion.test, rendicionService.test, pdfRendicion.test | Anular dos veces no compensa dos veces el saldo a favor (asientos `favor:a` + `favor:x` netean 0). Resumen del día con merma. |
| AC-REN-5 | comisiones.rendicion.test, comisionesService.rendicion.test, rendicion.facturacion.test, listaPedidos.rendicion.test | NC de 1 centavo repartida en 3 rubros suma exacta -1. `comisionRenglonesDe` con rendición nula y con pedido sin renglones. |
| AC-REN-6 | rendicion.test (funciones puras) | Cubierto por los bordes de arriba (todo sobre funciones puras). |

## Bugs encontrados
Ninguno reproducible en dominio. Los tests de bordes pasan.

## Riesgos y observaciones (sin test fallando)
1. **Descuentos y crédito**: la devolución acredita `precioCents` del renglón (precio del ítem). Si el pedido tiene descuento global que no está en `item.precio`, el crédito podría superar lo cobrado. El tope de NC usa `pedido.total`, pero la devolución no tiene tope contra el total. Conviene confirmar que `item.precio` ya es el precio neto.
2. **Efecto perdido**: el implementador ya documentó que un corte entre el reclamo del efecto en el servidor y la aplicación local lo pierde. No se puede probar sin Supabase real.
3. **Cambio sin stock**: la `venta` de un cambio puede dejar stock negativo. No hay validación de stock disponible en `validarRendicion` (es coherente con facturar).
4. **Faltó probar**: SQL real de la 014 (RPC, triggers, `cerrar_comisiones`) solo tiene tests de texto (`migracion014.sql.test.js`). Hace falta una prueba manual en Supabase con dos dispositivos (reclamo concurrente y `cantidad_excedida`).
5. La cobertura de UI de bloqueo (revertir/borrar/editar con rendición vigente) es del implementador. No agregué casos nuevos de UI.
