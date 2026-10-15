-- 009_tienda_portada.sql — REQ-POR (portada, ofertas y personalizacion de la tienda).
-- Se aplica A MANO en Supabase -> SQL Editor, DESPUES de 008_tienda.sql (hacer backup
-- antes). Idempotente (if not exists / create or replace / on conflict) y no
-- destructiva: no borra tablas, columnas ni datos existentes.
--
-- Diseno de seguridad:
--  * La app interna no usa Supabase Auth: "solo admin" = RPC security definer que
--    verifican id + PIN del admin con tienda_admin_ok (de la 008).
--  * anon (la tienda) solo lee la vitrina con tienda_portada() / tienda_catalogo().
--    Las tablas nuevas no tienen ningun grant para anon/authenticated.
--  * Imagenes: bucket publico "tienda" (2 MB, jpg/png/webp). Para subir, el admin pide
--    a admin_tienda_subida un nombre aleatorio valido por 10 minutos; la policy de
--    insert solo acepta ese nombre. No hay policy de update ni delete: nadie con la
--    anon key puede pisar ni borrar imagenes.
--  * admin_tienda_guardar valida todo en el servidor (no confia en el navegador).

begin;

-- =====================================================================
-- 0. Prerrequisitos
-- =====================================================================
do $$
begin
  if to_regclass('public.tienda_config') is null
     or to_regprocedure('public.tienda_admin_ok(text, text)') is null
     or to_regprocedure('public.tienda_precio_vigente(text, numeric, date)') is null then
    raise exception 'Falta la migracion 008_tienda.sql: aplicarla antes que esta.';
  end if;
end $$;

-- =====================================================================
-- 1. Config de la tienda (columnas nuevas de tienda_config)
-- =====================================================================
alter table public.tienda_config add column if not exists nombre     text  not null default 'Tienda' check (char_length(nombre) between 1 and 60);
alter table public.tienda_config add column if not exists logo_url   text  check (logo_url is null or (logo_url ~* '^https://' and char_length(logo_url) <= 500));
alter table public.tienda_config add column if not exists color      text  not null default '#0f766e' check (color ~ '^#[0-9a-f]{6}$');
alter table public.tienda_config add column if not exists bienvenida text  not null default '' check (char_length(bienvenida) <= 300);
alter table public.tienda_config add column if not exists contacto   text  not null default '' check (char_length(contacto) <= 200);
alter table public.tienda_config add column if not exists whatsapp   text  not null default '' check (whatsapp ~ '^[0-9]{0,15}$');
alter table public.tienda_config add column if not exists destacados jsonb not null default '[]'::jsonb check (jsonb_typeof(destacados) = 'array');

-- =====================================================================
-- 2. Tablas nuevas (RLS activo, sin grants para anon/authenticated)
-- =====================================================================
create table if not exists public.tienda_banners (
  id            uuid primary key default gen_random_uuid(),
  orden         integer not null default 0,
  imagen_url    text not null check (imagen_url ~* '^https://' and char_length(imagen_url) <= 500),
  titulo        text not null default '' check (char_length(titulo) <= 60),
  subtitulo     text not null default '' check (char_length(subtitulo) <= 120),
  destino_tipo  text not null check (destino_tipo in ('rubro', 'marca', 'producto', 'ofertas')),
  destino_valor text not null default '' check (char_length(destino_valor) <= 120),
  desde         date,
  hasta         date,
  activo        boolean not null default true,
  check (desde is null or hasta is null or desde <= hasta)
);

-- La 008 (tienda_precio_vigente) ya cobra min(precio) de las ofertas vigentes con precio > 0.
-- precio null = oferta sin precio especial (solo aparece en la fila de Ofertas).
create table if not exists public.tienda_ofertas (
  id          uuid primary key default gen_random_uuid(),
  producto_id text not null check (char_length(producto_id) <= 64),
  precio      numeric(14,2) check (precio is null or precio > 0),
  desde       date not null,
  hasta       date not null,
  check (desde <= hasta)
);
create index if not exists tienda_ofertas_producto_idx on public.tienda_ofertas (producto_id, desde, hasta);

create table if not exists public.tienda_subidas (
  nombre    text primary key,
  expira_at timestamptz not null,
  creado_at timestamptz not null default now()
);

alter table public.tienda_banners enable row level security;
alter table public.tienda_ofertas enable row level security;
alter table public.tienda_subidas enable row level security;

revoke all on public.tienda_banners from anon, authenticated;
revoke all on public.tienda_ofertas from anon, authenticated;
revoke all on public.tienda_subidas from anon, authenticated;

-- =====================================================================
-- 3. Bucket de imagenes "tienda" (AC-POR-4)
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tienda', 'tienda', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- La usa la policy de insert: solo nombres habilitados por admin_tienda_subida y vigentes.
create or replace function public.tienda_subida_habilitada(p_nombre text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(p_nombre ~ '^img/[0-9a-f-]{36}\.(jpg|png|webp)$', false)
     and exists (select 1 from public.tienda_subidas s where s.nombre = p_nombre and s.expira_at > now())
$$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'tienda_insert_con_permiso') then
    create policy tienda_insert_con_permiso on storage.objects for insert to anon, authenticated
      with check (bucket_id = 'tienda' and public.tienda_subida_habilitada(name));
  end if;
end $$;
-- Lectura: el bucket es publico (URL /object/public/tienda/...). No se crea policy de
-- select (evita listar el bucket) ni de update/delete (nadie pisa ni borra imagenes).

-- =====================================================================
-- 4. RPC publica: portada (solo datos de vitrina)
-- =====================================================================
create or replace function public.tienda_portada()
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp
set statement_timeout = '3s' as $$
declare
  v_cfg public.tienda_config;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  select * into v_cfg from public.tienda_config where id = 1;
  return jsonb_build_object(
    'ok', true,
    'config', jsonb_build_object(
      'nombre', v_cfg.nombre, 'logo', v_cfg.logo_url, 'color', v_cfg.color,
      'bienvenida', v_cfg.bienvenida, 'contacto', v_cfg.contacto, 'whatsapp', v_cfg.whatsapp,
      'permitirSinStock', v_cfg.permitir_sin_stock, 'destacados', v_cfg.destacados),
    'banners', coalesce((
      select jsonb_agg(jsonb_build_object(
               'imagen', b.imagen_url, 'titulo', b.titulo, 'subtitulo', b.subtitulo, 'orden', b.orden,
               'destino', jsonb_build_object('tipo', b.destino_tipo, 'valor', b.destino_valor))
             order by b.orden, b.id)
        from public.tienda_banners b
       where b.activo and (b.desde is null or b.desde <= v_hoy) and (b.hasta is null or b.hasta >= v_hoy)), '[]'::jsonb),
    'ofertas', coalesce((
      select jsonb_agg(jsonb_build_object('productoId', o.producto_id, 'precio', o.precio, 'desde', o.desde, 'hasta', o.hasta))
        from public.tienda_ofertas o
       where o.desde <= v_hoy and o.hasta >= v_hoy), '[]'::jsonb)
  );
end $$;

-- =====================================================================
-- 5. tienda_catalogo: suma precioAnterior / enOferta (AC-POR-3)
--    Misma seleccion de columnas seguras que la 008 (sin costo, ganancia ni stock exacto).
-- =====================================================================
create or replace function public.tienda_catalogo()
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp
set statement_timeout = '3s' as $$
declare
  v_cfg  public.tienda_config;
  v_hoy  date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_prod jsonb;
begin
  select * into v_cfg from public.tienda_config where id = 1;
  select coalesce(jsonb_agg(x order by x->>'nombre'), '[]'::jsonb) into v_prod from (
    select jsonb_build_object(
      'id',             p.id,
      'codigo',         p.codigo,
      'nombre',         p.nombre,
      'marca',          p.marca,
      'rubro',          p.categoria,
      'imagen',         p.imagen_url,
      'precio',         v.precio,
      'precioAnterior', case when v.precio < p.precio then p.precio else null end,
      'enOferta',       (v.precio < p.precio or exists (
                          select 1 from public.tienda_ofertas o
                           where o.producto_id = p.id::text and o.desde <= v_hoy and o.hasta >= v_hoy)),
      'ventaPor',       public.tienda_venta_por(p.venta_por, p.bulto_x),
      'bultoX',         case when coalesce(p.bulto_x, 0) > 1 then p.bulto_x else null end,
      'bultoNombre',    public.tienda_bulto_nombre(p.bulto_nombre),
      'minimoVenta',    greatest(coalesce(p.minimo_venta, 1), 1),
      'disponible',     (v_cfg.permitir_sin_stock
                         or coalesce((select sum(m.cantidad) from public.movimientos_stock m where m.producto_id = p.id::text), 0) > 0)
    ) as x
    from public.productos p
    cross join lateral (select public.tienda_precio_vigente(p.id::text, p.precio, v_hoy) as precio) v
    where coalesce(p.visible_tienda, true) and p.precio > 0
  ) t;
  return jsonb_build_object('ok', true, 'config', jsonb_build_object('permitirSinStock', v_cfg.permitir_sin_stock), 'productos', v_prod);
end $$;

-- =====================================================================
-- 6. RPC admin: leer / guardar la configuracion (AC-POR-2, AC-POR-5)
-- =====================================================================
create or replace function public.admin_tienda_leer(p_admin_id text, p_admin_pin text)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_cfg public.tienda_config;
begin
  if public.tienda_admin_ok(p_admin_id, p_admin_pin) is null then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  select * into v_cfg from public.tienda_config where id = 1;
  return jsonb_build_object(
    'ok', true,
    'config', jsonb_build_object(
      'nombre', v_cfg.nombre, 'logo', v_cfg.logo_url, 'color', v_cfg.color,
      'bienvenida', v_cfg.bienvenida, 'contacto', v_cfg.contacto, 'whatsapp', v_cfg.whatsapp,
      'permitirSinStock', v_cfg.permitir_sin_stock, 'limitePorHora', v_cfg.limite_por_hora,
      'destacados', v_cfg.destacados),
    'banners', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'imagen', b.imagen_url, 'titulo', b.titulo, 'subtitulo', b.subtitulo,
               'destino', jsonb_build_object('tipo', b.destino_tipo, 'valor', b.destino_valor),
               'desde', b.desde, 'hasta', b.hasta, 'activo', b.activo) order by b.orden, b.id)
        from public.tienda_banners b), '[]'::jsonb),
    'ofertas', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'productoId', o.producto_id, 'precio', o.precio,
               'desde', o.desde, 'hasta', o.hasta) order by o.desde, o.id)
        from public.tienda_ofertas o), '[]'::jsonb)
  );
end $$;

-- Reemplaza config + banners + ofertas en una sola transaccion. Valida en el servidor:
-- formatos, largos, URLs https, destinos, vigencias, topes y que el producto exista.
create or replace function public.admin_tienda_guardar(p_admin_id text, p_admin_pin text, p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp
set statement_timeout = '5s' as $$
declare
  v_c   jsonb := coalesce(p->'config', '{}'::jsonb);
  v_b   jsonb := coalesce(p->'banners', '[]'::jsonb);
  v_o   jsonb := coalesce(p->'ofertas', '[]'::jsonb);
  v_dst jsonb := coalesce(v_c->'destacados', '[]'::jsonb);
  v_lim integer;
  v_x   jsonb;
  v_i   integer := 0;
begin
  if public.tienda_admin_ok(p_admin_id, p_admin_pin) is null then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if jsonb_typeof(v_c) <> 'object' or jsonb_typeof(v_b) <> 'array' or jsonb_typeof(v_o) <> 'array'
     or jsonb_typeof(v_dst) <> 'array' then
    return jsonb_build_object('ok', false, 'motivo', 'invalido', 'campo', 'formato');
  end if;
  if jsonb_array_length(v_b) > 10 then return jsonb_build_object('ok', false, 'motivo', 'invalido', 'campo', 'banners'); end if;
  if jsonb_array_length(v_o) > 200 then return jsonb_build_object('ok', false, 'motivo', 'invalido', 'campo', 'ofertas'); end if;
  if jsonb_array_length(v_dst) > 10
     or exists (select 1 from jsonb_array_elements(v_dst) d
                 where jsonb_typeof(d) <> 'string' or char_length(d #>> '{}') not between 1 and 60) then
    return jsonb_build_object('ok', false, 'motivo', 'invalido', 'campo', 'destacados');
  end if;
  if char_length(trim(coalesce(v_c->>'nombre', ''))) not between 1 and 60 then
    return jsonb_build_object('ok', false, 'motivo', 'invalido', 'campo', 'nombre');
  end if;
  if coalesce(v_c->>'color', '') !~ '^#[0-9a-f]{6}$' then
    return jsonb_build_object('ok', false, 'motivo', 'invalido', 'campo', 'color');
  end if;
  if nullif(v_c->>'logo', '') is not null and ((v_c->>'logo') !~* '^https://' or char_length(v_c->>'logo') > 500) then
    return jsonb_build_object('ok', false, 'motivo', 'invalido', 'campo', 'logo');
  end if;
  if char_length(coalesce(v_c->>'bienvenida', '')) > 300 or char_length(coalesce(v_c->>'contacto', '')) > 200
     or coalesce(v_c->>'whatsapp', '') !~ '^[0-9]{0,15}$' then
    return jsonb_build_object('ok', false, 'motivo', 'invalido', 'campo', 'textos');
  end if;
  begin
    v_lim := (v_c->>'limitePorHora')::integer;
  exception when others then
    v_lim := null;
  end;
  if v_lim is null or v_lim not between 1 and 1000 then
    return jsonb_build_object('ok', false, 'motivo', 'invalido', 'campo', 'limitePorHora');
  end if;

  update public.tienda_config set
    nombre = trim(v_c->>'nombre'),
    logo_url = nullif(v_c->>'logo', ''),
    color = v_c->>'color',
    bienvenida = coalesce(v_c->>'bienvenida', ''),
    contacto = coalesce(v_c->>'contacto', ''),
    whatsapp = coalesce(v_c->>'whatsapp', ''),
    permitir_sin_stock = coalesce((v_c->>'permitirSinStock')::boolean, false),
    limite_por_hora = v_lim,
    destacados = v_dst,
    updated_at = now()
  where id = 1;

  -- Banners: alta/baja/orden = se reemplaza la lista completa (el orden es la posicion).
  delete from public.tienda_banners where true; -- "where true": compatible con pg_safeupdate
  for v_x in select * from jsonb_array_elements(v_b) loop
    if coalesce(v_x->>'imagen', '') !~* '^https://' or char_length(v_x->>'imagen') > 500
       or coalesce(v_x->'destino'->>'tipo', '') not in ('rubro', 'marca', 'producto', 'ofertas')
       or (v_x->'destino'->>'tipo' <> 'ofertas' and char_length(trim(coalesce(v_x->'destino'->>'valor', ''))) = 0)
       or char_length(coalesce(v_x->>'titulo', '')) > 60 or char_length(coalesce(v_x->>'subtitulo', '')) > 120
       or char_length(coalesce(v_x->'destino'->>'valor', '')) > 120 then
      raise exception using errcode = '22023', message = 'banner_invalido';
    end if;
    insert into public.tienda_banners (orden, imagen_url, titulo, subtitulo, destino_tipo, destino_valor, desde, hasta, activo)
    values (v_i, v_x->>'imagen', coalesce(v_x->>'titulo', ''), coalesce(v_x->>'subtitulo', ''),
            v_x->'destino'->>'tipo', case when v_x->'destino'->>'tipo' = 'ofertas' then '' else trim(v_x->'destino'->>'valor') end,
            nullif(v_x->>'desde', '')::date, nullif(v_x->>'hasta', '')::date, coalesce((v_x->>'activo')::boolean, true));
    v_i := v_i + 1;
  end loop;

  -- Ofertas: el producto tiene que existir; precio opcional > 0; vigencia obligatoria.
  delete from public.tienda_ofertas where true;
  for v_x in select * from jsonb_array_elements(v_o) loop
    if char_length(coalesce(v_x->>'productoId', '')) not between 1 and 64
       or not exists (select 1 from public.productos pr where pr.id::text = v_x->>'productoId') then
      raise exception using errcode = '22023', message = 'oferta_invalida';
    end if;
    insert into public.tienda_ofertas (producto_id, precio, desde, hasta)
    values (v_x->>'productoId', nullif(v_x->>'precio', '')::numeric(14,2),
            (v_x->>'desde')::date, (v_x->>'hasta')::date);
  end loop;

  return jsonb_build_object('ok', true);
exception
  when invalid_parameter_value or invalid_datetime_format or datetime_field_overflow
    or invalid_text_representation or check_violation or not_null_violation or numeric_value_out_of_range then
    -- Se revierte todo lo de esta llamada (bloque con excepcion = savepoint).
    return jsonb_build_object('ok', false, 'motivo', 'invalido', 'campo', 'detalle');
end $$;

-- Habilita subir UNA imagen a un nombre aleatorio durante 10 minutos (AC-POR-4).
create or replace function public.admin_tienda_subida(p_admin_id text, p_admin_pin text, p_tipo text)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_ext    text;
  v_nombre text;
begin
  if public.tienda_admin_ok(p_admin_id, p_admin_pin) is null then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  v_ext := case lower(coalesce(p_tipo, ''))
             when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  if v_ext is null then
    return jsonb_build_object('ok', false, 'motivo', 'tipo_invalido');
  end if;
  delete from public.tienda_subidas where expira_at < now() - interval '1 day';
  v_nombre := 'img/' || gen_random_uuid()::text || '.' || v_ext;
  insert into public.tienda_subidas (nombre, expira_at) values (v_nombre, now() + interval '10 minutes');
  return jsonb_build_object('ok', true, 'nombre', v_nombre);
end $$;

-- =====================================================================
-- 7. Permisos de ejecucion
-- =====================================================================
revoke all on function public.tienda_portada()                          from public;
revoke all on function public.tienda_catalogo()                         from public;
revoke all on function public.admin_tienda_leer(text, text)             from public;
revoke all on function public.admin_tienda_guardar(text, text, jsonb)   from public;
revoke all on function public.admin_tienda_subida(text, text, text)     from public;
revoke all on function public.tienda_subida_habilitada(text)            from public;

grant execute on function public.tienda_portada()                        to anon, authenticated;
grant execute on function public.tienda_catalogo()                       to anon, authenticated;
grant execute on function public.admin_tienda_leer(text, text)           to anon, authenticated;
grant execute on function public.admin_tienda_guardar(text, text, jsonb) to anon, authenticated;
grant execute on function public.admin_tienda_subida(text, text, text)   to anon, authenticated;
-- La evalua la policy del bucket con el rol del que sube: devuelve solo un booleano.
grant execute on function public.tienda_subida_habilitada(text)          to anon, authenticated;

commit;
