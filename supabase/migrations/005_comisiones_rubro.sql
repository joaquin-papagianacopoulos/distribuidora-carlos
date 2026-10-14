-- 005_comisiones_rubro.sql — REQ-COMR (AC-COMR-7, 8, 9, 13, 14) + AC-SEC-5.
-- Corrida 20261014-1449. Se aplica A MANO en Supabase -> SQL Editor (hacer
-- backup antes). Es idempotente: se puede correr más de una vez. No borra datos.
--
-- ORDEN DE APLICACIÓN: 002 PASO 1 -> 003 -> 004 -> 005. Si falta alguna, esta
-- migración aborta al principio sin tocar nada.
--
-- ATENCIÓN: redefine public.cerrar_comisiones (misma firma) y los triggers de
-- inmutabilidad de la 003. Si se vuelve a correr la 003, hay que volver a
-- correr esta 005 (si no, cerrar_comisiones vuelve al modelo por cliente).
--
-- Qué hace:
--  * public.rubro_clave(): clave de rubro, ESPEJO EXACTO de claveRubro() en
--    src/domain/rubros.js (mismas cadenas de acentos, sin la extensión unaccent).
--  * public.comisiones_rubro: % por vendedor (vendedores.id::text) y rubro.
--    Única por (vendedor_id, rubro_clave). "Vaciar" un % = pct null; las filas
--    no se borran nunca (trigger).
--  * RLS "solo admin": la tabla tiene RLS habilitado, NINGUNA política y ningún
--    grant para anon/authenticated (con la anon key no se puede leer ni
--    escribir). Se lee y se escribe SOLO por las RPC admin_leer_comisiones_rubro
--    y admin_guardar_comisiones_rubro (security definer + id del admin + PIN
--    verificado con public.verificar_pin), el mismo mecanismo que la 003/004.
--  * Cierres: columnas modelo ('cliente' | 'rubro') y desglose (jsonb que arma
--    el SERVIDOR). cerrar_comisiones recalcula cada parte con la tabla del
--    servidor y rechaza si no coincide. Los renglones 'pedido' del modelo
--    viejo se rechazan con 'modelo_obsoleto' (una PWA vieja no puede cerrar con
--    el % del cliente). Los ajustes de pedidos cerrados con el modelo viejo
--    siguen la fórmula de la 003 (total × % congelado).
--
-- Criterio de redondeo (AC-COMR-9), igual que src/domain/comisiones.js:
--   subtotal del renglón = round(round(precio, 2) * cantidad, 2)
--   comisión de un vendedor en un pedido = round(sum(subtotal * pct) * división / 10000, 2)
--   (un solo redondeo por pedido y por vendedor; round(numeric) redondea
--   alejándose del cero, igual que el dominio).

begin;

-- =====================================================================
-- 0. Prerrequisitos: 002 PASO 1, 003 y 004. Si falta algo, no se toca nada.
-- =====================================================================
do $$
begin
  if to_regprocedure('public.verificar_pin(text, text)') is null then
    raise exception 'Falta public.verificar_pin(text, text): aplicar antes 002_seguridad_recomendada.sql PASO 1 y despues volver a correr esta 005.';
  end if;
  if to_regprocedure('public.vendedor_habilitado(text)') is null
     or to_regclass('public.comisiones_cierre_pedidos') is null
     or to_regclass('public.comisiones_cierres') is null then
    raise exception 'Falta la migracion 003_comisiones.sql: aplicarla antes y despues volver a correr esta 005.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'vendedores' and column_name = 'activo') then
    raise exception 'Falta la migracion 004_baja_vendedores.sql (columna vendedores.activo): aplicarla antes y despues volver a correr esta 005.';
  end if;
end $$;

-- =====================================================================
-- 1. Rubro normalizado y clave (espejo de normalizarRubro / claveRubro)
-- =====================================================================
create or replace function public.rubro_normalizado(p text) returns text
language sql immutable set search_path = public, pg_temp as $$
  -- S-COMR-04: NFC primero (espejo de String.normalize('NFC') en normalizarRubro).
  select left(btrim(regexp_replace(regexp_replace(normalize(coalesce(p, ''), NFC), '[\x01-\x1f\x7f]', ' ', 'g'), '\s+', ' ', 'g')), 60)
$$;

create or replace function public.rubro_clave(p text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select nullif(lower(translate(public.rubro_normalizado(p),
    'áàâäãåéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ',
    'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC')), '')
$$;

-- =====================================================================
-- 2. Tabla de % por vendedor y rubro (AC-COMR-6, 7, 8)
-- =====================================================================
create table if not exists public.comisiones_rubro (
  id             text primary key check (length(id) between 1 and 64),
  vendedor_id    text not null check (length(vendedor_id) between 1 and 64),
  rubro          text not null check (length(rubro) between 1 and 60),
  rubro_clave    text not null check (length(rubro_clave) between 1 and 60),
  pct            numeric(5,2) check (pct is null or (pct >= 0 and pct <= 100)),
  editado_at     timestamptz not null default now(),
  editado_por    text check (editado_por is null or length(editado_por) <= 80),
  editado_por_id text check (editado_por_id is null or length(editado_por_id) <= 64),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint comisiones_rubro_vendedor_rubro_uq unique (vendedor_id, rubro_clave)
);
create index if not exists comisiones_rubro_vendedor_idx on public.comisiones_rubro (vendedor_id);

drop trigger if exists set_updated_at on public.comisiones_rubro;
create trigger set_updated_at before update on public.comisiones_rubro
  for each row execute function public.tg_set_updated_at();

-- Las filas no se borran: "vaciar" un % es pct = null (regla dura 6).
create or replace function public.tg_comisiones_rubro_sin_borrado() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'Los %% de comision por rubro no se borran (vaciar = pct null)';
end $$;
drop trigger if exists comisiones_rubro_sin_borrado on public.comisiones_rubro;
create trigger comisiones_rubro_sin_borrado before delete on public.comisiones_rubro
  for each row execute function public.tg_comisiones_rubro_sin_borrado();

-- =====================================================================
-- 3. RLS: solo admin. Sin políticas y sin grants => anon/authenticated no
--    leen ni escriben. Todo pasa por las RPC de abajo.
-- =====================================================================
alter table public.comisiones_rubro enable row level security;
revoke all on table public.comisiones_rubro from public, anon, authenticated;

-- =====================================================================
-- 4. Lectura (solo admin con PIN)
-- =====================================================================
create or replace function public.admin_leer_comisiones_rubro(p_admin_id text, p_admin_pin text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin_id text := trim(coalesce(p_admin_id, ''));
  v_por      text;
  v_pin_ok   boolean;
begin
  -- Autorización igual que cerrar_comisiones (S-COM-16): verificar_pin SIEMPRE
  -- y una sola respuesta 'no_autorizado', sin raise (el intento cuenta para el bloqueo).
  if length(v_admin_id) = 0 or length(v_admin_id) > 64 then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  select left(trim(ve.nombre), 80) into v_por
    from public.vendedores ve
   where ve.id::text = v_admin_id and ve.permiso = 1 and public.vendedor_habilitado(ve.id::text);
  v_pin_ok := coalesce(public.verificar_pin(v_admin_id, p_admin_pin), false);
  if not v_pin_ok or v_por is null or length(v_por) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  return jsonb_build_object('ok', true, 'filas', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', cr.id, 'vendedor_id', cr.vendedor_id, 'rubro', cr.rubro, 'rubro_clave', cr.rubro_clave,
             'pct', cr.pct, 'editado_at', cr.editado_at, 'editado_por', cr.editado_por) order by cr.vendedor_id, cr.rubro_clave)
      from (select * from public.comisiones_rubro order by vendedor_id, rubro_clave limit 20000) cr
  ), '[]'::jsonb));
end $$;

-- =====================================================================
-- 5. Escritura idempotente por lote (solo admin con PIN)
--    Upsert por id y por (vendedor_id, rubro_clave), last-write-wins por
--    editado_at. Devuelve el id canónico de cada fila aceptada.
-- =====================================================================
create or replace function public.admin_guardar_comisiones_rubro(p_admin_id text, p_admin_pin text, p_filas jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin_id   text := trim(coalesce(p_admin_id, ''));
  v_por        text;
  v_pin_ok     boolean;
  f            jsonb;
  v_id         text;
  v_vend       text;
  v_rubro      text;
  v_clave      text;
  v_pct        numeric;
  v_at         timestamptz;
  v_prev       record;
  v_fila       record;
  v_aceptadas  jsonb := '[]'::jsonb;
  v_rechazadas jsonb := '[]'::jsonb;
begin
  -- 1) Autorización (idéntica a la lectura).
  if length(v_admin_id) = 0 or length(v_admin_id) > 64 then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  select left(trim(ve.nombre), 80) into v_por
    from public.vendedores ve
   where ve.id::text = v_admin_id and ve.permiso = 1 and public.vendedor_habilitado(ve.id::text);
  v_pin_ok := coalesce(public.verificar_pin(v_admin_id, p_admin_pin), false);
  if not v_pin_ok or v_por is null or length(v_por) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  -- 2) El MISMO lock global que cerrar/anular: ningún % cambia en medio de un cierre.
  perform pg_advisory_xact_lock(hashtext('comisiones_global'));

  -- 3) Forma del lote.
  if coalesce(jsonb_typeof(p_filas), '') <> 'array' or jsonb_array_length(p_filas) = 0
     or jsonb_array_length(p_filas) > 1000 then
    return jsonb_build_object('ok', false, 'motivo', 'filas_invalidas');
  end if;

  -- 4) Fila por fila.
  for f in select value from jsonb_array_elements(p_filas) loop
    v_id := case when jsonb_typeof(f) = 'object' then f->>'id' end;
    if v_id is null or length(v_id) not between 1 and 64 then
      v_rechazadas := v_rechazadas || jsonb_build_array(jsonb_build_object('id', coalesce(left(v_id, 64), ''), 'motivo', 'fila_invalida'));
      continue;
    end if;
    v_vend := f->>'vendedor_id';
    v_rubro := public.rubro_normalizado(case when jsonb_typeof(f->'rubro') in ('string', 'number') then f->>'rubro' end);
    -- La clave la calcula el servidor (se ignora la que mande el cliente).
    v_clave := public.rubro_clave(v_rubro);
    v_pct := null;
    if coalesce(jsonb_typeof(f->'pct'), 'null') not in ('number', 'null')
       or length(coalesce(v_vend, '')) not between 1 and 64
       or v_clave is null
       or case when jsonb_typeof(f->'pct') = 'number'
               then (f->>'pct')::numeric < 0 or (f->>'pct')::numeric > 100
                    or (f->>'pct')::numeric <> round((f->>'pct')::numeric, 2)
               else false end then
      v_rechazadas := v_rechazadas || jsonb_build_array(jsonb_build_object('id', v_id, 'motivo', 'fila_invalida'));
      continue;
    end if;
    if jsonb_typeof(f->'pct') = 'number' then v_pct := round((f->>'pct')::numeric, 2); end if;
    begin
      v_at := (f->>'editado_at')::timestamptz;
    exception when others then
      v_at := null;
    end;
    -- Un editado_at futuro no puede ganar para siempre: se acota a now().
    v_at := least(coalesce(v_at, now()), now());

    if not exists (select 1 from public.vendedores ve where ve.id::text = v_vend) then
      v_rechazadas := v_rechazadas || jsonb_build_array(jsonb_build_object('id', v_id, 'motivo', 'vendedor_inexistente'));
      continue;
    end if;
    if not public.vendedor_habilitado(v_vend) then
      v_rechazadas := v_rechazadas || jsonb_build_array(jsonb_build_object('id', v_id, 'motivo', 'vendedor_inactivo'));
      continue;
    end if;

    select cr.vendedor_id, cr.rubro_clave into v_prev from public.comisiones_rubro cr where cr.id = v_id;
    if found then
      if v_prev.vendedor_id <> v_vend or v_prev.rubro_clave <> v_clave then
        v_rechazadas := v_rechazadas || jsonb_build_array(jsonb_build_object('id', v_id, 'motivo', 'id_en_uso'));
        continue;
      end if;
      update public.comisiones_rubro
         set pct = v_pct, rubro = v_rubro, editado_at = v_at, editado_por = v_por, editado_por_id = v_admin_id
       where id = v_id and v_at >= editado_at;
    else
      insert into public.comisiones_rubro (id, vendedor_id, rubro, rubro_clave, pct, editado_at, editado_por, editado_por_id)
      values (v_id, v_vend, v_rubro, v_clave, v_pct, v_at, v_por, v_admin_id)
      on conflict (vendedor_id, rubro_clave) do update
         set pct = excluded.pct, editado_at = excluded.editado_at,
             editado_por = excluded.editado_por, editado_por_id = excluded.editado_por_id
       where excluded.editado_at >= public.comisiones_rubro.editado_at;
    end if;

    select cr.id, cr.vendedor_id, cr.rubro, cr.rubro_clave, cr.pct, cr.editado_at into v_fila
      from public.comisiones_rubro cr
     where cr.vendedor_id = v_vend and cr.rubro_clave = v_clave;
    v_aceptadas := v_aceptadas || jsonb_build_array(jsonb_build_object(
      'id_enviado', v_id, 'id', v_fila.id, 'vendedor_id', v_fila.vendedor_id, 'rubro', v_fila.rubro,
      'rubro_clave', v_fila.rubro_clave, 'pct', v_fila.pct, 'editado_at', v_fila.editado_at));
  end loop;

  return jsonb_build_object('ok', true, 'filas', v_aceptadas, 'rechazadas', v_rechazadas);
end $$;

-- =====================================================================
-- 6. Cierres: modelo y desglose (AC-COMR-13)
-- =====================================================================
alter table public.comisiones_cierres add column if not exists modelo text not null default 'cliente'
  check (modelo in ('cliente', 'rubro'));
alter table public.comisiones_cierre_pedidos add column if not exists modelo text not null default 'cliente'
  check (modelo in ('cliente', 'rubro'));
alter table public.comisiones_cierre_pedidos add column if not exists desglose jsonb;

-- Inmutabilidad: igual que la 003 + modelo (y desglose en los renglones).
create or replace function public.tg_cierre_inmutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Los cierres de comisiones no se borran (anulalos con motivo)';
  end if;
  if new.id is distinct from old.id
     or new.desde is distinct from old.desde
     or new.hasta is distinct from old.hasta
     or new.cerrado_at is distinct from old.cerrado_at
     or new.cerrado_por is distinct from old.cerrado_por
     or new.cerrado_por_id is distinct from old.cerrado_por_id
     or new.total_vendido is distinct from old.total_vendido
     or new.total_comision is distinct from old.total_comision
     or new.totales is distinct from old.totales
     or new.detalle is distinct from old.detalle
     or new.lineas is distinct from old.lineas
     or new.modelo is distinct from old.modelo
     or new.created_at is distinct from old.created_at then
    raise exception 'Un cierre de comisiones confirmado no se puede modificar';
  end if;
  if old.estado = 'anulado' and (new.estado is distinct from old.estado
     or new.anulado_at is distinct from old.anulado_at
     or new.anulado_por is distinct from old.anulado_por
     or new.motivo_anulacion is distinct from old.motivo_anulacion) then
    raise exception 'Un cierre anulado no se puede modificar';
  end if;
  return new;
end $$;

create or replace function public.tg_cierre_renglon_inmutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Los renglones de un cierre no se borran';
  end if;
  if new.cierre_id is distinct from old.cierre_id
     or new.pedido_id is distinct from old.pedido_id
     or new.tipo is distinct from old.tipo
     or new.ajuste_seq is distinct from old.ajuste_seq
     or new.total is distinct from old.total
     or new.comision is distinct from old.comision
     or new.pct is distinct from old.pct
     or new.sin_comision is distinct from old.sin_comision
     or new.modelo is distinct from old.modelo
     or new.desglose is distinct from old.desglose
     or (new.vigente and not old.vigente) then
    raise exception 'Un renglon de cierre solo puede pasar de vigente a no vigente';
  end if;
  return new;
end $$;

-- =====================================================================
-- 7. Helpers de cálculo (NO expuestos: sin execute para anon/authenticated)
-- =====================================================================
-- Base por rubro de un pedido: renglones válidos (sin eliminado), precio al
-- centavo, cantidad > 0 con hasta 6 decimales, rubro guardado en el renglón o,
-- si no hay, el rubro actual del producto (AC-COMR-5). Sin rubro => clave null.
create or replace function public.comision_rubro_base(p_pedido_id text)
returns table(rubro_clave text, rubro text, subtotal numeric)
language sql stable set search_path = public, pg_temp as $$
  with it as (
    select i as item
      from public.pedidos p
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(p.items::jsonb) = 'array' then p.items::jsonb else '[]'::jsonb end) i
     where p.id::text = p_pedido_id
  ), validos as (
    select item,
           round(round((item->>'precio')::numeric, 2) * (item->>'cantidad')::numeric, 2) as subtotal,
           coalesce(
             nullif(public.rubro_normalizado(case when jsonb_typeof(item->'rubro') in ('string', 'number') then item->>'rubro' end), ''),
             (select public.rubro_normalizado(pr.categoria) from public.productos pr where pr.id::text = item->>'productoId' limit 1)
           ) as rubro
      from it
     where coalesce(item->>'eliminado', '') <> 'true'
       and jsonb_typeof(item->'precio') in ('number', 'string')
       and jsonb_typeof(item->'cantidad') in ('number', 'string')
       -- S-COMR-05: largo acotado (igual que RE_DECIMAL / RE_CANTIDAD de comisiones.js):
       -- un número patológico es un renglón inválido, no una excepción.
       and coalesce(item->>'precio', '') ~ '^-?[0-9]{1,12}(\.[0-9]{1,20})?$'
       and coalesce(item->>'cantidad', '') ~ '^[0-9]{1,9}(\.[0-9]{1,6})?$'
       and case when coalesce(item->>'precio', '') ~ '^-?[0-9]{1,12}(\.[0-9]{1,20})?$' then (item->>'precio')::numeric >= 0 else false end
       and case when coalesce(item->>'cantidad', '') ~ '^[0-9]{1,9}(\.[0-9]{1,6})?$' then (item->>'cantidad')::numeric > 0 else false end
  )
  select public.rubro_clave(v.rubro), min(nullif(v.rubro, '')), sum(v.subtotal)
    from validos v
   group by public.rubro_clave(v.rubro)
$$;

-- Comisión por parte: p_partes = [{vendedor_id, pct (división)}];
-- p_congelado = {vendedor_id: {rubro_clave: pct|null}} (ajustes de un cierre
-- 'rubro'). Un rubro sin % congelado usa el % vigente de comisiones_rubro.
-- Devuelve [{vendedor_id, pct, monto, rubros: [{rubro_clave, rubro, subtotal, pct}]}].
create or replace function public.comision_rubro_partes(p_pedido_id text, p_partes jsonb, p_congelado jsonb default null)
returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with base as (
    select * from public.comision_rubro_base(p_pedido_id) where rubro_clave is not null
  ), partes as (
    select pa->>'vendedor_id' as vendedor_id, (pa->>'pct')::numeric as division, ord
      from jsonb_array_elements(coalesce(p_partes, '[]'::jsonb)) with ordinality as x(pa, ord)
  ), detalle as (
    select pt.vendedor_id, pt.division, pt.ord, b.rubro_clave, b.rubro, b.subtotal,
           case when p_congelado is not null and (p_congelado -> pt.vendedor_id) ? b.rubro_clave
                then case when jsonb_typeof(p_congelado -> pt.vendedor_id -> b.rubro_clave) = 'number'
                          then (p_congelado -> pt.vendedor_id ->> b.rubro_clave)::numeric end
                else (select cr.pct from public.comisiones_rubro cr
                       where cr.vendedor_id = pt.vendedor_id and cr.rubro_clave = b.rubro_clave)
           end as pct
      from partes pt cross join base b
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'vendedor_id', pt.vendedor_id,
           'pct', pt.division,
           'monto', coalesce((select round(sum(d.subtotal * coalesce(d.pct, 0)) * pt.division / 10000, 2)
                                from detalle d where d.ord = pt.ord), 0),
           'rubros', coalesce((select jsonb_agg(jsonb_build_object('rubro_clave', d.rubro_clave, 'rubro', d.rubro,
                                                                   'subtotal', d.subtotal, 'pct', d.pct) order by d.rubro_clave)
                                 from detalle d where d.ord = pt.ord), '[]'::jsonb)
         ) order by pt.ord), '[]'::jsonb)
    from partes pt
$$;

revoke all on function public.rubro_normalizado(text) from public, anon, authenticated;
revoke all on function public.rubro_clave(text) from public, anon, authenticated;
revoke all on function public.comision_rubro_base(text) from public, anon, authenticated;
revoke all on function public.comision_rubro_partes(text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.tg_comisiones_rubro_sin_borrado() from public, anon, authenticated;

-- =====================================================================
-- 8. cerrar_comisiones con el modelo por rubro — MISMA firma y mismo orden
--    que la 003 (id -> autorización -> lock global -> idempotencia -> forma
--    -> período -> duplicados -> lineas = renglones -> pedidos -> montos ->
--    ajustes -> totales -> grabar).
-- =====================================================================
create or replace function public.cerrar_comisiones(p_cierre jsonb, p_renglones jsonb, p_admin_id text, p_admin_pin text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id          text := p_cierre->>'id';
  v_admin_id    text := trim(coalesce(p_admin_id, ''));
  v_por         text;
  v_existente   text;
  v_desde       date;
  v_hasta       date;
  v_invalidos   text[];
  v_conflictos  text[];
  v_tot_vend    numeric;
  v_tot_com     numeric;
  v_pin_ok      boolean;
  v_modelo      text;
  r             jsonb;
  v_pid         text;
  v_calc        jsonb;
  v_parte       jsonb;
  v_env         jsonb;
  v_suma        numeric;
  v_dif         numeric;
  v_cerrado_v   numeric;
  v_base        record;
  v_partes_base jsonb;
  v_cong        jsonb;
  v_partes_out  jsonb;
  v_desgloses   jsonb := '{}'::jsonb;
  v_desbordados text[];
begin
  if v_id is null or length(v_id) = 0 or length(v_id) > 64 then
    return jsonb_build_object('ok', false, 'motivo', 'id_invalido');
  end if;

  -- 1) Autorización (S-COM-01 / S-COM-16): igual que la 003.
  if length(v_admin_id) = 0 or length(v_admin_id) > 64 then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  select left(trim(ve.nombre), 80) into v_por
    from public.vendedores ve
   where ve.id::text = v_admin_id and ve.permiso = 1 and public.vendedor_habilitado(ve.id::text);
  v_pin_ok := coalesce(public.verificar_pin(v_admin_id, p_admin_pin), false);
  if not v_pin_ok or v_por is null or length(v_por) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  -- 2) Lock global (S-COM-21) y después idempotencia por id (S-COM-10/16).
  perform pg_advisory_xact_lock(hashtext('comisiones_global'));
  select coalesce(c.cerrado_por_id, '') into v_existente
    from public.comisiones_cierres c
   where c.id = v_id;
  if v_existente is not null then
    if v_existente = v_admin_id then
      return jsonb_build_object('ok', true, 'ya_existia', true);
    end if;
    return jsonb_build_object('ok', false, 'motivo', 'id_en_uso');
  end if;

  -- 3) Forma de la entrada.
  if jsonb_typeof(p_cierre) <> 'object' or octet_length(p_cierre::text) > 5000000 then
    return jsonb_build_object('ok', false, 'motivo', 'cierre_demasiado_grande');
  end if;
  -- S-COMR-03: el modelo del cierre lo decide el SERVIDOR (no se confía en el
  -- que manda el cliente). Se rechaza solo un valor que no es del catálogo.
  if coalesce(p_cierre->>'modelo', 'cliente') not in ('cliente', 'rubro') then
    return jsonb_build_object('ok', false, 'motivo', 'cierre_invalido');
  end if;
  if coalesce(jsonb_typeof(p_renglones), '') <> 'array' or jsonb_array_length(p_renglones) = 0
     or jsonb_array_length(p_renglones) > 5000 then
    return jsonb_build_object('ok', false, 'motivo', 'renglones_invalidos');
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_renglones) r
     where jsonb_typeof(r) <> 'object'
        or coalesce(r->>'tipo', '') not in ('pedido', 'ajuste')
        or length(coalesce(r->>'pedido_id', '')) not between 1 and 64
        or coalesce(jsonb_typeof(r->'total'), '') <> 'number'
        or coalesce(jsonb_typeof(r->'comision'), '') <> 'number'
        or coalesce(jsonb_typeof(r->'pct'), 'null') not in ('number', 'null')
        or coalesce(jsonb_typeof(r->'sin_comision'), 'boolean') <> 'boolean'
        or coalesce(r->>'modelo', 'cliente') not in ('cliente', 'rubro')
        or coalesce(jsonb_typeof(r->'partes'), 'array') <> 'array'
        or case when jsonb_typeof(r->'pct') = 'number'
                then (r->>'pct')::numeric < 0 or (r->>'pct')::numeric > 100
                else false end
        or case when r->>'tipo' = 'ajuste' and r ? 'ajuste_seq'
                then coalesce(r->>'ajuste_seq', '') !~ '^[0-9]{1,5}$'
                else false end
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'renglones_invalidos');
  end if;
  -- S-COMR-05: montos que no entran en numeric(16,2) => error claro con los pedidos.
  select array_agg(r->>'pedido_id') into v_invalidos
    from jsonb_array_elements(p_renglones) r
   where abs((r->>'total')::numeric) >= 10000000000000 or abs((r->>'comision')::numeric) >= 10000000000000;
  if v_invalidos is not null then
    return jsonb_build_object('ok', false, 'motivo', 'monto_desbordado', 'conflictos', to_jsonb(v_invalidos));
  end if;
  v_modelo := case when exists (select 1 from jsonb_array_elements(p_renglones) r
                                 where r->>'tipo' = 'pedido' or r->>'modelo' = 'rubro') then 'rubro' else 'cliente' end;
  -- S5 (REQ-COMR): después de la 005 ningún pedido se cierra con el % del
  -- cliente (una PWA vieja en caché). Los ajustes de cierres viejos sí.
  if exists (
    select 1 from jsonb_array_elements(p_renglones) r
     where r->>'tipo' = 'pedido' and coalesce(r->>'modelo', 'cliente') = 'cliente'
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'modelo_obsoleto');
  end if;

  -- Período válido (máx. 366 días).
  if coalesce(p_cierre->>'desde', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or coalesce(p_cierre->>'hasta', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'motivo', 'periodo_invalido');
  end if;
  v_desde := (p_cierre->>'desde')::date;
  v_hasta := (p_cierre->>'hasta')::date;
  if v_desde > v_hasta or (v_hasta - v_desde) + 1 > 366 then
    return jsonb_build_object('ok', false, 'motivo', 'periodo_invalido');
  end if;

  -- Un pedido aparece a lo sumo una vez como pedido y una vez como ajuste.
  if (select count(*) from jsonb_array_elements(p_renglones))
     <> (select count(distinct (r->>'pedido_id') || '|' || (r->>'tipo')) from jsonb_array_elements(p_renglones) r) then
    return jsonb_build_object('ok', false, 'motivo', 'renglones_duplicados');
  end if;

  -- "lineas" = renglones, con los mismos montos (S-COM-07).
  if coalesce(jsonb_typeof(p_cierre->'lineas'), '') <> 'array'
     or jsonb_array_length(p_cierre->'lineas') <> jsonb_array_length(p_renglones)
     or exists (
       select 1
         from jsonb_array_elements(p_cierre->'lineas') l
        where jsonb_typeof(l) <> 'object'
           or coalesce(jsonb_typeof(l->'total'), '') <> 'number'
           or coalesce(jsonb_typeof(l->'comision'), '') <> 'number'
     ) then
    return jsonb_build_object('ok', false, 'motivo', 'lineas_inconsistentes');
  end if;
  if exists (
    (select r->>'pedido_id', r->>'tipo', round((r->>'total')::numeric, 2), round((r->>'comision')::numeric, 2)
       from jsonb_array_elements(p_renglones) r
     except
     select l->>'pedidoId', case when l->>'tipo' = 'ajuste' then 'ajuste' else 'pedido' end,
            round((l->>'total')::numeric, 2), round((l->>'comision')::numeric, 2)
       from jsonb_array_elements(p_cierre->'lineas') l)
    union all
    (select l->>'pedidoId', case when l->>'tipo' = 'ajuste' then 'ajuste' else 'pedido' end,
            round((l->>'total')::numeric, 2), round((l->>'comision')::numeric, 2)
       from jsonb_array_elements(p_cierre->'lineas') l
     except
     select r->>'pedido_id', r->>'tipo', round((r->>'total')::numeric, 2), round((r->>'comision')::numeric, 2)
       from jsonb_array_elements(p_renglones) r)
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'lineas_inconsistentes');
  end if;

  -- 4) Cada pedido: existe, facturado, ENTREGADO y con fecha dentro del período.
  select array_agg(r->>'pedido_id') into v_invalidos
    from jsonb_array_elements(p_renglones) r
   where r->>'tipo' = 'pedido'
     and not exists (
       select 1 from public.pedidos p
        where p.id::text = r->>'pedido_id'
          and lower(coalesce(p.estado, '')) = 'facturado'
          and coalesce(p.entregado, false)
          and left(coalesce(p.fecha::text, ''), 10) between (p_cierre->>'desde') and (p_cierre->>'hasta')
     );
  if v_invalidos is not null then
    return jsonb_build_object('ok', false, 'motivo', 'pedido_invalido', 'conflictos', to_jsonb(v_invalidos));
  end if;

  -- 5a) Total del pedido = public.pedidos.total (negativo => 0).
  select array_agg(x.pedido_id) into v_invalidos
    from (
      select r->>'pedido_id' as pedido_id,
             round((r->>'total')::numeric, 2) as total_env,
             (select greatest(round(coalesce(p.total, 0)::numeric, 2), 0)
                from public.pedidos p where p.id::text = r->>'pedido_id') as total_srv
        from jsonb_array_elements(p_renglones) r
       where r->>'tipo' = 'pedido'
    ) x
   where x.total_env <> x.total_srv;
  if v_invalidos is not null then
    return jsonb_build_object('ok', false, 'motivo', 'montos_inconsistentes', 'conflictos', to_jsonb(v_invalidos));
  end if;

  -- 5b) Comisión por vendedor y rubro (AC-COMR-9/10): cada parte se recalcula
  --     con la tabla del SERVIDOR; el desglose lo arma el servidor.
  for r in select value from jsonb_array_elements(p_renglones) where value->>'tipo' = 'pedido' loop
    v_pid := r->>'pedido_id';
    if coalesce(r->>'sin_comision', 'false') = 'true' then
      if round((r->>'comision')::numeric, 2) <> 0 then
        v_invalidos := array_append(v_invalidos, v_pid);
      end if;
      continue;
    end if;
    if coalesce(jsonb_array_length(r->'partes'), 0) not between 1 and 2
       or exists (
         select 1 from jsonb_array_elements(r->'partes') pa
          where jsonb_typeof(pa) <> 'object'
             or length(coalesce(pa->>'vendedor_id', '')) not between 1 and 64
             or coalesce(jsonb_typeof(pa->'pct'), '') <> 'number'
             or coalesce(jsonb_typeof(pa->'monto'), '') <> 'number'
             or case when jsonb_typeof(pa->'pct') = 'number'
                     then (pa->>'pct')::numeric < 0 or (pa->>'pct')::numeric > 100
                          or (pa->>'pct')::numeric <> round((pa->>'pct')::numeric, 2)
                     else false end
             or not exists (select 1 from public.vendedores ve where ve.id::text = pa->>'vendedor_id')
       )
       or (select count(distinct pa->>'vendedor_id') from jsonb_array_elements(r->'partes') pa) <> jsonb_array_length(r->'partes')
       or (select sum(case when jsonb_typeof(pa->'pct') = 'number' then (pa->>'pct')::numeric end)
             from jsonb_array_elements(r->'partes') pa) is distinct from 100 then
      return jsonb_build_object('ok', false, 'motivo', 'renglones_invalidos');
    end if;
    -- S-COMR-05: la base de un pedido no puede pasar de 10^11 pesos (tope del dominio).
    if coalesce((select sum(b.subtotal) from public.comision_rubro_base(v_pid) b), 0) > 100000000000 then
      v_desbordados := array_append(v_desbordados, v_pid);
      continue;
    end if;
    v_calc := public.comision_rubro_partes(v_pid, r->'partes', null);
    v_suma := 0;
    for v_parte in select value from jsonb_array_elements(v_calc) loop
      v_env := null;
      select pa into v_env from jsonb_array_elements(r->'partes') pa where pa->>'vendedor_id' = v_parte->>'vendedor_id';
      if v_env is null or round((v_env->>'monto')::numeric, 2) <> (v_parte->>'monto')::numeric then
        v_invalidos := array_append(v_invalidos, v_pid);
      end if;
      v_suma := v_suma + (v_parte->>'monto')::numeric;
    end loop;
    if round((r->>'comision')::numeric, 2) <> v_suma then
      v_invalidos := array_append(v_invalidos, v_pid);
    end if;
    v_desgloses := v_desgloses || jsonb_build_object(v_pid, jsonb_build_object('partes', v_calc));
  end loop;
  if v_desbordados is not null then
    return jsonb_build_object('ok', false, 'motivo', 'monto_desbordado',
      'conflictos', to_jsonb((select array_agg(distinct x) from unnest(v_desbordados) x)));
  end if;
  if v_invalidos is not null then
    return jsonb_build_object('ok', false, 'motivo', 'montos_inconsistentes',
      'conflictos', to_jsonb((select array_agg(distinct x) from unnest(v_invalidos) x)));
  end if;

  -- S-COMR-03: el desglose por rubro que el cliente pone en lineas[] (lo que
  -- ven el historial y el PDF) tiene que coincidir con el que calculó el
  -- servidor (rubro, subtotal y % por vendedor). La comisión por rubro es un
  -- prorrateo informativo que ya cierra contra el monto de cada parte.
  select array_agg(distinct x.pid) into v_invalidos from (
    (select l->>'pedidoId' as pid, pa->>'vendedorId' as vid, d->>'rubroClave' as clave,
            case when jsonb_typeof(d->'subtotal') = 'number' then round((d->>'subtotal')::numeric, 2) end as subtotal,
            case when jsonb_typeof(d->'pct') = 'number' then round((d->>'pct')::numeric, 2) end as pct
       from jsonb_array_elements(p_cierre->'lineas') l
       cross join lateral jsonb_array_elements(case when jsonb_typeof(l->'partes') = 'array' then l->'partes' else '[]'::jsonb end) pa
       cross join lateral jsonb_array_elements(case when jsonb_typeof(pa->'desglose') = 'array' then pa->'desglose' else '[]'::jsonb end) d
      where l->>'modelo' = 'rubro' and coalesce(l->>'tipo', 'pedido') <> 'ajuste' and coalesce(d->>'rubroClave', '') <> ''
     except
     select s.key, pa->>'vendedor_id', rb->>'rubro_clave', round((rb->>'subtotal')::numeric, 2),
            case when jsonb_typeof(rb->'pct') = 'number' then round((rb->>'pct')::numeric, 2) end
       from jsonb_each(v_desgloses) s
       cross join lateral jsonb_array_elements(s.value->'partes') pa
       cross join lateral jsonb_array_elements(pa->'rubros') rb
      where s.key not like '%|ajuste')
    union all
    (select s.key, pa->>'vendedor_id', rb->>'rubro_clave', round((rb->>'subtotal')::numeric, 2),
            case when jsonb_typeof(rb->'pct') = 'number' then round((rb->>'pct')::numeric, 2) end
       from jsonb_each(v_desgloses) s
       cross join lateral jsonb_array_elements(s.value->'partes') pa
       cross join lateral jsonb_array_elements(pa->'rubros') rb
      where s.key not like '%|ajuste'
     except
     select l->>'pedidoId', pa->>'vendedorId', d->>'rubroClave',
            case when jsonb_typeof(d->'subtotal') = 'number' then round((d->>'subtotal')::numeric, 2) end,
            case when jsonb_typeof(d->'pct') = 'number' then round((d->>'pct')::numeric, 2) end
       from jsonb_array_elements(p_cierre->'lineas') l
       cross join lateral jsonb_array_elements(case when jsonb_typeof(l->'partes') = 'array' then l->'partes' else '[]'::jsonb end) pa
       cross join lateral jsonb_array_elements(case when jsonb_typeof(pa->'desglose') = 'array' then pa->'desglose' else '[]'::jsonb end) d
      where l->>'modelo' = 'rubro' and coalesce(l->>'tipo', 'pedido') <> 'ajuste' and coalesce(d->>'rubroClave', '') <> '')
  ) x;
  if v_invalidos is not null then
    return jsonb_build_object('ok', false, 'motivo', 'desglose_inconsistente', 'conflictos', to_jsonb(v_invalidos));
  end if;

  -- 6a) Ajustes de pedidos cerrados con el modelo VIEJO ('cliente'): la
  --     fórmula de la 003 sin cambios (diferencia de total × % congelado).
  select array_agg(a.pedido_id) into v_invalidos
    from (
      select r->>'pedido_id' as pedido_id,
             round((r->>'total')::numeric, 2) as total_env,
             round((r->>'comision')::numeric, 2) as com_env,
             (select count(*) from public.comisiones_cierre_pedidos cp
               where cp.pedido_id = r->>'pedido_id' and cp.tipo = 'pedido' and cp.vigente and not cp.sin_comision) as hay_base,
             (select max(cp.modelo) from public.comisiones_cierre_pedidos cp
               where cp.pedido_id = r->>'pedido_id' and cp.tipo = 'pedido' and cp.vigente) as base_modelo,
             (select coalesce(max(cp.pct), 0) from public.comisiones_cierre_pedidos cp
               where cp.pedido_id = r->>'pedido_id' and cp.tipo = 'pedido' and cp.vigente) as pct_base,
             (select coalesce(sum(cp.total), 0) from public.comisiones_cierre_pedidos cp
               where cp.pedido_id = r->>'pedido_id' and cp.vigente) as tot_cerrado,
             (select coalesce(sum(cp.comision), 0) from public.comisiones_cierre_pedidos cp
               where cp.pedido_id = r->>'pedido_id' and cp.vigente) as com_cerrada,
             coalesce((select greatest(round(coalesce(p.total, 0)::numeric, 2), 0)
                         from public.pedidos p
                        where p.id::text = r->>'pedido_id'
                          and lower(coalesce(p.estado, '')) = 'facturado'
                          and coalesce(p.entregado, false)), 0) as tot_actual
        from jsonb_array_elements(p_renglones) r
       where r->>'tipo' = 'ajuste'
    ) a
   where a.hay_base = 0
      or a.total_env <> a.tot_actual - a.tot_cerrado
      or (coalesce(a.base_modelo, 'cliente') = 'cliente'
          and a.com_env <> round(a.tot_actual * a.pct_base / 100, 2) - a.com_cerrada);
  if v_invalidos is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ajuste_invalido', 'conflictos', to_jsonb(v_invalidos));
  end if;

  -- 6b) Ajustes de pedidos cerrados con el modelo NUEVO ('rubro', AC-COMR-14):
  --     ítems actuales, MISMA asignación congelada y % congelado por rubro de
  --     la base (un rubro nuevo usa el % vigente). Se verifica cada parte
  --     contra lo cerrado vigente de ese vendedor.
  for r in select value from jsonb_array_elements(p_renglones) where value->>'tipo' = 'ajuste' loop
    v_pid := r->>'pedido_id';
    select cp.desglose, cp.modelo into v_base
      from public.comisiones_cierre_pedidos cp
     where cp.pedido_id = v_pid and cp.tipo = 'pedido' and cp.vigente and not cp.sin_comision
     limit 1;
    if not found or coalesce(v_base.modelo, 'cliente') <> 'rubro' then
      continue;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('vendedor_id', pb->>'vendedor_id', 'pct', pb->'pct')), '[]'::jsonb),
           coalesce(jsonb_object_agg(pb->>'vendedor_id', (
             select coalesce(jsonb_object_agg(rb->>'rubro_clave', rb->'pct'), '{}'::jsonb)
               from jsonb_array_elements(coalesce(pb->'rubros', '[]'::jsonb)) rb)), '{}'::jsonb)
      into v_partes_base, v_cong
      from jsonb_array_elements(coalesce(v_base.desglose->'partes', '[]'::jsonb)) pb;
    if exists (select 1 from public.pedidos p
                where p.id::text = v_pid
                  and lower(coalesce(p.estado, '')) = 'facturado'
                  and coalesce(p.entregado, false)) then
      v_calc := public.comision_rubro_partes(v_pid, v_partes_base, v_cong);
    else
      select coalesce(jsonb_agg(pb || jsonb_build_object('monto', 0, 'rubros', '[]'::jsonb)), '[]'::jsonb) into v_calc
        from jsonb_array_elements(v_partes_base) pb;
    end if;
    if coalesce(jsonb_array_length(r->'partes'), -1) <> jsonb_array_length(v_calc) then
      v_invalidos := array_append(v_invalidos, v_pid);
      continue;
    end if;
    v_suma := 0;
    v_partes_out := '[]'::jsonb;
    for v_parte in select value from jsonb_array_elements(v_calc) loop
      select coalesce(sum(round((pc->>'monto')::numeric, 2)), 0) into v_cerrado_v
        from public.comisiones_cierre_pedidos cp
        cross join lateral jsonb_array_elements(coalesce(cp.desglose->'partes', '[]'::jsonb)) pc
       where cp.pedido_id = v_pid and cp.vigente and pc->>'vendedor_id' = v_parte->>'vendedor_id';
      v_dif := (v_parte->>'monto')::numeric - v_cerrado_v;
      v_env := null;
      select pa into v_env from jsonb_array_elements(r->'partes') pa where pa->>'vendedor_id' = v_parte->>'vendedor_id';
      if v_env is null
         or case when jsonb_typeof(v_env->'monto') = 'number'
                 then round((v_env->>'monto')::numeric, 2) <> v_dif
                 else true end then
        v_invalidos := array_append(v_invalidos, v_pid);
      end if;
      v_suma := v_suma + v_dif;
      v_partes_out := v_partes_out || jsonb_build_array(v_parte || jsonb_build_object('monto', v_dif));
    end loop;
    if round((r->>'comision')::numeric, 2) <> v_suma then
      v_invalidos := array_append(v_invalidos, v_pid);
    end if;
    v_desgloses := v_desgloses || jsonb_build_object(v_pid || '|ajuste', jsonb_build_object('partes', v_partes_out));
  end loop;
  if v_invalidos is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ajuste_invalido',
      'conflictos', to_jsonb((select array_agg(distinct x) from unnest(v_invalidos) x)));
  end if;

  -- 7) Totales del cierre (S-COM-02): igual que la 003.
  select coalesce(sum(round((r->>'total')::numeric, 2)) filter (where r->>'tipo' = 'pedido'), 0),
         coalesce(sum(round((r->>'comision')::numeric, 2)) filter (where coalesce(r->>'sin_comision', 'false') <> 'true'), 0)
    into v_tot_vend, v_tot_com
    from jsonb_array_elements(p_renglones) r;
  if coalesce(jsonb_typeof(p_cierre->'total_vendido'), '') <> 'number'
     or coalesce(jsonb_typeof(p_cierre->'total_comision'), '') <> 'number'
     or coalesce(jsonb_typeof(p_cierre->'totales'->'totalVendido'), '') <> 'number'
     or coalesce(jsonb_typeof(p_cierre->'totales'->'totalComision'), '') <> 'number'
     or coalesce(jsonb_typeof(p_cierre->'totales'->'porVendedor'), 'array') <> 'array' then
    return jsonb_build_object('ok', false, 'motivo', 'totales_inconsistentes');
  end if;
  if round((p_cierre->>'total_vendido')::numeric, 2) <> v_tot_vend
     or round((p_cierre->>'total_comision')::numeric, 2) <> v_tot_com
     or round((p_cierre->'totales'->>'totalVendido')::numeric, 2) <> v_tot_vend
     or round((p_cierre->'totales'->>'totalComision')::numeric, 2) <> v_tot_com
     or (select coalesce(sum(case when jsonb_typeof(v->'totalComision') = 'number'
                                  then round((v->>'totalComision')::numeric, 2) end), 0)
           from jsonb_array_elements(coalesce(p_cierre->'totales'->'porVendedor', '[]'::jsonb)) v) <> v_tot_com then
    return jsonb_build_object('ok', false, 'motivo', 'totales_inconsistentes');
  end if;

  -- 8) Grabar con valores del servidor. modelo y desglose los fija el SERVIDOR.
  begin
    insert into public.comisiones_cierres (id, desde, hasta, cerrado_at, cerrado_por, cerrado_por_id, estado,
      total_vendido, total_comision, totales, detalle, lineas, modelo)
    values (v_id, v_desde, v_hasta, now(), v_por, v_admin_id, 'vigente',
      v_tot_vend, v_tot_com,
      coalesce(p_cierre->'totales', '{}'::jsonb), coalesce(p_cierre->'detalle', '[]'::jsonb), p_cierre->'lineas', v_modelo);

    insert into public.comisiones_cierre_pedidos (cierre_id, pedido_id, tipo, ajuste_seq, total, comision, pct, sin_comision, vigente, modelo, desglose)
    select v_id, r->>'pedido_id', r->>'tipo',
           case when r->>'tipo' = 'ajuste'
                then coalesce((select max(cp.ajuste_seq) from public.comisiones_cierre_pedidos cp
                                where cp.pedido_id = r->>'pedido_id' and cp.tipo = 'ajuste'), 0) + 1
                else 0 end,
           round((r->>'total')::numeric, 2), round((r->>'comision')::numeric, 2),
           case when jsonb_typeof(r->'pct') = 'number' then round((r->>'pct')::numeric, 2) end,
           coalesce(r->>'sin_comision', 'false') = 'true', true,
           case when r->>'tipo' = 'pedido' then coalesce(r->>'modelo', 'cliente')
                when v_desgloses ? ((r->>'pedido_id') || '|ajuste') then 'rubro'
                else 'cliente' end,
           case when r->>'tipo' = 'pedido' then v_desgloses -> (r->>'pedido_id')
                else v_desgloses -> ((r->>'pedido_id') || '|ajuste') end
      from jsonb_array_elements(p_renglones) r;
  exception when unique_violation then
    select array_agg(distinct cp.pedido_id) into v_conflictos
      from public.comisiones_cierre_pedidos cp
      join jsonb_array_elements(p_renglones) r on r->>'pedido_id' = cp.pedido_id
     where cp.vigente and cp.tipo = r->>'tipo';
    return jsonb_build_object('ok', false, 'motivo', 'ya_cerrado', 'conflictos', coalesce(to_jsonb(v_conflictos), '[]'::jsonb));
  end;

  return jsonb_build_object('ok', true);
end $$;

-- =====================================================================
-- 9. Permisos de las RPC (firma exacta). Los helpers no tienen execute.
-- =====================================================================
-- S-COMR-01 (paso inmediato): el desglose congelado de los renglones deja los %
-- por vendedor y rubro. La PWA NUNCA lee comisiones_cierre_pedidos (solo
-- comisiones_cierres, ver comisionesService.pullCierres), y las RPC
-- security definer la siguen leyendo como owner. Se quita el select a anon.
-- (la política de select queda, pero sin el grant de tabla no da acceso a anon)
revoke select on public.comisiones_cierre_pedidos from anon, authenticated;

revoke all on function public.cerrar_comisiones(jsonb, jsonb, text, text) from public;
grant execute on function public.cerrar_comisiones(jsonb, jsonb, text, text) to anon, authenticated;
revoke all on function public.admin_leer_comisiones_rubro(text, text) from public;
grant execute on function public.admin_leer_comisiones_rubro(text, text) to anon, authenticated;
revoke all on function public.admin_guardar_comisiones_rubro(text, text, jsonb) from public;
grant execute on function public.admin_guardar_comisiones_rubro(text, text, jsonb) to anon, authenticated;

commit;
