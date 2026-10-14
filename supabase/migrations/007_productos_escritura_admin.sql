-- 007_productos_escritura_admin.sql — S-VTA-01 (seguimiento de REQ-VTA).
-- Corrida 20261014-2036. Se aplica A MANO en Supabase -> SQL Editor (hacer
-- backup antes). Es idempotente (create or replace, revoke/grant repetibles) y
-- no destructiva: no borra tablas, columnas, policies ni datos.
--
-- Problema: la anon key (publica en el bundle) puede insertar, modificar y
-- borrar public.productos. Esta migracion revoca esa escritura y la mueve a dos
-- RPC security definer que exigen PIN de un admin activo (patron 002/004).
--
-- ORDEN DE APLICACION: 001, 002 PASO 1, 004, 006 y recien despues esta 007.
-- Si falta algo, aborta al principio sin tocar nada.
--
-- Despues de correrla, los cambios de productos se suben con el PIN del admin
-- ("Subir productos" en Configuracion o al cerrar comisiones). La app tolera
-- que la 007 no este aplicada (sigue subiendo directo como antes).
--
-- Consulta de control (admins sin PIN, no pueden autorizar nada):
--   select id, nombre from public.vendedores where permiso = 1 and pin_hash is null;

begin;

-- =====================================================================
-- 0. Prerrequisitos (consultas estaticas)
-- =====================================================================
do $$
begin
  if to_regprocedure('public.verificar_pin(text, text)') is null then
    raise exception 'Falta public.verificar_pin(text, text): aplicar antes 002_seguridad_recomendada.sql PASO 1.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'vendedores' and column_name = 'activo') then
    raise exception 'Falta la columna vendedores.activo: aplicar antes 004_baja_vendedores.sql.';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'productos'
         and column_name in ('venta_por', 'bulto_nombre', 'visible_tienda')) < 3 then
    raise exception 'Faltan columnas de public.productos: aplicar antes 006_unidad_venta.sql.';
  end if;
end $$;

-- =====================================================================
-- 1. Cierre de escritura directa. Los grants se chequean antes que RLS: cierra
--    aunque existan policies using(true) creadas desde el dashboard.
--    No se toca RLS. La lectura se mantiene.
-- =====================================================================
revoke insert, update, delete on public.productos from anon, authenticated;
grant select on public.productos to anon, authenticated;

-- =====================================================================
-- 2. RPC admin_guardar_productos
--    Respuesta: { ok:true, aceptados:[id], rechazados:[{id,motivo}] } o
--    { ok:false, motivo: 'no_autorizado' | 'lote_invalido' }.
--    Stock NO se toca nunca: las claves desconocidas (p. ej. stock) se ignoran.
--    Maximo 500 filas por llamada.
-- =====================================================================
create or replace function public.admin_guardar_productos(p_admin_id text, p_admin_pin text, p_filas jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin_id  text := trim(coalesce(p_admin_id, ''));
  v_es_admin  boolean;
  v_pin_ok    boolean;
  v_fila      jsonb;
  v_id        bigint;
  v_nombre    text;
  v_precio    numeric;
  v_imagen    text;
  v_extras    boolean;
  v_aceptados jsonb := '[]'::jsonb;
  v_rechazos  jsonb := '[]'::jsonb;
begin
  -- Autorizacion: id invalido => no_autorizado ANTES de verificar_pin (sonda sin
  -- gastar intentos). Despues verificar_pin SIEMPRE; return (no raise) para que
  -- el intento fallido quede registrado.
  if length(v_admin_id) = 0 or length(v_admin_id) > 64 then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  select exists (
    select 1 from public.vendedores
     where id::text = v_admin_id and permiso = 1 and activo and pin_hash is not null
  ) into v_es_admin;
  v_pin_ok := coalesce(public.verificar_pin(v_admin_id, p_admin_pin), false);
  if not v_pin_ok or not v_es_admin then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  if p_filas is null or jsonb_typeof(p_filas) <> 'array'
     or jsonb_array_length(p_filas) < 1 or jsonb_array_length(p_filas) > 500 then
    return jsonb_build_object('ok', false, 'motivo', 'lote_invalido');
  end if;

  for v_fila in select value from jsonb_array_elements(p_filas) loop
    v_id := null;
    begin
      if jsonb_typeof(v_fila) <> 'object' or (v_fila->>'id') !~ '^[0-9]{1,15}$' then
        v_rechazos := v_rechazos || jsonb_build_object('id', v_fila->'id', 'motivo', 'id_invalido');
        continue;
      end if;
      v_id := (v_fila->>'id')::bigint;
      if v_id <= 0 then
        v_rechazos := v_rechazos || jsonb_build_object('id', v_id, 'motivo', 'id_invalido');
        continue;
      end if;

      v_nombre := trim(coalesce(v_fila->>'nombre', ''));
      v_precio := (v_fila->>'precio')::numeric;
      v_imagen := nullif(v_fila->>'imagen_url', '');
      v_extras := coalesce(v_fila->>'extras', 'false') = 'true';

      if char_length(v_nombre) < 1 or char_length(v_nombre) > 200
         or v_precio is null or v_precio < 0
         or (v_imagen is not null and (v_imagen !~* '^https?://' or char_length(v_imagen) > 1000))
         or char_length(coalesce(v_fila->>'codigo', '')) > 64
         or char_length(coalesce(v_fila->>'unidad', '')) > 32
         or char_length(coalesce(v_fila->>'categoria', '')) > 120
         or char_length(coalesce(v_fila->>'marca', '')) > 120
         or char_length(coalesce(v_fila->>'bulto_nombre', '')) > 20 then
        v_rechazos := v_rechazos || jsonb_build_object('id', v_id, 'motivo', 'datos_invalidos');
        continue;
      end if;

      if v_extras then
        insert into public.productos
          (id, nombre, codigo, precio, unidad, categoria, marca, imagen_url,
           proveedor_id, costo_final, descuento1, descuento2, ganancia, precio_venta2,
           bulto_x, minimo_venta, venta_por, bulto_nombre, visible_tienda)
        values
          (v_id, v_nombre, coalesce(v_fila->>'codigo', ''), v_precio,
           coalesce(nullif(v_fila->>'unidad', ''), 'unidad'),
           coalesce(v_fila->>'categoria', ''), coalesce(v_fila->>'marca', ''), v_imagen,
           nullif(v_fila->>'proveedor_id', ''),
           coalesce((v_fila->>'costo_final')::numeric, 0),
           coalesce((v_fila->>'descuento1')::numeric, 0),
           coalesce((v_fila->>'descuento2')::numeric, 0),
           coalesce((v_fila->>'ganancia')::numeric, 0),
           coalesce((v_fila->>'precio_venta2')::numeric, 0),
           coalesce((v_fila->>'bulto_x')::integer, 1),
           coalesce((v_fila->>'minimo_venta')::integer, 1),
           nullif(v_fila->>'venta_por', ''),
           nullif(v_fila->>'bulto_nombre', ''),
           coalesce((v_fila->>'visible_tienda')::boolean, true))
        on conflict (id) do update set
          nombre = excluded.nombre, codigo = excluded.codigo, precio = excluded.precio,
          unidad = excluded.unidad, categoria = excluded.categoria, marca = excluded.marca,
          imagen_url = excluded.imagen_url, proveedor_id = excluded.proveedor_id,
          costo_final = excluded.costo_final, descuento1 = excluded.descuento1,
          descuento2 = excluded.descuento2, ganancia = excluded.ganancia,
          precio_venta2 = excluded.precio_venta2, bulto_x = excluded.bulto_x,
          minimo_venta = excluded.minimo_venta, venta_por = excluded.venta_por,
          bulto_nombre = excluded.bulto_nombre, visible_tienda = excluded.visible_tienda;
      else
        -- Solo basicas: el CSV no pisa los extras cargados en otro dispositivo.
        insert into public.productos (id, nombre, codigo, precio, unidad, categoria, marca, imagen_url)
        values
          (v_id, v_nombre, coalesce(v_fila->>'codigo', ''), v_precio,
           coalesce(nullif(v_fila->>'unidad', ''), 'unidad'),
           coalesce(v_fila->>'categoria', ''), coalesce(v_fila->>'marca', ''), v_imagen)
        on conflict (id) do update set
          nombre = excluded.nombre, codigo = excluded.codigo, precio = excluded.precio,
          unidad = excluded.unidad, categoria = excluded.categoria, marca = excluded.marca,
          imagen_url = excluded.imagen_url;
      end if;
      v_aceptados := v_aceptados || to_jsonb(v_id);
    exception when check_violation or not_null_violation or invalid_text_representation
              or numeric_value_out_of_range then
      v_rechazos := v_rechazos || jsonb_build_object('id', v_id, 'motivo', 'datos_invalidos');
    end;
  end loop;

  return jsonb_build_object('ok', true, 'aceptados', v_aceptados, 'rechazados', v_rechazos);
end $$;

revoke all on function public.admin_guardar_productos(text, text, jsonb) from public;
grant execute on function public.admin_guardar_productos(text, text, jsonb) to anon, authenticated;

-- =====================================================================
-- 3. RPC admin_baja_producto (baja fisica, igual que el boton actual).
--    No toca movimientos_stock. Idempotente.
-- =====================================================================
create or replace function public.admin_baja_producto(p_admin_id text, p_admin_pin text, p_producto_id bigint)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin_id text := trim(coalesce(p_admin_id, ''));
  v_es_admin boolean;
  v_pin_ok   boolean;
  v_n        integer;
begin
  if length(v_admin_id) = 0 or length(v_admin_id) > 64 then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  select exists (
    select 1 from public.vendedores
     where id::text = v_admin_id and permiso = 1 and activo and pin_hash is not null
  ) into v_es_admin;
  v_pin_ok := coalesce(public.verificar_pin(v_admin_id, p_admin_pin), false);
  if not v_pin_ok or not v_es_admin then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  if p_producto_id is null or p_producto_id <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'id_invalido');
  end if;

  delete from public.productos where id = p_producto_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', true, 'ya_borrado', true);
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.admin_baja_producto(text, text, bigint) from public;
grant execute on function public.admin_baja_producto(text, text, bigint) to anon, authenticated;

commit;
