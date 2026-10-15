# Manual del Panel de ganancia (solo admin)

## Cómo usarlo
1. Entrá a la pestaña **Panel** (solo la ve el admin).
2. Elegí el período (por defecto el mes en curso). Arriba ves ventas, costo, ganancia, margen %, cantidad de pedidos y ticket promedio, comparados con el período anterior.
3. Los números son netos de devoluciones y notas de crédito (Rendición).
4. Más abajo: rentabilidad por producto, rubro, marca, vendedor y cliente (podés ordenar), más vendidos (top 10), productos en alza/baja, productos sin ventas y un gráfico semanal/mensual.
5. Avisos: productos que venden con margen negativo o sin costo cargado.

## "Actualizar costos (PIN)"
- El costo de cada venta se guarda en el servidor, en un lugar privado. Para verlo en tu equipo hay que bajarlo.
- Tocá **Actualizar costos (PIN)**, poné tu PIN de admin y esperá. Se baja de a tandas y queda guardado en el equipo.
- Hacelo en cada dispositivo admin y de vez en cuando (antes de mirar números del día).
- El PIN no se guarda. 5 PIN mal bloquean 15 minutos.

## Qué es "costo estimado"
- Los pedidos facturados antes de esta versión no tienen el costo del momento. Para esos se usa el costo actual del producto y se marcan "costo estimado".
- La ganancia de esos pedidos puede variar si el costo cambió después. Con el tiempo van a ser cada vez menos.

## Seguridad (3 líneas)
1. Los costos nunca viajan en los pedidos ni se pueden leer con la clave pública; solo se bajan con el PIN de admin.
2. El costo lo fija el servidor al facturar; el celular no puede inventarlo.
3. Abierto (heredado): los pedidos se pueden escribir con la clave pública, así que alguien podría inflar ventas del Panel.

## Precauciones
- Aplicá la migración 015 (después de 011, 012, 013 y 014) antes de publicar; si no, el Panel avisa y muestra todo como estimado.
- Pedido facturado sin internet: el costo se toma cuando llega al servidor; puede diferir si cambiaste costos entre medio.
- Diferencias de 1 centavo por redondeo son normales.
- Merma baja la venta pero no el costo; las notas de crédito sin mercadería no tocan el costo.
- Revisá cada tanto los errores del servidor: `select * from pedidos_costos_errores order by id desc limit 50;`.
