-- 025_remito_redondeo_medio_pago.sql — Tanda 2 (2026-11-10): REQ-RED, REQ-DMP.
-- NO SE APLICA AUTOMATICAMENTE: se corre a mano en Supabase -> SQL Editor, DESPUES de la 024
-- (hacer backup antes). Idempotente (re-ejecutable), no borra datos y tolera tablas ausentes.
-- La app sigue funcionando sin esta migracion: los campos nuevos quedan locales y se avisa por consola.
--
--  1. pedidos.redondeo / redondeo_multiplo / total_redondeado (AC-RED-2). `pedidos.total` NO cambia:
--     sigue siendo la suma de renglones (cerrar_comisiones de la 014 valida contra ese valor).
--     Sin backfill: null = pedido anterior al redondeo (nunca se redondea).
--  2. deudas.medio_pago / referencia_pago / cobros jsonb (AC-DMP-1).
--  3. tienda_config.redondeo_total (singleton id = 1; ajuste "Redondeo del total", default 500) (AC-RED-1).
--  4. public.ajustes_app_leer(): lectura publica del ajuste (dato no sensible).
--  5. public.admin_guardar_redondeo(...): escritura solo con PIN de admin (patron verificar_pin).
-- No toca productos (sin grants por columna), ni cerrar_comisiones, ni admin_facturas_a_emitir.

begin;

-- =====================================================================
-- 1. pedidos: redondeo del total
-- =====================================================================
do $mig$
begin
  if to_regclass('public.pedidos') is null then
    raise notice '025: no existe public.pedidos, se saltea';
    return;
  end if;

  alter table public.pedidos add column if not exists redondeo numeric(14,2);
  alter table public.pedidos add column if not exists redondeo_multiplo integer;
  alter table public.pedidos add column if not exists total_redondeado numeric(14,2);

  if not exists (select 1 from pg_constraint where conname = 'pedidos_redondeo_multiplo_valido') then
    alter table public.pedidos add constraint pedidos_redondeo_multiplo_valido
      check (redondeo_multiplo is null or redondeo_multiplo in (0, 500, 1000)) not valid;
  end if;
end
$mig$;

-- =====================================================================
-- 2. deudas: medio de pago e historial de cobros
-- =====================================================================
do $mig$
begin
  if to_regclass('public.deudas') is null then
    raise notice '025: no existe public.deudas, se saltea';
    return;
  end if;

  alter table public.deudas add column if not exists medio_pago text;
  alter table public.deudas add column if not exists referencia_pago text;
  alter table public.deudas add column if not exists cobros jsonb;

  if not exists (select 1 from pg_constraint where conname = 'deudas_medio_pago_valido') then
    alter table public.deudas add constraint deudas_medio_pago_valido
      check (medio_pago is null or medio_pago in ('efectivo', 'transferencia', 'mixto', 'rendicion')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deudas_referencia_pago_largo') then
    alter table public.deudas add constraint deudas_referencia_pago_largo
      check (referencia_pago is null or char_length(referencia_pago) <= 60) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deudas_cobros_formato') then
    alter table public.deudas add constraint deudas_cobros_formato
      check (cobros is null or (jsonb_typeof(cobros) = 'array' and jsonb_array_length(cobros) <= 200 and octet_length(cobros::text) <= 60000)) not valid;
  end if;
end
$mig$;

-- =====================================================================
-- 3. tienda_config: ajuste "Redondeo del total" (sincronizado entre dispositivos)
-- =====================================================================
do $mig$
begin
  if to_regclass('public.tienda_config') is null then
    raise notice '025: no existe public.tienda_config, se saltea';
    return;
  end if;

  alter table public.tienda_config add column if not exists redondeo_total integer not null default 500;

  if not exists (select 1 from pg_constraint where conname = 'tienda_config_redondeo_total_valido') then
    alter table public.tienda_config add constraint tienda_config_redondeo_total_valido
      check (redondeo_total in (0, 500, 1000)) not valid;
  end if;
end
$mig$;

-- =====================================================================
-- 4. Lectura publica del ajuste (sin PIN: no es un dato sensible)
-- =====================================================================
create or replace function public.ajustes_app_leer()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_red integer := 500;
begin
  begin
    select redondeo_total into v_red from public.tienda_config where id = 1;
  exception when others then
    v_red := 500;
  end;
  return jsonb_build_object('redondeo_total', coalesce(v_red, 500));
end $$;

revoke all on function public.ajustes_app_leer() from public;
grant execute on function public.ajustes_app_leer() to anon, authenticated;

-- =====================================================================
-- 5. Guardar el ajuste: solo admin con PIN (mismo patron que admin_reasignar_vendedor_pedido, 024)
-- =====================================================================
create or replace function public.admin_guardar_redondeo(p_admin_id text, p_admin_pin text, p_multiplo integer)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin_id text := trim(coalesce(p_admin_id, ''));
  v_es_admin boolean;
  v_pin_ok   boolean;
begin
  -- id invalido => no_autorizado ANTES de verificar_pin (sonda sin gastar intentos).
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
  if p_multiplo is null or p_multiplo not in (0, 500, 1000) then
    return jsonb_build_object('ok', false, 'motivo', 'multiplo_invalido');
  end if;

  update public.tienda_config set redondeo_total = p_multiplo, updated_at = now() where id = 1;
  if not found then
    insert into public.tienda_config (id, redondeo_total) values (1, p_multiplo)
      on conflict (id) do update set redondeo_total = excluded.redondeo_total, updated_at = now();
  end if;
  return jsonb_build_object('ok', true, 'redondeo_total', p_multiplo);
end $$;

revoke all on function public.admin_guardar_redondeo(text, text, integer) from public;
grant execute on function public.admin_guardar_redondeo(text, text, integer) to anon, authenticated;

commit;
