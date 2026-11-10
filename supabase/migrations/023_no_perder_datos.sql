-- 023_no_perder_datos.sql — REQ-SEG2 (AC-SEG2-1, AC-SEG2-3, AC-SEG2-5)
-- Hallazgos S-1110-02 / 04 / 05 / 07. Se aplica a mano en el SQL editor de Supabase.
--
-- Qué hace (todo idempotente, sin borrar datos de usuario):
--   1. anon/authenticated pierden DELETE y TRUNCATE sobre clientes, deudas, faltantes, proveedores
--      y pedidos, y se eliminan TODAS las policies de DELETE de esas tablas.
--   2. Tablas de archivo clientes_borrados / faltantes_borrados (copia previa de lo que se borra por RPC).
--   3. RPC admin_borrar_cliente (PIN de admin) y borrar_faltantes (sin PIN, tope 200 ids).
--   4. pedidos.client_uuid + índice único: el alta de un pedido es idempotente.
--   5. movimientos_stock: cantidad acotada y trigger que rechaza 'ajuste'/'inicial' a anon/authenticated;
--      esos tipos solo entran por la RPC admin_registrar_ajustes_stock (PIN de admin).
-- Requisito: 002 (public.verificar_pin). Toda la migración tolera tablas ausentes.

begin;

-- =====================================================================
-- 1. Sin DELETE ni TRUNCATE para anon/authenticated + fuera las policies de DELETE
-- =====================================================================
do $$
declare
  t text;
  pol record;
begin
  foreach t in array array['clientes', 'deudas', 'faltantes', 'proveedores', 'pedidos'] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke delete, truncate on public.%I from anon, authenticated', t);
      for pol in
        select policyname from pg_policies
         where schemaname = 'public' and tablename = t and cmd = 'DELETE'
      loop
        execute format('drop policy if exists %I on public.%I', pol.policyname, t);
      end loop;
    end if;
  end loop;
end $$;

-- =====================================================================
-- 2. Archivo de lo borrado por RPC (solo lo lee el dueño desde el SQL editor)
-- =====================================================================
create table if not exists public.clientes_borrados (
  id          uuid primary key default gen_random_uuid(),
  origen_id   text,
  datos       jsonb not null,
  borrado_por text,
  borrado_en  timestamptz not null default now()
);
create table if not exists public.faltantes_borrados (
  id          uuid primary key default gen_random_uuid(),
  origen_id   text,
  datos       jsonb not null,
  borrado_por text,
  borrado_en  timestamptz not null default now()
);
alter table public.clientes_borrados  enable row level security;
alter table public.faltantes_borrados enable row level security;
revoke all on public.clientes_borrados  from anon, authenticated;
revoke all on public.faltantes_borrados from anon, authenticated;

-- =====================================================================
-- 3a. RPC admin_borrar_cliente (mismo patrón que admin_baja_producto, 007)
-- =====================================================================
create or replace function public.admin_borrar_cliente(p_admin_id text, p_admin_pin text, p_cliente_id text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin_id text := trim(coalesce(p_admin_id, ''));
  v_es_admin boolean;
  v_pin_ok   boolean;
  v_fila     jsonb;
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

  if p_cliente_id is null or length(trim(p_cliente_id)) = 0 or length(p_cliente_id) > 64 then
    return jsonb_build_object('ok', false, 'motivo', 'id_invalido');
  end if;

  select to_jsonb(c) into v_fila from public.clientes c where c.id::text = trim(p_cliente_id);
  if v_fila is null then
    return jsonb_build_object('ok', true, 'ya_borrado', true);
  end if;

  begin
    insert into public.clientes_borrados (origen_id, datos, borrado_por)
    values (trim(p_cliente_id), v_fila, v_admin_id);
    delete from public.clientes where id::text = trim(p_cliente_id);
  exception when foreign_key_violation then
    return jsonb_build_object('ok', false, 'motivo', 'tiene_referencias');
  end;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.admin_borrar_cliente(text, text, text) from public;
grant execute on function public.admin_borrar_cliente(text, text, text) to anon, authenticated;

-- =====================================================================
-- 3b. RPC borrar_faltantes (sin PIN: hoy los borran vendedor y armador). Tope 200 ids.
-- =====================================================================
create or replace function public.borrar_faltantes(p_ids text[])
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_n integer := 0;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return jsonb_build_object('ok', true, 'borrados', 0);
  end if;
  if cardinality(p_ids) > 200 then
    return jsonb_build_object('ok', false, 'motivo', 'demasiados_ids');
  end if;

  -- Tope por ventana (no solo por llamada): max. 200 faltantes borrados en 10 minutos en total,
  -- contados en faltantes_borrados. Iterar ids con la anon key no vacia la tabla.
  if (select count(*) from public.faltantes_borrados
       where borrado_por = 'borrar_faltantes' and borrado_en > now() - interval '10 minutes')
     + cardinality(p_ids) > 200 then
    return jsonb_build_object('ok', false, 'motivo', 'limite_ventana');
  end if;

  insert into public.faltantes_borrados (origen_id, datos, borrado_por)
  select f.id::text, to_jsonb(f), 'borrar_faltantes'
    from public.faltantes f where f.id::text = any(p_ids);
  delete from public.faltantes where id::text = any(p_ids);
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'borrados', v_n);
end $$;

revoke all on function public.borrar_faltantes(text[]) from public;
grant execute on function public.borrar_faltantes(text[]) to anon, authenticated;

-- =====================================================================
-- 4. Pedidos idempotentes: client_uuid único (varios null no chocan)
-- =====================================================================
do $$
begin
  if to_regclass('public.pedidos') is not null then
    alter table public.pedidos add column if not exists client_uuid uuid;
    create unique index if not exists pedidos_client_uuid_uk on public.pedidos (client_uuid);
  end if;
end $$;

-- =====================================================================
-- 5. Ledger: cantidad acotada y ajuste/inicial solo por RPC con PIN
-- =====================================================================
do $$
begin
  if to_regclass('public.movimientos_stock') is not null then
    alter table public.movimientos_stock drop constraint if exists movimientos_cantidad_chk;
    alter table public.movimientos_stock
      add constraint movimientos_cantidad_chk check (cantidad <> 0 and abs(cantidad) <= 1000000) not valid;
  end if;
end $$;

-- SECURITY INVOKER a propósito (sin "security definer"): así current_user es el rol que llama
-- (anon/authenticated). Con definer sería el dueño y el trigger no distinguiría nada.
create or replace function public.tg_movimiento_tipo_admin() returns trigger
language plpgsql as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.tipo in ('inicial', 'ajuste') then
      raise exception 'Los movimientos de tipo % solo se registran con el PIN de admin', new.tipo
        using errcode = '23514';
    end if;
  elsif tg_op = 'UPDATE' then
    if (new.tipo in ('inicial', 'ajuste') or old.tipo in ('inicial', 'ajuste'))
       and (new.tipo is distinct from old.tipo
            or new.cantidad is distinct from old.cantidad
            or new.producto_id is distinct from old.producto_id) then
      raise exception 'Los movimientos de tipo % solo se registran con el PIN de admin', new.tipo
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

do $$
begin
  if to_regclass('public.movimientos_stock') is not null then
    drop trigger if exists movimiento_tipo_admin on public.movimientos_stock;
    create trigger movimiento_tipo_admin before insert or update on public.movimientos_stock
      for each row execute function public.tg_movimiento_tipo_admin();
  end if;
end $$;

-- =====================================================================
-- 5b. RPC admin_registrar_ajustes_stock: ajustes/iniciales con PIN de admin (hasta 500 filas)
-- =====================================================================
create or replace function public.admin_registrar_ajustes_stock(p_admin_id text, p_admin_pin text, p_movs jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin_id text := trim(coalesce(p_admin_id, ''));
  v_es_admin boolean;
  v_pin_ok   boolean;
  v_fila     jsonb;
  v_ids      jsonb := '[]'::jsonb;
  v_id       text;
  v_cant     integer;
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

  if p_movs is null or jsonb_typeof(p_movs) <> 'array' then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;
  if jsonb_array_length(p_movs) > 500 then
    return jsonb_build_object('ok', false, 'motivo', 'demasiadas_filas');
  end if;

  for v_fila in select * from jsonb_array_elements(p_movs) loop
    v_id := v_fila->>'id';
    begin
      if v_id is null or v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or (v_fila->>'tipo') not in ('inicial', 'ajuste')
         or coalesce(v_fila->>'ref', '') !~ '^ajuste:'
         or coalesce(v_fila->>'producto_id', '') = '' then
        continue;
      end if;
      v_cant := (v_fila->>'cantidad')::integer;
      if v_cant is null or v_cant = 0 or abs(v_cant) > 1000000 then
        continue;
      end if;
      insert into public.movimientos_stock (id, producto_id, cantidad, tipo, ref, fecha, usuario, nota)
      values (v_id, v_fila->>'producto_id', v_cant, v_fila->>'tipo', v_fila->>'ref',
              coalesce((v_fila->>'fecha')::timestamptz, now()),
              left(v_fila->>'usuario', 120), left(v_fila->>'nota', 500))
      on conflict (id) do nothing;
      v_ids := v_ids || to_jsonb(v_id);
    exception when check_violation or not_null_violation or invalid_text_representation
              or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
      null; -- fila inválida: se saltea, no se confirma su id
    end;
  end loop;

  return jsonb_build_object('ok', true, 'ids', v_ids);
end $$;

revoke all on function public.admin_registrar_ajustes_stock(text, text, jsonb) from public;
grant execute on function public.admin_registrar_ajustes_stock(text, text, jsonb) to anon, authenticated;

commit;

-- =====================================================================
-- Verificación (correr a mano después de aplicar; no modifican nada)
-- =====================================================================
-- select grantee, table_name, privilege_type from information_schema.role_table_grants
--  where table_schema = 'public' and table_name in ('clientes','deudas','faltantes','proveedores','pedidos')
--    and grantee in ('anon','authenticated') and privilege_type in ('DELETE','TRUNCATE');   -- 0 filas
-- select tablename, policyname from pg_policies where schemaname = 'public' and cmd = 'DELETE'
--    and tablename in ('clientes','deudas','faltantes','proveedores','pedidos');             -- 0 filas
-- select indexname from pg_indexes where indexname = 'pedidos_client_uuid_uk';               -- 1 fila
-- select tgname from pg_trigger where tgname = 'movimiento_tipo_admin';                      -- 1 fila
