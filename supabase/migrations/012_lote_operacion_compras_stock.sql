-- 012_lote_operacion_compras_stock.sql — REQ-INA, REQ-CPR y REQ-STB (lote operacion).
-- Se aplica A MANO en Supabase -> SQL Editor, DESPUES de 010 y 011 y ANTES de publicar la
-- app (hacer backup antes). Idempotente y no destructiva: no borra tablas, columnas ni datos
-- (solo limpia permisos de subida/lectura de comprobantes ya vencidos).
--
-- Contenido:
--  1. productos.stock_minimo + admin_guardar_productos (de la 010) con stock_minimo.
--  2. ingresos_costos: costos y tipo A/B de cada ingreso (1:1). NO van en ingresos_mercaderia
--     (legible con anon): son datos financieros.
--  3. cuenta_proveedores (pagos y cargos; solo se anulan, nunca se editan ni borran).
--  4. pedidos_proveedor (listas de reposicion).
--  5. comprobantes_habilitados + bucket PRIVADO comprobantes-proveedores.
--  6. RPC con PIN de admin: admin_compras_guardar, admin_compras_bajar,
--     admin_comprobante_subida, admin_comprobante_lectura.
--
-- Seguridad (decision autorizada por el duenio): las tablas 2 a 5 tienen RLS activo, SIN
-- policies y SIN grants para anon/authenticated. El unico acceso es por las RPC security
-- definer de arriba, que validan _es_admin_con_pin (011). El bucket es privado: subir y leer
-- exige un permiso corto otorgado por RPC con PIN, sobre el nombre exacto del archivo.

begin;

-- 0. Prerrequisitos
do $$
begin
  if to_regprocedure('public._es_admin_con_pin(text, text)') is null then
    raise exception 'Falta la migracion 011_lote_operacion_facturacion_zonas.sql: aplicarla antes que esta.';
  end if;
  if to_regprocedure('public.admin_guardar_productos(text, text, jsonb)') is null
     or to_regclass('public.cambios_precio') is null then
    raise exception 'Falta la migracion 010_lote_operacion_precios.sql: aplicarla antes que esta.';
  end if;
  if to_regclass('public.ingresos_mercaderia') is null then
    raise exception 'Falta la migracion 001_altas_y_stock.sql.';
  end if;
end $$;

-- 1. Stock minimo (punto de reposicion). Null = se usa "minimo venta" como hoy.
alter table public.productos add column if not exists stock_minimo integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'productos_stock_minimo_chk' and conrelid = 'public.productos'::regclass) then
    alter table public.productos add constraint productos_stock_minimo_chk
      check (stock_minimo is null or stock_minimo >= 0);
  end if;
end $$;

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
  v_pbulto    numeric;
  v_smin      integer;
  v_costo     numeric;
  v_d1        numeric;
  v_d2        numeric;
  v_gan       numeric;
  v_pv2       numeric;
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
      v_pbulto := coalesce((v_fila->>'precio_bulto')::numeric, 0);
      v_smin := nullif(v_fila->>'stock_minimo', '')::integer;
      -- S-012-06: costos acotados (mismo tope MAX_IMPORTE que el dominio). Clave ausente = 0
      -- solo para validar; al actualizar se conserva el valor del servidor (ver abajo).
      v_costo := coalesce((v_fila->>'costo_final')::numeric, 0);
      v_d1 := coalesce((v_fila->>'descuento1')::numeric, 0);
      v_d2 := coalesce((v_fila->>'descuento2')::numeric, 0);
      v_gan := coalesce((v_fila->>'ganancia')::numeric, 0);
      v_pv2 := coalesce((v_fila->>'precio_venta2')::numeric, 0);

      -- S-012-06: numeric acepta 'NaN' e 'Infinity' (PG14+): se rechazan explicitamente
      -- (comparando como texto, para que tambien compile en versiones sin infinito).
      if char_length(v_nombre) < 1 or char_length(v_nombre) > 200
         or v_precio is null or v_precio = 'NaN'::numeric
         or v_precio::text in ('NaN', 'Infinity', '-Infinity')
         or v_pbulto::text in ('NaN', 'Infinity', '-Infinity')
         or v_costo::text in ('NaN', 'Infinity', '-Infinity')
         or v_d1::text in ('NaN', 'Infinity', '-Infinity')
         or v_d2::text in ('NaN', 'Infinity', '-Infinity')
         or v_gan::text in ('NaN', 'Infinity', '-Infinity')
         or v_pv2::text in ('NaN', 'Infinity', '-Infinity')
         or v_precio < 0 or v_precio > 999999999999
         or v_pbulto < 0 or v_pbulto > 999999999999
         or v_costo < 0 or v_costo > 999999999999
         or v_pv2 < 0 or v_pv2 > 999999999999
         or v_d1 < 0 or v_d1 > 100
         or v_d2 < 0 or v_d2 > 100
         or v_gan < 0 or v_gan > 1000
         or (v_smin is not null and (v_smin < 0 or v_smin > 1000000))
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
           bulto_x, minimo_venta, venta_por, bulto_nombre, visible_tienda, precio_bulto, stock_minimo)
        values
          (v_id, v_nombre, coalesce(v_fila->>'codigo', ''), v_precio,
           coalesce(nullif(v_fila->>'unidad', ''), 'unidad'),
           coalesce(v_fila->>'categoria', ''), coalesce(v_fila->>'marca', ''), v_imagen,
           nullif(v_fila->>'proveedor_id', ''),
           v_costo, v_d1, v_d2, v_gan, v_pv2,
           coalesce((v_fila->>'bulto_x')::integer, 1),
           coalesce((v_fila->>'minimo_venta')::integer, 1),
           nullif(v_fila->>'venta_por', ''),
           nullif(v_fila->>'bulto_nombre', ''),
           coalesce((v_fila->>'visible_tienda')::boolean, true),
           v_pbulto, v_smin)
        on conflict (id) do update set
          nombre = excluded.nombre, codigo = excluded.codigo, precio = excluded.precio,
          unidad = excluded.unidad, categoria = excluded.categoria, marca = excluded.marca,
          imagen_url = excluded.imagen_url, proveedor_id = excluded.proveedor_id,
          -- S-012-01: un dispositivo que no bajo los costos (sin PIN) no los manda: se conservan.
          costo_final   = case when v_fila ? 'costo_final' then excluded.costo_final else public.productos.costo_final end,
          descuento1    = case when v_fila ? 'descuento1' then excluded.descuento1 else public.productos.descuento1 end,
          descuento2    = case when v_fila ? 'descuento2' then excluded.descuento2 else public.productos.descuento2 end,
          ganancia      = case when v_fila ? 'ganancia' then excluded.ganancia else public.productos.ganancia end,
          precio_venta2 = case when v_fila ? 'precio_venta2' then excluded.precio_venta2 else public.productos.precio_venta2 end,
          bulto_x = excluded.bulto_x,
          minimo_venta = excluded.minimo_venta, venta_por = excluded.venta_por,
          bulto_nombre = excluded.bulto_nombre, visible_tienda = excluded.visible_tienda,
          precio_bulto = excluded.precio_bulto,
          -- Si la clave no viene en la fila se conserva el valor cargado en otro dispositivo.
          stock_minimo = case when v_fila ? 'stock_minimo' then excluded.stock_minimo else public.productos.stock_minimo end;
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

-- 2. ingresos_costos (1:1 con ingresos_mercaderia). ingreso_id con el mismo tipo (text).
create table if not exists public.ingresos_costos (
  ingreso_id    text primary key references public.ingresos_mercaderia(id) on delete restrict,
  proveedor_id  text not null,
  fecha         timestamptz not null default now(),
  tipo_cabecera text not null check (tipo_cabecera in ('A','B')),
  factura_a     text check (factura_a is null or char_length(factura_a) <= 40),
  factura_b     text check (factura_b is null or char_length(factura_b) <= 40),
  renglones     jsonb not null default '[]'::jsonb check (jsonb_typeof(renglones) = 'array' and pg_column_size(renglones) < 262144),
  updated_at    timestamptz not null default now(),
  updated_by    text,
  -- S-012-02: marca del SERVIDOR (trigger). El cursor de bajada usa esta, no updated_at del cliente.
  synced_at     timestamptz not null default now()
);
create index if not exists ingresos_costos_prov_idx on public.ingresos_costos (proveedor_id, fecha);
create index if not exists ingresos_costos_upd_idx on public.ingresos_costos (updated_at);
alter table public.ingresos_costos enable row level security;
revoke all on public.ingresos_costos from public, anon, authenticated;

-- 3. cuenta_proveedores (cargos y pagos). Monto en centavos enteros.
create table if not exists public.cuenta_proveedores (
  id               uuid primary key,
  proveedor_id     text not null,
  tipo             text not null check (tipo in ('cargo','pago')),
  fecha            date not null,
  monto_centavos   bigint not null check (monto_centavos > 0 and monto_centavos <= 100000000000),
  medio            text check (medio is null or medio in ('efectivo','transferencia','directa')),
  referencia       text check (referencia is null or char_length(referencia) <= 300),
  cliente_id       text,
  pedido_id        text,
  comprobante_path text check (comprobante_path is null or char_length(comprobante_path) <= 200),
  anulado_motivo   text check (anulado_motivo is null or char_length(anulado_motivo) <= 300),
  anulado_por      text,
  anulado_at       timestamptz,
  usuario          text,
  creado_at        timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  synced_at        timestamptz not null default now()
);
create index if not exists cuenta_prov_idx on public.cuenta_proveedores (proveedor_id, fecha);
create index if not exists cuenta_prov_upd_idx on public.cuenta_proveedores (updated_at);
alter table public.cuenta_proveedores enable row level security;
revoke all on public.cuenta_proveedores from public, anon, authenticated;

-- Inmutable: solo se puede agregar el comprobante (una vez) y anular (una vez).
create or replace function public.tg_cuenta_prov_inmutable() returns trigger
language plpgsql as $$
begin
  if new.id is distinct from old.id or new.proveedor_id is distinct from old.proveedor_id
     or new.tipo is distinct from old.tipo or new.fecha is distinct from old.fecha
     or new.monto_centavos is distinct from old.monto_centavos
     or new.medio is distinct from old.medio or new.referencia is distinct from old.referencia
     or new.cliente_id is distinct from old.cliente_id or new.pedido_id is distinct from old.pedido_id then
    raise exception 'cuenta_proveedores es inmutable (solo se anula)';
  end if;
  if old.comprobante_path is not null and new.comprobante_path is distinct from old.comprobante_path then
    raise exception 'el comprobante ya esta cargado';
  end if;
  if old.anulado_at is not null and (new.anulado_at is distinct from old.anulado_at
     or new.anulado_motivo is distinct from old.anulado_motivo or new.anulado_por is distinct from old.anulado_por) then
    raise exception 'el movimiento ya esta anulado';
  end if;
  return new;
end $$;
drop trigger if exists cuenta_prov_inmutable on public.cuenta_proveedores;
create trigger cuenta_prov_inmutable before update on public.cuenta_proveedores
  for each row execute function public.tg_cuenta_prov_inmutable();

-- 4. pedidos_proveedor
create table if not exists public.pedidos_proveedor (
  id           uuid primary key,
  proveedor_id text not null,
  estado       text not null check (estado in ('borrador','enviado','recibido')),
  items        jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and pg_column_size(items) < 262144),
  ingreso_id   text,
  usuario      text,
  creado_at    timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  synced_at    timestamptz not null default now()
);
create index if not exists pedidos_prov_idx on public.pedidos_proveedor (proveedor_id, estado);
create index if not exists pedidos_prov_upd_idx on public.pedidos_proveedor (updated_at);
alter table public.pedidos_proveedor enable row level security;
revoke all on public.pedidos_proveedor from public, anon, authenticated;

-- 4b. S-012-02: synced_at lo pone el servidor en cada insert/update (clock_timestamp, no el
--     reloj del cliente). La bajada pagina por (synced_at, id): un dispositivo que sube tarde
--     con updated_at viejos igual llega a los demas, y el id desempata filas con el mismo instante.
alter table public.ingresos_costos    add column if not exists synced_at timestamptz not null default now();
alter table public.cuenta_proveedores add column if not exists synced_at timestamptz not null default now();
alter table public.pedidos_proveedor  add column if not exists synced_at timestamptz not null default now();
create index if not exists ingresos_costos_sync_idx on public.ingresos_costos (synced_at, ingreso_id);
create index if not exists cuenta_prov_sync_idx on public.cuenta_proveedores (synced_at, id);
create index if not exists pedidos_prov_sync_idx on public.pedidos_proveedor (synced_at, id);

create or replace function public.tg_compras_synced_at() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.synced_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists ingresos_costos_synced_at on public.ingresos_costos;
create trigger ingresos_costos_synced_at before insert or update on public.ingresos_costos
  for each row execute function public.tg_compras_synced_at();
drop trigger if exists cuenta_prov_synced_at on public.cuenta_proveedores;
create trigger cuenta_prov_synced_at before insert or update on public.cuenta_proveedores
  for each row execute function public.tg_compras_synced_at();
drop trigger if exists pedidos_prov_synced_at on public.pedidos_proveedor;
create trigger pedidos_prov_synced_at before insert or update on public.pedidos_proveedor
  for each row execute function public.tg_compras_synced_at();

-- 5. Permisos cortos para el bucket privado de comprobantes.
create table if not exists public.comprobantes_habilitados (
  nombre    text primary key,
  modo      text not null check (modo in ('subir','leer')),
  expira_at timestamptz not null
);
alter table public.comprobantes_habilitados enable row level security;
revoke all on public.comprobantes_habilitados from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes-proveedores', 'comprobantes-proveedores', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.comprobante_habilitado(p_nombre text, p_modo text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(p_nombre ~ '^pagos/[0-9a-f-]{36}-[0-9a-f-]{36}\.(jpg|png|webp|pdf)$', false)
     and exists (select 1 from public.comprobantes_habilitados h
                  where h.nombre = p_nombre and h.modo = p_modo and h.expira_at > now())
$$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'comprob_insert_habilitado') then
    create policy comprob_insert_habilitado on storage.objects for insert to anon, authenticated
      with check (bucket_id = 'comprobantes-proveedores' and public.comprobante_habilitado(name, 'subir'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'comprob_select_habilitado') then
    create policy comprob_select_habilitado on storage.objects for select to anon, authenticated
      using (bucket_id = 'comprobantes-proveedores' and public.comprobante_habilitado(name, 'leer'));
  end if;
end $$;
-- Sin policies de update/delete: nadie pisa ni borra comprobantes con la anon key.

-- 6a. Subir/actualizar lote de compras (costos, cuenta, pedidos). Valida todo en el servidor.
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
         or coalesce(v_fila->>'tipo_cabecera', '') not in ('A','B')
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
           or coalesce(v_ren->>'tipo_factura', '') not in ('A','B')
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

-- 6b. Bajar lo cambiado (S-012-02): cursor por tabla sobre (synced_at, id), que pone el servidor.
--     p_cursor = {"costos": {"ts": ..., "id": ...}, "cuenta": {...}, "pedidos": {...}} (cada uno opcional).
--     Hasta 1000 filas por tabla; el cliente repite con el ultimo (synced_at, id) de las llenas.
create or replace function public.admin_compras_bajar(p_admin_id text, p_admin_pin text, p_cursor jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cur jsonb := case when jsonb_typeof(p_cursor) = 'object' then p_cursor else '{}'::jsonb end;
  v_ts_c timestamptz;
  v_id_c text;
  v_ts_m timestamptz;
  v_id_m text;
  v_ts_p timestamptz;
  v_id_p text;
  v_c jsonb;
  v_m jsonb;
  v_p jsonb;
begin
  if not public._es_admin_con_pin(p_admin_id, p_admin_pin) then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  begin
    v_ts_c := coalesce((v_cur->'costos'->>'ts')::timestamptz, '-infinity'::timestamptz);
    v_ts_m := coalesce((v_cur->'cuenta'->>'ts')::timestamptz, '-infinity'::timestamptz);
    v_ts_p := coalesce((v_cur->'pedidos'->>'ts')::timestamptz, '-infinity'::timestamptz);
  exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
    return jsonb_build_object('ok', false, 'motivo', 'lote_invalido');
  end;
  v_id_c := left(coalesce(v_cur->'costos'->>'id', ''), 64);
  v_id_m := left(coalesce(v_cur->'cuenta'->>'id', ''), 64);
  v_id_p := left(coalesce(v_cur->'pedidos'->>'id', ''), 64);

  select coalesce(jsonb_agg(to_jsonb(t) order by t.synced_at, t.ingreso_id), '[]'::jsonb) into v_c from (
    select ingreso_id, proveedor_id, fecha, tipo_cabecera, factura_a, factura_b, renglones, updated_at, synced_at
      from public.ingresos_costos
     where (synced_at, ingreso_id) > (v_ts_c, v_id_c)
     order by synced_at, ingreso_id limit 1000) t;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.synced_at, t.id::text), '[]'::jsonb) into v_m from (
    select * from public.cuenta_proveedores
     where (synced_at, id::text) > (v_ts_m, v_id_m)
     order by synced_at, id::text limit 1000) t;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.synced_at, t.id::text), '[]'::jsonb) into v_p from (
    select * from public.pedidos_proveedor
     where (synced_at, id::text) > (v_ts_p, v_id_p)
     order by synced_at, id::text limit 1000) t;

  return jsonb_build_object('ok', true, 'costos', v_c, 'cuenta', v_m, 'pedidos', v_p);
end $$;

-- 6c. Permiso para subir un comprobante (10 min). El nombre lo arma el servidor.
create or replace function public.admin_comprobante_subida(p_admin_id text, p_admin_pin text, p_pago_id uuid, p_ext text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ext text := lower(trim(coalesce(p_ext, '')));
  v_nombre text;
begin
  if not public._es_admin_con_pin(p_admin_id, p_admin_pin) then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if v_ext = 'jpeg' then v_ext := 'jpg'; end if;
  if p_pago_id is null or v_ext not in ('jpg','png','webp','pdf') then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;
  delete from public.comprobantes_habilitados where expira_at < now();
  v_nombre := 'pagos/' || p_pago_id::text || '-' || gen_random_uuid()::text || '.' || v_ext;
  insert into public.comprobantes_habilitados (nombre, modo, expira_at)
  values (v_nombre, 'subir', now() + interval '10 minutes');
  return jsonb_build_object('ok', true, 'nombre', v_nombre);
end $$;

-- 6d. Permiso para leer UN comprobante (2 min). No devuelve URLs.
create or replace function public.admin_comprobante_lectura(p_admin_id text, p_admin_pin text, p_nombre text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public._es_admin_con_pin(p_admin_id, p_admin_pin) then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if coalesce(p_nombre, '') !~ '^pagos/[0-9a-f-]{36}-[0-9a-f-]{36}\.(jpg|png|webp|pdf)$' then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;
  delete from public.comprobantes_habilitados where expira_at < now();
  insert into public.comprobantes_habilitados (nombre, modo, expira_at)
  values (p_nombre, 'leer', now() + interval '2 minutes')
  on conflict (nombre) do update set modo = 'leer', expira_at = excluded.expira_at;
  return jsonb_build_object('ok', true);
end $$;

-- 7. Permisos: el PIN de admin es la barrera para las RPC; la funcion de policy solo
--    devuelve boolean.
revoke all on function public.tg_cuenta_prov_inmutable() from public, anon, authenticated;
revoke all on function public.admin_compras_guardar(text, text, jsonb) from public;
grant execute on function public.admin_compras_guardar(text, text, jsonb) to anon, authenticated;
revoke all on function public.admin_compras_bajar(text, text, jsonb) from public;
grant execute on function public.admin_compras_bajar(text, text, jsonb) to anon, authenticated;
revoke all on function public.tg_compras_synced_at() from public, anon, authenticated;
revoke all on function public.admin_comprobante_subida(text, text, uuid, text) from public;
grant execute on function public.admin_comprobante_subida(text, text, uuid, text) to anon, authenticated;
revoke all on function public.admin_comprobante_lectura(text, text, text) from public;
grant execute on function public.admin_comprobante_lectura(text, text, text) to anon, authenticated;
revoke all on function public.comprobante_habilitado(text, text) from public;
grant execute on function public.comprobante_habilitado(text, text) to anon, authenticated;

commit;
