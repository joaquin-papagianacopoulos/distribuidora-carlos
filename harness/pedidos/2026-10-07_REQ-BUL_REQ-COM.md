
---

## REQ-BUL — Botón "Bulto" al cargar productos en un pedido

Contexto: el producto ya tiene el campo **Bulto x** (`bultoX`, cuántas unidades trae el bulto).

| Decisión | Valor |
|---|---|
| Pantallas | **Pedido** (carga del vendedor), **Facturación** (editar pedido) y **Armado** |
| Qué suma el botón | `bultoX` unidades por cada toque (se acumula sobre la cantidad que ya tenga el renglón) |
| Productos sin bulto | Si `bultoX` es 1 o no está cargado, el botón no se muestra |

- **AC-BUL-1** En los renglones de las tres pantallas, un producto con `bultoX > 1` muestra un botón "+ Bulto (x N)", donde N = `bultoX`. Con `bultoX` ≤ 1 o vacío, no aparece.
- **AC-BUL-2** Cada toque suma exactamente `bultoX` a la cantidad del renglón: con bulto x12, tocar 3 veces sobre un renglón en 0 deja 36; sobre un renglón con 5 deja 41.
- **AC-BUL-3** Hay un botón "− Bulto" que resta `bultoX` sin bajar de 0 unidades (si quedaría en 0 o menos, se comporta como hoy al vaciar la cantidad: el renglón no se borra solo).
- **AC-BUL-4** El renglón muestra el desglose: "36 u. = 3 bultos" o "41 u. = 3 bultos + 5 u.". El desglose se calcula con el `bultoX` actual del producto.
- **AC-BUL-5** El cálculo (sumar/restar bultos, desglose) es una función pura en `src/domain/` con tests, incluyendo `bultoX` decimal, negativo, texto o ausente (se trata como "sin bulto").
- **AC-BUL-6** Los avisos existentes siguen funcionando con la cantidad resultante: mínimo de venta y stock disponible (AC-PROD-4).
- **AC-BUL-7** En Facturación y Armado, sumar bultos a un pedido ya facturado ajusta el stock solo por la diferencia (mismo mecanismo de AC-STK-4). En Armado, el registro de lo que cambió el armador (`armadoLog`) refleja el cambio de cantidad.
- **AC-BUL-8** Los botones respetan los permisos actuales de cada pantalla (el vendedor solo en Pedido; el armador en Armado; el admin en las tres).

---

## REQ-COM — Cierre de comisiones (dashboard para admin)

| Decisión | Valor |
|---|---|
| Base de cálculo | Pedidos **facturados y entregados** dentro del período |
| "Entregado" | La app hoy no tiene esa marca (solo "A reparto"). Se agrega una marca **Entregado** al pedido (ver AC-COM-1). **⚠ A confirmar con el dueño** si alcanza con "A reparto" |
| Período | Rango de fechas elegido por el admin; se usa la **fecha del pedido** |
| % de comisión | El de la ficha del cliente (`comision`), congelado al momento del cierre |
| A quién le corresponde | Al **vendedor de la ficha del cliente**. Si el pedido lo cargó otro vendedor, el admin decide: todo a uno, todo al otro, o dividir |
| Cierre | Por período: se revisa, se confirma y queda guardado e inmodificable. Un pedido cerrado no vuelve a contar en otro cierre |

### Marca de entregado
- **AC-COM-1** En Facturación y en Orden de entrega, un pedido facturado tiene un botón "Marcar entregado" / "Desmarcar". Guarda `entregado`, `entregadoAt` y `entregadoPor`, se sincroniza con Supabase (columnas nuevas, tolerando que no existan todavía, como AC-CLI-5) y no modifica `estado` ni el stock.

### Dashboard
- **AC-COM-2** Nueva sección "Comisiones" solo para admin (AC-SEC-4). Un vendedor o armador no la ve ni puede entrar.
- **AC-COM-3** El admin elige el período (por defecto, el mes en curso). Cuentan solo pedidos `facturado` + `entregado`, no borrados/cancelados, con fecha dentro del rango y que **no** pertenezcan a un cierre vigente.
- **AC-COM-4** Comisión del pedido = total del pedido × % de comisión del cliente / 100, redondeado a 2 decimales. Cliente sin % cargado → comisión 0 y aviso "cliente sin % de comisión".
- **AC-COM-5** Resumen por vendedor: cantidad de pedidos, cantidad de clientes, total vendido y total de comisión. Al tocar un vendedor se ve el detalle por cliente y por pedido.
- **AC-COM-6** Avisos visibles arriba del dashboard, con contador: (a) pedido cargado por un vendedor distinto al de la ficha del cliente, (b) cliente sin vendedor asignado en la ficha, (c) cliente sin % de comisión, (d) pedidos facturados del período sin marcar como entregados (informativo, no se cuentan).

### Asignación cuando el pedido lo cargó otro vendedor
- **AC-COM-7** Por defecto la comisión va al vendedor de la ficha. En los pedidos con aviso (a), el admin puede elegir: 100 % al vendedor de la ficha, 100 % al que cargó el pedido, o **dividir** con un % para cada uno (la suma tiene que dar 100; por defecto 50/50).
- **AC-COM-8** Un cliente sin vendedor en la ficha no se puede cerrar hasta que el admin asigne la comisión de sus pedidos a un vendedor (o la marque "sin comisión").
- **AC-COM-9** Las asignaciones se guardan como borrador del período (no se pierden al salir de la pantalla) hasta confirmar el cierre.

### Cierre
- **AC-COM-10** "Cerrar comisiones" pide confirmación mostrando los totales por vendedor. Al confirmar se graba un **cierre** (UUID) con: período, fecha, admin que cerró, y el detalle congelado por vendedor → cliente → pedido (total, %, comisión, asignación/división).
- **AC-COM-11** Un cierre confirmado no se puede editar. Los pedidos incluidos quedan marcados con el id del cierre y no vuelven a aparecer en otro período.
- **AC-COM-12** El admin puede **anular** un cierre indicando un motivo obligatorio. Queda registrado (quién, cuándo, motivo) y sus pedidos vuelven a estar disponibles. Un cierre anulado se sigue viendo en el historial, marcado como anulado.
- **AC-COM-13** Si un pedido ya cerrado cambia después (se edita el total, se revierte a pendiente o se borra), el dashboard lo muestra como **ajuste pendiente** con la diferencia de comisión, para incluirla en el próximo cierre.
- **AC-COM-14** Historial de cierres con sus totales, y exportación a PDF de un cierre (resumen por vendedor + detalle). El PDF usa el mismo generador de la app (`pdfGen`).
- **AC-COM-15** Cálculos, filtros, divisiones y validaciones (suma = 100 %, redondeos, montos negativos/NaN) son funciones puras en `src/domain/comisiones.js` con tests.
- **AC-COM-16** Persistencia offline-first como el resto: store IndexedDB nuevo con id UUID, sincronización por upsert y migración `supabase/migrations/003_comisiones.sql` con RLS y sin política de borrado para los cierres. Dos admins cerrando el mismo período desde dos dispositivos no puede dejar pedidos contados en dos cierres vigentes (restricción única en Supabase o validación equivalente).
