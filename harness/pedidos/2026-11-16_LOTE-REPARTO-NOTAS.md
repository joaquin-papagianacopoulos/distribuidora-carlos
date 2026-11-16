# Pedido 2026-11-16 — Lote reparto, notas, remito y factura de proveedor

Texto del dueño (tal cual):

- Que en orden, se pueda imprimir el reparto del día solo habilita el día anterior. Y que pueda seleccionar los pedidos que elija entregar.
- Letra arial black.
- Stock visible? se puede ver el stock real mientras se levanta pedidos?
- Líneas de recuadros más claritas, gris más suave.
- Que Carlos y Paola puedan editar cantidades.
- Que en sin armar aparezcan todos los pedidos sin armar hasta la fecha.
- No se ven las notas de pie de pedido.
- ELEMENTAL: los errores de escala bulto. El San Ignacio de 1 litro no baja su precio de 3 bultos (hice exactamente lo mismo que con 500, que sí lo toma bien). A los otros les expresé la cantidad como bulto para que lo tome, pero eso hace que no exprese el precio de unidad de bulto comprando cantidad: tiene que figurar siempre el precio de unidad x bulto, en todos los casos.
- Que en remito aparezca el precio unitario.
- Fact proveedor: solo hay que poner si es A o B, sin número. N.º de factura A / B: sacar. En la columna factura no nos sirve poner si es A, B o en negro porque ya lo ponemos arriba. Cargamos separado las A y las B.
- El tamaño de imagen para el carro: tengo imagen 10x10 en jugo, ¿está bien?
- ¿Cómo se hace nota de crédito? ¿Cómo se hacen devoluciones?
- Hoja reparto (Carly): aparecen todos los pedidos solo del día de la fecha (incluso algunos ya entregados y pagados). No siempre sacamos el reparto completo como se tomó: necesitamos poder ELEGIR qué pedidos salen a reparto, con una única lista con todos los pedidos pendientes de entrega y no por fecha.

Mapa a requerimientos (harness/SPEC.md, "Lote 2026-11-16"):

| Pedido | REQ / AC |
|---|---|
| Reparto elegible, lista única | REQ-REP (AC-REP-1..3) |
| Sin armar hasta la fecha | REQ-SAR (AC-SAR-1) |
| Notas de pie de pedido | REQ-OBS (AC-OBS-1..3) — requiere migración 028 |
| Líneas más claras | AC-RTO-8 |
| Precio unitario en remito | AC-RTO-9 |
| Escala de bultos que no aplica | AC-ESC2-5 |
| Precio de unidad x bulto siempre | AC-CBU-4, AC-RTO-9 |
| Stock visible | REQ-STV (AC-STV-1) |
| Factura proveedor solo A/B | REQ-INA2 (AC-INA2-1) |
| Arial Black | pendiente de confirmar |
| Carlos y Paola editan cantidades | pendiente de confirmar |

## Ampliación (mismo día) — Orden de entrega como tablero interactivo
Pedido del dueño: el botón "Orden" se cambia por completo. No se entregan los pedidos por día: quiere entregar según quiera él, ese día y en ese momento. Armar un dashboard interactivo donde elija clientes y direcciones de pedidos pendientes de entrega y se ordenen según el orden de entrega que ponga. Muy interactivo, fácil de entender, que se vea bien en celular y compu.

Mapa: REQ-RUT (AC-RUT-1..7). Reemplaza la pantalla por zona/día (AC-ZON-1/2) y la lista con tildes de REQ-REP.
