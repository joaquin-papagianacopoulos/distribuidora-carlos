-- 019_ajustes_contacto_direccion.sql — REQ-CON (AC-CON-1) y REQ-DIR (AC-DIR-2).
-- Se aplica A MANO en Supabase -> SQL Editor, DESPUES de la 010 (hacer backup antes).
-- Idempotente y NO destructiva (no borra nada).
--
--  1. clientes.contacto: nombre de contacto (opcional). Sin esta columna la app sigue
--     funcionando: sube el resto de los datos del cliente y avisa por consola.
--  2. direccion_exacta(text): misma regla que src/domain/direccion.js (calle y numero,
--     o "s/n"; minimo 5 caracteres).
--  3. tienda_crear_pedido: COPIA de la 010 + rechazo (motivo 'invalido') si la direccion
--     de entrega no es exacta. Pedidos viejos no se tocan.

begin;

alter table public.clientes add column if not exists contacto text;

create or replace function public.direccion_exacta(t text)
returns boolean
language sql immutable as $fn$
  select char_length(v) >= 5
     and v ~ '[[:alpha:]]'
     and (v ~ '(^|[^[:alnum:]])[0-9]+' or v ~* '(^|\s)s/n($|[\s.,;])')
  from (select regexp_replace(btrim(coalesce(t, '')), '\s+', ' ', 'g') as v) x
$fn$;

grant execute on function public.direccion_exacta(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- tienda_crear_pedido (copia de la 010; unico cambio marcado con REQ-DIR)
-- ---------------------------------------------------------------------
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

revoke all on function public.tienda_crear_pedido(jsonb) from public;
grant execute on function public.tienda_crear_pedido(jsonb) to anon, authenticated;

commit;
