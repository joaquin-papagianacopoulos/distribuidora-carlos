# Pedido 2026-11-10 — Lote "ventas, remito y seguridad de datos" (15 REQ en 4 tandas)

> Prompt para el pipeline del harness (`/mejorar-app`). Se corre **por tandas**, en orden; en cada una el orquestador incorpora a `harness/SPEC.md` **solo** los REQ de esa tanda (si no, falla el gate `traceability`).
> Insumos ya escritos: `harness/reports/20261110-lote/diagnostico-precio-costo.md` y `harness/reports/20261110-lote/security-report.md`.
> Primer paso de cada arquitecto: verificar en el código qué existe ya (REQ-PBU, REQ-MIN, REQ-SST, REQ-FAB, REQ-FRB, REQ-GBU, REQ-COM "Asignación") y anotar supuestos en el plan. Varios de estos REQ **modifican** AC viejos: el plan dice cuáles y el implementador actualiza los tests viejos que cambian de comportamiento (no se borran ni se saltean: se adaptan y se anota).

## Principios del lote
- Mismos principios del lote operación (SPEC, "Lote operación — principios"): lo más simple que funcione, nada se rompe, cálculo en `src/domain/` puro con tests, stock solo por movimientos, datos financieros nunca legibles por anon, migraciones idempotentes numeradas desde la 023 y sin `drop` de datos.
- **No se pierde ni se filtra nada**: todo cambio de datos nuevo es offline-first con UUID e idempotente; ningún camino nuevo borra registros con `pendingSync`.
- Pedidos, productos y clientes viejos (sin los campos nuevos) siguen funcionando con defaults.
- Roles: "administradores (Carlos y Paola)" = rol `permiso` 1. No se cablean nombres.

## Decisiones del dueño (2026-11-10)
| Tema | Decisión |
|---|---|
| Precio por cantidad de bultos | **Descuento % por escala** cargado en el producto ("desde 3 bultos → 5 %"), sobre el precio llevando bulto; el precio resultante se **redondea para arriba**. "Descuento 1/2" del producto son del costo del proveedor y no se tocan |
| Editar pedido enviado | El vendedor puede hasta que se **facture**; si ya estaba armado queda marcado "modificado" |
| Redondeo del total | **Elegible en Configuración**: sin redondeo / $500 / $1000, al múltiplo más cercano; arranca en $500 |
| "Número de orden" del producto | **Número de renglón** (1, 2, 3…) |

---

## Tanda 0 — Urgente: plata y datos (P0)

### REQ-PVC — El precio de venta nunca queda igual al costo por omisión (bug)
Causa en `diagnostico-precio-costo.md`: con precio vacío y sin % de ganancia se guarda `precio = costo`.
- **AC-PVC-1** Importar una planilla con costos y la celda/columna de precio vacía sobre un producto **existente** conserva su precio actual (no lo vacía ni lo pisa). Solo se recalcula si hay ganancia > 0 conocida y el precio anterior era el calculado.
- **AC-PVC-2** Alta o edición (formulario e importación) con precio vacío, ganancia vacía/0 y costo > 0 → **error en el campo** "Falta el precio de venta o el % de ganancia"; nunca se guarda el costo como precio. Un precio escrito a mano igual al costo se acepta con aviso (no bloquea).
- **AC-PVC-3** El formulario de producto no autocompleta el precio al tipear el costo si no hay ganancia > 0. En un dispositivo que no tiene los costos (sin PIN), la ganancia desconocida no se toma como 0 y el precio no se toca.
- **AC-PVC-4** Función pura `productosConPrecioSospechoso(productos)` (precio ≤ costo neto con costo > 0) y aviso en Productos (solo admin, con los costos leídos por PIN): "N productos con precio igual o menor al costo" + lista para corregir. No corrige sola.
- **AC-PVC-5** Texto de ayuda de la plantilla Excel corregido y tests de los tres casos del diagnóstico.

### REQ-SEG2 — No perder ni filtrar datos (hallazgos S-1110)
- **AC-SEG2-1** (S-1110-02) Migración: `anon`/`authenticated` sin `DELETE` ni `TRUNCATE` sobre `clientes`, `deudas`, `faltantes`, `proveedores`, `pedidos`. Borrar un cliente pasa por RPC `security definer` con PIN de admin (o baja lógica); la app sigue pudiendo borrar clientes como admin y un test estático verifica el `revoke`.
- **AC-SEG2-2** (S-1110-03) "Borrar caché": cuenta los registros sin subir de **todos** los stores; si hay alguno o no hay conexión, no borra y dice qué falta subir. Solo borra con todo subido, o tras exportar el respaldo (AC-SEG2-6) y una segunda confirmación escrita.
- **AC-SEG2-3** (S-1110-04/05) Guardar un pedido nunca lo pierde ni lo duplica: se escribe primero en IndexedDB con UUID de idempotencia (`clientUuid`) y `pendingSync`, y el alta remota es idempotente por ese UUID (columna con índice único + upsert/`on conflict do nothing`). Un error de red deja el pedido local visible como "sin subir". Pedidos viejos sin UUID siguen andando.
- **AC-SEG2-4** (S-1110-06) El sync de faltantes pagina (como el resto) y no borra del dispositivo nada que no haya podido confirmar que falta en el remoto completo.
- **AC-SEG2-5** (S-1110-07) Migración: los movimientos de stock que inserta `anon` quedan limitados a los tipos que la app usa sin PIN, con cantidad acotada; `ajuste`/`inicial` solo por RPC con PIN de admin, sin romper el flujo actual de Stock.
- **AC-SEG2-6** (S-1110-08) Botón **"Exportar respaldo"** (admin, Configuración): baja un archivo con todos los stores locales (sin PIN ni claves), con fecha en el nombre. `backups/` y los `.sql` sueltos de limpieza quedan en `.gitignore`.
- **AC-SEG2-7** El push de clientes con 401/403 informa el error (hoy devuelve ok) y la subida no pisa ediciones hechas mientras subía (se limpia `pendingSync` solo si el registro no cambió desde que se leyó).

> Fuera de alcance de este lote (queda como decisión del dueño, ver security-report S-1110-01): reemplazar el PIN por autenticación real de Supabase (Auth + RLS por usuario). Es el único arreglo de fondo para que la anon key no lea pedidos/clientes.

## Tanda 1 — Carga de pedidos

### REQ-EDP — El vendedor edita un pedido ya enviado
- **AC-EDP-1** En la lista de pedidos, el vendedor (permiso 2) ve "Editar" en **sus** pedidos no facturados (pendiente o en armado): agrega y saca productos y cambia cantidades con las mismas reglas que Nuevo pedido (mínimos, múltiplos, precio de bulto). Facturado: solo admin, como hoy.
- **AC-EDP-2** Si el pedido ya tenía armado empezado o terminado, al guardar queda marcado **"Modificado"** (`modificadoTrasArmado`, con fecha y usuario) y Armado lo destaca con los renglones nuevos/cambiados; el armador lo confirma y la marca se va.
- **AC-EDP-3** La edición es offline-first, no duplica el pedido (mismo id/UUID) y no pisa en silencio: si el pedido cambió en el servidor desde que se abrió (`updated_at` distinto) se avisa y se recarga antes de guardar. Función pura de permiso `puedeEditarPedido(usuario, pedido)` con tests.

### REQ-MUL — Cantidades en múltiplos del mínimo
- **AC-MUL-1** Con "Mínimo venta" > 1, el `+`/`−` y volver a tocar el producto van de a mínimo: 3 → 6 → 9 (hoy sumaba de a 1). Tipear una cantidad que no es múltiplo se ajusta al múltiplo superior con aviso. Mínimo vacío/0/1 = de a 1.
- **AC-MUL-2** Vale en Nuevo pedido, edición (REQ-EDP) y tienda (el servidor valida lo mismo). En Armado/Facturación el admin puede dejar cualquier cantidad (REQ-MIN2). Convive con el paso de a bulto (AC-FRB-4): por debajo del bulto, de a mínimo; desde el bulto, de a bulto. Función pura en `src/domain/minimos.js` con tests.

### REQ-CBU — Bultos en casillero aparte y precio de bulto a la vista
- **AC-CBU-1** En la lista desplegada de productos de Nuevo pedido, cada producto con bulto (`bultoX > 1`) muestra dos botones: **"Unidad $X"** y **"Bulto xN $Y"** (Y = precio llevando bulto × N; si no hay `precioBulto`, precio × N). Tocar "Bulto" agrega 1 bulto.
- **AC-CBU-2** El renglón tiene **dos casilleros**: "Bultos" y "Unidades sueltas", cada uno con su `+`/`−`. La cantidad guardada sigue siendo `item.cantidad` en unidades (= bultos × bultoX + sueltas); stock, armado y comisiones no cambian. El casillero de bultos no se mezcla con el mínimo: sumar un bulto no suma el mínimo.
- **AC-CBU-3** El renglón muestra el precio que se está aplicando ("Precio bulto $Y" o "Precio unidad $X") y cambia al cruzar el bulto (regla REQ-PBU/REQ-GBU/REQ-ESC). Funciones puras (partir/juntar bultos y sueltas) con tests; pedidos viejos se muestran partidos solos.

### REQ-SST2 — Cargar productos sin stock
- **AC-SST2-1** En Nuevo pedido y edición, un producto con stock 0 o negativo **aparece** en la lista y se puede agregar; muestra "Sin stock — por recibir" y nunca se bloquea ni se oculta. (El arquitecto ubica dónde hoy se oculta o bloquea y lo anota; la tienda mantiene su configuración propia, AC-SST-3.)

### REQ-MIN2 — Por debajo del mínimo en Armado: solo administradores
- **AC-MIN2-1** En Armado, solo el admin (permiso 1) puede dejar un renglón por debajo del mínimo o fuera de múltiplo, con confirmación; vendedor y armador no (ven el error en el renglón). Modifica AC-MIN-2: se extiende a Armado. Función pura con tests por rol.

### REQ-ASV — Asignar el vendedor de un pedido
- **AC-ASV-1** En Nuevo pedido, el admin elige "Vendedor del pedido" (default: él mismo); un vendedor también puede cargar un pedido a nombre de otro vendedor activo. Se guarda quién lo cargó (`cargadoPor`) y de quién es (`vendedorId`); la comisión va al `vendedorId` (reutilizar "Asignación cuando el pedido lo cargó otro vendedor" de REQ-COM y `SelectorVendedor`).
- **AC-ASV-2** Los pedidos que entran por el carrito/tienda (Pedidos web) aparecen "Sin vendedor"; el admin les asigna uno desde la bandeja o desde la lista de pedidos, antes o después de facturar (si el período de comisiones ya está cerrado, queda como ajuste pendiente, AC-COM-13). Sin vendedor asignado no suman comisión a nadie y se ve un aviso.

### REQ-PEN — Pedidos pendientes siempre a la vista
- **AC-PEN-1** Al abrir la lista de pedidos en la fecha de hoy se ven, además de los de hoy, **todos los pedidos no facturados de cualquier fecha** (pasada o futura) en un bloque "Pendientes", con su fecha de entrega y cuántos días faltan/pasaron. Función pura `pedidosPendientesVisibles(pedidos, hoy)` con tests (fecha futura, vencidos, borrados, facturados).

## Tanda 2 — Remito, hoja de ruta y deudas

### REQ-RTO — El comprobante es un "Remito"
- **AC-RTO-1** El comprobante impreso se titula **"REMITO"** por defecto (las facturas A/B se hacen en ARCA). El selector A/B de Facturación se conserva para el reporte del contador (REQ-FAB) pero su valor por defecto pasa a "Sin factura" y ya no cambia el título del impreso (modifica AC-FAB-1 y AC-FAB-4).
- **AC-RTO-2** El remito muestra la **dirección** del cliente (y localidad/zona si hay) debajo del nombre, y el **nombre del vendedor** en tamaño destacado (al menos el del nombre del cliente).
- **AC-RTO-3** Cada renglón sale **numerado** (1, 2, 3…; un grupo REQ-AGR/REQ-GBU cuenta como un renglón) y al pie del detalle dice "Ítems: N".
- **AC-RTO-4** **Interlineado reducido**: entran al menos 30 % más renglones por hoja que hoy sin superponer texto (test de layout en `boletaLayout` con pedido largo). Mismo criterio compacto para los demás PDF con tablas.
- **AC-RTO-5** Si el cliente tiene **saldo deudor** (deudas pendientes, sin contar este pedido), el remito lo muestra: "Saldo anterior: $X" y "Total a cobrar: $Y". Sin deuda no se imprime nada.
- **AC-RTO-6** Se saca el **pie de página** del remito (troquel Efectivo / Transferencia / Transf. a proveedor, REQ-TRQ) y esos datos pasan a la hoja de ruta (REQ-HRU). Modifica AC-TRQ-1.

### REQ-HRU — Hoja de ruta con importes y cobranza
- **AC-HRU-1** La hoja de ruta (impresión de Orden de entrega) lista por cliente: orden, cliente, dirección, **importe del remito**, saldo anterior, total a cobrar y columnas vacías para anotar **Efectivo / Transferencia / Transf. a proveedor** y observaciones; con totales al final. Cálculo en función pura con tests.

### REQ-RED — Redondeo del total
- **AC-RED-1** Configuración (admin): "Redondeo del total": sin redondeo / a $500 / a $1000 (default $500), al múltiplo **más cercano** (la mitad exacta, para arriba). Sincronizado entre dispositivos.
- **AC-RED-2** El total del pedido se redondea al facturar: el remito muestra "Subtotal", "Redondeo ±$X" y "TOTAL"; el pedido guarda `redondeo` y `total` ya redondeado, y deuda, hoja de ruta y reportes usan ese total. Las comisiones se calculan sobre los renglones (sin redondeo). Pedidos ya facturados no se recalculan. Función pura `redondearTotal(total, multiplo)` con tests (0, negativos, mitad exacta, sin redondeo).

### REQ-DMP — Medio de pago en el historial de deudas
- **AC-DMP-1** Al registrar un pago de deuda se elige **Efectivo** o **Transferencia** (obligatorio; opcional una referencia). El historial muestra el medio y totales por medio; pagos viejos salen "sin dato". Campo `medioPago` (columna `medio_pago`) con migración tolerante y sync que no falla si la columna no existe aún.

## Tanda 3 — Precio por cantidad de bultos

### REQ-ESC — Descuento por escala de bultos
- **AC-ESC-1** El producto tiene hasta 3 escalas opcionales: "desde N bultos → D % de descuento" (N entero ≥ 2, creciente; 0 < D < 100). Se cargan en el formulario y en la plantilla Excel. Columna pública `escalas_bulto` (jsonb) con `grant select` por columna (regla 8) y RPC de guardado con PIN.
- **AC-ESC-2** Regla: con cantidad ≥ N bultos completos se aplica la escala más alta alcanzada sobre el precio llevando bulto (o el precio por unidad si no hay `precioBulto`) a **todas** las unidades del renglón; el precio unitario resultante se **redondea para arriba** al peso entero. Se respeta el precio manual (AC-PBU-3). En un grupo combinable (REQ-GBU) cuenta la suma del grupo.
- **AC-ESC-3** Nuevo pedido, edición, Armado, Facturación y remito muestran la escala aplicada ("x5 bultos −8 %") y la tienda/servidor (`tienda_catalogo`, `tienda_crear_pedido`) aplican la **misma** regla.
- **AC-ESC-4** Función pura `precioConEscala(producto, cantidad)` integrada en `precioAplicado`, con tests (sin escalas, borde exacto, redondeo, escalas desordenadas o inválidas se ignoran).

---

## Tests y revisión (OBLIGATORIO en cada tanda)
Igual que el lote operación: cada AC con un test que lo nombra; regresión de datos viejos; test de upgrade de IndexedDB si cambia `DB_VERSION`; SQL idempotente; el auditor corre en las tandas 0, 1 (permisos de edición, asignación de vendedor) y 3 (tienda); gates completos en verde y `manual.md` (máx. 80 líneas, para el dueño) con pasos manuales (migraciones y orden).

## Corridas
0. `REQ-PVC REQ-SEG2`
1. `REQ-EDP REQ-MUL REQ-CBU REQ-SST2 REQ-MIN2 REQ-ASV REQ-PEN`
2. `REQ-RTO REQ-HRU REQ-RED REQ-DMP`
3. `REQ-ESC`

## A confirmar con el dueño (no bloquea; queda anotado)
- REQ-ESC: el "redondeo para arriba" se tomó al peso entero por unidad; ¿o a $10/$50/$100?
- REQ-RTO-4 "menos interlineado general": se aplicó a los impresos; ¿también a las listas de la app?
- REQ-ASV: ¿un vendedor puede cargar a nombre de otro, o solo el admin reasigna?
- REQ-RED: ¿el redondeo también en los pedidos de la tienda online?
