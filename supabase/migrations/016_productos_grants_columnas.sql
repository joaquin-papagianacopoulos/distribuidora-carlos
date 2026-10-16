-- 016_productos_grants_columnas.sql — repara el "permission denied for table productos" del sync.
-- Se aplica A MANO en Supabase -> SQL Editor. Idempotente y NO destructiva: no toca datos,
-- solo vuelve a otorgar el select por columnas de public.productos.
--
-- Problema: la 013 revoca el select de TABLA de productos y otorga select solo a las columnas
-- publicas QUE EXISTIAN en ese momento. Si despues se corre una migracion que agrega columnas
-- a productos (006: venta_por, bulto_nombre, visible_tienda; 010: precio_bulto; 012:
-- stock_minimo), esas columnas quedan sin permiso. La app las pide al bajar los productos y
-- PostgREST responde 401 / 42501 "permission denied for table productos": el sync se corta.
--
-- Arreglo: otorgar select a TODAS las columnas actuales salvo las internas (misma regla que la
-- 013). Volver a correr esta migracion despues de cualquier migracion que agregue columnas a
-- productos. Se puede correr aunque la 013 no este aplicada (no cambia nada en ese caso).

begin;

do $$
declare
  v_cols text;
begin
  if to_regclass('public.productos') is null then
    raise exception 'No existe public.productos: aplicar antes 001_altas_y_stock.sql.';
  end if;
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'productos'
     and column_name not in ('costo_final', 'descuento1', 'descuento2', 'ganancia', 'precio_venta2');
  execute format('grant select (%s) on public.productos to anon, authenticated', v_cols);
end $$;

-- Las internas siguen sin select (costos y margen se leen por admin_productos_costos con PIN).
-- Solo si la 013 ya esta aplicada: antes de la 013, anon tiene select de tabla (la 007) y
-- revocar por columna no alcanza; la 013 es la que lo cierra.
do $$
begin
  if to_regprocedure('public.admin_productos_costos(text, text, bigint, integer)') is not null then
    revoke select (costo_final, descuento1, descuento2, ganancia, precio_venta2) on public.productos from anon, authenticated;
  end if;
end $$;

commit;
