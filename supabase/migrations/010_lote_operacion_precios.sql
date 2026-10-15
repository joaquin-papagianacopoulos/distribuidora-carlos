-- 010_lote_operacion_precios.sql — REQ-PBU, REQ-MIN (tienda) y REQ-HPR (lote operacion).
-- Se aplica A MANO en Supabase -> SQL Editor, DESPUES de 007 y 009 y ANTES de publicar
-- la app (hacer backup antes). Idempotente (if not exists / create or replace / on conflict)
-- y no destructiva: no borra tablas, columnas ni datos.
--
-- Contenido:
--  1. productos.precio_bulto (precio por unidad llevando bulto).
--  2. admin_guardar_productos (de la 007) con precio_bulto en la rama "extras".
--  3. Helpers tienda_precio_aplicado / tienda_minimo_efectivo (mismas reglas que
--     src/domain/precios.js y src/domain/minimos.js).
--  4. tienda_catalogo (de la 009) y tienda_crear_pedido (de la 008) usando esos helpers:
--     el servidor recalcula precio y minimo; un carrito con precio manipulado no pasa.
--  5. cambios_precio (historial de cambios de precio) + RPC admin_registrar_cambios_precio.
--
-- Seguridad (decision autorizada por el duenio):
--  * cambios_precio se lee con anon (los precios de venta ya son publicos); NO guarda costos,
--    ganancias ni datos de clientes. Escribir solo por la RPC con PIN de admin activo
--    (patron 007). Sin update/delete: el historial es inmutable.
--  * Los helpers no tienen grant para anon: solo los usan las RPC security definer.

begin;

-- =====================================================================
-- 0. Prerrequisitos (consultas estaticas)
-- =====================================================================
do $$
begin
  if to_regprocedure('public.admin_guardar_productos(text, text, jsonb)') is null then
    raise exception 'Falta la migracion 007_productos_escritura_admin.sql: aplicarla antes que esta.';
  end if;
  if to_regprocedure('public.tienda_precio_vigente(text, numeric, date)') is null
     or to_regprocedure('public.tienda_venta_por(text, integer)') is null
     or to_regclass('public.tienda_ofertas') is null then
    raise exception 'Faltan las migraciones 008_tienda.sql / 009_tienda_portada.sql: aplicarlas antes que esta.';
  end if;
  if to_regprocedure('public.verificar_pin(text, text)') is null then
    raise exception 'Falta public.verificar_pin(text, text): aplicar antes 002_seguridad_recomendada.sql PASO 1.';
  end if;
end $$;

-- =====================================================================
-- 1. productos.precio_bulto
-- =====================================================================
alter table public.productos add column if not exists precio_bulto numeric(14,2) not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'productos_precio_bulto_chk' and conrelid = 'public.productos'::regclass) then
    alter table public.productos add constraint productos_precio_bulto_chk check (precio_bulto >= 0);
  end if;
end $$;

-- =====================================================================
-- 2. admin_guardar_productos: igual a la 007 + precio_bulto (solo rama extras;
--    la rama basica no lo pisa, como el resto de los extras).
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

      if char_length(v_nombre) < 1 or char_length(v_nombre) > 200
         or v_precio is null or v_precio < 0 or v_precio = 'NaN'::numeric or v_pbulto = 'NaN'::numeric
         or v_pbulto < 0 or v_pbulto > 999999999999
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
           bulto_x, minimo_venta, venta_por, bulto_nombre, visible_tienda, precio_bulto)
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
           coalesce((v_fila->>'visible_tienda')::boolean, true),
           v_pbulto)
        on conflict (id) do update set
          nombre = excluded.nombre, codigo = excluded.codigo, precio = excluded.precio,
          unidad = excluded.unidad, categoria = excluded.categoria, marca = excluded.marca,
          imagen_url = excluded.imagen_url, proveedor_id = excluded.proveedor_id,
          costo_final = excluded.costo_final, descuento1 = excluded.descuento1,
          descuento2 = excluded.descuento2, ganancia = excluded.ganancia,
          precio_venta2 = excluded.precio_venta2, bulto_x = excluded.bulto_x,
          minimo_venta = excluded.minimo_venta, venta_por = excluded.venta_por,
          bulto_nombre = excluded.bulto_nombre, visible_tienda = excluded.visible_tienda,
          precio_bulto = excluded.precio_bulto;
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
-- 3. Helpers (sin grant para anon; los usan las RPC definer)
-- =====================================================================
-- Precio por unidad que corresponde a p_unidades: con bulto_x > 1, precio_bulto > 0 y al menos
-- 1 bulto completo => el menor entre precio y precio_bulto. Si no, el precio.
create or replace function public.tienda_precio_aplicado(p_precio numeric, p_precio_bulto numeric, p_bulto_x integer, p_unidades numeric)
returns numeric
language sql immutable set search_path = public, pg_temp as $$
  select case
    when p_precio is null then null
    when coalesce(p_bulto_x, 0) > 1 and coalesce(p_precio_bulto, 0) > 0 and coalesce(p_unidades, 0) >= p_bulto_x
      then round(least(p_precio, p_precio_bulto), 2)
    else round(p_precio, 2)
  end
$$;

-- Minimo efectivo: <= 1 o vacio => 1; si se vende por bulto, redondeado al multiplo de bulto superior.
create or replace function public.tienda_minimo_efectivo(p_minimo integer, p_venta_por text, p_bulto_x integer)
returns integer
language sql immutable set search_path = public, pg_temp as $$
  select case
    when greatest(coalesce(p_minimo, 1), 1) <= 1 then 1
    when public.tienda_venta_por(p_venta_por, p_bulto_x) = 'bulto' and coalesce(p_bulto_x, 0) > 1
      then (ceil(greatest(p_minimo, 1)::numeric / p_bulto_x) * p_bulto_x)::integer
    else greatest(p_minimo, 1)
  end
$$;

revoke all on function public.tienda_precio_aplicado(numeric, numeric, integer, numeric) from public, anon, authenticated;
revoke all on function public.tienda_minimo_efectivo(integer, text, integer) from public, anon, authenticated;

-- =====================================================================
-- 4. tienda_catalogo (de la 009) + precioBulto y minimo efectivo
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


-- =====================================================================
-- 5. tienda_crear_pedido (de la 008): el servidor recalcula minimo efectivo y precio
--    aplicado (oferta vs precio por bulto). Cambios marcados con REQ-PBU / REQ-MIN.
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
    select p3.id, p3.nombre, p3.precio, p3.precio_bulto, p3.bulto_x, p3.minimo_venta, p3.venta_por, p3.bulto_nombre into v_prod
      from public.productos p3 where p3.id = v_k::bigint;
    v_u      := (v_acum->>v_k)::bigint;
    v_vp     := public.tienda_venta_por(v_prod.venta_por, v_prod.bulto_x);
    v_bx     := case when coalesce(v_prod.bulto_x, 0) > 1 then v_prod.bulto_x else null end;
    -- REQ-MIN: minimo efectivo; REQ-PBU: precio por bulto si llega a 1 bulto completo (menor entre oferta y bulto).
    v_min    := public.tienda_minimo_efectivo(v_prod.minimo_venta, v_prod.venta_por, v_prod.bulto_x);
    v_unit   := public.tienda_precio_vigente(v_k, v_prod.precio, v_hoy);
    v_precio := public.tienda_precio_aplicado(v_unit, v_prod.precio_bulto, v_prod.bulto_x, v_u);
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
                                 'cantidad', v_u, 'precio', v_cent::numeric / 100, 'subtotal', (v_cent * v_u)::numeric / 100,
                                 'precioOriginal', v_unit, 'precioPorBulto', (v_precio < v_unit));
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
-- 6. Historial de cambios de precio (REQ-HPR)
-- =====================================================================
create table if not exists public.cambios_precio (
  id                    uuid primary key,
  producto_id           text not null check (char_length(producto_id) between 1 and 64),
  codigo                text not null default '' check (char_length(codigo) <= 64),
  nombre                text not null default '' check (char_length(nombre) <= 200),
  rubro                 text not null default '' check (char_length(rubro) <= 120),
  precio_anterior       numeric(14,2) check (precio_anterior is null or precio_anterior >= 0),
  precio_nuevo          numeric(14,2) not null check (precio_nuevo >= 0),
  precio_bulto_anterior numeric(14,2) check (precio_bulto_anterior is null or precio_bulto_anterior >= 0),
  precio_bulto_nuevo    numeric(14,2) not null default 0 check (precio_bulto_nuevo >= 0),
  fecha                 date not null,
  creado_en             timestamptz not null,
  usuario_id            text check (usuario_id is null or char_length(usuario_id) <= 64),
  usuario_nombre        text not null default '' check (char_length(usuario_nombre) <= 80),
  recibido_en           timestamptz not null default now()
);
create index if not exists cambios_precio_fecha_idx on public.cambios_precio (fecha);

alter table public.cambios_precio enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cambios_precio' and policyname = 'cambios_precio_select') then
    create policy cambios_precio_select on public.cambios_precio for select to anon, authenticated using (true);
  end if;
end $$;

-- S-010-03: sacar TODO (incluye references/trigger) y dar solo select por columnas.
-- S-010-01: usuario_id NO se expone a anon (es la mitad de la credencial del RPC admin).
revoke all on public.cambios_precio from public, anon, authenticated;
grant select (id, producto_id, codigo, nombre, rubro, precio_anterior, precio_nuevo,
              precio_bulto_anterior, precio_bulto_nuevo, fecha, creado_en, usuario_nombre)
  on public.cambios_precio to anon, authenticated;

-- RPC: registra un lote (<= 500) de cambios con PIN de admin activo.
-- Respuesta: { ok:true, aceptados:[uuid], rechazados:[{id,motivo}] } o { ok:false, motivo }.
-- Reintentos idempotentes: un id ya recibido cuenta como aceptado (on conflict do nothing).
-- Un id de admin vacio devuelve no_autorizado sin gastar intentos (sonda de la app).
create or replace function public.admin_registrar_cambios_precio(p_admin_id text, p_admin_pin text, p_filas jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin_id  text := trim(coalesce(p_admin_id, ''));
  v_es_admin  boolean;
  v_pin_ok    boolean;
  v_fila      jsonb;
  v_id        uuid;
  v_pa        numeric;
  v_pn        numeric;
  v_ba        numeric;
  v_bn        numeric;
  v_fecha     date;
  v_creado    timestamptz;
  v_aceptados jsonb := '[]'::jsonb;
  v_rechazos  jsonb := '[]'::jsonb;
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

  if p_filas is null or jsonb_typeof(p_filas) <> 'array'
     or jsonb_array_length(p_filas) < 1 or jsonb_array_length(p_filas) > 500 then
    return jsonb_build_object('ok', false, 'motivo', 'lote_invalido');
  end if;

  for v_fila in select value from jsonb_array_elements(p_filas) loop
    v_id := null;
    begin
      if jsonb_typeof(v_fila) <> 'object' then
        v_rechazos := v_rechazos || jsonb_build_object('id', null, 'motivo', 'datos_invalidos');
        continue;
      end if;
      v_id := (v_fila->>'id')::uuid;
      v_pa := (v_fila->>'precio_anterior')::numeric;
      v_pn := (v_fila->>'precio_nuevo')::numeric;
      v_ba := (v_fila->>'precio_bulto_anterior')::numeric;
      v_bn := coalesce((v_fila->>'precio_bulto_nuevo')::numeric, 0);
      v_fecha := (v_fila->>'fecha')::date;
      v_creado := (v_fila->>'creado_en')::timestamptz;

      if v_id is null or v_pn is null or v_fecha is null or v_creado is null
         or v_pn = 'NaN'::numeric or v_bn = 'NaN'::numeric
         or v_pa = 'NaN'::numeric or v_ba = 'NaN'::numeric
         or v_pn < 0 or v_pn > 999999999999 or v_bn < 0 or v_bn > 999999999999
         or (v_pa is not null and (v_pa < 0 or v_pa > 999999999999))
         or (v_ba is not null and (v_ba < 0 or v_ba > 999999999999))
         or char_length(coalesce(v_fila->>'producto_id', '')) not between 1 and 64
         or char_length(coalesce(v_fila->>'codigo', '')) > 64
         or char_length(coalesce(v_fila->>'nombre', '')) > 200
         or char_length(coalesce(v_fila->>'rubro', '')) > 120
         or char_length(coalesce(v_fila->>'usuario_id', '')) > 64
         or char_length(coalesce(v_fila->>'usuario_nombre', '')) > 80 then
        v_rechazos := v_rechazos || jsonb_build_object('id', v_id, 'motivo', 'datos_invalidos');
        continue;
      end if;

      insert into public.cambios_precio
        (id, producto_id, codigo, nombre, rubro, precio_anterior, precio_nuevo,
         precio_bulto_anterior, precio_bulto_nuevo, fecha, creado_en, usuario_id, usuario_nombre)
      values
        (v_id, v_fila->>'producto_id', coalesce(v_fila->>'codigo', ''), coalesce(v_fila->>'nombre', ''),
         coalesce(v_fila->>'rubro', ''), v_pa, v_pn, v_ba, v_bn, v_fecha, v_creado,
         nullif(v_fila->>'usuario_id', ''), coalesce(v_fila->>'usuario_nombre', ''))
      on conflict (id) do nothing;
      v_aceptados := v_aceptados || to_jsonb(v_id::text);
    exception when check_violation or not_null_violation or invalid_text_representation
              or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
      v_rechazos := v_rechazos || jsonb_build_object('id', v_id, 'motivo', 'datos_invalidos');
    end;
  end loop;

  return jsonb_build_object('ok', true, 'aceptados', v_aceptados, 'rechazados', v_rechazos);
end $$;

revoke all on function public.admin_registrar_cambios_precio(text, text, jsonb) from public;
grant execute on function public.admin_registrar_cambios_precio(text, text, jsonb) to anon, authenticated;

-- S-010-04: re-emitir grants (create or replace conserva el ACL, pero no dependemos de eso).
revoke all on function public.tienda_catalogo() from public;
revoke all on function public.tienda_crear_pedido(jsonb) from public;
grant execute on function public.tienda_catalogo() to anon, authenticated;
grant execute on function public.tienda_crear_pedido(jsonb) to anon, authenticated;

commit;
