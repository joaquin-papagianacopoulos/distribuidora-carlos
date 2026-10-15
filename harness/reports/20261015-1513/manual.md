# Manual: Facturas A/B, agrupar, troquel y zonas

## Factura A / B (pantalla Facturacion, solo admin)
1. Cada pedido tiene un selector: Factura A, Factura B o Sin factura.
2. La app sugiere sola: cliente Responsable Inscripto = A; los demas = B; sin dato = sin factura. Podes cambiarlo.
3. Para marcar varios: tildá los pedidos y elegí el tipo una sola vez.
4. Si marcás A y el cliente no tiene un CUIT valido, sale un aviso. Te deja seguir igual.
5. Los tipos quedan en el equipo. Tocá "Subir tipos de factura (N)", poné tu PIN y se mandan a la nube.
   Hace falta conexion. Si falla, quedan pendientes y los volves a subir.
6. La boleta impresa dice "FACTURA A" o "FACTURA B" arriba.

## Reporte "Facturas a emitir" (pestaña "A emitir", solo admin)
1. Elegí desde/hasta y si querés A, B o todas. Pedí el PIN y tocá consultar.
2. Ves los pedidos facturados (sin los borrados) con cliente, CUIT, IVA, tipo, n.º de pedido, fecha y monto.
3. Sale agrupado en A y B, con subtotales y total general. Boton para bajar el PDF y pasarselo al contador.

## Agrupar productos
1. En Facturacion, al editar un pedido, tildá los renglones (ej. 10 sabores de Saphirus) y tocá "Agrupar".
2. El nombre se sugiere (marca o rubro); lo podes cambiar. "Deshacer" separa el grupo.
3. Es solo para la boleta: stock, armado, comisiones y estadisticas siguen viendo cada renglon.
4. Al imprimir elegi: "con detalle" (el grupo y abajo sus renglones) o "solo grupos"
   (una linea tipo "Saphirus - 3 bultos (36 u.) - $X"). El total no cambia.

## Troquel
Abajo de todo de la boleta hay una casilla nueva "Transf. a proveedor" con la linea "Proveedor: ______",
junto a Efectivo y Transferencia. Si la boleta es larga, el troquel pasa a una hoja nueva en vez de pisar algo.

## Orden de entrega por zona
1. Elegí la zona. Ves sus clientes en orden.
2. Para reordenar: flechas arriba/abajo o escribí el numero; los demas se corren solos.
3. Para imprimir: elegí la fecha o fechas de los pedidos y una o varias zonas.
   Salen agrupados por zona y numerados sin huecos segun quien tiene pedido. Ese numero es el ORDEN de la boleta.
4. La primera vez, el orden de cada zona arranca igual al que ya tenias (dia y despues orden). No se pierde nada.
5. Clientes sin zona van al final, en "Sin zona". Si cambiás la zona de un cliente, queda ultimo en la nueva.

## Seguridad (en 5 lineas)
1. El tipo de factura A/B vive en una tabla cerrada: con la clave publica no se lee ni se escribe.
2. El reporte (con CUIT) solo se pide con tu PIN de admin; 5 PIN mal bloquean 15 minutos.
3. S-011-01/02 (heredado): el CUIT de los clientes y los pedidos se pueden leer y escribir con la clave publica de la app.
4. Eso significa que alguien con la clave podria ver o alterar datos; no lo introdujo esta version.
5. Recomendacion: mas adelante migrar a Supabase Auth (usuarios reales) para cerrar eso.

## Precauciones y pasos manuales
1. Antes de nada, hacé backup (Supabase y exportar datos de la app).
2. Aplicá la migracion 011 en el SQL editor de Supabase, DESPUES de la 010 y ANTES de publicar la app nueva.
3. Prueba de seguridad: con la clave anon, `select * from pedidos_factura` tiene que dar "permission denied".
4. Si publicás sin la 011, la app anda igual: grupos y zonas quedan solo en el equipo y los tipos A/B quedan pendientes.
5. Despues de publicar, probá con un pedido: marcar tipo, subir con PIN, ver el reporte, imprimir.
