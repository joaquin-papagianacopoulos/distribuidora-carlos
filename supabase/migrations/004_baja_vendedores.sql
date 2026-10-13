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
--
-- Modificada en RUN 20261012-2106 antes de aplicarse (S-COM-20 / AC-VEN-2 /
-- AC-VEN-4). Confirmado por el orquestador: esta 004 todavía NO se aplicó en
-- Supabase, por eso se edita en el lugar (si ya se hubiera aplicado, estos
-- cambios irían en una 005 con los mismos "create or replace"). Cambios:
--   a) admin_baja_vendedor cuenta como "otro admin" solo a uno activo Y con
--      pin_hash (un admin sin PIN no puede autorizar nada).
--   b) REDEFINE admin_guardar_vendedor de la 002 (S-COM-20): misma firma y
--      mismos defaults, más: exige que el admin que autoriza esté activo, no
--      deja ponerle PIN a un vendedor dado de baja, un admin no puede quedar
--      sin PIN y no se puede degradar ni quitarle el PIN al último admin
--      activo con PIN. Si se vuelve a correr la 002 PASO 1 (que pisa la
--      función con la versión vieja), hay que volver a correr esta 004.
--   c) S-VEN-03 (iteración 2): trigger vendedor_zz_inactivo_sin_pin, que
--      impide dejar pin / pin_hash en un vendedor con activo = false (ni por
--      la admin_guardar_vendedor vieja de la 002 ni por un cliente viejo).
--      La 002 no lo toca, así que sobrevive a re-correr la 002 PASO 1. Las
--      RPC de la 003 ya exigen activo vía public.vendedor_habilitado().
--
-- CONSULTA DE CONTROL ANTES DE APLICAR (S-VEN-02): admins sin PIN, que hoy
-- entran con UI de admin con un toque. Si devuelve filas, ponerles PIN por
-- admin_guardar_vendedor o degradarlas ANTES de correr esta 004:
--   select id, nombre from public.vendedores where permiso = 1 and pin_hash is null;

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
-- 2b. S-VEN-03: un vendedor dado de baja no puede tener PIN. Corre para
--     TODOS (también security definer y la admin_guardar_vendedor vieja de
--     la 002). "zz": se dispara después de vendedor_hashear_pin (orden
--     alfabético), así ve el pin_hash ya calculado. La baja (activo=false
--     + pin_hash null en el mismo update) pasa sin problema.
-- =====================================================================
create or replace function public.tg_vendedor_inactivo_sin_pin() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.activo = false and (new.pin_hash is not null or nullif(trim(coalesce(new.pin::text, '')), '') is not null) then
    raise exception 'vendedor_inactivo: un vendedor dado de baja no puede tener PIN';
  end if;
  return new;
end $$;
drop trigger if exists vendedor_zz_inactivo_sin_pin on public.vendedores;
create trigger vendedor_zz_inactivo_sin_pin before insert or update on public.vendedores
  for each row execute function public.tg_vendedor_inactivo_sin_pin();

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

  -- 3) Nunca el último admin activo CON PIN (AC-VEN-4, RUN 20261012-2106):
  --    un admin sin pin_hash no puede autorizar RPC, así que no cuenta.
  if v_permiso = 1 then
    select count(*) into v_otros_admin
      from public.vendedores
     where permiso = 1 and activo and pin_hash is not null and id::text <> v_vend_id;
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

-- =====================================================================
-- 4. admin_guardar_vendedor REDEFINIDA (S-COM-20, AC-VEN-2, AC-VEN-4).
--    RUN 20261012-2106. Misma firma y mismos defaults que la 002 (si no,
--    "create or replace" falla). Respuesta igual que la 002: el id (texto) o
--    null si no autoriza. Los raise de abajo van DESPUÉS de autorizar: el
--    rollback solo descarta un verificar_pin EXITOSO, así que no habilita
--    fuerza bruta (mismo razonamiento que el security-report de 2022).
--    Mensajes (el cliente los mapea): vendedor_inexistente, vendedor_inactivo,
--    admin_sin_pin, ultimo_admin.
--    OJO: si se vuelve a correr la 002 PASO 1, volver a correr esta 004.
-- =====================================================================
create or replace function public.admin_guardar_vendedor(
  p_admin_id text, p_admin_pin text,
  p_vendedor_id text, p_nombre text, p_zona text, p_permiso int,
  p_pin_nuevo text default null, p_borrar_pin boolean default false
) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_id          text;
  v_destino     public.vendedores%rowtype;
  v_pin_nuevo   text := nullif(trim(coalesce(p_pin_nuevo, '')), '');
  v_queda_pin   boolean;
  v_otros_admin int;
begin
  -- a) Autorización (igual que la 002, S-COM-16): verificar_pin SIEMPRE y
  --    "no es admin" / "PIN incorrecto" / "admin dado de baja" devuelven lo
  --    mismo (null, sin raise). Lo único nuevo: el admin tiene que estar activo.
  if not coalesce(public.verificar_pin(p_admin_id, p_admin_pin), false)
     or not exists (
       select 1 from public.vendedores
        where id::text = p_admin_id and permiso = 1 and activo and pin_hash is not null
     ) then
    return null;
  end if;

  -- b) Validación de datos (igual que la 002).
  if p_permiso not in (1, 2, 3) then
    raise exception 'permiso invalido';
  end if;
  if length(coalesce(trim(p_nombre), '')) = 0 or length(p_nombre) > 120 then
    raise exception 'nombre invalido';
  end if;
  if not coalesce(p_borrar_pin, false) and v_pin_nuevo is not null and v_pin_nuevo !~ '^\d{4,8}$' then
    raise exception 'El PIN debe tener entre 4 y 8 digitos';
  end if;

  -- c) Misma clave de lock que admin_baja_vendedor: una baja y una
  --    degradación concurrentes no pueden dejar la base sin admin con PIN.
  perform pg_advisory_xact_lock(hashtext('vendedores_baja'));

  -- d) Destino existente y activo (no se le puede volver a poner PIN a un
  --    dado de baja: AC-VEN-2).
  if p_vendedor_id is not null then
    select * into v_destino from public.vendedores where id::text = p_vendedor_id for update;
    if not found then
      raise exception 'vendedor_inexistente';
    end if;
    if v_destino.activo = false then
      raise exception 'vendedor_inactivo';
    end if;
  end if;

  -- e) Un admin no puede quedar sin PIN.
  v_queda_pin := case
    when coalesce(p_borrar_pin, false) then false
    when v_pin_nuevo is not null then true
    when p_vendedor_id is not null then v_destino.pin_hash is not null
    else false
  end;
  if p_permiso = 1 and not v_queda_pin then
    raise exception 'admin_sin_pin';
  end if;

  -- f) No degradar ni quitarle el PIN al último admin activo con PIN.
  if p_vendedor_id is not null
     and v_destino.permiso = 1 and v_destino.activo and v_destino.pin_hash is not null
     and (p_permiso <> 1 or not v_queda_pin) then
    select count(*) into v_otros_admin
      from public.vendedores
     where permiso = 1 and activo and pin_hash is not null and id::text <> p_vendedor_id;
    if v_otros_admin = 0 then
      raise exception 'ultimo_admin';
    end if;
  end if;

  -- g) Insert / update iguales a la 002.
  if p_vendedor_id is null then
    insert into public.vendedores (nombre, zona, permiso)
    values (trim(p_nombre), coalesce(trim(p_zona), ''), p_permiso)
    returning id::text into v_id;
  else
    update public.vendedores set nombre = trim(p_nombre), zona = coalesce(trim(p_zona), ''), permiso = p_permiso
     where id::text = p_vendedor_id returning id::text into v_id;
    if v_id is null then
      raise exception 'vendedor_inexistente';
    end if;
  end if;

  if coalesce(p_borrar_pin, false) then
    update public.vendedores set pin = null, pin_hash = null, tiene_pin = false where id::text = v_id;
  elsif v_pin_nuevo is not null then
    update public.vendedores
       set pin = null, pin_hash = extensions.crypt(v_pin_nuevo, extensions.gen_salt('bf', 10)), tiene_pin = true
     where id::text = v_id;
  end if;
  return v_id;
end $$;

revoke all on function public.admin_guardar_vendedor(text, text, text, text, text, int, text, boolean) from public;
grant execute on function public.admin_guardar_vendedor(text, text, text, text, text, int, text, boolean) to anon, authenticated;

commit;
