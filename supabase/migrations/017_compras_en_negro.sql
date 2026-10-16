-- 017_compras_en_negro.sql — REQ-NEG: tipo de compra "En negro" (sin factura) en el ingreso de mercaderia.
-- Se aplica A MANO en Supabase -> SQL Editor, DESPUES de la 012 (hacer backup antes).
-- Idempotente y NO destructiva: no borra ni modifica datos; solo amplia lo que se acepta.
--
-- Que hace:
--  1. ingresos_costos.tipo_cabecera acepta 'N' (en negro) ademas de 'A' y 'B'.
--  2. admin_compras_guardar (misma firma y misma logica que la 012) acepta 'N' en la cabecera
--     y en cada renglon. Unico cambio: ('A','B') -> ('A','B','N') en esas dos validaciones.
--     Si se vuelve a correr la 012, hay que volver a correr esta 017.
-- Las notas de credito (rendicion, 014) siguen siendo solo A/B.

begin;

do $$
begin
  if to_regclass('public.ingresos_costos') is null
     or to_regprocedure('public.admin_compras_guardar(text, text, jsonb)') is null then
    raise exception 'Falta la migracion 012_lote_operacion_compras_stock.sql: aplicarla antes que esta.';
  end if;
end $$;

-- 1. Check de la cabecera: se reemplaza el de la 012 (nombre automatico) por uno con nombre fijo.
do $$
declare
  r record;
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.ingresos_costos'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%tipo_cabecera%'
       and c.conname <> 'ingresos_costos_tipo_cabecera_chk'
  loop
    execute format('alter table public.ingresos_costos drop constraint %I', r.conname);
  end loop;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.ingresos_costos'::regclass and conname = 'ingresos_costos_tipo_cabecera_chk') then
    alter table public.ingresos_costos add constraint ingresos_costos_tipo_cabecera_chk
      check (tipo_cabecera in ('A','B','N'));
  end if;
end $$;

-- 2. RPC de guardado (copia de la 012 con 'N' permitido).
create or replace function public.admin_compras_guardar(p_admin_id text, p_admin_pin text, p_lote jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_fila jsonb;
  v_ren  jsonb;
  v_id   text;
  v_ts   timestamptz;
  v_uuid uuid;
  v_costo numeric;
  v_n_costos integer := 0;
  v_n_cuenta integer := 0;
  v_n_pedidos integer := 0;
  v_total integer := 0;
  v_rechazados jsonb := '[]'::jsonb;
  v_guardados_c jsonb := '[]'::jsonb;
  v_guardados_m jsonb := '[]'::jsonb;
  v_guardados_p jsonb := '[]'::jsonb;
  v_admin text := left(trim(coalesce(p_admin_id, '')), 64);
  v_anul jsonb;
begin
  if not public._es_admin_con_pin(p_admin_id, p_admin_pin) then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if p_lote is null or jsonb_typeof(p_lote) <> 'object'
     or jsonb_typeof(coalesce(p_lote->'costos', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_lote->'cuenta', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_lote->'pedidos', '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'motivo', 'lote_invalido');
  end if;
  v_total := jsonb_array_length(coalesce(p_lote->'costos', '[]'::jsonb))
           + jsonb_array_length(coalesce(p_lote->'cuenta', '[]'::jsonb))
           + jsonb_array_length(coalesce(p_lote->'pedidos', '[]'::jsonb));
  if v_total < 1 or v_total > 500 then
    return jsonb_build_object('ok', false, 'motivo', 'lote_invalido');
  end if;

  -- Costos del ingreso
  for v_fila in select value from jsonb_array_elements(coalesce(p_lote->'costos', '[]'::jsonb)) loop
    v_id := null;
    begin
      if jsonb_typeof(v_fila) <> 'object' then
        v_rechazados := v_rechazados || jsonb_build_object('id', null::text, 'motivo', 'datos_invalidos');
        continue;
      end if;
      v_id := v_fila->>'ingreso_id';
      v_ts := least(coalesce((v_fila->>'updated_at')::timestamptz, now()), now() + interval '5 minutes');
      if v_id is null or v_id !~ '^[0-9a-zA-Z-]{1,64}$'
         or coalesce(v_fila->>'tipo_cabecera', '') not in ('A','B','N')
         or char_length(coalesce(v_fila->>'factura_a', '')) > 40
         or char_length(coalesce(v_fila->>'factura_b', '')) > 40
         or jsonb_typeof(v_fila->'renglones') <> 'array'
         or jsonb_array_length(v_fila->'renglones') > 500
         or coalesce(v_fila->>'proveedor_id', '') !~ '^[0-9a-zA-Z-]{1,64}$' then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo', 'datos_invalidos');
        continue;
      end if;
      for v_ren in select value from jsonb_array_elements(v_fila->'renglones') loop
        v_costo := nullif(v_ren->>'costo_unitario', '')::numeric;
        if jsonb_typeof(v_ren) <> 'object'
           or coalesce(v_ren->>'tipo_factura', '') not in ('A','B','N')
           or coalesce(v_ren->>'producto_id', '') !~ '^[0-9a-zA-Z-]{1,64}$'
           or (v_costo is not null and (v_costo < 0 or v_costo > 999999999 or v_costo = 'NaN'::numeric)) then
          raise exception 'renglon_invalido' using errcode = '22023';
        end if;
      end loop;
      if not exists (select 1 from public.ingresos_mercaderia where id = v_id) then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo', 'ingreso_inexistente');
        continue;
      end if;
      insert into public.ingresos_costos
        (ingreso_id, proveedor_id, fecha, tipo_cabecera, factura_a, factura_b, renglones, updated_at, updated_by)
      values
        (v_id, v_fila->>'proveedor_id', coalesce((v_fila->>'fecha')::timestamptz, now()), v_fila->>'tipo_cabecera',
         nullif(v_fila->>'factura_a', ''), nullif(v_fila->>'factura_b', ''), v_fila->'renglones', v_ts, v_admin)
      on conflict (ingreso_id) do update
        set tipo_cabecera = excluded.tipo_cabecera, factura_a = excluded.factura_a,
            factura_b = excluded.factura_b, renglones = excluded.renglones,
            updated_at = excluded.updated_at, updated_by = excluded.updated_by
        where excluded.updated_at >= public.ingresos_costos.updated_at;
      v_n_costos := v_n_costos + 1;
      v_guardados_c := v_guardados_c || to_jsonb(v_id);
    exception
      -- S-012-03: solo los errores de DATO esperados se informan como datos_invalidos.
      -- Cualquier otro (permisos, bug, query_canceled) se propaga y aborta la llamada.
      when check_violation or not_null_violation or foreign_key_violation
        or invalid_text_representation or invalid_datetime_format or datetime_field_overflow
        or numeric_value_out_of_range or invalid_parameter_value or string_data_right_truncation
        or raise_exception then
      v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo', 'datos_invalidos');
    end;
  end loop;

  -- Cuenta con proveedores
  for v_fila in select value from jsonb_array_elements(coalesce(p_lote->'cuenta', '[]'::jsonb)) loop
    v_id := null;
    begin
      if jsonb_typeof(v_fila) <> 'object' then
        v_rechazados := v_rechazados || jsonb_build_object('id', null::text, 'motivo', 'datos_invalidos');
        continue;
      end if;
      v_id := v_fila->>'id';
      v_uuid := v_id::uuid;
      v_ts := least(coalesce((v_fila->>'updated_at')::timestamptz, now()), now() + interval '5 minutes');
      v_anul := case when jsonb_typeof(v_fila->'anulado') = 'object' then v_fila->'anulado' else null end;
      if coalesce(v_fila->>'proveedor_id', '') !~ '^[0-9a-zA-Z-]{1,64}$'
         or coalesce(v_fila->>'tipo', '') not in ('cargo','pago')
         or coalesce(v_fila->>'monto_centavos', '') !~ '^[0-9]{1,12}$'
         or (v_fila->>'monto_centavos')::bigint < 1
         or (v_fila->>'tipo' = 'pago' and coalesce(v_fila->>'medio', '') not in ('efectivo','transferencia','directa'))
         or (v_fila->>'tipo' = 'cargo' and nullif(v_fila->>'medio', '') is not null)
         or char_length(coalesce(v_fila->>'referencia', '')) > 300
         or char_length(coalesce(v_fila->>'comprobante_path', '')) > 200
         or (nullif(v_fila->>'comprobante_path', '') is not null and v_fila->>'comprobante_path' !~ '^pagos/[0-9a-f-]{36}-[0-9a-f-]{36}\.(jpg|png|webp|pdf)$')
         or (v_anul is not null and char_length(trim(coalesce(v_anul->>'motivo', ''))) < 1) then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo', 'datos_invalidos');
        continue;
      end if;
      insert into public.cuenta_proveedores
        (id, proveedor_id, tipo, fecha, monto_centavos, medio, referencia, cliente_id, pedido_id,
         comprobante_path, anulado_motivo, anulado_por, anulado_at, usuario, creado_at, updated_at)
      values
        (v_uuid, v_fila->>'proveedor_id', v_fila->>'tipo', (v_fila->>'fecha')::date,
         (v_fila->>'monto_centavos')::bigint, nullif(v_fila->>'medio', ''), nullif(v_fila->>'referencia', ''),
         left(nullif(v_fila->>'cliente_id', ''), 64), left(nullif(v_fila->>'pedido_id', ''), 64),
         nullif(v_fila->>'comprobante_path', ''),
         case when v_anul is null then null else left(trim(v_anul->>'motivo'), 300) end,
         case when v_anul is null then null else left(coalesce(v_anul->>'usuario', v_admin), 64) end,
         case when v_anul is null then null else least(coalesce((v_anul->>'at')::timestamptz, now()), now() + interval '5 minutes') end,
         left(coalesce(v_fila->>'usuario', v_admin), 64),
         least(coalesce((v_fila->>'creado_at')::timestamptz, now()), now() + interval '5 minutes'), v_ts)
      on conflict (id) do update
        set comprobante_path = coalesce(public.cuenta_proveedores.comprobante_path, excluded.comprobante_path),
            anulado_motivo = coalesce(public.cuenta_proveedores.anulado_motivo, excluded.anulado_motivo),
            anulado_por    = coalesce(public.cuenta_proveedores.anulado_por, excluded.anulado_por),
            anulado_at     = coalesce(public.cuenta_proveedores.anulado_at, excluded.anulado_at),
            updated_at     = greatest(public.cuenta_proveedores.updated_at, excluded.updated_at);
      v_n_cuenta := v_n_cuenta + 1;
      v_guardados_m := v_guardados_m || to_jsonb(v_id);
    exception
      -- S-012-03: solo los errores de DATO esperados se informan como datos_invalidos.
      -- Cualquier otro (permisos, bug, query_canceled) se propaga y aborta la llamada.
      when check_violation or not_null_violation or foreign_key_violation
        or invalid_text_representation or invalid_datetime_format or datetime_field_overflow
        or numeric_value_out_of_range or invalid_parameter_value or string_data_right_truncation
        or raise_exception then
      -- Un movimiento ya existente con datos distintos (trigger de inmutabilidad, raise_exception) se rechaza.
      v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo', 'datos_invalidos');
    end;
  end loop;

  -- Pedidos al proveedor (last-write-wins; "recibido" no retrocede)
  for v_fila in select value from jsonb_array_elements(coalesce(p_lote->'pedidos', '[]'::jsonb)) loop
    v_id := null;
    begin
      if jsonb_typeof(v_fila) <> 'object' then
        v_rechazados := v_rechazados || jsonb_build_object('id', null::text, 'motivo', 'datos_invalidos');
        continue;
      end if;
      v_id := v_fila->>'id';
      v_uuid := v_id::uuid;
      v_ts := least(coalesce((v_fila->>'updated_at')::timestamptz, now()), now() + interval '5 minutes');
      if coalesce(v_fila->>'proveedor_id', '') !~ '^[0-9a-zA-Z-]{1,64}$'
         or coalesce(v_fila->>'estado', '') not in ('borrador','enviado','recibido')
         or jsonb_typeof(v_fila->'items') <> 'array'
         or jsonb_array_length(v_fila->'items') > 500 then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo', 'datos_invalidos');
        continue;
      end if;
      insert into public.pedidos_proveedor
        (id, proveedor_id, estado, items, ingreso_id, usuario, creado_at, updated_at)
      values
        (v_uuid, v_fila->>'proveedor_id', v_fila->>'estado', v_fila->'items',
         left(nullif(v_fila->>'ingreso_id', ''), 64), left(coalesce(v_fila->>'usuario', v_admin), 64),
         least(coalesce((v_fila->>'creado_at')::timestamptz, now()), now() + interval '5 minutes'), v_ts)
      on conflict (id) do update
        set estado = excluded.estado, items = excluded.items, ingreso_id = excluded.ingreso_id,
            updated_at = excluded.updated_at
        where excluded.updated_at >= public.pedidos_proveedor.updated_at
          and public.pedidos_proveedor.estado <> 'recibido';
      -- Una version mas vieja, o sobre un pedido ya recibido, ya esta resuelta: se confirma igual.
      v_n_pedidos := v_n_pedidos + 1;
      v_guardados_p := v_guardados_p || to_jsonb(v_id);
    exception
      -- S-012-03: solo los errores de DATO esperados se informan como datos_invalidos.
      -- Cualquier otro (permisos, bug, query_canceled) se propaga y aborta la llamada.
      when check_violation or not_null_violation or foreign_key_violation
        or invalid_text_representation or invalid_datetime_format or datetime_field_overflow
        or numeric_value_out_of_range or invalid_parameter_value or string_data_right_truncation
        or raise_exception then
      v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo', 'datos_invalidos');
    end;
  end loop;

  return jsonb_build_object('ok', true,
    'guardados', jsonb_build_object('costos', v_n_costos, 'cuenta', v_n_cuenta, 'pedidos', v_n_pedidos),
    'ids', jsonb_build_object('costos', v_guardados_c, 'cuenta', v_guardados_m, 'pedidos', v_guardados_p),
    'rechazados', v_rechazados);
end $$;

revoke all on function public.admin_compras_guardar(text, text, jsonb) from public;
grant execute on function public.admin_compras_guardar(text, text, jsonb) to anon, authenticated;

commit;
