-- 018_pedidos_web_fecha.sql — REQ-WEB (AC-WEB-8): al aceptar un pedido web se puede cambiar la
-- fecha del pedido (p. ej. entregarlo otro dia). Se aplica A MANO en Supabase -> SQL Editor,
-- DESPUES de la 008 (hacer backup antes). Idempotente y NO destructiva.
--
-- Redefine admin_resolver_pedido_web con la MISMA firma y la misma logica que la 008; el unico
-- agregado es p_datos.fecha (opcional, YYYY-MM-DD, entre hoy-60 y hoy+90 en hora de Argentina).
-- Sin fecha se comporta igual que antes. Si se vuelve a correr la 008, volver a correr esta 018.

begin;

do $$
begin
  if to_regprocedure('public.admin_resolver_pedido_web(text, text, text, uuid, text, jsonb)') is null then
    raise exception 'Falta la migracion 008_tienda.sql: aplicarla antes que esta.';
  end if;
end $$;

create or replace function public.admin_resolver_pedido_web(
  p_admin_id text, p_admin_pin text, p_pedido_id text, p_accion_id uuid, p_tipo text, p_datos jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_por    text;
  v_ped    record;
  v_motivo text;
  v_vend   text;
  v_items  jsonb;
  v_total  numeric;
  v_fecha  date;
  v_hoy    date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  v_por := public.tienda_admin_ok(p_admin_id, p_admin_pin);
  if v_por is null then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if p_accion_id is null or p_tipo not in ('aceptar', 'rechazar') or p_datos is null or jsonb_typeof(p_datos) <> 'object'
     or p_pedido_id is null or char_length(p_pedido_id) > 40 then
    return jsonb_build_object('ok', false, 'motivo', 'invalido');
  end if;

  select id::text as id, origen, web_estado, web_accion_id, web_revisado_por, cliente_id::text as cliente_id into v_ped
    from public.pedidos where id::text = p_pedido_id and origen = 'web' for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
  end if;

  if coalesce(v_ped.web_estado, 'por_revisar') <> 'por_revisar' then
    if v_ped.web_accion_id = p_accion_id then
      return jsonb_build_object('ok', true, 'repetido', true);
    end if;
    return jsonb_build_object('ok', false, 'motivo', 'ya_resuelto', 'estado', v_ped.web_estado,
                              'revisado_por', v_ped.web_revisado_por, 'cliente_id', v_ped.cliente_id);
  end if;

  if p_tipo = 'rechazar' then
    v_motivo := trim(coalesce(p_datos->>'motivo', ''));
    if char_length(v_motivo) < 3 or char_length(v_motivo) > 300 then
      return jsonb_build_object('ok', false, 'motivo', 'invalido');
    end if;
    update public.pedidos
       set web_estado = 'rechazado', web_revisado_por = v_por, web_revisado_at = now(),
           web_motivo_rechazo = v_motivo, web_accion_id = p_accion_id, updated_at = now()
     where id::text = p_pedido_id;
    return jsonb_build_object('ok', true);
  end if;

  -- aceptar
  v_vend  := trim(coalesce(p_datos->>'vendedor', ''));
  v_items := p_datos->'items';
  begin
    v_total := (p_datos->>'total')::numeric;
  exception when others then
    v_total := null;
  end;
  if char_length(v_vend) < 1 or char_length(v_vend) > 80
     or coalesce(p_datos->>'cliente_id', '') = ''
     or v_items is null or jsonb_typeof(v_items) <> 'array'
     or jsonb_array_length(v_items) < 1 or jsonb_array_length(v_items) > 150
     or v_total is null or v_total < 0 then
    return jsonb_build_object('ok', false, 'motivo', 'invalido');
  end if;
  -- AC-WEB-8: fecha opcional (mover la entrega a otro dia). Mismo rango que el dominio.
  if nullif(p_datos->>'fecha', '') is not null then
    if (p_datos->>'fecha') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      return jsonb_build_object('ok', false, 'motivo', 'invalido');
    end if;
    begin
      v_fecha := (p_datos->>'fecha')::date;
    exception when others then
      return jsonb_build_object('ok', false, 'motivo', 'invalido');
    end;
    if v_fecha < v_hoy - 60 or v_fecha > v_hoy + 90 then
      return jsonb_build_object('ok', false, 'motivo', 'invalido');
    end if;
  end if;
  if not exists (select 1 from public.clientes where id::text = p_datos->>'cliente_id') then
    return jsonb_build_object('ok', false, 'motivo', 'cliente_inexistente');
  end if;

  update public.pedidos pe
     set cliente_id = x.cliente_id,
         cliente_nombre = left(coalesce(p_datos->>'cliente_nombre', pe.cliente_nombre), 160),
         zona = left(coalesce(p_datos->>'zona', ''), 80),
         vendedor = v_vend,
         items = v_items,
         total = v_total,
         web_estado = 'aceptado', web_revisado_por = v_por, web_revisado_at = now(),
         web_motivo_rechazo = null, web_accion_id = p_accion_id, updated_at = now()
    from jsonb_populate_record(null::public.pedidos, jsonb_build_object('cliente_id', p_datos->'cliente_id')) x
   where pe.id::text = p_pedido_id;
  -- AC-WEB-8: update aparte (asignar un date funciona con fecha date, timestamptz o text).
  if v_fecha is not null then
    update public.pedidos set fecha = v_fecha where id::text = p_pedido_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.admin_resolver_pedido_web(text, text, text, uuid, text, jsonb) from public;
grant execute on function public.admin_resolver_pedido_web(text, text, text, uuid, text, jsonb) to anon, authenticated;

commit;
