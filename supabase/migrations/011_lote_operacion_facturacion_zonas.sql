-- 011_lote_operacion_facturacion_zonas.sql — REQ-FAB, REQ-AGR y REQ-ZON (lote operacion).
-- Se aplica A MANO en Supabase -> SQL Editor, DESPUES de 002 (verificar_pin) y 010, y ANTES
-- de publicar la app (hacer backup antes). Idempotente y no destructiva: no borra tablas,
-- columnas ni datos.
--
-- Contenido:
--  1. pedidos.grupos (jsonb): grupos de renglones para la boleta (solo presentacion).
--  2. clientes.orden_zona (integer) + inicializacion UNICA con el orden actual (dia y orden).
--  3. pedidos_factura: tipo de factura A/B por pedido. Dato fiscal => NO legible ni escribible
--     con la anon key: RLS activo, sin grants, acceso solo por las RPC de abajo.
--  4. RPC admin_guardar_tipos_factura (PIN de admin, patron 007/010).
--  5. RPC admin_facturas_a_emitir (PIN de admin): reporte para el contador.

begin;

-- 0. Prerrequisitos
do $$
begin
  if to_regprocedure('public.verificar_pin(text, text)') is null then
    raise exception 'Falta public.verificar_pin(text, text): aplicar antes 002_seguridad_recomendada.sql PASO 1.';
  end if;
  if to_regclass('public.cambios_precio') is null then
    raise exception 'Falta la migracion 010_lote_operacion_precios.sql: aplicarla antes que esta.';
  end if;
end $$;

-- 1. Grupos de renglones (AC-AGR-2). Null por defecto: pedidos viejos no cambian.
alter table public.pedidos add column if not exists grupos jsonb;

-- S-011-05: tope de tamano de grupos (not valid: no revisa filas existentes).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pedidos_grupos_size_chk' and conrelid = 'public.pedidos'::regclass) then
    alter table public.pedidos add constraint pedidos_grupos_size_chk
      check (grupos is null or pg_column_size(grupos) < 65536) not valid;
  end if;
end $$;

-- 2. Orden por zona (AC-ZON-1/3)
alter table public.clientes add column if not exists orden_zona integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clientes_orden_zona_chk' and conrelid = 'public.clientes'::regclass) then
    alter table public.clientes add constraint clientes_orden_zona_chk check (orden_zona is null or orden_zona > 0);
  end if;
end $$;

-- Inicializacion: SOLO la primera vez (si no hay ningun orden_zona cargado). Orden actual:
-- indice del dia (lunes..domingo; sin dia al final), luego orden_entrega, nombre e id.
-- No toca dia_entrega ni orden_entrega.
do $$
begin
  if not exists (select 1 from public.clientes where orden_zona is not null) then
    update public.clientes c
       set orden_zona = n.pos
      from (
        select id,
               row_number() over (
                 partition by translate(lower(btrim(regexp_replace(coalesce(zona, ''), '\s+', ' ', 'g'))), 'áéíóúüñ', 'aeiouun')
                 order by coalesce(array_position(array['lunes','martes','miercoles','jueves','viernes','sabado','domingo'], translate(lower(btrim(coalesce(dia_entrega, ''))), 'áéíóú', 'aeiou')), 99),
                          coalesce(orden_entrega, 2147483647),
                          lower(coalesce(nombre, '')),
                          id::text
               )::integer as pos
          from public.clientes
      ) n
     where c.id = n.id and c.orden_zona is null;
  end if;
end $$;

-- 3. pedidos_factura (AC-FAB-1). pedido_id con el MISMO tipo que pedidos.id.
do $$
declare v_tipo text;
begin
  if to_regclass('public.pedidos_factura') is null then
    select format_type(a.atttypid, a.atttypmod) into v_tipo
      from pg_attribute a
     where a.attrelid = 'public.pedidos'::regclass and a.attname = 'id' and not a.attisdropped;
    execute format(
      'create table public.pedidos_factura (
         pedido_id    %s primary key,
         tipo_factura text not null check (tipo_factura in (''A'',''B'',''ninguna'')),
         updated_at   timestamptz not null default now(),
         updated_by   text
       )', v_tipo);
  end if;
end $$;

alter table public.pedidos_factura enable row level security;
revoke all on public.pedidos_factura from public, anon, authenticated;

-- Helper interno: valida admin activo + PIN. Sin grant para anon.
create or replace function public._es_admin_con_pin(p_admin_id text, p_admin_pin text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id text := trim(coalesce(p_admin_id, ''));
  v_es_admin boolean;
  v_pin_ok boolean;
begin
  if length(v_id) = 0 or length(v_id) > 64 then return false; end if;
  select exists (
    select 1 from public.vendedores
     where id::text = v_id and permiso = 1 and activo and pin_hash is not null
  ) into v_es_admin;
  v_pin_ok := coalesce(public.verificar_pin(v_id, p_admin_pin), false);
  return v_pin_ok and v_es_admin;
end $$;
revoke all on function public._es_admin_con_pin(text, text) from public, anon, authenticated;

-- 4. Guardar tipos de factura. Last-write-wins por updated_at (no retrocede).
create or replace function public.admin_guardar_tipos_factura(p_admin_id text, p_admin_pin text, p_filas jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_fila jsonb;
  v_tipo text;
  v_ts   timestamptz;
  v_pid  text;
  v_guardados jsonb := '[]'::jsonb;
  v_rechazados jsonb := '[]'::jsonb;
begin
  if not public._es_admin_con_pin(p_admin_id, p_admin_pin) then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array'
     or jsonb_array_length(p_filas) < 1 or jsonb_array_length(p_filas) > 500 then
    return jsonb_build_object('ok', false, 'motivo', 'lote_invalido');
  end if;

  for v_fila in select value from jsonb_array_elements(p_filas) loop
    v_pid := null;
    begin
      if jsonb_typeof(v_fila) <> 'object' then
        v_rechazados := v_rechazados || jsonb_build_object('id', null::text, 'motivo', 'datos_invalidos');
        continue;
      end if;
      v_pid := v_fila->>'pedido_id';
      v_tipo := v_fila->>'tipo_factura';
      -- S-011-04: el reloj del cliente no puede ir al futuro (tope now() + 5 min).
      v_ts := least(coalesce((v_fila->>'updated_at')::timestamptz, now()), now() + interval '5 minutes');
      if v_pid is null or v_pid !~ '^[0-9a-zA-Z-]{1,64}$' or v_tipo is null or v_tipo not in ('A','B','ninguna') then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_pid, 'motivo', 'datos_invalidos');
        continue;
      end if;
      if not exists (select 1 from public.pedidos where id::text = v_pid) then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_pid, 'motivo', 'pedido_inexistente');
        continue;
      end if;
      insert into public.pedidos_factura (pedido_id, tipo_factura, updated_at, updated_by)
      select p.id, v_tipo, v_ts, left(trim(p_admin_id), 64) from public.pedidos p where p.id::text = v_pid
      on conflict (pedido_id) do update
        set tipo_factura = excluded.tipo_factura, updated_at = excluded.updated_at, updated_by = excluded.updated_by
        where excluded.updated_at >= public.pedidos_factura.updated_at;
      -- Una marca mas vieja que la guardada ya esta resuelta: se confirma igual (no se reintenta).
      v_guardados := v_guardados || to_jsonb(v_pid);
    exception when others then
      v_rechazados := v_rechazados || jsonb_build_object('id', v_pid, 'motivo', 'datos_invalidos');
    end;
  end loop;

  return jsonb_build_object('ok', true, 'guardados', v_guardados, 'rechazados', v_rechazados);
end $$;

-- 5. Reporte "Facturas a emitir" (AC-FAB-3): solo pedidos facturados, rango maximo 366 dias.
create or replace function public.admin_facturas_a_emitir(p_admin_id text, p_admin_pin text, p_desde date, p_hasta date)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_filas jsonb;
begin
  if not public._es_admin_con_pin(p_admin_id, p_admin_pin) then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 366 then
    return jsonb_build_object('ok', false, 'motivo', 'rango_invalido');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'pedido_id',      p.id::text,
           'fecha',          left(p.fecha::text, 10),
           'cliente_id',     p.cliente_id::text,
           'cliente_nombre', coalesce(c.nombre, p.cliente_nombre),
           'cuit',           c.cuit,
           'tipo_iva',       c.tipo_iva,
           'tipo_factura',   f.tipo_factura,
           'total',          p.total
         ) order by left(p.fecha::text, 10), p.id::text), '[]'::jsonb)
    into v_filas
    from public.pedidos p
    left join public.clientes c on c.id::text = p.cliente_id::text
    left join public.pedidos_factura f on f.pedido_id::text = p.id::text
   where lower(coalesce(p.estado, '')) = 'facturado'
     and left(p.fecha::text, 10) >= p_desde::text
     and left(p.fecha::text, 10) <= p_hasta::text;

  return jsonb_build_object('ok', true, 'filas', v_filas);
end $$;

-- 6. Permisos: el PIN de admin es la barrera (como 007/010).
revoke all on function public.admin_guardar_tipos_factura(text, text, jsonb) from public;
grant execute on function public.admin_guardar_tipos_factura(text, text, jsonb) to anon, authenticated;
revoke all on function public.admin_facturas_a_emitir(text, text, date, date) from public;
grant execute on function public.admin_facturas_a_emitir(text, text, date, date) to anon, authenticated;

commit;
