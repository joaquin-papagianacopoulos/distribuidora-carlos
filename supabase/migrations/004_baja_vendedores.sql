-- 004_baja_vendedores.sql — REQ-VEN (AC-VEN-1, 2, 4, 5).
-- Corrida 20261012-ven. Se aplica A MANO en Supabase -> SQL Editor (hacer
-- backup antes). Es idempotente: se puede correr más de una vez. No borra datos.
--
-- Bug que arregla: el botón "Eliminar" de Configuración -> Vendedores borraba
-- solo en el dispositivo; Supabase seguía teniendo la fila y el próximo pull la
-- volvía a bajar. Borrar de verdad no corresponde: la 002 (PASO 3) revoca
-- DELETE sobre vendedores y los pedidos/cierres nombran al vendedor.
--
-- Decisión: BAJA LÓGICA. vendedores.activo = false + se borra el PIN hasheado
-- (pin_hash = null, tiene_pin = false) para que no pueda volver a ingresar.
-- Nunca DELETE. Pedidos, clientes y cierres que lo nombran no se tocan.
--
-- ORDEN DE APLICACIÓN: REQUIERE el PASO 1 de 002_seguridad_recomendada.sql
-- (pin_hash + public.verificar_pin). Si no está, aborta al principio sin tocar nada.
--
-- La app tolera que esto no se haya corrido: si la columna "activo" o la RPC
-- no existen, muestra "Falta la migración 004 en Supabase" y no borra nada.

begin;

-- =====================================================================
-- 0. Prerrequisito: PASO 1 de la 002 (mismo chequeo que la 003)
-- =====================================================================
do $$
begin
  if to_regprocedure('public.verificar_pin(text, text)') is null then
    raise exception 'Falta public.verificar_pin(text, text): aplicar antes 002_seguridad_recomendada.sql PASO 1 (PIN hasheado) y despues volver a correr esta 004.';
  end if;
end $$;

-- =====================================================================
-- 1. Columna activo (AC-VEN-2). Todos los existentes quedan activos.
-- =====================================================================
alter table public.vendedores add column if not exists activo boolean not null default true;

-- Si ya se corrió el PASO 2 de la 002 (select por columna para anon), la
-- columna nueva no está en ese grant: sin esto el pull daría "permission denied".
-- Nunca se da select de pin / pin_hash.
grant select (activo) on public.vendedores to anon, authenticated;

-- =====================================================================
-- 2. La anon key no puede cambiar "activo" con un PATCH directo: solo la RPC.
--    (Sin esto, cualquiera podría "resucitar" a un vendedor dado de baja.)
--    La RPC es security definer: corre como el dueño, no como anon.
-- =====================================================================
create or replace function public.tg_vendedor_activo_solo_rpc() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.activo := true;
    elsif new.activo is distinct from old.activo then
      raise exception 'activo solo se cambia con la RPC admin_baja_vendedor';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists vendedor_activo_solo_rpc on public.vendedores;
create trigger vendedor_activo_solo_rpc before insert or update on public.vendedores
  for each row execute function public.tg_vendedor_activo_solo_rpc();

-- =====================================================================
-- 3. RPC admin_baja_vendedor (AC-VEN-1, 2, 4)
--    Respuesta jsonb: { ok: true } o { ok: false, motivo }.
--    motivo: 'no_autorizado' (genérico: no es admin o PIN incorrecto, igual
--    que S-COM-16), 'no_existe', 'propio_admin', 'ultimo_admin'.
-- =====================================================================
create or replace function public.admin_baja_vendedor(p_admin_id text, p_admin_pin text, p_vendedor_id text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin_id    text := trim(coalesce(p_admin_id, ''));
  v_vend_id     text := trim(coalesce(p_vendedor_id, ''));
  v_es_admin    boolean;
  v_pin_ok      boolean;
  v_permiso     int;
  v_activo      boolean;
  v_otros_admin int;
begin
  -- 1) Autorización: verificar_pin se llama SIEMPRE y "no es admin" o "PIN
  --    incorrecto" devuelven lo mismo (no hay oráculo de qué ids son admin).
  --    return (no raise): el intento fallido queda registrado y cuenta para
  --    el bloqueo por fuerza bruta de verificar_pin.
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

  if length(v_vend_id) = 0 or length(v_vend_id) > 64 then
    return jsonb_build_object('ok', false, 'motivo', 'no_existe');
  end if;

  -- 2) No darse de baja a sí mismo (AC-VEN-4).
  if v_vend_id = v_admin_id then
    return jsonb_build_object('ok', false, 'motivo', 'propio_admin');
  end if;

  -- Serializa bajas concurrentes: dos admins no pueden dejar el sistema sin admin.
  perform pg_advisory_xact_lock(hashtext('vendedores_baja'));

  select permiso, activo into v_permiso, v_activo
    from public.vendedores where id::text = v_vend_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_existe');
  end if;

  -- Idempotente: si ya estaba de baja, igual se asegura que no quede PIN.
  if not v_activo then
    update public.vendedores set pin = null, pin_hash = null, tiene_pin = false
     where id::text = v_vend_id and (pin_hash is not null or tiene_pin);
    return jsonb_build_object('ok', true, 'ya_inactivo', true);
  end if;

  -- 3) Nunca el último admin activo (AC-VEN-4).
  if v_permiso = 1 then
    select count(*) into v_otros_admin
      from public.vendedores
     where permiso = 1 and activo and id::text <> v_vend_id;
    if v_otros_admin = 0 then
      return jsonb_build_object('ok', false, 'motivo', 'ultimo_admin');
    end if;
  end if;

  -- 4) Baja lógica (AC-VEN-2): no borra filas.
  update public.vendedores
     set activo = false, pin = null, pin_hash = null, tiene_pin = false
   where id::text = v_vend_id;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.admin_baja_vendedor(text, text, text) from public;
grant execute on function public.admin_baja_vendedor(text, text, text) to anon, authenticated;

commit;
