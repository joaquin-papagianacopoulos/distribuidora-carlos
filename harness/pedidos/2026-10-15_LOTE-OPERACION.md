# Pedido 2026-10-15 — Lote "operación diaria" (13 REQ en 5 corridas)

> Prompt para el pipeline del harness (`/mejorar-app`). Se corre **por tandas** (ver "Corridas" al final): en cada corrida el orquestador incorpora a `harness/SPEC.md` **solo** los REQ de esa tanda (si no, falla el gate `traceability`).
> **Autorización del dueño:** "si tienen que tomar alguna decisión sobre seguridad, tienen todos los permisos; resuelvan todo de la manera más fácil y recomendable". El arquitecto y el auditor deciden y dejan cada decisión anotada en "Supuestos/Decisiones" del plan y en el reporte de seguridad.
> **Entregable extra por corrida:** `harness/reports/<RUN_ID>/manual.md` (máx. 80 líneas, para el dueño, sin jerga): cómo se usa cada cosa nueva paso a paso, evaluación de seguridad en 5 líneas y precauciones/pasos manuales (migraciones SQL, en qué orden, backup).

## Principios para todo el lote
- **Lo más simple que funcione**, reutilizando lo que ya existe (bultos/`unidadVenta`, `stockService`/ledger, `pdfGen`, `rubros`/`marcas`, patrón de RPC con PIN de admin de la migración 007, selectores con "Agregar nuevo…").
- **Nada se rompe:** pedidos, productos, clientes e ingresos viejos (sin los campos nuevos) siguen funcionando con defaults.
- Stock **solo** por movimientos. Todo cálculo (precios, agrupado, rentabilidad, saldos, A/B) en funciones puras de `src/domain/` con tests.
- **Seguridad de datos financieros:** costos, ganancias, pagos y saldos con proveedores, notas de crédito y facturación A/B **no** pueden quedar legibles ni escribibles con la anon key. Usar el patrón más simple que lo garantice (RPC `security definer` con PIN de admin como 007, o el que el auditor justifique mejor). Pantallas nuevas: **solo admin**, salvo que el REQ diga otra cosa.
- Migraciones nuevas numeradas después de la última existente, idempotentes, sin `drop` de datos.

---

## Tanda 1 — Precios y reglas de venta

### REQ-PBU — Precio por unidad llevando bulto
| Decisión | Valor |
|---|---|
| Campo nuevo | `precioBulto` (columna `precio_bulto`), etiqueta **"Precio por unidad llevando bulto"**. Vacío/0 = no hay precio por bulto |
| Etiqueta del precio actual | `precio` pasa a mostrarse como **"Precio por unidad"** (antes "Precio venta 1"; el campo interno no cambia). "Precio venta 2" queda como está |
| Regla | Si la cantidad del renglón llega a **al menos 1 bulto completo** (`cantidad ≥ bultoX`, con `bultoX > 1`) y hay `precioBulto`, **todas las unidades del renglón** van a `precioBulto`. Si no, `precio`. Ej.: unidad $900, llevando bulto $800, bulto x16: 10 u. → $9.000; 16 u. → $12.800; 20 u. → $16.000 |
| Cómo se guarda | `item.precio` = precio aplicado; `item.precioOriginal` = precio por unidad; `item.precioPorBulto = true`. Así boleta, totales y "Total sin descuento" siguen funcionando |

- **AC-PBU-1** Formulario de producto con "Precio por unidad" y "Precio por unidad llevando bulto" (≥ 0; si es mayor que el precio por unidad se avisa, no se bloquea).
- **AC-PBU-2** Plantilla Excel de productos (REQ-PLA): columnas **"Precio por unidad"** y **"Precio por unidad llevando bulto"**; un Excel viejo con "Precio venta 1" se sigue importando.
- **AC-PBU-3** Nuevo pedido, Facturación y Armado aplican la regla al cambiar la cantidad (subir o bajar del bulto cambia el precio), salvo que el admin haya puesto un precio/descuento manual en ese renglón (se respeta el manual).
- **AC-PBU-4** La tienda muestra "Llevando el display: $800 c/u" y el servidor (`tienda_crear_pedido`/`tienda_catalogo`) aplica la **misma** regla; un carrito con precio manipulado no pasa.
- **AC-PBU-5** Función pura `precioAplicado(producto, cantidad)` con tests (bordes: `bultoX` 0/1/vacío, `precioBulto` vacío/0/mayor que el unitario, cantidades decimales, el ejemplo de la tabla).

### REQ-MIN — Mínimo para pedir un producto
Se usa el campo existente **"Mínimo venta"** (`minimoVenta`).
- **AC-MIN-1** Al agregar un producto con mínimo a un pedido (Nuevo pedido y tienda), la cantidad arranca en el mínimo y **no** se puede guardar por debajo (error claro en el renglón). Mínimo vacío/0/1 = sin restricción.
- **AC-MIN-2** En Facturación el admin puede guardar por debajo del mínimo con confirmación; el armador no puede bajar de él (si falta mercadería, lo anota como faltante como hoy).
- **AC-MIN-3** Si el producto se vende por bulto, el mínimo se redondea al múltiplo de bulto superior. Función pura con tests.

### REQ-SST — Vender sin stock con aviso
- **AC-SST-1** En Nuevo pedido, Facturación y Armado se puede cargar y facturar un producto sin stock suficiente: **nunca se bloquea**, se muestra el aviso "Sin stock (hay N)" en el renglón y un resumen al facturar ("3 productos quedan con stock negativo"). `STOCK_POLICY` queda en `advertir`.
- **AC-SST-2** El stock puede quedar negativo (sigue siendo la suma de movimientos) y Stock lo muestra en rojo. Revertir/borrar el pedido lo devuelve como hoy (AC-STK-3).
- **AC-SST-3** La tienda mantiene su configuración propia (`permitir pedir sin stock`, REQ-POR); este REQ no la cambia.

### REQ-HPR — Cambios de precio del día en PDF
- **AC-HPR-1** Cada vez que cambia `precio` o `precioBulto` de un producto (formulario, plantilla Excel, cualquier otro camino) se registra un cambio: producto, precio anterior → nuevo (de cada uno), fecha y hora, usuario. Registro con UUID, offline-first, sincronizado. Sin cambio real (mismo valor) no se registra.
- **AC-HPR-2** Sección "Cambios de precio" (Configuración o Productos, admin): elegir un día (default hoy) o un rango, ver la lista y bajar un **PDF** con código, producto, rubro, precio anterior, precio nuevo y variación %, ordenado por rubro y nombre. Si un producto cambió varias veces en el período, se muestra el primero anterior y el último nuevo.
- **AC-HPR-3** Opción "solo precio nuevo" para el PDF (lista para pasarle a clientes/vendedores: código, producto, precio por unidad, precio llevando bulto).
- **AC-HPR-4** El historial empieza a registrarse desde esta versión (no se reconstruye el pasado) y la pantalla lo aclara.

## Tanda 2 — Facturación y logística

### REQ-FAB — Facturas A y B en pedidos + PDF para el contador
- **AC-FAB-1** En Facturación cada pedido tiene un selector **Factura A / Factura B / Sin factura** (`tipoFactura`, columna `tipo_factura`). Sugerencia por defecto según el tipo de IVA del cliente: Responsable Inscripto → A; el resto → B; sin dato → sin factura. Se puede marcar varios pedidos a la vez.
- **AC-FAB-2** Pedido marcado A con cliente sin CUIT válido → aviso visible (no bloquea).
- **AC-FAB-3** Reporte "Facturas a emitir" (admin): rango de fechas y filtro A/B/todas → lista y **PDF** con cliente, CUIT, tipo de IVA, tipo de factura, n.º de pedido, fecha y monto, agrupado A y B con subtotales y total general. Solo pedidos facturados no borrados.
- **AC-FAB-4** La boleta impresa muestra "Factura A" / "Factura B" en el encabezado cuando corresponde.

### REQ-AGR — Agrupar productos al facturar
Ej.: pedido con 10 sabores de Saphirus → en la boleta sale una línea "Saphirus — 3 bultos (36 u.) — $X".
- **AC-AGR-1** En Facturación el admin selecciona renglones y toca **"Agrupar"**; el nombre del grupo se sugiere con la marca común (o el rubro) y se puede editar. Se pueden deshacer grupos.
- **AC-AGR-2** El grupo se guarda en el pedido (`grupos: [{id, nombre, itemIds}]`); los renglones **siguen separados** para stock, armado, comisiones y estadísticas (agrupar no toca movimientos de stock).
- **AC-AGR-3** En la boleta (PDF) el grupo sale como una sola línea: nombre, unidades totales, bultos (si todos los renglones comparten `bultoX` → "3 bultos (36 u.)"; si no, solo unidades) y subtotal. Opción al imprimir: "con detalle" (el grupo y debajo sus renglones) o "solo grupos".
- **AC-AGR-4** Funciones puras (armar grupos, totales, texto de bultos) con tests, incluidos grupos con bultos mixtos, renglones eliminados y grupos vacíos.

### REQ-TRQ — Casilla "Transferencia a proveedor" en el troquel
- **AC-TRQ-1** En la parte de recorte de la boleta (abajo de todo, donde están "Efectivo" y "Transferencia") se agrega la casilla **"Transf. a proveedor"** con una línea "Proveedor: ________". No se superpone con nada (probar con boleta larga y con deuda pendiente).

### REQ-ZON — Logística por zona en lugar de por día
- **AC-ZON-1** Orden de entrega se organiza por **zona** (la zona de la ficha del cliente): cada cliente tiene un puesto (`ordenZona`) dentro de su zona. La pantalla deja elegir la zona, ver y reordenar sus clientes (mover arriba/abajo o escribir el número, corriendo a los demás como hoy).
- **AC-ZON-2** Imprimir: se eligen fecha(s) de pedido y una o varias zonas; los pedidos salen agrupados por zona y numerados sin huecos dentro de cada zona según quién tiene pedido (mismo criterio que hoy por día). El número de "ORDEN" de la boleta es el de la zona.
- **AC-ZON-3** Migración sin pérdida: la primera vez, el orden por zona se inicializa con el orden actual (día y luego orden). `diaEntrega`/`ordenEntrega` se conservan (no se borran ni se muestran). Clientes sin zona van a "Sin zona" al final.
- **AC-ZON-4** Funciones puras de orden por zona con tests (renumeración, empates, clientes sin zona, zonas con mayúsculas/espacios distintos se tratan como la misma).

## Tanda 3 — Compras, proveedores y stock

### REQ-INA — Ingresos de mercadería con costo y Factura A/B
- **AC-INA-1** En el ingreso de mercadería (REQ-ING) cada renglón suma **Costo unitario** (opcional, ≥ 0) y **Factura A / Factura B** (default el de la cabecera, que también se elige). Un mismo ingreso puede tener renglones A y B. Se puede cargar el número de factura A y el de B.
- **AC-INA-2** El comprobante muestra subtotales de unidades y costo **por A y por B** y total.
- **AC-INA-3** Historial de ingresos filtrable por proveedor, fechas y A/B, con totales A vs B; y por producto se ve qué entró en A y qué en B. Exportable a PDF.
- **AC-INA-4** Al confirmar un ingreso con costo, opcionalmente (tilde, default sí) se actualiza el "Costo final" del producto (registra cambio de precio de venta si se recalcula, REQ-HPR).
- **AC-INA-5** Ingresos viejos sin costo/A-B se siguen viendo ("sin dato"). Los movimientos de stock no cambian (AC-ING-5).

### REQ-CPR — Cuenta con proveedores y pedidos al proveedor
- **AC-CPR-1** Sección **"Proveedores"** (admin): por proveedor, una **cuenta corriente** con saldo = compras − pagos. Compras = ingresos con costo (se cargan solos al confirmar el ingreso) + cargos manuales (ej. factura sin ingreso). Pagos = los que carga el admin.
- **AC-CPR-2** Cargar pago: fecha, monto, medio (**Efectivo / Transferencia / Transferencia directa del cliente al proveedor**), referencia/nota, y en "directa" el cliente/pedido opcional. Comprobante adjunto opcional (imagen/PDF máx. 5 MB a Storage privado, solo admin).
- **AC-CPR-3** Movimientos de la cuenta en orden de fecha con saldo acumulado, filtro por fechas y medio, totales por medio. PDF de estado de cuenta.
- **AC-CPR-4** **Pedido al proveedor**: el admin arma una lista (producto, cantidad en unidades o bultos) — con botón "Agregar los de stock bajo" (REQ-STB) —, la guarda como borrador, la comparte (PDF/WhatsApp con `share` existente) y la marca **recibida**: eso abre un Ingreso de mercadería precargado con esos productos y cantidades.
- **AC-CPR-5** Anular un pago o cargo con motivo (no se borra; queda registrado quién/cuándo). Saldos y totales en funciones puras con tests (centavos, negativos, anulados).

### REQ-STB — Sector Stock: búsqueda y avisos de stock bajo
- **AC-STB-1** Campo nuevo de producto **"Stock mínimo"** (`stockMinimo`, punto de reposición). Si está vacío se usa "Mínimo venta" como hoy (AC-STK-7 sigue valiendo).
- **AC-STB-2** Pantalla Stock: buscador por nombre/código/marca (sin tildes ni mayúsculas, palabras en cualquier orden) y filtros por rubro, marca, proveedor y estado (**sin stock / bajo / ok / negativo**).
- **AC-STB-3** Avisos: contador "N productos con stock bajo" visible en la pestaña Stock y arriba de la pantalla; lista de stock bajo con botón "Agregar al pedido al proveedor" (REQ-CPR) por producto o todos los de un proveedor.

## Tanda 4 — Rendición

### REQ-REN — Rendición: notas de crédito, devoluciones y cambios
- **AC-REN-1** Sección **"Rendición"** (admin): se anota sobre un pedido facturado (buscar por cliente/n.º/fecha) uno de: **Devolución** (productos y cantidades ≤ lo facturado menos lo ya devuelto, motivo), **Cambio** (sale producto X / entra producto Y con cantidades; diferencia de precio calculada) o **Nota de crédito** (monto y motivo, sin mercadería; opcional Factura A/B y n.º de NC).
- **AC-REN-2** Stock: devolución → movimientos `devolucion` positivos (vuelven al stock); cambio → `devolucion` del que vuelve + `venta` del que sale. Idempotente (reintentos o dos dispositivos no duplican), con UUID, como el resto del ledger. Opción por renglón "no vuelve al stock (roto/vencido)" → no genera movimiento y queda registrado como merma.
- **AC-REN-3** Plata: el crédito (devolución, NC o diferencia del cambio) se descuenta de la deuda pendiente del cliente si tiene; si no, queda como **saldo a favor** que se muestra en su próxima boleta. Una diferencia a pagar por el cliente en un cambio suma a su deuda.
- **AC-REN-4** Rendición del día: lista por fecha con totales (devuelto, NC, cambios, mermas) y **PDF**. Anular una rendición con motivo revierte sus movimientos de stock y su efecto en la cuenta del cliente (sin borrar nada).
- **AC-REN-5** Comisiones (REQ-COM/COMR): una devolución o NC sobre un pedido ya cerrado aparece como **ajuste pendiente** (AC-COM-13); si no está cerrado, baja la comisión del período.
- **AC-REN-6** Cálculos (cantidades disponibles para devolver, montos, saldo a favor, efecto en comisión) en funciones puras con tests.

## Tanda 5 — Panel

### REQ-PAN — Panel de ganancia y rentabilidad
- **AC-PAN-1** Al facturar, cada renglón guarda su **costo unitario** del momento (`costoUnitario`: costo final neto de descuentos del producto, misma fórmula que `calcularPrecioVenta`). Pedidos viejos sin ese dato usan el costo actual y se marcan "costo estimado".
- **AC-PAN-2** Sección **"Panel"** (admin), período elegible (default mes en curso) con comparación contra el período anterior: ventas, costo, **ganancia bruta**, **margen %**, cantidad de pedidos y ticket promedio. Netos de devoluciones y NC (REQ-REN).
- **AC-PAN-3** Rentabilidad por **producto**, **rubro** y **marca** (ventas, unidades, ganancia, margen %), ordenable; y por vendedor y cliente.
- **AC-PAN-4** **Más vendidos** (top 10 por unidades y por importe), **en alza / en baja** (variación vs período anterior), **sin ventas** en el período y **tendencia** semanal/mensual (gráfico de barras simple en SVG, sin librerías nuevas).
- **AC-PAN-5** Avisos: productos con margen negativo o sin costo cargado.
- **AC-PAN-6** Todo el cálculo en `src/domain/panel.js` puro con tests (centavos, períodos vacíos, productos borrados, costo estimado). Rendimiento: con 20.000 renglones el cálculo tarda < 1 s (test).

---

## Tests y revisión (OBLIGATORIO en cada tanda)
1. Cada AC de la tanda con al menos un test que lo nombra; el revisor arma la tabla AC → test → resultado.
2. Tests **justos**: por AC, el caso feliz + los bordes que importan (máx. ~5). No duplicar lo que ya cubrió el implementador.
3. Regresión: pedidos/productos/clientes/ingresos viejos sin campos nuevos; ningún test existente se borra ni se saltea.
4. Migraciones: test de upgrade de IndexedDB (si cambia `DB_VERSION`) sin borrar ni vaciar stores; SQL idempotente.
5. Seguridad: el auditor revisa las tablas/RPC nuevas (datos financieros no legibles/escribibles con anon key), Storage privado de comprobantes, inyección en PDF/CSV y que el servidor no confíe en precios del cliente (REQ-PBU en tienda).
6. Gates completos en verde y `manual.md` escrito.

## Corridas (en este orden, una por sesión)
1. `REQ-PBU REQ-MIN REQ-SST REQ-HPR`
2. `REQ-FAB REQ-AGR REQ-TRQ REQ-ZON`
3. `REQ-INA REQ-CPR REQ-STB`
4. `REQ-REN`
5. `REQ-PAN`

## A confirmar con el dueño (no bloquea; queda anotado)
- REQ-PBU: con 1,5 bultos, ¿todo al precio de bulto (lo implementado) o solo los bultos completos?
- REQ-REN: ¿la rendición la cargan también vendedores/repartidores? (por ahora solo admin).
- REQ-ZON: ¿se sigue necesitando el día de reparto para algo? (por ahora se conserva oculto).
