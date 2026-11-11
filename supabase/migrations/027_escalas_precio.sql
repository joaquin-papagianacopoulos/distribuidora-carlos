-- 027_escalas_precio.sql — 2026-11-10: REQ-ESC2, escalas por bultos con PRECIO directo (en vez de %).
-- NO SE APLICA AUTOMATICAMENTE: se corre a mano en Supabase -> SQL Editor, DESPUES de la 026
-- (hacer backup antes). Idempotente (re-ejecutable) y no destructiva: no borra datos ni revoca grants.
--
-- Que cambia: cada escala de productos.escalas_bulto puede ser
--     {"desde": 3, "precio": 950}   -> desde 3 bultos, $950 por unidad (NUEVO)
--     {"desde": 5, "pct": 8}        -> desde 5 bultos, 8 % menos (formato viejo, sigue funcionando)
-- Solo se reemplazan dos helpers de la 026; las RPC (admin_guardar_productos, tienda_catalogo,
-- tienda_crear_pedido) los usan y no hace falta tocarlas:
--   * escalas_bulto_normalizar: acepta "precio" (numero > 0, hasta 2 decimales). Si una escala trae un
--     precio valido manda el precio; si no, el %.
--   * tienda_precio_con_escala: con "precio" cobra ese precio (solo si baja el precio base); con "pct"
--     sigue igual que la 026.
-- Espejo de src/domain/precios.js (normalizarEscalasBulto / precioDeEscala).
-- SIN esta migracion el servidor descarta las escalas con precio al guardar productos (quedan solo en el
-- dispositivo) y la tienda online no las aplica.
-- En un pedido web, tienda_crear_pedido guarda escalaDesde (y escalaPct null si la escala es por precio):
-- la app toma el precio de las escalas congeladas del renglon (escalaDeRenglon).

begin;

do $mig$
begin
  if to_regprocedure('public.tienda_escala_alcanzada(jsonb, integer, numeric)') is null then
    raise exception 'Falta la migracion 026_escalas_bulto.sql: aplicarla antes que esta.';
  end if;
end
$mig$;

create or replace function public.escalas_bulto_normalizar(p jsonb)
returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $fn$
declare
  v_out    jsonb := '[]'::jsonb;
  v_e      jsonb;
  v_desde  numeric;
  v_pct    numeric;
  v_precio numeric;
  v_ult    numeric := 0;
  v_n      integer := 0;
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
    if coalesce(jsonb_typeof(v_e->'desde'), '') <> 'number' then
      continue;
    end if;
    v_desde := (v_e->>'desde')::numeric;
    if v_desde <> trunc(v_desde) or v_desde < 2 or v_desde > 9999 then
      continue;
    end if;
    -- REQ-ESC2: precio valido => manda el precio; si no, el % (escala vieja).
    v_precio := null;
    v_pct := null;
    if coalesce(jsonb_typeof(v_e->'precio'), '') = 'number' then
      v_precio := (v_e->>'precio')::numeric;
      if not (v_precio > 0 and v_precio <= 999999999999) or v_precio <> round(v_precio, 2) then
        v_precio := null;
      end if;
    end if;
    if v_precio is null then
      if coalesce(jsonb_typeof(v_e->'pct'), '') <> 'number' then
        continue;
      end if;
      v_pct := (v_e->>'pct')::numeric;
      if not (v_pct > 0 and v_pct < 100) or v_pct <> round(v_pct, 2) then
        continue;
      end if;
    end if;
    if v_n > 0 and v_desde <= v_ult then
      continue;
    end if;
    if v_precio is not null then
      v_out := v_out || jsonb_build_object('desde', v_desde::integer, 'precio', v_precio);
    else
      v_out := v_out || jsonb_build_object('desde', v_desde::integer, 'pct', v_pct);
    end if;
    v_ult := v_desde;
    v_n := v_n + 1;
    if v_n >= 3 then
      exit;
    end if;
  end loop;
  return v_out;
end
$fn$;

-- Precio por unidad con la escala alcanzada. Con "precio": ese precio. Con "pct" (vieja):
-- ceil(precio * (100 - pct) / 100) al peso entero. Si no baja el precio queda el precio base.
create or replace function public.tienda_precio_con_escala(p_precio numeric, p_escalas jsonb, p_bulto_x integer, p_unidades numeric)
returns numeric
language sql immutable set search_path = public, pg_temp as $fn$
  select case
    when p_precio is null then null
    when v.nuevo is not null and v.nuevo < round(p_precio, 2) then v.nuevo
    else round(p_precio, 2)
  end
  from (
    select case
      when a.e is null then null
      when jsonb_typeof(a.e->'precio') = 'number' then round((a.e->>'precio')::numeric, 2)
      else ceil(round(p_precio, 2) * 100 * (10000 - round(coalesce((a.e->>'pct')::numeric, 0) * 100)) / 1000000)
    end as nuevo
    from (select public.tienda_escala_alcanzada(p_escalas, p_bulto_x, p_unidades) as e) a
  ) v
$fn$;

revoke all on function public.escalas_bulto_normalizar(jsonb) from public, anon, authenticated;
revoke all on function public.tienda_precio_con_escala(numeric, jsonb, integer, numeric) from public, anon, authenticated;

commit;
