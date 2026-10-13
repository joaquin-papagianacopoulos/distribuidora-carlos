-- 002_seguridad_recomendada.sql — REQ-SEC (AC-SEC-5) — BORRADOR, NO APLICADO.
-- Generado por la auditoria 20261007-run1 (harness/reports/20261007-run1/security-report.md).
--
-- Contexto: la app entra a Supabase SOLO con la anon key (va dentro del bundle
-- JS, cualquiera la puede sacar del navegador). Sin Supabase Auth, la base no
-- puede distinguir a un admin de un desconocido: todo lo que la app hace, lo
-- puede hacer cualquiera con curl. Este script reduce el dano SIN romper el
-- flujo offline actual, en pasos. Cada paso dice que cambio necesita el cliente.
--
-- Como aplicarlo: Supabase -> SQL Editor. Correr y probar PASO por PASO, no todo
-- junto. Hacer backup antes (Database -> Backups). Ningun paso borra datos.
-- Los pasos marcados "REQUIERE CLIENTE NUEVO" solo se corren DESPUES de
-- publicar la version de la app que los usa; si no, la app deja de funcionar.

-- =====================================================================
-- PASO 0. Extension para hashear PINs (bcrypt). En Supabase vive en "extensions".
-- Cliente: sin cambios.
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

-- =====================================================================
-- PASO 1. PIN hasheado + verificacion en el servidor (no en el cliente).
-- Hoy: vendedores.pin esta en texto plano y la app lo baja con select('*')
-- (src/sync/syncService.js downloadMaestros/downloadVendedores) y lo compara
-- en el navegador (src/components/SelectorVendedor.js confirmarPin). Cualquiera
-- con la anon key lee el PIN del admin:  GET /rest/v1/vendedores?select=nombre,pin,permiso
-- Cliente: sin cambios todavia (la columna pin sigue existiendo en este paso).
-- =====================================================================
begin;

alter table public.vendedores add column if not exists pin_hash text;
alter table public.vendedores add column if not exists tiene_pin boolean not null default false;

-- Hashear los PINs existentes (bcrypt con sal propia por fila). NO borra "pin".
update public.vendedores
   set pin_hash  = extensions.crypt(trim(pin::text), extensions.gen_salt('bf', 10)),
       tiene_pin = true
 where pin is not null and trim(pin::text) <> '' and pin_hash is null;

-- Si alguien sigue escribiendo "pin" en texto plano (cliente viejo), se hashea
-- y se limpia al vuelo. Cuando el cliente nuevo este publicado, "pin" queda NULL.
create or replace function public.tg_vendedor_hashear_pin() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.pin is not null and trim(new.pin::text) <> '' then
    new.pin_hash := extensions.crypt(trim(new.pin::text), extensions.gen_salt('bf', 10));
  end if;
  new.tiene_pin := new.pin_hash is not null;
  return new;
end $$;
drop trigger if exists vendedor_hashear_pin on public.vendedores;
create trigger vendedor_hashear_pin before insert or update on public.vendedores
  for each row execute function public.tg_vendedor_hashear_pin();

-- Escalada de privilegios: hoy cualquiera puede hacer
--   POST /rest/v1/vendedores {"nombre":"x","permiso":1}
-- y entrar como admin sin PIN. Con anon/authenticated se fuerza permiso 2 y no
-- se permite subir permiso ni tocar el hash. Los cambios de rol/PIN pasan por
-- las RPC de abajo (SECURITY DEFINER: corren como el dueno, no como anon).
create or replace function public.tg_vendedor_sin_escalada() returns trigger
language plpgsql as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.permiso := 2;
      new.pin_hash := null;
      new.tiene_pin := false;
      -- (si llega "pin" en texto plano lo hashea el trigger vendedor_hashear_pin,
      --  que corre despues por orden alfabetico: "vendedor_h..." > "vendedor_e...")
    else
      -- La app hoy no hace UPDATE remoto de vendedores, asi que esto no rompe nada.
      -- Sin esta regla, cualquiera podria hacer PATCH {"pin":"0000"} al admin.
      if new.permiso is distinct from old.permiso
         or new.pin is distinct from old.pin
         or new.pin_hash is distinct from old.pin_hash
         or new.tiene_pin is distinct from old.tiene_pin then
        raise exception 'permiso y PIN solo se cambian con la RPC admin_guardar_vendedor';
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists vendedor_esc_sin_escalada on public.vendedores;
create trigger vendedor_esc_sin_escalada before insert or update on public.vendedores
  for each row execute function public.tg_vendedor_sin_escalada();

-- Limite de intentos para que no se pueda adivinar un PIN de 4 digitos por fuerza bruta.
create table if not exists public.vendedores_pin_intentos (
  vendedor_id text        not null,
  intento_en  timestamptz not null default now(),
  ok          boolean     not null
);
create index if not exists vendedores_pin_intentos_idx on public.vendedores_pin_intentos (vendedor_id, intento_en desc);
alter table public.vendedores_pin_intentos enable row level security;
-- Sin politicas: solo lo usan las funciones SECURITY DEFINER.
revoke all on public.vendedores_pin_intentos from anon, authenticated;

-- verificar_pin: devuelve true/false. Nunca devuelve el PIN ni el hash.
-- Bloquea 15 minutos despues de 5 fallos.
create or replace function public.verificar_pin(p_vendedor_id text, p_pin text)
returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash   text;
  v_fallos int;
  v_ok     boolean;
begin
  select count(*) into v_fallos
    from public.vendedores_pin_intentos
   where vendedor_id = p_vendedor_id and not ok and intento_en > now() - interval '15 minutes';
  if v_fallos >= 5 then
    raise exception 'Demasiados intentos. Proba de nuevo en 15 minutos.' using errcode = 'P0001';
  end if;

  select pin_hash into v_hash from public.vendedores where id::text = p_vendedor_id;
  if v_hash is null then
    return false;  -- sin PIN o inexistente: el cliente decide (vendedor sin PIN entra directo)
  end if;
  v_ok := extensions.crypt(coalesce(trim(p_pin), ''), v_hash) = v_hash;
  insert into public.vendedores_pin_intentos (vendedor_id, ok) values (p_vendedor_id, v_ok);
  return v_ok;
end $$;
revoke all on function public.verificar_pin(text, text) from public;
grant execute on function public.verificar_pin(text, text) to anon, authenticated;

-- admin_guardar_vendedor: alta/edicion de vendedores con rol o PIN, autorizada
-- por el PIN de un admin (permiso = 1 y con PIN). Devuelve el id.
-- RUN 20261012-2106: La 004 la redefine (S-COM-20 + activo). Si se vuelve a
-- correr la 002 PASO 1, volver a correr la 004. El cuerpo de aca no se toca
-- porque la version nueva usa la columna activo, que no existe hasta la 004.
create or replace function public.admin_guardar_vendedor(
  p_admin_id text, p_admin_pin text,
  p_vendedor_id text, p_nombre text, p_zona text, p_permiso int,
  p_pin_nuevo text default null, p_borrar_pin boolean default false
) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id text;
begin
  -- Iteracion 3 (S-COM-16, mismo criterio que la 003): verificar_pin se llama
  -- SIEMPRE y "no es admin" o "PIN incorrecto" devuelven lo mismo (null), para
  -- no revelar que ids son admin.
  -- return (no raise): un raise haria rollback del intento fallido y
  -- permitiria fuerza bruta sin limite. El cliente trata null como "no autorizado".
  if not coalesce(public.verificar_pin(p_admin_id, p_admin_pin), false)
     or not exists (select 1 from public.vendedores where id::text = p_admin_id and permiso = 1 and pin_hash is not null) then
    return null;
  end if;
  if p_permiso not in (1, 2, 3) then
    raise exception 'permiso invalido';
  end if;
  if length(coalesce(trim(p_nombre), '')) = 0 or length(p_nombre) > 120 then
    raise exception 'nombre invalido';
  end if;

  if p_vendedor_id is null then
    insert into public.vendedores (nombre, zona, permiso)
    values (trim(p_nombre), coalesce(trim(p_zona), ''), p_permiso)
    returning id::text into v_id;
  else
    update public.vendedores set nombre = trim(p_nombre), zona = coalesce(trim(p_zona), ''), permiso = p_permiso
     where id::text = p_vendedor_id returning id::text into v_id;
  end if;

  if p_borrar_pin then
    update public.vendedores set pin = null, pin_hash = null, tiene_pin = false where id::text = v_id;
  elsif p_pin_nuevo is not null and trim(p_pin_nuevo) <> '' then
    if trim(p_pin_nuevo) !~ '^\d{4,8}$' then
      raise exception 'El PIN debe tener entre 4 y 8 digitos';
    end if;
    update public.vendedores
       set pin = null, pin_hash = extensions.crypt(trim(p_pin_nuevo), extensions.gen_salt('bf', 10)), tiene_pin = true
     where id::text = v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.admin_guardar_vendedor(text, text, text, text, text, int, text, boolean) from public;
grant execute on function public.admin_guardar_vendedor(text, text, text, text, text, int, text, boolean) to anon, authenticated;

commit;

-- =====================================================================
-- PASO 2 (REQUIERE CLIENTE NUEVO). Ocultar pin / pin_hash a la anon key.
-- Cambios en el cliente ANTES de correr este paso:
--   a) src/sync/syncService.js (downloadMaestros y downloadVendedores):
--        supabase.from('vendedores').select('id,nombre,zona,permiso,tiene_pin')
--      (con privilegios por columna, select('*') da "permission denied").
--      Guardar localmente tiene_pin en vez de pin; dejar de copiar r.pin.
--   b) src/components/SelectorVendedor.js confirmarPin:
--        const { data, error } = await supabase.rpc('verificar_pin',
--          { p_vendedor_id: String(pinVendedor.remoteId ?? pinVendedor.id), p_pin: pin });
--        if (error || data !== true) { setPinError('PIN incorrecto'); return; }
--      y usar v.tiene_pin en lugar de v.pin para mostrar el candado.
--      Offline: solo permitir reentrar al ultimo vendedor que ya se valido en
--      ESTE dispositivo (no hay forma segura de validar un PIN de 4 digitos
--      offline: cualquier hash local se rompe por fuerza bruta en milisegundos).
--   c) src/pages/Configuracion.js handleSave (tab vendedores) y
--      src/sync/syncService.js syncVendedor: si cambia permiso o PIN, llamar a
--        supabase.rpc('admin_guardar_vendedor', { p_admin_id, p_admin_pin, ... })
--      pidiendo el PIN del admin en un modal; no mandar "pin" en texto plano.
-- =====================================================================
-- begin;
-- update public.vendedores set pin = null where pin is not null and pin_hash is not null;  -- borra SOLO el texto plano ya hasheado
-- revoke select on public.vendedores from anon, authenticated;
-- do $$
-- declare cols text;
-- begin
--   select string_agg(quote_ident(column_name), ', ') into cols
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'vendedores' and column_name not in ('pin', 'pin_hash');
--   execute format('grant select (%s) on public.vendedores to anon, authenticated', cols);
-- end $$;
-- -- (UPDATE de pin/pin_hash/permiso ya lo bloquea el trigger vendedor_esc_sin_escalada del PASO 1.)
-- commit;

-- =====================================================================
-- PASO 3. Nadie con la anon key puede BORRAR datos criticos.
-- La app no borra estas tablas en Supabase (pedidos se "borran" con
-- estado='eliminado' via update), asi que no requiere cambios en el cliente.
-- (Si la tabla no tiene RLS, el revoke igual aplica: se chequea antes que RLS.)
-- =====================================================================
begin;
revoke delete, truncate on public.pedidos             from anon, authenticated;
revoke delete, truncate on public.clientes            from anon, authenticated;
revoke delete, truncate on public.vendedores          from anon, authenticated;
revoke delete, truncate on public.movimientos_stock   from anon, authenticated;
revoke delete, truncate on public.ingresos_mercaderia from anon, authenticated;
revoke truncate         on public.productos           from anon, authenticated;
revoke truncate         on public.proveedores         from anon, authenticated;
revoke truncate         on public.deudas              from anon, authenticated;
revoke truncate         on public.faltantes           from anon, authenticated;
commit;
-- Pendiente (REQUIERE CLIENTE NUEVO): productos, proveedores, deudas y faltantes
-- hoy se borran fisicamente desde la app (Configuracion.js:302 y :344,
-- deudaRepository.js:73/:167, faltanteRepository.js:23, Faltantes.js:273).
-- Pasarlos a borrado logico (columna borrado_en timestamptz + filtro en los
-- select) y despues:
--   revoke delete on public.productos, public.proveedores, public.deudas, public.faltantes from anon, authenticated;

-- =====================================================================
-- PASO 4. Integridad del ledger de stock (movimientos_stock / ingresos).
-- Problemas que cierra:
--   * Hoy un UPDATE con la anon key puede cambiar "ref" de una venta a otra
--     cosa; el pedido deja de "ver" su descuento y el dispositivo lo vuelve a
--     descontar => stock duplicado. Tambien se pueden reescribir fecha/usuario/nota.
--   * Se pueden insertar ventas positivas o ingresos negativos.
--   * created_at lo puede mandar el cliente (auditoria falsa).
-- Cliente: compatible con el actual (el re-upsert manda los mismos valores y el
-- unico cambio legitimo de ref es pedido-local:N -> pedido:<remoteId>).
-- =====================================================================
begin;

alter table public.movimientos_stock   add column if not exists origen_ip text;
alter table public.ingresos_mercaderia add column if not exists origen_ip text;

create or replace function public.tg_movimiento_inmutable() returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id
     or new.producto_id is distinct from old.producto_id
     or new.cantidad    is distinct from old.cantidad
     or new.tipo        is distinct from old.tipo
     or new.fecha       is distinct from old.fecha
     or new.usuario     is distinct from old.usuario
     or new.nota        is distinct from old.nota
     or new.created_at  is distinct from old.created_at
     or new.origen_ip   is distinct from old.origen_ip then
    raise exception 'movimientos_stock es inmutable: registra un ajuste en lugar de modificar';
  end if;
  -- Unico cambio permitido: re-key de pedido offline a id remoto.
  if new.ref is distinct from old.ref
     and not (old.ref like 'pedido-local:%' and new.ref like 'pedido:%') then
    raise exception 'movimientos_stock: ref solo puede pasar de pedido-local:* a pedido:*';
  end if;
  return new;
end $$;
-- (el trigger movimiento_inmutable de la 001 ya apunta a esta funcion)

create or replace function public.tg_ingreso_inmutable() returns trigger language plpgsql as $$
begin
  if new.items is distinct from old.items
     or new.proveedor_id      is distinct from old.proveedor_id
     or new.factura_proveedor is distinct from old.factura_proveedor
     or new.fecha             is distinct from old.fecha
     or new.usuario           is distinct from old.usuario
     or new.created_at        is distinct from old.created_at
     or new.origen_ip         is distinct from old.origen_ip then
    raise exception 'ingresos_mercaderia es inmutable';
  end if;
  return new;
end $$;

-- Sello del servidor en el INSERT: hora real e IP de origen (PostgREST la expone
-- en request.headers). Sirve para auditar quien cargo un movimiento falso.
create or replace function public.tg_sello_servidor() returns trigger language plpgsql as $$
declare h json;
begin
  new.created_at := now();
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then h := null;
  end;
  new.origen_ip := left(coalesce(h->>'x-forwarded-for', h->>'x-real-ip'), 100);
  return new;
end $$;
drop trigger if exists sello_servidor on public.movimientos_stock;
create trigger sello_servidor before insert on public.movimientos_stock
  for each row execute function public.tg_sello_servidor();
drop trigger if exists sello_servidor on public.ingresos_mercaderia;
create trigger sello_servidor before insert on public.ingresos_mercaderia
  for each row execute function public.tg_sello_servidor();

-- Signo coherente con el tipo y formato de ref. NOT VALID: no revisa filas
-- viejas (no rompe nada existente), si las nuevas.
do $$ begin
  alter table public.movimientos_stock add constraint movimientos_signo_chk check (
    (tipo = 'venta' and cantidad < 0)
    or (tipo in ('ingreso', 'anulacion') and cantidad > 0)
    or tipo in ('inicial', 'ajuste')
  ) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.movimientos_stock add constraint movimientos_ref_chk check (
    ref ~ '^(pedido|pedido-local|ingreso|ajuste):[A-Za-z0-9_.:-]{1,80}$'
  ) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.movimientos_stock add constraint movimientos_textos_chk check (
    length(coalesce(usuario, '')) <= 80 and length(coalesce(nota, '')) <= 200 and length(id) <= 64 and length(producto_id) <= 64
  ) not valid;
exception when duplicate_object then null; end $$;

-- Un movimiento tipo 'ingreso' tiene que tener su cabecera (el cliente sube
-- primero ingresos_mercaderia y despues movimientos_stock: syncStock()).
create or replace function public.tg_movimiento_ingreso_con_cabecera() returns trigger language plpgsql as $$
begin
  if new.tipo = 'ingreso' and not exists (
    select 1 from public.ingresos_mercaderia i where 'ingreso:' || i.id = new.ref
  ) then
    raise exception 'movimiento de ingreso sin cabecera en ingresos_mercaderia';
  end if;
  return new;
end $$;
drop trigger if exists movimiento_ingreso_con_cabecera on public.movimientos_stock;
create trigger movimiento_ingreso_con_cabecera before insert on public.movimientos_stock
  for each row execute function public.tg_movimiento_ingreso_con_cabecera();

-- proveedores: la 001 usa "for all" (incluye DELETE). Separar por comando.
-- REQUIERE CLIENTE NUEVO si se quiere quitar el DELETE: Configuracion.js:344
-- borra proveedores en Supabase. Mientras tanto se deja DELETE pero solo para
-- proveedores sin ingresos (la FK on delete restrict ya lo garantiza).
drop policy if exists proveedores_rw     on public.proveedores;
drop policy if exists proveedores_select on public.proveedores;
drop policy if exists proveedores_insert on public.proveedores;
drop policy if exists proveedores_update on public.proveedores;
drop policy if exists proveedores_delete on public.proveedores;
create policy proveedores_select on public.proveedores for select to anon, authenticated using (true);
create policy proveedores_insert on public.proveedores for insert to anon, authenticated with check (true);
create policy proveedores_update on public.proveedores for update to anon, authenticated using (true) with check (true);
create policy proveedores_delete on public.proveedores for delete to anon, authenticated using (true);
-- Cuando el cliente use borrado logico: drop policy proveedores_delete on public.proveedores;

commit;

-- =====================================================================
-- PASO 5 (objetivo final, REQUIERE CLIENTE NUEVO). Autenticacion real.
-- Mientras todo entre como "anon", RLS no puede separar admin de vendedor ni
-- proteger CUIT/telefonos/domicilios de clientes, deudas o precios: la anon
-- key ES la llave de todo. Opciones, de menor a mayor esfuerzo:
--   a) Supabase Auth con un usuario por vendedor (email/clave o magic link) y
--      una tabla perfiles(user_id uuid, vendedor_id, permiso). Login una vez
--      online; la sesion se renueva sola y sirve offline.
--   b) Edge Function "login-vendedor": recibe vendedor_id + PIN, llama a
--      verificar_pin y devuelve un JWT firmado con claims
--      { role: 'authenticated', vendedor_id, permiso } que el cliente pasa a
--      supabase.auth.setSession / headers. (Necesita el JWT secret del
--      proyecto, que vive SOLO en la Edge Function, nunca en el bundle.)
-- Con cualquiera de las dos, las politicas pasan a ser, por ejemplo:
--   create policy pedidos_vendedor on public.pedidos for select to authenticated
--     using ((auth.jwt()->>'permiso')::int in (1, 3) or vendedor_nombre = auth.jwt()->>'vendedor_nombre');
--   create policy movs_insert_admin on public.movimientos_stock for insert to authenticated
--     with check ((auth.jwt()->>'permiso')::int = 1 or tipo in ('venta', 'anulacion'));
-- y se hace: revoke all on all tables in schema public from anon;
-- =====================================================================
