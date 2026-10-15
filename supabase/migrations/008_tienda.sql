-- 008_tienda.sql — REQ-TIE + REQ-WEB (tienda publica y bandeja "Pedidos web").
-- Corrida 20261014-2100. Se aplica A MANO en Supabase -> SQL Editor (hacer backup
-- antes). Es idempotente (if not exists / create or replace) y no destructiva:
-- no borra tablas, columnas, policies ni datos.
--
-- ORDEN DE APLICACION: 001, 002 PASO 1, 004, 006 y despues esta 008. Si falta algo
-- aborta al principio sin tocar nada.
--
-- Diseno de seguridad:
--  * La tienda (anon, sin login) SOLO usa dos RPC security definer:
--    tienda_catalogo() y tienda_crear_pedido(jsonb). Las tablas nuevas no tienen
--    ningun grant para anon/authenticated.
--  * El servidor RECALCULA precios, bultos y totales; precioVisto solo sirve para
--    detectar cambios y devolver el carrito corregido.
--  * Un trigger impide que la app interna (anon key) fabrique o pise pedidos web.
--  * Aceptar/rechazar pasa por admin_resolver_pedido_web (PIN del admin + for update).
--
-- S-WEB-01: los datos de contacto del consumidor final NO viven en pedidos (que la
-- app interna lee con la anon key) sino en public.pedidos_web_contacto, sin ningun
-- grant para anon/authenticated. Los escribe solo tienda_crear_pedido y se leen
-- unicamente con la RPC admin_listar_pedidos_web (PIN del admin).

begin;

-- =====================================================================
-- 0. Prerrequisitos
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

create extension if not exists pgcrypto with schema extensions;

-- =====================================================================
-- 1. Columnas nuevas de pedidos
-- =====================================================================
alter table public.pedidos add column if not exists origen             text not null default 'interna';
alter table public.pedidos add column if not exists web_estado         text;
alter table public.pedidos add column if not exists web_revisado_por   text;
alter table public.pedidos add column if not exists web_revisado_at    timestamptz;
alter table public.pedidos add column if not exists web_motivo_rechazo text;
alter table public.pedidos add column if not exists idempotencia       uuid;
alter table public.pedidos add column if not exists web_accion_id      uuid;

do $$ begin
  alter table public.pedidos add constraint pedidos_origen_chk check (origen in ('interna', 'web')) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.pedidos add constraint pedidos_web_estado_chk
    check (web_estado is null or web_estado in ('por_revisar', 'aceptado', 'rechazado')) not valid;
exception when duplicate_object then null; end $$;

create unique index if not exists pedidos_idempotencia_uq on public.pedidos (idempotencia) where idempotencia is not null;
create index if not exists pedidos_web_estado_idx on public.pedidos (web_estado) where origen = 'web';

-- =====================================================================
-- 2. Trigger: la app interna (anon/authenticated) no puede crear ni pisar datos web
-- =====================================================================
create or replace function public.tg_pedidos_web_guard()
returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.origen := 'interna';
      new.web_estado := null;
      new.web_revisado_por := null;
      new.web_revisado_at := null;
      new.web_motivo_rechazo := null;
      new.idempotencia := null;
      new.web_accion_id := null;
    else
      -- Un pedido web que no esta aceptado no se toca desde el sync generico
      -- (no puede pasar a facturado ni cambiar renglones): devuelve OLD sin error.
      if old.origen = 'web' and coalesce(old.web_estado, '') <> 'aceptado' then
        return old;
      end if;
      new.origen := old.origen;
      new.web_estado := old.web_estado;
      new.web_revisado_por := old.web_revisado_por;
      new.web_revisado_at := old.web_revisado_at;
      new.web_motivo_rechazo := old.web_motivo_rechazo;
      new.idempotencia := old.idempotencia;
      new.web_accion_id := old.web_accion_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tg_pedidos_web_guard on public.pedidos;
create trigger tg_pedidos_web_guard before insert or update on public.pedidos
  for each row execute function public.tg_pedidos_web_guard();

-- =====================================================================
-- 3. Tablas nuevas (RLS activo, sin grants para anon/authenticated)
-- =====================================================================
create table if not exists public.tienda_config (
  id                   integer primary key check (id = 1),
  permitir_sin_stock   boolean not null default false,
  limite_por_hora      integer not null default 5 check (limite_por_hora between 1 and 1000),
  max_renglones        integer not null default 150 check (max_renglones between 1 and 150),
  max_unidades_renglon integer check (max_unidades_renglon is null or max_unidades_renglon between 1 and 1000000),
  max_total            numeric(14,2) check (max_total is null or max_total > 0),
  limite_global_por_hora integer not null default 60 check (limite_global_por_hora between 1 and 100000),
  updated_at           timestamptz not null default now()
);
alter table public.tienda_config add column if not exists limite_global_por_hora integer not null default 60;
insert into public.tienda_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.tienda_secretos (
  id  integer primary key check (id = 1),
  sal text not null
);
insert into public.tienda_secretos (id, sal)
  values (1, encode(extensions.gen_random_bytes(24), 'hex')) on conflict (id) do nothing;

create table if not exists public.vendedores_tienda_tokens (
  token       text primary key,
  vendedor_id text not null,
  creado_at   timestamptz not null default now(),
  revocado_at timestamptz
);
create index if not exists vendedores_tienda_tokens_vendedor_idx on public.vendedores_tienda_tokens (vendedor_id);

create table if not exists public.tienda_intentos (
  id          uuid primary key default gen_random_uuid(),
  origen_hash text not null,
  creado_at   timestamptz not null default now()
);
create index if not exists tienda_intentos_origen_idx on public.tienda_intentos (origen_hash, creado_at);

create table if not exists public.pedidos_web_contacto (
  pedido_id  text primary key,
  contacto   jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists movimientos_stock_producto_idx on public.movimientos_stock (producto_id);

alter table public.pedidos_web_contacto     enable row level security;
alter table public.tienda_config            enable row level security;
alter table public.tienda_secretos          enable row level security;
alter table public.vendedores_tienda_tokens enable row level security;
alter table public.tienda_intentos          enable row level security;

revoke all on public.pedidos_web_contacto     from anon, authenticated;
revoke all on public.tienda_config            from anon, authenticated;
revoke all on public.tienda_secretos          from anon, authenticated;
revoke all on public.vendedores_tienda_tokens from anon, authenticated;
revoke all on public.tienda_intentos          from anon, authenticated;

-- =====================================================================
-- 4. Helpers internos (sin grant: solo los usan las RPC definer)
-- =====================================================================
create or replace function public.tienda_venta_por(p_venta_por text, p_bulto_x integer)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when lower(coalesce(p_venta_por, '')) = 'bulto' and coalesce(p_bulto_x, 0) > 1 then 'bulto'
    when lower(coalesce(p_venta_por, '')) = 'ambos' and coalesce(p_bulto_x, 0) > 1 then 'ambos'
    when lower(coalesce(p_venta_por, '')) = 'unidad' then 'unidad'
    when coalesce(p_bulto_x, 0) > 1 and nullif(trim(coalesce(p_venta_por, '')), '') is null then 'ambos'
    else 'unidad'
  end
$$;

create or replace function public.tienda_bulto_nombre(p_nombre text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select coalesce((select n from unnest(array['Bulto', 'Display', 'Caja', 'Pack']) n
                    where lower(n) = lower(trim(coalesce(p_nombre, '')))), 'Bulto')
$$;

-- Oferta vigente (REQ-POR, corrida siguiente): tolera que tienda_ofertas no exista todavia.
create or replace function public.tienda_precio_vigente(p_producto_id text, p_precio numeric, p_hoy date)
returns numeric
language plpgsql stable set search_path = public, pg_temp as $$
declare v numeric;
begin
  if to_regclass('public.tienda_ofertas') is null then
    return p_precio;
  end if;
  begin
    execute 'select min(precio) from public.tienda_ofertas where producto_id::text = $1 and desde <= $2 and hasta >= $2 and precio > 0'
      into v using p_producto_id, p_hoy;
  exception when others then
    v := null;
  end;
  return coalesce(least(v, p_precio), p_precio);
end $$;

create or replace function public.tienda_admin_ok(p_admin_id text, p_admin_pin text)
returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_id  text := trim(coalesce(p_admin_id, ''));
  v_es  boolean;
  v_ok  boolean;
  v_nom text;
begin
  if length(v_id) = 0 or length(v_id) > 64 then return null; end if;
  select true, nombre into v_es, v_nom from public.vendedores
   where id::text = v_id and permiso = 1 and activo and pin_hash is not null;
  v_ok := coalesce(public.verificar_pin(v_id, p_admin_pin), false);
  if not v_ok or not coalesce(v_es, false) then return null; end if;
  return coalesce(v_nom, 'admin');
end $$;

-- =====================================================================
-- 5. RPC publica: catalogo (solo columnas seguras; sin costo, ganancia ni stock exacto)
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
      'id',          p.id,
      'codigo',      p.codigo,
      'nombre',      p.nombre,
      'marca',       p.marca,
      'rubro',       p.categoria,
      'imagen',      p.imagen_url,
      'precio',      public.tienda_precio_vigente(p.id::text, p.precio, v_hoy),
      'ventaPor',    public.tienda_venta_por(p.venta_por, p.bulto_x),
      'bultoX',      case when coalesce(p.bulto_x, 0) > 1 then p.bulto_x else null end,
      'bultoNombre', public.tienda_bulto_nombre(p.bulto_nombre),
      'minimoVenta', greatest(coalesce(p.minimo_venta, 1), 1),
      'disponible',  (v_cfg.permitir_sin_stock
                      or coalesce((select sum(m.cantidad) from public.movimientos_stock m where m.producto_id = p.id::text), 0) > 0)
    ) as x
    from public.productos p
    where coalesce(p.visible_tienda, true) and p.precio > 0
  ) t;
  return jsonb_build_object('ok', true, 'config', jsonb_build_object('permitirSinStock', v_cfg.permitir_sin_stock), 'productos', v_prod);
end $$;

-- =====================================================================
-- 6. RPC publica: crear pedido (recalcula todo en el servidor)
--    Orden: idempotencia -> honeypot -> topes -> limite/hora -> recalculo ->
--    comparacion con lo visto -> insert. Reglas = src/domain/tienda.js.
--    Respuestas: {ok:true,pedidoId,total,repetido}, {ok:false,motivo:
--    'invalido'|'tope'|'limite'|'cambio', carrito?}.
-- =====================================================================
create or replace function public.tienda_crear_pedido(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_cfg       public.tienda_config;
  v_idem      uuid;
  v_existente record;
  v_contacto  jsonb;
  v_items     jsonb;
  v_e         jsonb;
  v_pid       text;
  v_cant      bigint;
  v_modo      text;
  v_prod      record;
  v_unid      bigint;
  v_acum      jsonb := '{}'::jsonb;
  v_visto     jsonb := '{}'::jsonb;
  v_faltan    jsonb := '[]'::jsonb;
  v_k         text;
  v_u         bigint;
  v_vp        text;
  v_bx        integer;
  v_min       integer;
  v_disp      boolean;
  v_precio    numeric;
  v_cent      bigint;
  v_total_c   bigint := 0;
  v_cambio    boolean := false;
  v_ren_ped   jsonb := '[]'::jsonb;
  v_ren_cor   jsonb := '[]'::jsonb;
  v_tope_u    integer;
  v_hoy       date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_headers   json;
  v_ip        text;
  v_hash      text;
  v_sal       text;
  v_token     text := nullif(trim(coalesce(p->>'token', '')), '');
  v_vendedor  text := '';
  v_nombre    text;
  v_item      jsonb;
  v_pedido_id text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return jsonb_build_object('ok', false, 'motivo', 'invalido');
  end if;
  select * into v_cfg from public.tienda_config where id = 1;

  -- 1) Idempotencia: el mismo id devuelve el mismo pedido.
  begin
    v_idem := (p->>'idempotencia')::uuid;
  exception when others then
    v_idem := null;
  end;
  if v_idem is null then
    return jsonb_build_object('ok', false, 'motivo', 'invalido');
  end if;
  select id::text as id, total into v_existente from public.pedidos where idempotencia = v_idem;
  if found then
    return jsonb_build_object('ok', true, 'pedidoId', v_existente.id, 'total', v_existente.total, 'repetido', true);
  end if;

  -- 2) Honeypot: respuesta generica, no crea nada.
  if coalesce(p->>'hp', '') <> '' then
    return jsonb_build_object('ok', false, 'motivo', 'invalido');
  end if;

  -- 3) Topes y datos de contacto.
  v_items := p->'items';
  v_contacto := p->'contacto';
  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) < 1 then
    return jsonb_build_object('ok', false, 'motivo', 'invalido');
  end if;
  if jsonb_array_length(v_items) > v_cfg.max_renglones then
    return jsonb_build_object('ok', false, 'motivo', 'tope');
  end if;
  if v_contacto is null or jsonb_typeof(v_contacto) <> 'object'
     or char_length(trim(coalesce(v_contacto->>'nombre', ''))) not between 1 and 120
     or char_length(trim(coalesce(v_contacto->>'telefono', ''))) not between 6 and 30
     or char_length(trim(coalesce(v_contacto->>'direccion', ''))) not between 1 and 160
     or char_length(trim(coalesce(v_contacto->>'ciudad', ''))) not between 1 and 80
     or char_length(coalesce(v_contacto->>'cp', '')) > 10
     or char_length(coalesce(v_contacto->>'provincia', '')) > 40
     or char_length(coalesce(v_contacto->>'cuit', '')) > 20
     or char_length(coalesce(v_contacto->>'observaciones', '')) > 500 then
    return jsonb_build_object('ok', false, 'motivo', 'invalido');
  end if;
  v_contacto := jsonb_build_object(
    'nombre',        left(trim(v_contacto->>'nombre'), 120),
    'telefono',      left(trim(v_contacto->>'telefono'), 30),
    'direccion',     left(trim(v_contacto->>'direccion'), 160),
    'ciudad',        left(trim(v_contacto->>'ciudad'), 80),
    'cp',            left(trim(coalesce(v_contacto->>'cp', '')), 10),
    'provincia',     left(trim(coalesce(v_contacto->>'provincia', '')), 40),
    'cuit',          left(trim(coalesce(v_contacto->>'cuit', '')), 20),
    'observaciones', left(trim(coalesce(v_contacto->>'observaciones', '')), 500)
  );

  -- 4) Limite por hora y por origen (la IP nunca se guarda en claro: hash con sal).
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_headers := null;
  end;
  -- S-TIE-01: el cliente puede mandar su propio x-forwarded-for; el proxy confiable
  -- agrega la IP real al FINAL. Se usa cf-connecting-ip o el ULTIMO elemento.
  v_ip := trim(coalesce(nullif(trim(v_headers->>'cf-connecting-ip'), ''),
                        nullif(regexp_replace(coalesce(v_headers->>'x-forwarded-for', ''), '^.*,\s*', ''), ''),
                        v_headers->>'x-real-ip', ''));
  select sal into v_sal from public.tienda_secretos where id = 1;
  v_hash := encode(extensions.digest(v_ip || coalesce(v_sal, ''), 'sha256'), 'hex');
  -- S-TIE-02: un lock transaccional serializa contar+insertar (sin rafagas paralelas).
  perform pg_advisory_xact_lock(hashtext('tienda:limite'));
  delete from public.tienda_intentos where creado_at < now() - interval '2 days';
  -- Sin IP identificable no hay bucket propio (evita bloqueo mutuo): rige solo el tope global.
  if v_ip <> '' and (select count(*) from public.tienda_intentos
       where origen_hash = v_hash and creado_at > now() - interval '1 hour') >= v_cfg.limite_por_hora then
    return jsonb_build_object('ok', false, 'motivo', 'limite');
  end if;
  if (select count(*) from public.tienda_intentos
       where creado_at > now() - interval '1 hour') >= v_cfg.limite_global_por_hora then
    return jsonb_build_object('ok', false, 'motivo', 'limite');
  end if;

  -- 5) Recalculo: suma de unidades por producto (renglones repetidos se unifican).
  v_tope_u := coalesce(v_cfg.max_unidades_renglon, 1000000);
  for v_e in select value from jsonb_array_elements(v_items) loop
    if jsonb_typeof(v_e) <> 'object' then
      return jsonb_build_object('ok', false, 'motivo', 'invalido');
    end if;
    v_pid := v_e->>'productoId';
    if v_pid is null or v_pid !~ '^[0-9]{1,15}$' or coalesce(v_e->>'cantidad', '') !~ '^[0-9]{1,7}$' then
      return jsonb_build_object('ok', false, 'motivo', 'invalido');
    end if;
    v_pid := (v_pid::bigint)::text;  -- S-TIE-03: "07" y "7" son el mismo producto
    v_cant := (v_e->>'cantidad')::bigint;
    v_modo := coalesce(v_e->>'modo', 'unidad');
    if v_cant < 1 or v_modo not in ('unidad', 'bulto') then
      return jsonb_build_object('ok', false, 'motivo', 'invalido');
    end if;
    select p2.bulto_x, p2.venta_por into v_prod from public.productos p2
     where p2.id = v_pid::bigint and coalesce(p2.visible_tienda, true) and p2.precio > 0;
    if not found then
      v_faltan := v_faltan || to_jsonb(v_pid);
      continue;
    end if;
    v_unid := v_cant;
    if v_modo = 'bulto' then
      if public.tienda_venta_por(v_prod.venta_por, v_prod.bulto_x) = 'unidad' then
        return jsonb_build_object('ok', false, 'motivo', 'invalido');
      end if;
      v_unid := v_cant * v_prod.bulto_x;
    end if;
    v_unid := v_unid + coalesce((v_acum->>v_pid)::bigint, 0);
    if v_unid > 1000000 then
      return jsonb_build_object('ok', false, 'motivo', 'tope');
    end if;
    v_acum := jsonb_set(v_acum, array[v_pid], to_jsonb(v_unid));
    if not (v_visto ? v_pid) then
      v_visto := jsonb_set(v_visto, array[v_pid], coalesce(v_e->'precioVisto', 'null'::jsonb));
    end if;
  end loop;

  v_cambio := jsonb_array_length(v_faltan) > 0;
  for v_k in select key from jsonb_each(v_acum) loop
    select p3.id, p3.nombre, p3.precio, p3.bulto_x, p3.minimo_venta, p3.venta_por, p3.bulto_nombre into v_prod
      from public.productos p3 where p3.id = v_k::bigint;
    v_u      := (v_acum->>v_k)::bigint;
    v_vp     := public.tienda_venta_por(v_prod.venta_por, v_prod.bulto_x);
    v_bx     := case when coalesce(v_prod.bulto_x, 0) > 1 then v_prod.bulto_x else null end;
    v_min    := greatest(coalesce(v_prod.minimo_venta, 1), 1);
    v_precio := public.tienda_precio_vigente(v_k, v_prod.precio, v_hoy);
    v_cent   := round(v_precio * 100)::bigint;
    v_disp   := v_cfg.permitir_sin_stock
                or coalesce((select sum(m.cantidad) from public.movimientos_stock m where m.producto_id = v_k), 0) > 0;
    -- Reglas: minimo, multiplo si es solo bulto, tope por renglon, disponibilidad.
    if v_u < v_min or (v_vp = 'bulto' and v_bx is not null and v_u % v_bx <> 0) or v_u > v_tope_u or not v_disp then
      v_cambio := true;
    end if;
    -- Precio distinto de lo que vio el cliente.
    if jsonb_typeof(v_visto->v_k) = 'number' and round((v_visto->>v_k)::numeric * 100)::bigint <> v_cent then
      v_cambio := true;
    end if;
    v_total_c := v_total_c + v_cent * v_u;
    v_item := jsonb_build_object('productoId', to_jsonb(v_prod.id), 'nombre', v_prod.nombre,
                                 'cantidad', v_u, 'precio', v_cent::numeric / 100, 'subtotal', (v_cent * v_u)::numeric / 100);
    if v_vp <> 'unidad' and v_bx is not null and v_u % v_bx = 0 then
      v_item := v_item || jsonb_build_object('bultos', v_u / v_bx, 'bultoX', v_bx,
                                             'bultoNombre', public.tienda_bulto_nombre(v_prod.bulto_nombre));
    end if;
    v_ren_ped := v_ren_ped || v_item;
    v_ren_cor := v_ren_cor || jsonb_build_object('productoId', to_jsonb(v_prod.id), 'unidades', v_u,
                                                 'precio', v_cent::numeric / 100, 'disponible', v_disp);
  end loop;

  if jsonb_array_length(v_ren_ped) > v_cfg.max_renglones
     or (v_cfg.max_total is not null and v_total_c > round(v_cfg.max_total * 100))
     or v_total_c > 100000000000 then
    return jsonb_build_object('ok', false, 'motivo', 'tope');
  end if;
  if jsonb_array_length(v_ren_ped) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'cambio',
                              'carrito', jsonb_build_object('renglones', '[]'::jsonb, 'total', 0, 'faltan', v_faltan));
  end if;

  -- 6) Algo cambio respecto de lo que vio el cliente: NO se crea; se devuelve el carrito corregido.
  if v_cambio then
    return jsonb_build_object('ok', false, 'motivo', 'cambio',
                              'carrito', jsonb_build_object('renglones', v_ren_cor, 'total', v_total_c::numeric / 100, 'faltan', v_faltan));
  end if;

  -- 7) Vendedor del token (invalido o de un vendedor dado de baja => link general, misma respuesta).
  if v_token is not null and char_length(v_token) <= 100 then
    select ve.nombre into v_nombre
      from public.vendedores_tienda_tokens t
      join public.vendedores ve on ve.id::text = t.vendedor_id
     where t.token = v_token and t.revocado_at is null and ve.activo;
    v_vendedor := coalesce(v_nombre, '');
  end if;

  insert into public.tienda_intentos (origen_hash) values (v_hash);
  begin
    insert into public.pedidos (cliente_nombre, vendedor, zona, fecha, items, total, estado,
                                origen, web_estado, idempotencia, updated_at)
    values (v_contacto->>'nombre', v_vendedor, '', v_hoy, v_ren_ped, v_total_c::numeric / 100, 'pendiente',
            'web', 'por_revisar', v_idem, now())
    returning id::text into v_pedido_id;
    insert into public.pedidos_web_contacto (pedido_id, contacto) values (v_pedido_id, v_contacto);
  exception when unique_violation then
    -- Doble clic concurrente: gano el otro; devolvemos el mismo pedido.
    select id::text as id, total into v_existente from public.pedidos where idempotencia = v_idem;
    return jsonb_build_object('ok', true, 'pedidoId', v_existente.id, 'total', v_existente.total, 'repetido', true);
  end;

  return jsonb_build_object('ok', true, 'pedidoId', v_pedido_id, 'total', v_total_c::numeric / 100,
                            'repetido', false, 'renglones', v_ren_ped);
end $$;

-- =====================================================================
-- 7. RPC admin: aceptar / rechazar de forma atomica (AC-WEB-6)
--    Respuestas: {ok:true[,repetido:true]} | {ok:false,motivo:'no_autorizado'|
--    'no_encontrado'|'invalido'|'cliente_inexistente'|'ya_resuelto', ...}
-- =====================================================================
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
  return jsonb_build_object('ok', true);
end $$;

-- Contactos de pedidos web (S-WEB-01): solo admin con PIN. Devuelve {ok, contactos:{id:{...}}}.
create or replace function public.admin_listar_pedidos_web(p_admin_id text, p_admin_pin text, p_ids text[])
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if public.tienda_admin_ok(p_admin_id, p_admin_pin) is null then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) > 500 then
    return jsonb_build_object('ok', false, 'motivo', 'invalido');
  end if;
  return jsonb_build_object('ok', true, 'contactos', coalesce((
    select jsonb_object_agg(c.pedido_id, c.contacto)
      from public.pedidos_web_contacto c where c.pedido_id = any (p_ids)), '{}'::jsonb));
end $$;

-- =====================================================================
-- 8. RPC admin: links por vendedor (token aleatorio de 256 bits, regenerable)
-- =====================================================================
create or replace function public.admin_token_tienda(
  p_admin_id text, p_admin_pin text, p_vendedor_id text, p_regenerar boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_token text;
begin
  if public.tienda_admin_ok(p_admin_id, p_admin_pin) is null then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if p_vendedor_id is null or char_length(p_vendedor_id) > 64
     or not exists (select 1 from public.vendedores where id::text = p_vendedor_id and activo) then
    return jsonb_build_object('ok', false, 'motivo', 'vendedor_invalido');
  end if;
  select token into v_token from public.vendedores_tienda_tokens
   where vendedor_id = p_vendedor_id and revocado_at is null order by creado_at desc limit 1;
  if v_token is not null and not coalesce(p_regenerar, false) then
    return jsonb_build_object('ok', true, 'token', v_token);
  end if;
  update public.vendedores_tienda_tokens set revocado_at = now()
   where vendedor_id = p_vendedor_id and revocado_at is null;
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.vendedores_tienda_tokens (token, vendedor_id) values (v_token, p_vendedor_id);
  return jsonb_build_object('ok', true, 'token', v_token);
end $$;

create or replace function public.admin_listar_tokens_tienda(p_admin_id text, p_admin_pin text)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if public.tienda_admin_ok(p_admin_id, p_admin_pin) is null then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  return jsonb_build_object('ok', true, 'tokens', coalesce((
    select jsonb_agg(jsonb_build_object('vendedor_id', t.vendedor_id, 'token', t.token))
      from public.vendedores_tienda_tokens t where t.revocado_at is null), '[]'::jsonb));
end $$;

-- =====================================================================
-- 9. Permisos de ejecucion
-- =====================================================================
revoke all on function public.tienda_venta_por(text, integer)               from public, anon, authenticated;
revoke all on function public.tienda_bulto_nombre(text)                     from public, anon, authenticated;
revoke all on function public.tienda_precio_vigente(text, numeric, date)    from public, anon, authenticated;
revoke all on function public.tienda_admin_ok(text, text)                   from public, anon, authenticated;
revoke all on function public.tienda_catalogo()                             from public;
revoke all on function public.tienda_crear_pedido(jsonb)                    from public;
revoke all on function public.admin_resolver_pedido_web(text, text, text, uuid, text, jsonb) from public;
revoke all on function public.admin_token_tienda(text, text, text, boolean) from public;
revoke all on function public.admin_listar_tokens_tienda(text, text)        from public;
revoke all on function public.admin_listar_pedidos_web(text, text, text[])   from public;

grant execute on function public.tienda_catalogo()          to anon, authenticated;
grant execute on function public.tienda_crear_pedido(jsonb) to anon, authenticated;
grant execute on function public.admin_resolver_pedido_web(text, text, text, uuid, text, jsonb) to anon, authenticated;
grant execute on function public.admin_token_tienda(text, text, text, boolean) to anon, authenticated;
grant execute on function public.admin_listar_tokens_tienda(text, text)        to anon, authenticated;
grant execute on function public.admin_listar_pedidos_web(text, text, text[])   to anon, authenticated;

commit;
