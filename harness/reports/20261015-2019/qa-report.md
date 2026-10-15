# QA REQ-PAN (run 20261015-2019)
Archivo nuevo: `src/domain/__tests__/panel.bordes.test.js` (28 tests; 26 verdes, 2 rojos = bugs). `panel.test.js` y los de servicio/pagina/grafico del implementador no se tocaron ni duplicaron.

## AC -> tests de bordes (ademas de los existentes)
| AC | Casos agregados |
|---|---|
| AC-PAN-1 | cantidad decimal x precio con centavos; snapshot 0 valido (no estimado); snapshot null => estimado |
| AC-PAN-2 | ganancia/margen negativos con centavos; ganancia 0 sin -0; devolucion total => margen null; NC > ventas (BUG 1); periodo anterior marzo->febrero 28/29, enero->diciembre, 1 dia, cruce de anio, rango que cruza mes; rendicion de pedido inexistente; rechazada/renglon invalido; variacion con anterior negativo; no facturados/web sin aceptar/sin items/nulos; pedido sin remoteId; zona horaria (BUG 2) |
| AC-PAN-3 | producto borrado => costo null y "sin costo"; item sin productoId; agrupacion rubro/marca sin mayusculas ni espacios; Sin vendedor/Sin marca; dimension invalida |
| AC-PAN-4 | en alza: producto nuevo, producto que dejo de venderse, sin cambio, tope n, anterior negativo; sin ventas excluye borrados/inactivos; mas vendidos ignora <= 0; tendencia semanal en limite domingo/lunes y cambio de anio; mensual cruzando anio; sin `hasta` |
| AC-PAN-5 | margen negativo de periodo no se duplica con catalogo; borrados fuera; precio = costo no avisa; descuentos bajan el costo; sin costo |
| AC-PAN-6 | entradas null; periodo vacio; semana previa al mes entra en tendencia/anterior pero no en resumen; devolucion + NC vigentes netean y anulada no; producto borrado sin costo |

## Bugs
1. **Margen con ventas netas negativas (severidad baja).** `margen()` en `src/domain/panel.js` divide por un denominador negativo. Reproducir: `resumenPeriodo([venta 1000 costo 500, nc -3000 costo 0])` => ventas -2000, ganancia -2500, `margenBp` = **+12500** (deberia ser null o negativo). Pasa cuando las NC del mes superan las ventas. Test rojo: "AC-PAN-2 NC mayor que ventas...". Sugerido: `ventas <= 0 ? null`.
2. **Fecha ISO con hora se corta en UTC (severidad baja/latente).** `fechaDe` -> `normalizePedidoFecha` hace `slice(0,10)`. `'2026-10-11T01:30:00Z'` (22:30 del 10/10 en Argentina) queda en 11/10 y puede caer en otro periodo/semana. Hoy `pedidos.fecha` y `rendicion.fecha` se guardan como `YYYY-MM-DD` local (`getLocalTodayStr`), por eso es latente; se dispara si algun origen (web, rendicion de servidor) trae timestamp. Test rojo: "AC-PAN-2 fecha ISO con hora...". Sugerido: convertir con `Date` a fecha local ART cuando hay hora/Z.

## Observaciones sin bug
- Redondeo de margen negativo usa `Math.round` (mitad hacia +inf): -12,5 bp => -12. Diferencia de 1 bp, aceptable.
- Producto vendido y devuelto por completo (unidades netas 0) figura en "sin ventas": coherente con el calculo neto.
- Merma: baja venta pero conserva costo (verificado).

## Ejecucion
`CI=true npx react-scripts test --watchAll=false panel.bordes` => 26 passed, 2 failed (los BUG). Suite completa y cobertura: las corre el gate.
