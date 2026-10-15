# Lote operación — Manual del dueño (15/10/2026)

Resume las 5 tandas: precios y mínimos, facturación y zonas, compras y proveedores, rendición y panel.

## 1. Qué hay de nuevo
| Función | Dónde está | Quién la usa |
|---|---|---|
| Precio por unidad llevando bulto | Configuración > Productos; se aplica en pedidos, facturación, armado y tienda | Admin carga; todos lo ven aplicado |
| Plantilla Excel con 2 precios | Configuración > Productos > plantilla/importar | Admin |
| Mínimo para pedir | Campo "Mínimo venta" del producto | Admin carga; todos lo respetan |
| Vender sin stock con aviso | Nuevo pedido, Facturación, Armado, Stock | Todos |
| Cambios de precio del día + PDF | Configuración > "Cambios de precio" | Admin |
| Factura A / B | Facturación (selector por pedido) | Admin |
| Facturas a emitir | Pestaña "A emitir" | Admin |
| Agrupar productos en la boleta | Facturación > editar pedido > "Agrupar" | Admin |
| Casilla "Transf. a proveedor" | Troquel de la boleta impresa | Quien imprime |
| Orden de entrega por zona | Pestaña "Orden" | Admin / quien arma el reparto |
| Ingreso con costo y Factura A/B | Stock > Ingreso | Admin |
| Proveedores: cuenta, pagos, comprobantes | Pestaña "Proveedores" | Admin |
| Pedido al proveedor | Proveedores > Pedido | Admin |
| Stock bajo y buscador | Stock; aviso arriba | Todos ven; admin arma el pedido |
| Rendición (devoluciones, cambios, notas de crédito) | Pestaña "Rendición" | Admin |
| Panel de ganancia | Pestaña "Panel" | Admin |

## 2. Cómo usar cada cosa

### Precio llevando bulto y plantilla
1. Editá o creá un producto en Configuración > Productos.
2. "Precio por unidad" es el de siempre. Cargá además "Precio por unidad llevando bulto" y el "Bulto x" (ej. 16).
3. Ejemplo: unidad 900 pesos, con bulto 800, bulto x16: 10 u. = 9.000; 16 u. = 12.800; 20 u. = 16.000 (todas pasan al precio de bulto).
4. Si el de bulto queda más caro que el unitario, avisa pero deja guardar (cobra el menor). Un precio o descuento puesto a mano se respeta.
5. Excel: dos columnas, "Precio por unidad" y "Precio por unidad llevando bulto" (vacía si no aplica). Los Excel viejos con "Precio venta 1" siguen entrando.

### Mínimo para pedir
1. En el producto, "Mínimo venta" (vacío, 0 o 1 = sin mínimo).
2. Al agregarlo, la cantidad arranca en el mínimo y no deja bajar. Si se vende por bulto, sube al múltiplo del bulto (mínimo 13, bulto x6 = 18).
3. En Facturación el admin puede guardar por debajo con confirmación. El armador no puede bajar del mínimo (lo que falta va como faltante).

### Vender sin stock
Nunca te bloquea. El renglón dice "Sin stock (hay N)" y al facturar sale "N productos quedan con stock negativo". En Stock el negativo se ve en rojo. Si revertís o borrás el pedido, el stock vuelve solo.

### Cambios de precio del día y PDF
1. Configuración > "Cambios de precio" (admin). Cada cambio de precio queda registrado: antes, después, fecha, hora y quién.
2. Elegí un día (hoy por defecto) o un rango, mirá la lista y tocá "Bajar PDF".
3. "Solo precio nuevo" saca un PDF limpio para clientes o vendedores. El historial empieza desde esta versión.

### Factura A/B y "Facturas a emitir"
1. En Facturación cada pedido tiene selector: Factura A, B o Sin factura. La app sugiere: Responsable Inscripto = A, el resto = B. Podés cambiarlo, o tildar varios y elegir una vez.
2. Si marcás A y el cliente no tiene CUIT válido, avisa pero te deja seguir.
3. Tocá "Subir tipos de factura (N)", poné tu PIN y se mandan a la nube (hace falta internet; si falla quedan pendientes).
4. La boleta impresa dice "FACTURA A" o "FACTURA B" arriba.
5. Pestaña "A emitir": elegí desde/hasta, A, B o todas, PIN y consultar. Sale agrupado con subtotales y total, y un PDF para el contador.

### Agrupar productos
1. En Facturación, editá el pedido, tildá los renglones y tocá "Agrupar". Sugiere el nombre (marca o rubro) y lo podés cambiar. "Deshacer" separa.
2. Es solo para la boleta: stock, armado y comisiones siguen viendo cada renglón.
3. Al imprimir: "con detalle" o "solo grupos". El total no cambia.

### Casilla "Transf. a proveedor"
Abajo de la boleta, junto a Efectivo y Transferencia, hay una casilla nueva con "Proveedor: ______". Si la boleta es larga, el troquel pasa a una hoja nueva.

### Orden de entrega por zona
1. Elegí la zona y mirá sus clientes en orden. Reordená con las flechas o escribiendo el número.
2. Para imprimir: elegí fecha(s) y una o varias zonas. Sale numerado sin huecos según quién tiene pedido; ese número es el ORDEN de la boleta.
3. La primera vez el orden arranca igual al que tenías. Sin zona va al final. Si cambiás la zona de un cliente, queda último en la nueva.

### Ingresos con costo y A/B
1. Stock > Ingreso: elegí proveedor y, si querés, número de factura A y/o B (cabecera y por renglón).
2. Cargá producto, cantidad y costo unitario (opcional). Dejá tildado "Actualizar costo del producto" si querés que el costo quede en el producto (costo 0 no actualiza).
3. Confirmá: sale el comprobante con subtotales A, B y total. El historial filtra por proveedor, fechas y A/B, con PDF. Los ingresos viejos dicen "sin dato".

### Proveedores: cuenta, pagos, comprobantes
1. Pestaña Proveedores, elegí uno: ves compras menos pagos con saldo acumulado. Las compras entran solas al confirmar un ingreso con costo; una factura sin ingreso va como cargo manual.
2. Cargar pago: fecha, monto y medio (Efectivo, Transferencia o Transferencia directa del cliente al proveedor, con cliente o pedido opcional).
3. Comprobante: foto o PDF hasta 5 MB, guardado privado.
4. Anular: escribí el motivo. No se borra, queda quién y cuándo. Filtros por fecha y medio, y PDF de estado de cuenta.
5. La primera vez pide el PIN de admin.

### Pedido al proveedor
1. Proveedores > Pedido: producto y cantidad (unidades o bultos). "Agregar los de stock bajo" suma lo que falta.
2. Se guarda como borrador; compartilo por PDF o WhatsApp.
3. Al llegar la mercadería, "Recibido" abre un Ingreso ya cargado; solo ponés costos y confirmás.

### Stock bajo
1. El buscador ignora tildes, mayúsculas y orden de palabras. Filtros: rubro, marca, proveedor y estado (sin stock, bajo, ok, negativo).
2. "Stock mínimo" es el punto de reposición del producto; vacío usa el "Mínimo venta".
3. Arriba y en Stock ves "N productos con stock bajo"; podés sumar uno, o todos los de un proveedor, al pedido.

### Rendición
1. Pestaña Rendición: buscá el pedido facturado por cliente, número o fecha.
2. Elegí Devolución (productos y cantidades hasta lo facturado; "no vuelve al stock" para roto/vencido, queda como merma), Cambio (la app calcula la diferencia) o Nota de crédito (monto y motivo; podés poner Factura A/B y número).
3. Guardá (queda en el celular aunque no haya internet) y tocá "Subir y bajar" con tu PIN.
4. Plata del cliente: el crédito baja su deuda; si no debe, queda saldo a favor que aparece en su próxima boleta. En un cambio, si el nuevo cuesta más, la diferencia suma a su deuda.
5. Anular: motivo y PIN; revierte stock y cuenta. Una rendición se anula una sola vez. Un pedido con rendición vigente no se puede revertir, borrar ni editar.
6. Comisiones: período abierto, baja la comisión; período cerrado, queda como ajuste pendiente. Ves el día con totales y un PDF.

### Panel
1. Pestaña Panel (admin). Elegí el período (mes en curso por defecto): ventas, costo, ganancia, margen %, pedidos y ticket promedio, contra el período anterior, netos de devoluciones y notas de crédito.
2. Abajo: rentabilidad por producto, rubro, marca, vendedor y cliente; más vendidos; en alza/baja; sin ventas; gráfico semanal/mensual; avisos de margen negativo o sin costo.
3. "Actualizar costos (PIN)" baja a tu equipo los costos de cada venta (se guardan en el servidor). Hacelo en cada dispositivo admin.
4. "Costo estimado": pedidos facturados antes de esta versión usan el costo actual del producto; su ganancia puede variar.

## 3. Evaluación de seguridad
Protegido:
- Los costos, descuentos y ganancia de los productos ya no se leen con la clave pública: solo el admin con PIN (desde la migración 013).
- Datos financieros privados, solo con PIN de admin: cuenta de proveedores, pagos, pedidos al proveedor, tipos de factura A/B, rendiciones, saldos a favor y costos de cada venta.
- Comprobantes en un lugar cerrado, sin links públicos.
- El PIN no se guarda en el equipo; 5 PIN mal bloquean 15 minutos.
- Precios y créditos los recalcula el servidor: un carrito o celular manipulado no consigue precio de bulto ni crédito de más.
- Cambios de precio: solo el admin con PIN los escribe.
- Cada tanda tuvo revisión de un auditor; ninguna quedó con riesgo crítico ni alto.

Queda abierto (heredado, no lo introdujo este lote):
- Con la clave pública de la app se pueden leer y escribir clientes (incluido CUIT), pedidos y movimientos de stock. Riesgo: alguien con la clave podría ver datos de clientes o alterar pedidos (también inflar ventas del Panel). Mitigación hoy: no compartir la clave ni la app con desconocidos.
- Alguien podría bloquear a propósito el PIN de admin intentando muchas veces (molestia, no robo).
- La librería de Excel (xlsx) tiene fallas conocidas sin arreglo: no abrir archivos Excel de gente desconocida.
- El servidor no impide revertir un pedido con rendición (solo lo impide la pantalla).
- Las migraciones nuevas no se probaron contra una base real: por eso las pruebas manuales de abajo.

Recomendación: como próximo proyecto, migrar a Supabase Auth (usuarios reales) para cerrar todo lo heredado de una vez.

## 4. Antes de publicar: pasos en orden
1. Backup: en Supabase (Database > Backups o exportar las tablas) y exportar los datos de la app.
2. Opcional: buscar productos con precio NaN (precio o precio_bulto); no debería haber ninguno.
3. SQL Editor de Supabase, una por una: **010, 011 y 012** (carpeta supabase/migrations). Son compatibles con la app vieja, y la 010 tiene que estar antes de publicar (si no, el precio llevando bulto se pierde al subir productos).
   - Si la 012 vieja ya había corrido: corré igual la 012 actual y después `drop function public.admin_compras_bajar(text, text, timestamptz);`.
4. Publicar la app nueva (deploy).
5. **Esperar a que todos los celulares y PCs tengan la app nueva** (cerrar y abrir la app en cada uno, y verificar que sincroniza). Recién ahí correr **013, 014 y 015**, en ese orden. La 013 oculta los costos: un dispositivo con la app vieja deja de poder bajar productos hasta actualizarse.
   - Regla futura (CLAUDE.md, regla 8): cada columna nueva pública de productos necesita su permiso de lectura en la migración.
6. Pruebas con la clave pública (anon) que recomiendan los auditores:
   - Insertar en cambios_precio y leer usuario_id de cambios_precio: permission denied.
   - Llamar tienda_precio_aplicado(10,8,12,12): permission denied.
   - Leer pedidos_factura: permission denied.
   - productos?select=costo_final: error; productos?select=id,nombre,precio: 200 (esto es lo correcto).
   - ingresos_costos, cuenta_proveedores, pedidos_proveedor y comprobantes_habilitados: permission denied; listar el bucket comprobantes-proveedores: vacío.
   - has_table_privilege de anon sobre public.pedidos_costos (select): debe dar false.
7. Pruebas en la app: pedido de tienda con precio manipulado (debe rechazarse); un bulto completo en la tienda (total igual al precio de bulto); cambiar un precio y bajar el PDF; marcar tipo de factura, subir con PIN, ver "A emitir" e imprimir; misma devolución desde dos dispositivos (no debe duplicar) y devolver de más (debe rechazar); anular una rendición (el stock vuelve exacto).
8. En cada dispositivo admin: "Subir productos" / "Bajar de otros dispositivos" con PIN (trae costos) y Panel > "Actualizar costos (PIN)".

## 5. Precauciones del día a día
- PIN de admin: no lo compartas ni lo anotes en el celular; con 5 errores se bloquea 15 minutos.
- Los equipos viejos tienen que actualizarse: cerrar y abrir la app con internet al menos una vez. Hasta entonces pueden fallar al sincronizar.
- Si algo queda "pendiente de subir" (tipos de factura, rendiciones, pagos): conectate a internet, tocá el botón de subir con tu PIN y repetí si falla. No se pierde, queda en el equipo; no borres datos de la app hasta que suba.
- Si sale "Falta la migración 0xx", esa migración no se aplicó: aplicala en orden.
- Revisá de vez en cuando la tabla pedidos_costos_errores (últimos 50 registros, más nuevos primero).
- Los cambios de precio y los costos de venta tienen historia solo desde esta versión.

## 6. Pendientes / a confirmar con el dueño
Preguntas del pedido:
- Precio de bulto: con 1,5 bultos, ¿todo al precio de bulto (como está) o solo los bultos completos?
- Rendición: ¿la cargan también vendedores o repartidores? Hoy solo admin.
- Zonas: ¿sigue haciendo falta el día de reparto? Hoy se conserva oculto.

Seguimientos que no frenan nada:
- Reemplazar la librería xlsx por otra (exceljs).
- Que el servidor impida revertir pedidos con rendición; revisar el "ajuste" de deudas que acepta cualquier signo con la clave pública.
- "Aplicar saldo a favor" contra deudas futuras todavía no existe: hoy se muestra en la boleta pero no se descuenta solo.
- Si se corta el celular justo al aplicar una rendición en la cuenta del cliente, ese efecto puede no aplicarse: queda anotado en el servidor para revisar a mano.
- Atar el comprobante de pago al pago en una migración futura; confirmar que el precio de cada renglón ya es neto de descuento (rendición).
- Las observaciones muy largas del troquel (más de ~50 líneas) no paginan.
- Migrar a Supabase Auth (ver sección 3).
