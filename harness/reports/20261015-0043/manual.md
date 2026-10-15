# Manual para el dueño — lote operación (precios, mínimos, sin stock, cambios de precio)

## 1. Precio por unidad llevando bulto
- Dónde: Configuración > Productos > editar o crear un producto.
- Ahora el precio de siempre se llama "Precio por unidad". Aparece un campo nuevo: "Precio por unidad llevando bulto".
- Uso: cargá el precio normal, el precio más barato si se lleva el bulto entero, y el "Bulto x" (ej. 16).
- Ejemplo: unidad $900, llevando bulto $800, bulto x16. 10 u. = $9.000. 16 u. = $12.800. 20 u. = $16.000
  (todas las unidades pasan al precio de bulto).
- Si el precio de bulto queda más caro que el unitario, el sistema avisa pero te deja guardar (cobra el menor).
- Se aplica solo en Nuevo pedido, Facturación, Armado y la tienda. Si ponés un precio o descuento a mano, se respeta el tuyo.
- La tienda muestra "Llevando el display: $800 c/u".

## 2. Plantilla Excel
- Dónde: Configuración > Productos > plantilla/importar Excel.
- Hay dos columnas: "Precio por unidad" y "Precio por unidad llevando bulto". Dejá vacía la segunda si no aplica.
- Los Excel viejos con "Precio venta 1" se siguen importando igual.

## 3. Mínimo para pedir
- Dónde: en el producto, campo "Mínimo venta" (vacío, 0 o 1 = sin mínimo).
- Al agregar el producto a un pedido (o a la tienda) la cantidad arranca en el mínimo y no deja guardar por debajo.
- Si el producto se vende por bulto, el mínimo sube al múltiplo de bulto (mínimo 13 y bulto x6 = 18).
- En Facturación el admin puede guardar por debajo con una confirmación. El armador no puede bajar del mínimo
  (lo que falta lo anota como faltante, como siempre).

## 4. Vender sin stock con aviso
- Nuevo pedido, Facturación y Armado nunca te bloquean por falta de stock.
- En el renglón sale "Sin stock (hay N)". Al facturar sale un resumen: "3 productos quedan con stock negativo".
- En Stock el negativo se ve en rojo. Si revertís o borrás el pedido, el stock vuelve solo.
- La tienda web sigue con su propia opción de "permitir pedir sin stock".

## 5. Cambios de precio del día + PDF
- Dónde: Configuración > botón "Cambios de precio" (solo admin).
- Cada vez que cambia el precio o el precio de bulto de un producto (a mano o por Excel) queda registrado: producto,
  antes, después, fecha, hora y quién.
- Pasos: elegí un día (por defecto hoy) o un rango > mirá la lista > "Bajar PDF".
- Si un producto cambió varias veces, se muestra el primer precio anterior y el último nuevo.
- Opción "solo precio nuevo": PDF limpio para pasar a clientes o vendedores (código, producto, precio, precio llevando bulto).
- El historial empieza desde esta versión; no se reconstruye lo anterior (la pantalla lo aclara).

## Seguridad (resumen)
- Protege: los precios los recalcula el servidor, así que un carrito manipulado en la tienda no consigue precio de bulto.
- Nadie sin PIN de admin puede escribir cambios de precio ni precio de bulto; el público solo puede leerlos, sin ver quién los hizo.
- No se perdió ninguna protección de las migraciones anteriores (007/008/009).
- Queda abierto: la librería de Excel (`xlsx`) tiene fallas conocidas sin arreglo; no la usen con archivos de gente desconocida.
- Queda abierto: no se pudo probar el SQL contra una base real; por eso las pruebas de abajo.

## Precauciones y pasos manuales
1. Hacé un backup de Supabase (Database > Backups, o exportá las tablas productos y pedidos).
2. Aplicá `supabase/migrations/010_lote_operacion_precios.sql` en el SQL editor de Supabase ANTES de publicar la app
   (si publicás primero, la app nueva no encuentra las columnas y falla la sincronización de productos).
3. Opcional antes: `select id from productos where precio = 'NaN' or precio_bulto = 'NaN';` (no debería devolver filas).
4. Publicá la app. En cada dispositivo abrila una vez con internet para que actualice la base local.
5. Pruebas manuales recomendadas por el auditor:
   - Como anónimo, intentar `insert into cambios_precio ...`: tiene que dar "permission denied".
   - `select usuario_id from cambios_precio`: "permission denied".
   - `select tienda_precio_aplicado(10,8,12,12)`: "permission denied".
   - Hacer un pedido en la tienda con precio manipulado: tiene que ser rechazado con aviso de cambio de precio.
   - Pedido en la tienda de un bulto completo: el total debe coincidir con el precio llevando bulto.
   - Cambiar un precio, ver que aparezca en "Cambios de precio" y bajar el PDF.
   - Cargar un producto sin stock en Nuevo pedido y facturar: debe dejar y avisar.
