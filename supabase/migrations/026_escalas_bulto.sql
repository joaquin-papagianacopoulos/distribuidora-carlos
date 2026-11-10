-- 026_escalas_bulto.sql — Tanda 3 (2026-11-10): REQ-ESC, descuento por escala de bultos.
-- NO SE APLICA AUTOMATICAMENTE: se corre a mano en Supabase -> SQL Editor, DESPUES de la 025
-- (hacer backup antes). DEPENDE de: 010 (tienda_catalogo), 022 (admin_guardar_productos) y
-- 024 (tienda_crear_pedido, y por ende la 019): reemplaza esas tres RPC como copia fiel + la escala. Idempotente (re-ejecutable) y no destructiva: no borra datos ni revoca grants.
-- La app sigue funcionando sin esta migracion: las escalas quedan solo en el dispositivo.
-- Despues de aplicarla, correr supabase/verificacion/026_escalas_casos.sql: tiene que dar 0 filas.
--
--  1. productos.escalas_bulto (jsonb, opcional): [{"desde":5,"pct":8}, ...] hasta 3 escalas.
--     Es publica (no es un costo): grant select por columna como pide la 013.
--  2. Helpers (sin grant para anon; los usan las RPC definer):
--     escalas_bulto_normalizar, tienda_escala_alcanzada, tienda_escala_pct, tienda_precio_con_escala.
--     Espejo exacto de src/domain/precios.js (normalizarEscalasBulto / escalaAlcanzada / aplicarDescuentoEscala):
--     precio * (1 - pct/100) redondeado PARA ARRIBA al peso entero, en aritmetica exacta (numeric).
--  3. admin_guardar_productos: COPIA de la 022 + escalas_bulto (clave ausente = se conserva).
--  4. tienda_catalogo: COPIA de la 010 + 'escalasBulto'.
--  5. tienda_crear_pedido: COPIA de la 024 + escala sobre el precio aplicado (cambios marcados REQ-ESC).
-- Mismos revoke/grant que las versiones anteriores de cada RPC.

begin;

-- =====================================================================
-- 0. Dependencias
-- =====================================================================
do $mig$
begin
  if to_regprocedure('public.admin_guardar_productos(text, text, jsonb)') is null then
    raise exception 'Falta la migracion 012/022: aplicarlas antes que esta (admin_guardar_productos).';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'productos' and column_name = 'grupo_bulto') then
    raise exception 'Falta la migracion 022_grupo_bulto.sql: aplicarla antes que esta.';
  end if;
  if to_regprocedure('public.tienda_cantidad_valida(bigint, integer, text, integer)') is null then
    raise exception 'Falta la migracion 024_pedidos_edicion_vendedor.sql: aplicarla antes que esta.';
  end if;
  if to_regprocedure('public.tienda_precio_aplicado(numeric, numeric, integer, numeric)') is null then
    raise exception 'Falta la migracion 010_lote_operacion_precios.sql: aplicarla antes que esta.';
  end if;
end
$mig$;

-- =====================================================================
-- 1. Columna
-- =====================================================================
alter table public.productos add column if not exists escalas_bulto jsonb;

do $mig$
begin
  if not exists (select 1 from pg_constraint where conname = 'productos_escalas_bulto_chk' and conrelid = 'public.productos'::regclass) then
    alter table public.productos add constraint productos_escalas_bulto_chk
      check (case
               when escalas_bulto is null then true
               when jsonb_typeof(escalas_bulto) = 'array' then jsonb_array_length(escalas_bulto) <= 3 and octet_length(escalas_bulto::text) <= 512
               else false
             end);
  end if;
end
$mig$;

grant select (escalas_bulto) on public.productos to anon, authenticated;

-- =====================================================================
-- 2. Helpers
-- =====================================================================
-- Misma regla que normalizarEscalasBulto (JS): se recorren los primeros 10 elementos en el orden recibido;
-- vale si desde es un entero entre 2 y 9999 y pct esta entre 0 y 100 (sin extremos) con hasta 2 decimales;
-- se conserva solo si desde es MAYOR que el ultimo conservado; maximo 3. Lo invalido se ignora una a una.
create or replace function public.escalas_bulto_normalizar(p jsonb)
returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $fn$
declare
  v_out   jsonb := '[]'::jsonb;
  v_e     jsonb;
  v_desde numeric;
  v_pct   numeric;
  v_ult   numeric := 0;
  v_n     integer := 0;
begin
  if p is null or jsonb_typeof(p) <> 'array' then
    return '[]'::jsonb;
  end if;
  for v_e in
    select t.value from jsonb_array_elements(p) with ordinality as t(value, ord) where t.ord <= 10 order by t.ord
  loop
    if coalesce(jsonb_typeof(v_e), '') <> 'object' then
      continue;
    end if;
    if coalesce(jsonb_typeof(v_e->'desde'), '') <> 'number' or coalesce(jsonb_typeof(v_e->'pct'), '') <> 'number' then
      continue;
    end if;
    v_desde := (v_e->>'desde')::numeric;
    v_pct := (v_e->>'pct')::numeric;
    if v_desde <> trunc(v_desde) or v_desde < 2 or v_desde > 9999 then
      continue;
    end if;
    if not (v_pct > 0 and v_pct < 100) or v_pct <> round(v_pct, 2) then
      continue;
    end if;
    if v_n > 0 and v_desde <= v_ult then
      continue;
    end if;
    v_out := v_out || jsonb_build_object('desde', v_desde::integer, 'pct', v_pct);
    v_ult := v_desde;
    v_n := v_n + 1;
    if v_n >= 3 then
      exit;
    end if;
  end loop;
  return v_out;
end
$fn$;

-- Escala mas alta alcanzada ({"desde":5,"pct":8}) o null. Solo cuentan bultos completos y bulto_x > 1.
create or replace function public.tienda_escala_alcanzada(p_escalas jsonb, p_bulto_x integer, p_unidades numeric)
returns jsonb
language sql immutable set search_path = public, pg_temp as $fn$
  select e.value
    from jsonb_array_elements(public.escalas_bulto_normalizar(p_escalas)) with ordinality as e(value, ord)
   where coalesce(p_bulto_x, 0) > 1
     and floor(coalesce(p_unidades, 0) / nullif(p_bulto_x, 0)) >= (e.value->>'desde')::numeric
   order by e.ord desc
   limit 1
$fn$;

create or replace function public.tienda_escala_pct(p_escalas jsonb, p_bulto_x integer, p_unidades numeric)
returns numeric
language sql immutable set search_path = public, pg_temp as $fn$
  select coalesce((public.tienda_escala_alcanzada(p_escalas, p_bulto_x, p_unidades)->>'pct')::numeric, 0)
$fn$;

-- Precio por unidad con la escala: ceil(precio * (100 - pct) / 100) al peso entero. Si no baja el precio,
-- queda el precio base (redondeado a centavos como tienda_precio_aplicado).
create or replace function public.tienda_precio_con_escala(p_precio numeric, p_escalas jsonb, p_bulto_x integer, p_unidades numeric)
returns numeric
language sql immutable set search_path = public, pg_temp as $fn$
  select case
    when p_precio is null then null
    when v.nuevo < round(p_precio, 2) then v.nuevo
    else round(p_precio, 2)
  end
  from (
    select ceil(round(p_precio, 2) * 100 * (10000 - round(public.tienda_escala_pct(p_escalas, p_bulto_x, p_unidades) * 100)) / 1000000) as nuevo
  ) v
$fn$;

revoke all on function public.escalas_bulto_normalizar(jsonb) from public, anon, authenticated;
revoke all on function public.tienda_escala_alcanzada(jsonb, integer, numeric) from public, anon, authenticated;
revoke all on function public.tienda_escala_pct(jsonb, integer, numeric) from public, anon, authenticated;
revoke all on function public.tienda_precio_con_escala(numeric, jsonb, integer, numeric) from public, anon, authenticated;

-- =====================================================================
-- 3. admin_guardar_productos (copia de la 022; cambios marcados REQ-ESC)
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
  v_pbulto    numeric;
  v_smin      integer;
  v_gbulto    text;
  v_escalas   jsonb;
  v_esc_mal   boolean;
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
      v_gbulto := nullif(trim(coalesce(v_fila->>'grupo_bulto', '')), '');
      -- REQ-ESC: hasta 3 escalas. Clave ausente = se conserva (ver on conflict); null = sin escalas;
      -- algo que no es lista, o con mas de 3 elementos, se rechaza. Se normaliza en el servidor.
      v_escalas := null;
      v_esc_mal := false;
      if v_fila ? 'escalas_bulto' then
        if jsonb_typeof(v_fila->'escalas_bulto') = 'array' then
          if jsonb_array_length(v_fila->'escalas_bulto') > 3 then
            v_esc_mal := true;
          else
            v_escalas := nullif(public.escalas_bulto_normalizar(v_fila->'escalas_bulto'), '[]'::jsonb);
          end if;
        elsif jsonb_typeof(v_fila->'escalas_bulto') <> 'null' then
          v_esc_mal := true;
        end if;
      end if;
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
         or char_length(coalesce(v_fila->>'bulto_nombre', '')) > 20
         or char_length(coalesce(v_gbulto, '')) > 40
         or v_esc_mal then -- REQ-ESC
        v_rechazos := v_rechazos || jsonb_build_object('id', v_id, 'motivo', 'datos_invalidos');
        continue;
      end if;

      if v_extras then
        insert into public.productos
          (id, nombre, codigo, precio, unidad, categoria, marca, imagen_url,
           proveedor_id, costo_final, descuento1, descuento2, ganancia, precio_venta2,
           bulto_x, minimo_venta, venta_por, bulto_nombre, visible_tienda, precio_bulto, stock_minimo, grupo_bulto, escalas_bulto)
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
           v_pbulto, v_smin, v_gbulto, v_escalas)
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
          stock_minimo = case when v_fila ? 'stock_minimo' then excluded.stock_minimo else public.productos.stock_minimo end,
          -- REQ-GBU: un dispositivo viejo (sin la clave) no borra el grupo.
          grupo_bulto = case when v_fila ? 'grupo_bulto' then excluded.grupo_bulto else public.productos.grupo_bulto end,
          -- REQ-ESC: un dispositivo viejo (sin la clave) no borra las escalas.
          escalas_bulto = case when v_fila ? 'escalas_bulto' then excluded.escalas_bulto else public.productos.escalas_bulto end;
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
-- 4. tienda_catalogo (copia de la 010; cambio marcado REQ-ESC)
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
      -- REQ-PBU: precio por unidad llevando bulto (solo si realmente baja el precio).
      'precioBulto',    case when coalesce(p.bulto_x, 0) > 1 and p.precio_bulto > 0 and p.precio_bulto < v.precio
                             then p.precio_bulto else null end,
      -- REQ-ESC: escalas por bulto normalizadas (solo si hay bulto usable).
      'escalasBulto',   case when coalesce(p.bulto_x, 0) > 1 then public.escalas_bulto_normalizar(p.escalas_bulto) else '[]'::jsonb end,
      -- REQ-MIN: minimo efectivo (redondeado al bulto si se vende por bulto).
      'minimoVenta',    public.tienda_minimo_efectivo(p.minimo_venta, p.venta_por, p.bulto_x),
      'disponible',     (v_cfg.permitir_sin_stock
                         or coalesce((select sum(m.cantidad) from public.movimientos_stock m where m.producto_id = p.id::text), 0) > 0)
    ) as x
    from public.productos p
    cross join lateral (select public.tienda_precio_vigente(p.id::text, p.precio, v_hoy) as precio) v
    where coalesce(p.visible_tienda, true) and p.precio > 0
  ) t;
  return jsonb_build_object('ok', true, 'config', jsonb_build_object('permitirSinStock', v_cfg.permitir_sin_stock), 'productos', v_prod);
end $$;

revoke all on function public.tienda_catalogo() from public;
grant execute on function public.tienda_catalogo() to anon, authenticated;

-- =====================================================================
-- 5. tienda_crear_pedido (copia de la 024; cambios marcados REQ-ESC)
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
  v_base      numeric; -- REQ-ESC: precio aplicado sin escala
  v_alc       jsonb;   -- REQ-ESC: escala alcanzada (o null)
  v_escs      jsonb;   -- REQ-ESC: escalas normalizadas del producto
  v_unit      numeric;
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
     or not public.direccion_exacta(v_contacto->>'direccion') -- REQ-DIR (AC-DIR-2)
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
    select p3.id, p3.nombre, p3.precio, p3.precio_bulto, p3.bulto_x, p3.minimo_venta, p3.venta_por, p3.bulto_nombre, p3.escalas_bulto into v_prod -- REQ-ESC
      from public.productos p3 where p3.id = v_k::bigint;
    v_u      := (v_acum->>v_k)::bigint;
    v_vp     := public.tienda_venta_por(v_prod.venta_por, v_prod.bulto_x);
    v_bx     := case when coalesce(v_prod.bulto_x, 0) > 1 then v_prod.bulto_x else null end;
    -- REQ-MIN: minimo efectivo; REQ-PBU: precio por bulto si llega a 1 bulto completo (menor entre oferta y bulto).
    v_min    := public.tienda_minimo_efectivo(v_prod.minimo_venta, v_prod.venta_por, v_prod.bulto_x);
    v_unit   := public.tienda_precio_vigente(v_k, v_prod.precio, v_hoy);
    v_base   := public.tienda_precio_aplicado(v_unit, v_prod.precio_bulto, v_prod.bulto_x, v_u);
    -- REQ-ESC: encima del precio aplicado, la escala alcanzada (mismo calculo que precioConEscala en JS).
    v_precio := public.tienda_precio_con_escala(v_base, v_prod.escalas_bulto, v_prod.bulto_x, v_u);
    v_alc    := case when v_precio < v_base then public.tienda_escala_alcanzada(v_prod.escalas_bulto, v_prod.bulto_x, v_u) else null end;
    v_cent   := round(v_precio * 100)::bigint;
    v_disp   := v_cfg.permitir_sin_stock
                or coalesce((select sum(m.cantidad) from public.movimientos_stock m where m.producto_id = v_k), 0) > 0;
    -- Reglas: minimo, multiplo del minimo (REQ-MUL), multiplo si es solo bulto, tope por renglon, disponibilidad.
    if v_u < v_min or (v_vp = 'bulto' and v_bx is not null and v_u % v_bx <> 0) or v_u > v_tope_u or not v_disp
       or not public.tienda_cantidad_valida(v_u, v_prod.minimo_venta, v_vp, v_bx) then -- REQ-MUL (AC-MUL-2)
      v_cambio := true;
    end if;
    -- Precio distinto de lo que vio el cliente.
    if jsonb_typeof(v_visto->v_k) = 'number' and round((v_visto->>v_k)::numeric * 100)::bigint <> v_cent then
      v_cambio := true;
    end if;
    v_total_c := v_total_c + v_cent * v_u;
    v_item := jsonb_build_object('productoId', to_jsonb(v_prod.id), 'nombre', v_prod.nombre,
                                 'cantidad', v_u, 'precio', v_cent::numeric / 100, 'subtotal', (v_cent * v_u)::numeric / 100,
                                 'precioOriginal', v_unit, 'precioPorBulto', (v_base < v_unit)); -- REQ-ESC: la escala no ensucia precioPorBulto
    -- REQ-ESC: se congelan las escalas (y el bulto) en el renglon; escalaDesde/escalaPct solo si se aplico.
    v_escs := case when v_bx is not null then public.escalas_bulto_normalizar(v_prod.escalas_bulto) else '[]'::jsonb end;
    if jsonb_array_length(v_escs) > 0 then
      v_item := v_item || jsonb_build_object('escalasBulto', v_escs, 'precioBultoX', v_bx);
      if coalesce(v_prod.precio_bulto, 0) > 0 then
        v_item := v_item || jsonb_build_object('precioBultoOriginal', v_prod.precio_bulto);
      end if;
      if v_alc is not null then
        v_item := v_item || jsonb_build_object('escalaDesde', (v_alc->>'desde')::integer, 'escalaPct', (v_alc->>'pct')::numeric);
      end if;
    end if;
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

revoke all on function public.tienda_crear_pedido(jsonb) from public;
grant execute on function public.tienda_crear_pedido(jsonb) to anon, authenticated;

commit;
