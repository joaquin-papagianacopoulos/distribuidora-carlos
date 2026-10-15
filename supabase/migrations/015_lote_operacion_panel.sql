-- 015_lote_operacion_panel.sql — REQ-PAN (AC-PAN-1): costo unitario del momento al facturar
-- (lote operacion, RUN 20261015-2019).
-- Se aplica A MANO en Supabase -> SQL Editor, DESPUES de 011, 012 y 013 y ANTES de publicar la
-- app (hacer backup antes). Idempotente y no destructiva: no borra tablas, columnas ni datos.
--
-- Decision de seguridad (delegada por el duenio): el costo lo captura el SERVIDOR con un trigger
-- sobre pedidos y lo guarda en una tabla PRIVADA. pedidos.items (legible con la anon key) nunca
-- lleva costos. El admin los baja con PIN por admin_costos_venta_bajar.
--
--  1. pedidos_costos: por pedido, objeto productoId -> costo neto unitario. RLS on, sin policies,
--     sin grants para anon/authenticated.
--  2. pedidos_costos_errores: registro privado de fallos del trigger (el trigger nunca bloquea
--     el guardado de un pedido, pero el fallo queda anotado y como WARNING en el log).
--  3. _costo_neto_producto: misma formula que calcularPrecioVenta (src/domain/productos.js).
--  4. tg_pedidos_costos_snapshot + trigger en pedidos: el primer costo capturado gana.
--  5. admin_costos_venta_bajar: bajada con PIN de admin, cursor keyset (synced_at, pedido_id).
-- Sin backfill: los pedidos anteriores se muestran como "costo estimado" en el Panel.

begin;

-- 0. Prerrequisitos
do $$
begin
  if to_regprocedure('public._es_admin_con_pin(text, text)') is null then
    raise exception 'Falta la migracion 011_lote_operacion_facturacion_zonas.sql: aplicarla antes que esta.';
  end if;
  if to_regprocedure('public.tg_compras_synced_at()') is null then
    raise exception 'Falta la migracion 012_lote_operacion_compras_stock.sql: aplicarla antes que esta.';
  end if;
  if to_regclass('public.pedidos') is null or to_regclass('public.productos') is null then
    raise exception 'Faltan las tablas pedidos/productos.';
  end if;
end $$;

-- 1. pedidos_costos (sin FK: borrar un pedido no se traba; queda huerfano y el Panel lo ignora)
create table if not exists public.pedidos_costos (
  pedido_id     text primary key check (char_length(pedido_id) between 1 and 64),
  costos        jsonb not null default '{}'::jsonb
                check (jsonb_typeof(costos) = 'object' and pg_column_size(costos) < 262144),
  capturado_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  synced_at     timestamptz not null default now()
);
create index if not exists pedidos_costos_sync_idx on public.pedidos_costos (synced_at, pedido_id);
alter table public.pedidos_costos enable row level security;
revoke all on public.pedidos_costos from public, anon, authenticated;

drop trigger if exists pedidos_costos_synced_at on public.pedidos_costos;
create trigger pedidos_costos_synced_at before insert or update on public.pedidos_costos
  for each row execute function public.tg_compras_synced_at();

-- 2. Errores del trigger (privada, solo se agregan filas)
create table if not exists public.pedidos_costos_errores (
  id         bigint generated always as identity primary key,
  pedido_id  text,
  error      text,
  created_at timestamptz not null default now()
);
alter table public.pedidos_costos_errores enable row level security;
revoke all on public.pedidos_costos_errores from public, anon, authenticated;

-- 3. Costo neto = costo x (1 - d1/100) x (1 - d2/100), redondeado a 2 decimales.
--    Costo vacio o <= 0 => null (sin costo). d1/d2 acotados a 0..100 como en el cliente.
create or replace function public._costo_neto_producto(p_costo numeric, p_d1 numeric, p_d2 numeric)
returns numeric
language sql immutable set search_path = public, pg_temp as $$
  select case
    when p_costo is null or p_costo <= 0 then null
    else round(
      p_costo
      * (1 - least(greatest(coalesce(p_d1, 0), 0), 100) / 100)
      * (1 - least(greatest(coalesce(p_d2, 0), 0), 100) / 100), 2)
  end
$$;
revoke all on function public._costo_neto_producto(numeric, numeric, numeric) from public, anon, authenticated;

-- 4. Trigger de captura. Solo actua con estado = 'facturado' y cuando recien se factura o cambian
--    los items. Agrega los productos que todavia no estan en el snapshot (el primero gana).
--    Nunca bloquea el guardado del pedido: ante un error deja WARNING y una fila en
--    pedidos_costos_errores.
create or replace function public.tg_pedidos_costos_snapshot() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_nuevos jsonb;
begin
  if lower(coalesce(new.estado, '')) <> 'facturado' then
    return new;
  end if;
  -- SEC-PAN-01: solo en la transicion a 'facturado' (INSERT facturado, o UPDATE desde otro estado).
  if tg_op = 'UPDATE' and lower(coalesce(old.estado, '')) = 'facturado' then
    return new;
  end if;
  if new.items is null or jsonb_typeof(new.items) <> 'array' then
    return new;
  end if;

  begin
    select coalesce(jsonb_object_agg(t.pid, t.costo), '{}'::jsonb) into v_nuevos from (
      select distinct on (it.pid) it.pid, public._costo_neto_producto(p.costo_final, p.descuento1, p.descuento2) as costo
        from (
          select case when trim(both '"' from (e->'productoId')::text) ~ '^[0-9]{1,18}$'
                      then trim(both '"' from (e->'productoId')::text)::bigint end as pid
            from jsonb_array_elements(new.items) e
           where jsonb_typeof(e) = 'object'
             and coalesce(e->>'eliminado', 'false') <> 'true'
             and e->'productoId' is not null and jsonb_typeof(e->'productoId') in ('number', 'string')
        ) it
        join public.productos p on p.id = it.pid   -- por pk (sin cast de columna: evita seq scan por pedido)
       where public._costo_neto_producto(p.costo_final, p.descuento1, p.descuento2) is not null
       order by it.pid
    ) t;

    if v_nuevos <> '{}'::jsonb then
      insert into public.pedidos_costos as c (pedido_id, costos)
      values (new.id::text, v_nuevos)
      on conflict (pedido_id) do update
        set costos = excluded.costos || c.costos,   -- prioridad al existente (el primero gana)
            updated_at = now()
        where (excluded.costos || c.costos) is distinct from c.costos;
    end if;
  exception when others then
    raise warning 'pedidos_costos_snapshot fallo para pedido %: % (%)', new.id, sqlerrm, sqlstate;
    begin
      -- SEC-PAN-03: tabla tecnica de logs, se acota a 90 dias al insertar.
      delete from public.pedidos_costos_errores where created_at < now() - interval '90 days';
      insert into public.pedidos_costos_errores (pedido_id, error)
      values (new.id::text, left(sqlstate || ': ' || sqlerrm, 500));
    exception when others then
      raise warning 'pedidos_costos_snapshot no pudo registrar el error: %', sqlerrm;
    end;
  end;
  return new;
end $$;
revoke all on function public.tg_pedidos_costos_snapshot() from public, anon, authenticated;

drop trigger if exists pedidos_costos_snapshot on public.pedidos;
create trigger pedidos_costos_snapshot after insert or update of estado, items on public.pedidos
  for each row execute function public.tg_pedidos_costos_snapshot();

-- 5. Bajada con PIN de admin. Cursor { ts, id } sobre (synced_at, pedido_id), paginas de 1000.
create or replace function public.admin_costos_venta_bajar(p_admin_id text, p_admin_pin text, p_cursor jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cur jsonb := case when jsonb_typeof(p_cursor) = 'object' then p_cursor else '{}'::jsonb end;
  v_ts  timestamptz;
  v_id  text;
  v_c   jsonb;
begin
  if not public._es_admin_con_pin(p_admin_id, p_admin_pin) then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  begin
    v_ts := coalesce((v_cur->'costos'->>'ts')::timestamptz, '-infinity'::timestamptz);
  exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
    return jsonb_build_object('ok', false, 'motivo', 'lote_invalido');
  end;
  v_id := left(coalesce(v_cur->'costos'->>'id', ''), 64);

  select coalesce(jsonb_agg(jsonb_build_object(
           'pedido_id', t.pedido_id, 'costos', t.costos,
           'capturado_at', t.capturado_at, 'synced_at', t.synced_at)
           order by t.synced_at, t.pedido_id), '[]'::jsonb) into v_c from (
    select * from public.pedidos_costos
     where (synced_at, pedido_id) > (v_ts, v_id)
     order by synced_at, pedido_id limit 1000) t;

  return jsonb_build_object('ok', true, 'costos', v_c);
end $$;
revoke all on function public.admin_costos_venta_bajar(text, text, jsonb) from public;
grant execute on function public.admin_costos_venta_bajar(text, text, jsonb) to anon, authenticated;

commit;
