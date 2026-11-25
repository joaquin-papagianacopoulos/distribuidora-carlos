-- 029_planilla_productos.sql — Lote 2026-11-25: AC-XLS-2, guardar en la app el ultimo Excel de
-- productos subido para que cualquier admin pueda bajarlo.
-- Se aplica a mano en el SQL editor de Supabase. Idempotente. DEPENDE de: 011 (_es_admin_con_pin).
--
--  * Bucket PRIVADO "planillas-productos" (10 MB, xlsx / xls / csv).
--  * Subir y leer exige un permiso corto otorgado por RPC con el PIN de un admin (patron 012,
--    comprobantes de proveedores). El nombre del archivo lo arma el servidor (uuid): el cliente no elige ruta.
--  * Tabla planillas_productos: un registro por Excel subido (historial); "el ultimo" = el mas nuevo.
--    Sin acceso directo para anon/authenticated: todo pasa por las RPC.
--  * Sin policies de update/delete en el bucket: nadie pisa ni borra archivos con la anon key.

do $$
begin
  if to_regprocedure('public._es_admin_con_pin(text, text)') is null then
    raise exception 'Falta la migracion 011: aplicarla antes que esta (_es_admin_con_pin).';
  end if;
end $$;

-- 1. Registro de planillas subidas.
create table if not exists public.planillas_productos (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null unique check (nombre ~ '^productos/[0-9a-f-]{36}\.(xlsx|xls|csv)$'),
  nombre_original text not null check (char_length(nombre_original) between 1 and 150),
  tam_bytes       integer not null check (tam_bytes > 0 and tam_bytes <= 10485760),
  subido_por      text,
  subido_at       timestamptz not null default now()
);
create index if not exists planillas_productos_at_idx on public.planillas_productos (subido_at desc);
alter table public.planillas_productos enable row level security;
revoke all on public.planillas_productos from public, anon, authenticated;

-- 2. Permisos cortos para el bucket.
create table if not exists public.planillas_habilitadas (
  nombre    text primary key,
  modo      text not null check (modo in ('subir','leer')),
  expira_at timestamptz not null
);
alter table public.planillas_habilitadas enable row level security;
revoke all on public.planillas_habilitadas from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('planillas-productos', 'planillas-productos', false, 10485760,
        array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.ms-excel', 'text/csv'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.planilla_habilitada(p_nombre text, p_modo text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(p_nombre ~ '^productos/[0-9a-f-]{36}\.(xlsx|xls|csv)$', false)
     and exists (select 1 from public.planillas_habilitadas h
                  where h.nombre = p_nombre and h.modo = p_modo and h.expira_at > now())
$$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'planillas_insert_habilitada') then
    create policy planillas_insert_habilitada on storage.objects for insert to anon, authenticated
      with check (bucket_id = 'planillas-productos' and public.planilla_habilitada(name, 'subir'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'planillas_select_habilitada') then
    create policy planillas_select_habilitada on storage.objects for select to anon, authenticated
      using (bucket_id = 'planillas-productos' and public.planilla_habilitada(name, 'leer'));
  end if;
end $$;

-- 3. Permiso para subir (10 min). El nombre lo arma el servidor.
create or replace function public.admin_planilla_subida(p_admin_id text, p_admin_pin text, p_ext text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ext text := lower(trim(coalesce(p_ext, '')));
  v_nombre text;
begin
  if not public._es_admin_con_pin(p_admin_id, p_admin_pin) then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if v_ext not in ('xlsx','xls','csv') then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;
  delete from public.planillas_habilitadas where expira_at < now();
  v_nombre := 'productos/' || gen_random_uuid()::text || '.' || v_ext;
  insert into public.planillas_habilitadas (nombre, modo, expira_at)
  values (v_nombre, 'subir', now() + interval '10 minutes');
  return jsonb_build_object('ok', true, 'nombre', v_nombre);
end $$;

-- 4. Confirmar la subida: solo si el archivo existe de verdad en el bucket. Quien subio sale del servidor.
create or replace function public.admin_planilla_confirmar(p_admin_id text, p_admin_pin text, p_nombre text, p_nombre_original text, p_tam integer)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_quien text;
  v_orig text := left(regexp_replace(trim(coalesce(p_nombre_original, '')), '[\x00-\x1f]', '', 'g'), 150);
begin
  if not public._es_admin_con_pin(p_admin_id, p_admin_pin) then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if coalesce(p_nombre, '') !~ '^productos/[0-9a-f-]{36}\.(xlsx|xls|csv)$'
     or length(v_orig) = 0 or p_tam is null or p_tam < 1 or p_tam > 10485760 then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'planillas-productos' and name = p_nombre) then
    return jsonb_build_object('ok', false, 'motivo', 'archivo_inexistente');
  end if;
  select v.nombre into v_quien from public.vendedores v where v.id::text = trim(p_admin_id);
  insert into public.planillas_productos (nombre, nombre_original, tam_bytes, subido_por)
  values (p_nombre, v_orig, p_tam, v_quien)
  on conflict (nombre) do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- 5. El ultimo Excel: datos + permiso para leerlo (2 min). No devuelve URLs.
create or replace function public.admin_planilla_ultima(p_admin_id text, p_admin_pin text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.planillas_productos%rowtype;
begin
  if not public._es_admin_con_pin(p_admin_id, p_admin_pin) then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  select * into r from public.planillas_productos order by subido_at desc, id desc limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'hay', false);
  end if;
  delete from public.planillas_habilitadas where expira_at < now();
  insert into public.planillas_habilitadas (nombre, modo, expira_at)
  values (r.nombre, 'leer', now() + interval '2 minutes')
  on conflict (nombre) do update set modo = 'leer', expira_at = excluded.expira_at;
  return jsonb_build_object('ok', true, 'hay', true, 'nombre', r.nombre, 'nombre_original', r.nombre_original,
                            'tam_bytes', r.tam_bytes, 'subido_por', r.subido_por, 'subido_at', r.subido_at);
end $$;

revoke all on function public.admin_planilla_subida(text, text, text) from public;
grant execute on function public.admin_planilla_subida(text, text, text) to anon, authenticated;
revoke all on function public.admin_planilla_confirmar(text, text, text, text, integer) from public;
grant execute on function public.admin_planilla_confirmar(text, text, text, text, integer) to anon, authenticated;
revoke all on function public.admin_planilla_ultima(text, text) from public;
grant execute on function public.admin_planilla_ultima(text, text) to anon, authenticated;
revoke all on function public.planilla_habilitada(text, text) from public;
grant execute on function public.planilla_habilitada(text, text) to anon, authenticated;
