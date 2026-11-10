# Diagnóstico: "los precios de venta son nuestros costos" (2026-11-10)

Solo diagnóstico: no se tocó `src/` ni `supabase/`, no se escribió en ninguna base.

## Causa raíz (VERIFICADO ejecutando el dominio real con un script fuera del repo)

**Cuando el precio queda vacío y no hay % de ganancia, el sistema guarda `precio = costo`.**

1. `src/domain/productos.js:96-102` (`validarProducto`): si `form.precio` está vacío usa
   `calcularPrecioVenta` (`:41-48`) = costo neto × (1 + ganancia/100). Con ganancia vacía/0
   (`:92-94` la toma como 0) el resultado es exactamente el costo. No hay error ni aviso.
2. `src/domain/plantillas.js:349-351` (`validarFilaProducto`, importación Excel): si la celda
   "Precio por unidad" está vacía (o la columna no existe) y la fila trae **cualquier** campo de
   costo (`CAMPOS_COSTO`, `:278`), fuerza `form.precio = ''` aunque el producto ya exista y
   tenga un precio cargado a mano. Eso dispara el punto 1 y **pisa el precio de venta bueno**.
3. Agravante multi-dispositivo: desde la migración 013 los costos no bajan con la anon key; en
   un dispositivo que no los bajó con PIN, `existente.ganancia` es `undefined`
   (`productos.js:276`), `plantillas.js:305` lo vuelve `''` => ganancia 0 => precio = costo,
   aunque en el servidor ese producto tenga ganancia. `conservarCostosDesconocidos`
   (`src/pages/Configuracion.js:79`) protege los costos pero no el `precio`, que sí se sube.
4. Formulario: `src/components/ProductoForm.js:74-75` autocompleta "Precio por unidad" con el
   calculado al tipear el costo; con ganancia vacía el campo queda igual al costo (alta nueva o
   producto cuyo precio ya coincidía con el calculado). Visible en pantalla, pero fácil de no ver.
5. La propia plantilla lo documenta como comportamiento esperado (`plantillas.js:40-41`:
   ganancia "vacío = 0", precio "si queda vacío se calcula").

### Reproducción (salida real de `planificarImportacion`)

| Caso | Planilla | Producto previo | Resultado |
|---|---|---|---|
| A alta | Costo final 1000, % Ganancia vacío, Precio vacío | no existe | `precio=1000` |
| B | Costo final 1000, Precio vacío | precio manual 1500, ganancia 0 | `precio=1000` (pisado) |
| C | solo Código/Descripción/Costo final 1000 | precio 1350, costos desconocidos | `precio=1000` (pisado) |
| D | solo Costo final 1000 | ganancia 35 conocida | `precio=1350` (correcto) |

El caso más probable para el reporte del dueño es B/C: se subió una planilla con "Costo final"
y sin precio/ganancia sobre productos existentes (SUPUESTO: no se vio el archivo que usaron).

## Hipótesis descartadas (VERIFICADO por lectura / ejecución)

- Alias y matching de encabezados (`plantillas.js:125-163`): "Costo", "Costo unitario",
  "Precio costo", "Precio lista", "Precio compra", "Precio unitario" NO se mapean a `precio`
  (se ignoran o el archivo se rechaza). `utils/fuzzy.js` no participa del mapeo de columnas.
  Única salvedad: un archivo viejo con encabezado "Precio" a secas se toma como precio de
  venta; si era una lista de precios del proveedor, entra el costo como precio (SUPUESTO de uso).
- Sync / RPC: `productosRpc.js:24`, `syncService.js:278` y `admin_guardar_productos`
  (migración 022 `:92,142,154`) mandan `precio` desde `precio`; no hay cruce ni `coalesce`
  con `costo_final`.
- Ingreso de mercadería: `domain/compras.js:217-230` solo recalcula precio si ganancia > 0 y
  el precio era el automático; `stockService.js:108` usa ese resultado. No pisa con el costo.
- Tienda pública: `tienda_catalogo` (migración 010 `:217-256`) devuelve `p.precio` /
  `precio_bulto`; nunca lee `costo_final`. La tienda muestra el costo solo porque `precio` ya
  quedó igual al costo (fuga indirecta de dato privado, regla 8).

## Datos dañados: NO se pudo medir

Las herramientas MCP de Supabase dan acceso a un proyecto "app-distribuidora", pero su esquema
no coincide con este repo (productos sin `costo_final`/`ganancia`/`precio_bulto`, sin
`admin_guardar_productos` ni `movimientos_stock`, y con una columna `orden_catalogo` que el repo
no conoce). Parece otro despliegue; no sirve para comparar precio contra costo. No se leyó `.env`.
Nota aparte: en ese proyecto el asesor de Supabase marca RLS deshabilitado en `vendedores`,
`clientes`, `productos`, `pedidos`, `faltantes` y `deudas` (revisar si es la base productiva).

Consultas de solo lectura para correr en la base real (SQL editor):

```sql
select count(*) total,
  count(*) filter (where costo_final > 0 and precio = round(costo_final
     * (1 - coalesce(descuento1,0)/100) * (1 - coalesce(descuento2,0)/100), 2)) precio_igual_costo,
  count(*) filter (where costo_final > 0 and precio < costo_final) precio_menor_costo,
  count(*) filter (where coalesce(ganancia,0) = 0 and costo_final > 0) sin_ganancia
from public.productos;
select usuario, origen, date_trunc('day', created_at) dia, count(*)   -- ajustar nombres de columnas
from public.cambios_precio group by 1,2,3 order by 3 desc limit 20;   -- a la migración 010
```

## Corrección de código mínima (propuesta, no aplicada)

1. `plantillas.js:351`: en productos existentes NO vaciar el precio salvo que la ganancia
   resultante sea > 0 y el precio previo fuera el automático (misma regla que
   `costoProductoDesdeIngreso`). Si no, conservar `existente.precio`.
2. `productos.js:98-102`: precio vacío + ganancia 0 + costo > 0 => error "Cargá el precio por
   unidad o el % de ganancia" (nunca caer al costo). Cubre formulario y altas por planilla.
3. `ProductoForm.js:74-75`: no autocompletar el precio mientras la ganancia sea vacía/0.
4. `plantillas.js:40-41`: corregir el texto de instrucciones. Actualizar AC-PROD-1/AC-PLA-3 en
   `harness/SPEC.md` y agregar tests para los casos A, B y C.

## Reparación de datos (propuesta, NO ejecutada)

1. Medir con la consulta de arriba y exportar los afectados antes de tocar nada (backup).
2. Para cada afectado, recuperar el precio anterior desde `cambios_precio` (último cambio cuyo
   precio nuevo = costo): restaurar `precio_anterior`. También queda historial local en el
   store `cambiosPrecio` del dispositivo que importó.
3. Los que no tengan historial (altas): no se puede inferir el precio; el dueño carga % de
   ganancia por rubro o sube la planilla con "Precio por unidad" completo.
4. Aplicar por la app (planilla corregida + sync con PIN), no con UPDATE directo, para que
   quede registrado el cambio de precio y bajen los dispositivos.
5. Revisar pedidos y pedidos web tomados desde la fecha de la importación: se vendieron al
   costo. Mientras tanto conviene ocultar la tienda o los productos afectados.
