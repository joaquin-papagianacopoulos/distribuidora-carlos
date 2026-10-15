-- 013_productos_costos_privados.sql — S-012-01 (REQ-INA, AC-INA-4; seguridad).
-- Se aplica A MANO en Supabase -> SQL Editor, DESPUES de la 012 (hacer backup antes).
-- Idempotente y NO destructiva: no borra ni mueve datos; solo cambia permisos de lectura.
--
-- Problema: la 007 dejo `grant select on productos` para anon, asi que con la anon key se podian
-- leer costo_final, descuento1, descuento2 y ganancia (costo real y margen de toda la lista).
--
-- Decision (delegada por el duenio, "lo mas facil y recomendable" = Opcion B del informe):
--  1. Se revoca el select de TABLA de productos a anon/authenticated y se otorga select solo por
--     COLUMNAS publicas: todas menos las internas.
--  2. Columnas internas: costo_final, descuento1, descuento2, ganancia y precio_venta2.
--     precio_venta2 tambien es interna: es una lista de precios comercial que no usan la venta,
--     el pedido ni la tienda (la tienda lee por tienda_catalogo, security definer).
--  3. Los costos se leen solo por la RPC admin_productos_costos con PIN de admin (patron
--     _es_admin_con_pin), paginada por id. La escritura sigue por admin_guardar_productos.
--  4. Los select('*') de la app sobre productos pasan a lista explicita de columnas (con
--     select('*') PostgREST daria "permission denied" despues de esta migracion).

begin;

-- 0. Prerrequisitos
do $$
begin
  if to_regprocedure('public._es_admin_con_pin(text, text)') is null then
    raise exception 'Falta la migracion 011_lote_operacion_facturacion_zonas.sql: aplicarla antes que esta.';
  end if;
  if to_regprocedure('public.admin_compras_bajar(text, text, jsonb)') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'productos' and column_name = 'stock_minimo') then
    raise exception 'Falta la migracion 012_lote_operacion_compras_stock.sql: aplicarla antes que esta.';
  end if;
end $$;

-- 1. Lectura de productos solo por columnas publicas.
--    Revocar el select de tabla tambien revoca los de columna; despues se otorgan las publicas
--    (calculadas: cualquier columna futura queda publica salvo que se agregue a la lista interna).
revoke select on public.productos from anon, authenticated;

do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'productos'
     and column_name not in ('costo_final', 'descuento1', 'descuento2', 'ganancia', 'precio_venta2');
  if v_cols is null then
    raise exception 'public.productos no tiene columnas publicas';
  end if;
  execute format('grant select (%s) on public.productos to anon, authenticated', v_cols);
end $$;

-- Por las dudas (re-ejecucion o grants manuales por columna): las internas quedan sin select.
revoke select (costo_final, descuento1, descuento2, ganancia, precio_venta2) on public.productos from anon, authenticated;

-- 2. RPC de lectura de costos con PIN de admin. Paginada por id (keyset): p_desde_id exclusivo.
create or replace function public.admin_productos_costos(p_admin_id text, p_admin_pin text, p_desde_id bigint, p_limite integer)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_desde  bigint := greatest(coalesce(p_desde_id, 0), 0);
  v_limite integer := least(greatest(coalesce(p_limite, 1000), 1), 1000);
  v_filas  jsonb;
begin
  if not public._es_admin_con_pin(p_admin_id, p_admin_pin) then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) into v_filas from (
    select id, costo_final, descuento1, descuento2, ganancia, precio_venta2
      from public.productos
     where id > v_desde
     order by id
     limit v_limite) t;

  return jsonb_build_object('ok', true, 'productos', v_filas);
end $$;

revoke all on function public.admin_productos_costos(text, text, bigint, integer) from public;
grant execute on function public.admin_productos_costos(text, text, bigint, integer) to anon, authenticated;

commit;
