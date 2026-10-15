# Manual del dueño - Compras, Proveedores y Stock

## 1. Ingreso de mercadería con costo y Factura A/B
1. Entrá a Stock > Ingreso. Elegí proveedor y, si querés, cargá el número de factura A y/o B.
2. Elegí en la cabecera si todo es Factura A o B. Cada renglón puede cambiarse por separado.
3. Cargá producto, cantidad y costo unitario (el costo es opcional).
4. Dejá tildado "Actualizar costo del producto" si querés que el costo nuevo quede en el producto. Si no, destildalo. Un costo en 0 no actualiza nada.
5. Confirmá. Se muestra el comprobante con subtotales de A, de B y el total.
6. Historial: filtrá por proveedor, fechas y A o B. Ves los totales de A contra B y qué entró por A o B en cada producto. Botón PDF para exportar.
7. Los ingresos viejos sin costo aparecen como "sin dato". El stock no cambia por esto.

## 2. Proveedores (solo admin)
1. Entrá a la pestaña Proveedores y elegí uno. Ves la cuenta corriente: compras menos pagos, con saldo acumulado.
2. Las compras se cargan solas al confirmar un ingreso con costo. Si hay una factura sin ingreso, cargala como cargo manual.
3. Cargar pago: fecha, monto y medio: Efectivo, Transferencia, o Transferencia directa del cliente al proveedor (ahí podés indicar cliente o pedido).
4. Comprobante: adjuntá foto o PDF (hasta 5 MB). Queda guardado privado, solo lo ve el admin.
5. Anular: tocá anular y escribí el motivo. No se borra: queda registrado quién y cuándo.
6. Filtrá por fechas y medio. Ves totales por medio y el PDF de estado de cuenta.
7. La primera vez te pide el PIN de admin.

## 3. Pedido al proveedor
1. En Proveedores > Pedido, armá la lista: producto y cantidad en unidades o bultos.
2. Botón "Agregar los de stock bajo" suma lo que hace falta reponer.
3. Se guarda como borrador. Compartilo por PDF o WhatsApp.
4. Cuando llega la mercadería, marcalo "Recibido": se abre un Ingreso ya cargado con esos productos y cantidades. Ahí solo ponés costos y confirmás.

## 4. Stock
1. Buscador: por nombre, código o marca; no importan tildes, mayúsculas ni el orden de las palabras.
2. Filtros: rubro, marca, proveedor y estado (sin stock, bajo, ok, negativo).
3. Stock mínimo: campo nuevo en cada producto (punto de reposición). Si lo dejás vacío se usa el "Mínimo venta".
4. Avisos: arriba y en la pestaña Stock ves "N productos con stock bajo". Desde la lista agregás uno, o todos los de un proveedor, al pedido.

## 5. Seguridad
- Los costos de los productos (costo, descuentos, ganancia, precio 2) ya no los puede leer cualquiera: solo el admin con PIN.
- La cuenta corriente, los pagos y los pedidos al proveedor son privados.
- Los comprobantes están en un lugar cerrado, sin links públicos.
- Todo esto exige el PIN de admin. Vendedores y armadores siguen trabajando igual, sin ver costos.
- Los costos en el celular de un vendedor son los que ya tenía; no se borran.

## 6. Precauciones y pasos manuales
1. Hacé backup de Supabase antes de tocar nada.
2. ORDEN exacto: (a) publicar la app nueva; (b) en Supabase > SQL Editor correr la 012; (c) después la 013. Nunca la 013 antes que la 012.
3. Si la 012 vieja ya se había corrido, corré igual la 012 actual (no rompe nada) y después: `drop function public.admin_compras_bajar(text, text, timestamptz);`
4. Los celulares con la app vieja pueden fallar al sincronizar productos hasta que se actualicen (cerrar y abrir la app).
5. Pruebas con la clave anon (la pública):
   - `productos?select=costo_final` debe dar error.
   - `productos?select=id,nombre,precio` debe dar 200.
   - Las 4 tablas nuevas (ingresos_costos, cuenta_proveedores, pedidos_proveedor, comprobantes_habilitados) deben dar "permission denied".
   - Listar el bucket comprobantes-proveedores debe dar vacío.
6. Tras la 013, los costos en otros dispositivos del admin se bajan con PIN: "Subir productos" o "Bajar de otros dispositivos".
7. Si en el futuro se agrega una columna a productos, avisá al equipo: hay que darle permiso de lectura a mano.
8. Sin la 012 la app anda igual en modo local y muestra "Falta la migración 012".
