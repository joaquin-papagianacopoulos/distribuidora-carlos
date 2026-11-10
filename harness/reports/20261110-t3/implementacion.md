# Implementacion RUN 20261110-t3 — REQ-ESC (AC-ESC-1..4)

## Dominio (src/domain)
- `precios.js`: `normalizarEscalasBulto`, `escalaAlcanzada`, `aplicarDescuentoEscala` (BigInt, ceil al peso entero), `precioConEscala`, `precioAplicado` (delega; clave `escala` solo si se aplico), `precioMinimoRenglon`, `etiquetaEscala` (`pdf:true` => guion ASCII), `validarEscalasBulto`, `escalasATexto`/`parsearEscalasTexto`. Cambian `esPrecioManual`, `precioBaseRenglon` (la escala no cuenta como descuento), `precioAplicadoRenglon` (recalcula `escalaDesde`/`escalaPct` siempre), `completarPreciosBulto`.
- `bultos.js` (`renglonNuevo` congela `escalasBulto` + `precioBultoX`), `grupoBulto.js` (progreso y linea con escala), `edicionPedido.js` (recalcula escala, descarta lo que mande el cliente, piso del grupo), `gruposFactura.js` (sufijo ASCII), `productos.js` (campo al final, validacion, sync `escalas_bulto`, columna publica), `plantillas.js` (columna, alias, `-` borra, vacio conserva, anti formula), `tienda.js` (`escalasBulto` en precio + `textoEscalasTienda`).
- Fixture compartido: `__fixtures__/escalasCasos.js` (24 casos).

## UI
`ProductoForm.js` (3 filas, deshabilitadas con Bulto x <= 1), `NuevoPedido.js`, `Armado.js`, `Facturacion.js` (etiqueta de escala), `tienda/DetalleProducto.js`.

## Supabase (NO aplicada en ninguna base)
- `supabase/migrations/026_escalas_bulto.sql`: columna jsonb + check (max 3) + `grant select (escalas_bulto)`; 4 helpers (`escalas_bulto_normalizar`, `tienda_escala_alcanzada`, `tienda_escala_pct`, `tienda_precio_con_escala`) con search_path fijo y revoke a anon; `admin_guardar_productos` (copia de 022), `tienda_catalogo` (copia de 010), `tienda_crear_pedido` (copia de 024). Generada por script a partir de las versiones previas (copia fiel); `$$`/`$fn$`/`$mig$` pareados.
- `supabase/verificacion/026_escalas_casos.sql`: mismos casos del fixture; devuelve solo filas que no coinciden (0 = OK).
- Sin cambio de `DB_VERSION` (queda 12).

## Tests nuevos
`precios.escalas`, `productos.escalas`, `plantillas.escalas`, `grupoBulto.escalas`, `tienda.escalas`, `migracion026.sql` (estatico: pares de delimitadores, fidelidad linea a linea de las 3 RPC contra 022/010/024 con lista blanca de lineas cambiadas, grants, fixture == SQL de verificacion), `ProductoForm.escalas`, `escalas.pantallas`.
Adaptados (marcados `// ADAPTADO`, solo se suma 'Escalas por bulto' al final): `productos_proveedores`, `plantillas`, `qa.plantillas.bordes` (20 -> 21 columnas), `ProductoForm`.

## Verificacion
Suite completa: 270 suites / 3848 tests OK. `react-scripts build` OK. `run-gates --fast`: todos en verde.

## Pasos manuales
Backup; aplicar 026 en el SQL Editor (despues de la 025); correr `supabase/verificacion/026_escalas_casos.sql` y verificar 0 filas. Sin la 026 las escalas quedan solo locales (el fallback de columnas descarta `escalas_bulto`) y la RPC 022 ignora la clave: el sync no se rompe.

## Limites
La SQL no se pudo ejecutar localmente (no hay psql): la equivalencia JS/SQL esta cubierta por tests estaticos y el SQL de verificacion a correr en Supabase. Armado y Facturacion solo tienen la etiqueta cubierta por el mismo dominio (el test de pantalla es de Nuevo Pedido). No se mostro la escala en `TarjetaProducto` (solo en el detalle).
