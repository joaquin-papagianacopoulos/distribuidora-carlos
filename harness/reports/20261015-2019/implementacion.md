# Implementación — REQ-PAN Panel de ganancia y rentabilidad (run 20261015-2019)

## Resultado
`node harness/gates/run-gates.mjs --fast` en verde (unit-tests, coverage-domain, traceability, secret-scan,
security-rules). `react-scripts build` OK. No se tocó `harness/gates/**` ni `security-report.md`.

## Piezas (cada una con su test)
| Pieza | Archivo | Test | AC |
|---|---|---|---|
| Migración | `supabase/migrations/015_lote_operacion_panel.sql` | `src/__tests__/security.panel.run2019.test.js` (estático) | AC-PAN-1 |
| Dominio puro | `src/domain/panel.js` | `src/domain/__tests__/panel.test.js` (28 tests, incluye 20.000 renglones < 1 s) | AC-PAN-1..6 |
| Cursor | `src/domain/cursorCompras.js` (`TABLAS_CURSOR_PANEL`) | `panelService.test.js` | AC-PAN-1 |
| IndexedDB v12 | `src/db/index.js` (`costosVenta`, `getCostosVenta`, `putCostosVentaBatch`) | `src/db/__tests__/migracionV12.test.js` | AC-PAN-1 |
| Costos fuera de items | `pedidoRepository.js` y `syncService.js` usan `itemsSinCostos(p.items)` | `pedidoRepository.test.js` + estático | AC-PAN-1 |
| Servicio | `src/services/panelService.js` | `src/services/__tests__/panelService.test.js` | AC-PAN-1/2 |
| Gráfico SVG | `src/components/GraficoBarras.js` | `components/__tests__/GraficoBarras.test.js` | AC-PAN-4 |
| Pantalla | `src/pages/Panel.js` | `pages/__tests__/panel.page.test.js` | AC-PAN-2..5 |
| Pestaña solo admin | `src/App.js` (`panel`) | `src/__tests__/app.stockBajo.test.js` | AC-PAN-2 |

## Decisiones
- El snapshot de costo lo captura el servidor (trigger `AFTER INSERT OR UPDATE OF estado, items` en `pedidos`)
  en `pedidos_costos` (RLS on, `revoke all`, sin policies). El primer costo capturado por producto gana.
- El trigger no bloquea el guardado: ante error hace `raise warning` Y anota una fila en la tabla privada
  `pedidos_costos_errores` (si ese insert también falla, otro warning). Nada se traga en silencio.
- `admin_costos_venta_bajar` (PIN admin, cursor `(synced_at, pedido_id)`, páginas de 1000) es lo único con
  `grant execute`. Helper `_costo_neto_producto` y la función del trigger sin execute.
- `costoUnitario` nunca viaja en `pedidos.items`: `itemsSinCostos` limpia `costoUnitario/costoFinal/costoNeto/
  costo/descuento1/descuento2/ganancia` en los dos caminos de subida (repositorio y sync masivo).
- Costo neto 0 por descuento 100 % es un costo válido (0), no "sin costo"; solo vacío o <= 0 en `costoFinal` da null.
- Sin backfill: pedidos anteriores a la 015 quedan como "costo estimado".
- La pantalla muestra aviso si falta la 015 o si no hay costos bajados; el PIN se limpia tras usarlo y no se persiste.

## Tests existentes modificados (marcados `MOD (RUN 20261015-2019, REQ-PAN)`)
`migracionV5..V11.test.js` y `security.comisiones.iter2.test.js`: `DB_VERSION` 11 -> 12 y se suma el store
`costosVenta` a las listas de stores esperados. No se desactivó ni se bajó ningún umbral.

## Para el dueño (manual)
Aplicar `015_lote_operacion_panel.sql` en el SQL Editor de Supabase (después de 011, 012 y 013; hacer backup
antes). Luego, en el Panel, "Actualizar costos (PIN)" en el dispositivo admin.

## Supuestos / riesgos
- Redondeo SQL (`round`) vs JS (`Math.round`) puede diferir 1 centavo en casos límite.
- Pedido facturado offline: el snapshot toma el costo cuando llega al servidor (deriva acotada).
- Merma: baja la venta pero no el costo. NC: solo afecta totales, vendedor y cliente.
- La migración no se probó contra un Postgres real (no hay entorno): revisión del auditor recomendada,
  en especial la extracción de `productoId` del jsonb en el trigger y el `on conflict ... where`.

## Vuelta 2
- margen() devuelve null con ventas <= 0 (AC-PAN-2); fechaDe convierte ISO con zona/timestamp a dia Argentina (UTC-3), `YYYY-MM-DD` igual.
- 015: trigger captura solo en transicion a facturado (SEC-PAN-01); borra errores > 90 dias al insertar uno nuevo (SEC-PAN-03).
- Tests: panel.bordes (sin `// BUG:`), src/__tests__/security.panel.vuelta2.test.js.
