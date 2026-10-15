# Manual de Rendicion (para el dueño)

Rendicion sirve para anotar lo que un cliente te devuelve, te cambia o se le acredita sobre un pedido ya facturado. Solo la ve el administrador.

## Paso a paso
1. Entra a la pestaña **Rendicion** y busca el pedido facturado por cliente, numero o fecha.
2. Elegi que pasa:
   - **Devolucion**: marca los productos y cantidades (hasta lo facturado menos lo ya devuelto) y escribi el motivo. Si la mercaderia esta rota o vencida, tilda **"no vuelve al stock (roto/vencido)"**: no suma stock y queda registrada como merma.
   - **Cambio**: indica que producto vuelve y cual sale. La app calcula la diferencia de precio.
   - **Nota de credito**: monto y motivo, sin mercaderia. Podes poner Factura A o B y el numero de la nota.
3. Guarda. Queda anotada en el celular, aunque no tengas internet.
4. Toca **"Subir y bajar"** y pone tu PIN. Ahi se sube la rendicion al servidor y se baja lo que cargaron otros dispositivos.

## Que pasa con el stock
- Devolucion: la mercaderia vuelve al stock (salvo la marcada roto/vencido).
- Cambio: vuelve el producto devuelto y sale el nuevo.
- Nota de credito: no toca el stock.
- Si subis dos veces o desde dos celulares, no se duplica.

## Que pasa con la plata del cliente
- Si el cliente tiene deuda, el credito se descuenta de esa deuda.
- Si no tiene deuda (o sobra), queda como **saldo a favor** y aparece en su proxima boleta.
- En un cambio, si el producto nuevo cuesta mas, la diferencia se suma a su deuda.

## Rendicion del dia y PDF
En la pestaña ves las rendiciones por fecha con totales: devuelto, notas de credito, cambios y mermas. Hay un boton para bajar el **PDF** del dia.

## Anular
Toca **Anular**, escribi el motivo y pone tu PIN. Se revierte el stock y el efecto en la cuenta del cliente. No se borra nada: queda el registro. Una rendicion se anula una sola vez.

## Pedidos con rendicion
Un pedido con rendicion vigente **no se puede revertir, borrar ni editar**. Si hace falta, primero anula la rendicion.

## Comisiones
- Pedido cuyo periodo todavia no se cerro: baja la comision de ese periodo.
- Pedido de un periodo ya cerrado: aparece como **ajuste pendiente** para el proximo cierre.

## Seguridad
- Solo el admin con PIN sube, baja o anula rendiciones.
- Los datos de plata (rendiciones, saldos a favor) no los puede leer nadie sin ese PIN.
- El PIN no se guarda en el celular.
- Cada pedido admite devolver solo hasta lo que se facturo; el servidor lo controla.
- Los montos de credito los recalcula el servidor, no el celular.

## Precauciones y pasos manuales
1. Haz un **backup** antes de empezar.
2. Aplica la migracion **014** en Supabase (SQL editor) **despues** de la 011, 012 y 013 y **antes** de publicar la app.
3. Proba con **dos dispositivos**: misma devolucion desde ambos y devolver mas de lo facturado.
4. Si un dispositivo se corta justo cuando se aplica el efecto en la cuenta del cliente, ese efecto no se duplica pero puede no aplicarse: queda anotado en el servidor para que lo revises a mano.
5. El **"Aplicar saldo a favor"** contra deudas futuras todavia no existe: hoy el saldo se muestra en la boleta pero no se descuenta solo.
