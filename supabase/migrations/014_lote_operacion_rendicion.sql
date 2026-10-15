-- 014_lote_operacion_rendicion.sql — REQ-REN (AC-REN-1..5): rendicion de devoluciones,
-- cambios y notas de credito (lote operacion, RUN 20261015-1630).
-- Se aplica A MANO en Supabase -> SQL Editor, DESPUES de 005, 011 y 012 y ANTES de publicar la
-- app (hacer backup antes). Idempotente y no destructiva: no borra tablas, columnas ni datos.
--
-- Contenido:
--  1. rendiciones: documento inmutable (UUID). Solo pasa de vigente a anulada (con motivo) y
--     se le anota el efecto en la cuenta del cliente UNA vez. No se borra nunca.
--  2. cuenta_clientes: ledger privado de saldo a favor de clientes (solo se agregan filas).
--  3. movimientos_stock: tipo nuevo 'devolucion' y ref 'rendicion:<uuid>'. Los CHECK se
--     reemplazan NOT VALID (no revisan filas viejas). Un movimiento de rendicion exige su
--     cabecera en rendiciones (no se pueden forjar devoluciones con la anon key).
--  4. RPC con PIN de admin (_es_admin_con_pin, 011): admin_rendiciones_guardar,
--     admin_rendicion_anular, admin_rendicion_efecto, admin_cuenta_clientes_guardar,
--     admin_rendiciones_bajar.
--  5. Comisiones (AC-REN-5): la base por rubro y el total de un pedido descuentan las
--     rendiciones vigentes (numeros congelados en la rendicion). cerrar_comisiones se redefine
--     copiando la 005 y cambiando SOLO el total del pedido de 5a y 6a por el helper.
--
-- Seguridad (decision autorizada por el duenio, D1): rendiciones y cuenta_clientes tienen RLS
-- activo, SIN policies y SIN grants para anon/authenticated. Solo se accede por las RPC
-- security definer de arriba, que validan el PIN del admin.

begin;

-- 0. Prerrequisitos
do $$
begin
  if to_regprocedure('public._es_admin_con_pin(text, text)') is null then
    raise exception 'Falta la migracion 011_lote_operacion_facturacion_zonas.sql: aplicarla antes que esta.';
  end if;
  if to_regprocedure('public.tg_compras_synced_at()') is null then
    raise exception 'Falta la migracion 012_lote_operacion_compras_stock.sql: aplicarla antes que esta.';
  end if;
  if to_regprocedure('public.comision_rubro_base(text)') is null
     or to_regprocedure('public.rubro_clave(text)') is null then
    raise exception 'Falta la migracion 005_comisiones_rubro.sql: aplicarla antes que esta.';
  end if;
  if to_regclass('public.movimientos_stock') is null then
    raise exception 'Falta la migracion 001_altas_y_stock.sql.';
  end if;
end $$;

-- 1. rendiciones
create table if not exists public.rendiciones (
  id                     uuid primary key,
  pedido_id              text not null check (char_length(pedido_id) between 1 and 64),
  cliente_id             text check (cliente_id is null or char_length(cliente_id) <= 64),
  cliente_nombre         text check (cliente_nombre is null or char_length(cliente_nombre) <= 200),
  fecha                  date not null,
  tipo                   text not null check (tipo in ('devolucion','cambio','nc')),
  renglones              jsonb not null default '[]'::jsonb check (jsonb_typeof(renglones) = 'array' and pg_column_size(renglones) < 262144),
  credito_cents          bigint not null check (abs(credito_cents) <= 100000000000),
  credito_comision_cents bigint not null default 0 check (abs(credito_comision_cents) <= 100000000000),
  comision_renglones     jsonb not null default '[]'::jsonb check (jsonb_typeof(comision_renglones) = 'array' and pg_column_size(comision_renglones) < 65536),
  tipo_factura           text check (tipo_factura is null or tipo_factura in ('A','B')),
  nro_nc                 text check (nro_nc is null or char_length(nro_nc) <= 30),
  motivo                 text not null check (char_length(motivo) between 3 and 300),
  efecto                 jsonb check (efecto is null or (jsonb_typeof(efecto) = 'object' and pg_column_size(efecto) < 65536)),
  efecto_anulacion       jsonb check (efecto_anulacion is null or (jsonb_typeof(efecto_anulacion) = 'object' and pg_column_size(efecto_anulacion) < 65536)),
  estado                 text not null default 'vigente' check (estado in ('vigente','anulada')),
  anulada_at             timestamptz,
  anulada_por            text check (anulada_por is null or char_length(anulada_por) <= 64),
  motivo_anulacion       text check (motivo_anulacion is null or char_length(motivo_anulacion) <= 300),
  usuario                text check (usuario is null or char_length(usuario) <= 80),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  synced_at              timestamptz not null default now()
);
create index if not exists rendiciones_sync_idx on public.rendiciones (synced_at, id);
create index if not exists rendiciones_pedido_idx on public.rendiciones (pedido_id);
create index if not exists rendiciones_fecha_idx on public.rendiciones (fecha);
alter table public.rendiciones enable row level security;
revoke all on public.rendiciones from public, anon, authenticated;

-- Inmutable: solo vigente -> anulada (una vez) y anotar el efecto (una vez). Nunca se borra.
create or replace function public.tg_rendicion_inmutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'rendiciones no se borran: se anulan';
  end if;
  if new.id is distinct from old.id or new.pedido_id is distinct from old.pedido_id
     or new.cliente_id is distinct from old.cliente_id or new.cliente_nombre is distinct from old.cliente_nombre
     or new.fecha is distinct from old.fecha or new.tipo is distinct from old.tipo
     or new.renglones is distinct from old.renglones or new.credito_cents is distinct from old.credito_cents
     or new.credito_comision_cents is distinct from old.credito_comision_cents
     or new.comision_renglones is distinct from old.comision_renglones
     or new.tipo_factura is distinct from old.tipo_factura or new.nro_nc is distinct from old.nro_nc
     or new.motivo is distinct from old.motivo or new.usuario is distinct from old.usuario
     or new.created_at is distinct from old.created_at then
    raise exception 'rendiciones es inmutable (solo se anula)';
  end if;
  if old.estado = 'anulada' and (new.estado is distinct from old.estado
     or new.anulada_at is distinct from old.anulada_at or new.anulada_por is distinct from old.anulada_por
     or new.motivo_anulacion is distinct from old.motivo_anulacion) then
    raise exception 'la rendicion ya esta anulada';
  end if;
  if old.estado = 'vigente' and new.estado = 'vigente' and (new.anulada_at is not null
     or new.anulada_por is not null or new.motivo_anulacion is not null) then
    raise exception 'datos de anulacion sin anular';
  end if;
  if old.efecto is not null and new.efecto is distinct from old.efecto then
    raise exception 'el efecto de la rendicion ya esta registrado';
  end if;
  if old.efecto_anulacion is not null and new.efecto_anulacion is distinct from old.efecto_anulacion then
    raise exception 'el efecto de la anulacion ya esta registrado';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists rendicion_inmutable on public.rendiciones;
create trigger rendicion_inmutable before update or delete on public.rendiciones
  for each row execute function public.tg_rendicion_inmutable();
drop trigger if exists rendiciones_synced_at on public.rendiciones;
create trigger rendiciones_synced_at before insert or update on public.rendiciones
  for each row execute function public.tg_compras_synced_at();

-- 2. cuenta_clientes (saldo a favor). Ids deterministas (<rendId>:favor:a / :x) o UUID.
create table if not exists public.cuenta_clientes (
  id           text primary key check (char_length(id) between 1 and 64),
  cliente_id   text not null check (char_length(cliente_id) between 1 and 64),
  rendicion_id uuid references public.rendiciones(id) on delete restrict,
  tipo         text not null check (tipo in ('saldo_favor','uso_saldo')),
  monto_cents  bigint not null check (monto_cents <> 0 and abs(monto_cents) <= 100000000000),
  fecha        date not null,
  usuario      text check (usuario is null or char_length(usuario) <= 80),
  created_at   timestamptz not null default now(),
  synced_at    timestamptz not null default now()
);
create index if not exists cuenta_clientes_sync_idx on public.cuenta_clientes (synced_at, id);
create index if not exists cuenta_clientes_cliente_idx on public.cuenta_clientes (cliente_id);
alter table public.cuenta_clientes enable row level security;
revoke all on public.cuenta_clientes from public, anon, authenticated;

-- Solo se agregan filas: un error se corrige con un asiento compensatorio.
create or replace function public.tg_cuenta_clientes_inmutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'cuenta_clientes es inmutable (se compensa con otro asiento)';
end $$;
drop trigger if exists cuenta_clientes_inmutable on public.cuenta_clientes;
create trigger cuenta_clientes_inmutable before update or delete on public.cuenta_clientes
  for each row execute function public.tg_cuenta_clientes_inmutable();
drop trigger if exists cuenta_clientes_synced_at on public.cuenta_clientes;
create trigger cuenta_clientes_synced_at before insert on public.cuenta_clientes
  for each row execute function public.tg_compras_synced_at();

-- 3. movimientos_stock: tipo 'devolucion' y ref 'rendicion:'. Se reemplazan los CHECK con
--    NOT VALID (no revisan filas viejas, si las nuevas). Correr dos veces da lo mismo.
alter table public.movimientos_stock drop constraint if exists movimientos_stock_tipo_check;
alter table public.movimientos_stock add constraint movimientos_stock_tipo_check
  check (tipo in ('inicial','ajuste','ingreso','venta','anulacion','devolucion')) not valid;

alter table public.movimientos_stock drop constraint if exists movimientos_signo_chk;
alter table public.movimientos_stock add constraint movimientos_signo_chk check (
  (tipo = 'venta' and cantidad < 0)
  or (tipo = 'ingreso' and cantidad > 0)
  or (tipo = 'anulacion' and (cantidad > 0 or ref ~ '^rendicion:'))
  or (tipo = 'devolucion' and cantidad > 0)
  or tipo in ('inicial', 'ajuste')
) not valid;

alter table public.movimientos_stock drop constraint if exists movimientos_ref_chk;
alter table public.movimientos_stock add constraint movimientos_ref_chk check (
  ref ~ '^(pedido|pedido-local|ingreso|ajuste|rendicion):[A-Za-z0-9_.:-]{1,80}$'
) not valid;

-- Un movimiento de rendicion tiene que tener su cabecera (el cliente sube primero la rendicion
-- por RPC y recien despues los movimientos: syncStock los retiene) y coincidir con un renglon
-- esperado (S-REN-02): id determinista '<rendId>:<idx>:a|x', mismo producto, tipo y cantidad
-- con signo que el renglon <idx>. ':a' = alta ('devolucion' + / 'venta' -; la merma no mueve
-- stock); ':x' = anulacion (opuesta, solo con la rendicion anulada). 'devolucion' solo con ref
-- de rendicion. security definer (S-REN-01): anon no puede leer rendiciones y el trigger corre
-- con el rol que inserta; sin execute para anon (revoke mas abajo).
create or replace function public.tg_movimiento_rendicion_con_cabecera() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_estado    text;
  v_renglones jsonb;
  v_partes    text[];
  v_ren       jsonb;
  v_cant      integer;
  v_tipo_esp  text;
  v_cant_esp  integer;
begin
  if tg_op = 'UPDATE' and coalesce(old.ref, '') ~ '^rendicion:' and new.ref is distinct from old.ref then
    raise exception 'no se cambia la ref de un movimiento de rendicion';
  end if;
  if new.tipo = 'devolucion' and coalesce(new.ref, '') !~ '^rendicion:' then
    raise exception 'movimiento de devolucion sin rendicion';
  end if;
  if coalesce(new.ref, '') ~ '^rendicion:' then
    select r.estado, r.renglones into v_estado, v_renglones
      from public.rendiciones r where 'rendicion:' || r.id::text = new.ref;
    if v_estado is null then
      raise exception 'movimiento de rendicion sin cabecera en rendiciones';
    end if;
    if new.tipo not in ('devolucion', 'venta', 'anulacion') then
      raise exception 'tipo de movimiento invalido para una rendicion';
    end if;
    v_partes := regexp_match(coalesce(new.id, ''), '^([0-9a-f-]{36}):([0-9]{1,3}):([ax])$');
    if v_partes is null or 'rendicion:' || v_partes[1] <> new.ref then
      raise exception 'id de movimiento de rendicion invalido';
    end if;
    v_ren := case when jsonb_typeof(v_renglones) = 'array' then v_renglones -> (v_partes[2]::integer) end;
    if v_ren is null or jsonb_typeof(v_ren) <> 'object'
       or coalesce(v_ren->>'cantidad', '') !~ '^[0-9]{1,7}$'
       or v_ren->>'productoId' is distinct from new.producto_id then
      raise exception 'movimiento de rendicion fuera de los renglones';
    end if;
    v_cant := (v_ren->>'cantidad')::integer;
    if v_ren->>'sentido' = 'entra' and coalesce(v_ren->>'vuelveAlStock', 'true') <> 'false' then
      v_tipo_esp := 'devolucion';
      v_cant_esp := v_cant;
    elsif v_ren->>'sentido' = 'sale' then
      v_tipo_esp := 'venta';
      v_cant_esp := -v_cant;
    else
      raise exception 'movimiento de rendicion fuera de los renglones';
    end if;
    if v_partes[3] = 'x' then
      if v_estado <> 'anulada' then
        raise exception 'anulacion de una rendicion vigente';
      end if;
      v_tipo_esp := 'anulacion';
      v_cant_esp := -v_cant_esp;
    end if;
    if new.tipo <> v_tipo_esp or new.cantidad <> v_cant_esp then
      raise exception 'movimiento de rendicion fuera de los renglones';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists movimiento_rendicion_con_cabecera on public.movimientos_stock;
create trigger movimiento_rendicion_con_cabecera before insert or update on public.movimientos_stock
  for each row execute function public.tg_movimiento_rendicion_con_cabecera();

-- 4a. Guardar rendiciones (alta). on conflict do nothing: un reintento confirma sin duplicar.
--     El servidor valida cantidades contra public.pedidos.items (facturado - devuelto vigente).
create or replace function public.admin_rendiciones_guardar(p_admin_id text, p_admin_pin text, p_lote jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin     text := left(trim(coalesce(p_admin_id, '')), 64);
  v_filas     jsonb;
  v_fila      jsonb;
  v_ren       jsonb;
  v_id        text;
  v_uuid      uuid;
  v_pid       text;
  v_tipo      text;
  v_cred      bigint;
  v_cred_com  bigint;
  v_suma_com  numeric;
  v_motivo    text;
  v_total     numeric;
  v_previo    bigint;
  v_entra     integer;
  v_sale      integer;
  v_suma_e    numeric;
  v_suma_s    numeric;
  v_pmin      numeric;
  v_fact      numeric;
  v_dev       numeric;
  v_prod      record;
  v_confirmados jsonb := '[]'::jsonb;
  v_rechazados  jsonb := '[]'::jsonb;
begin
  if not public._es_admin_con_pin(p_admin_id, p_admin_pin) then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  v_filas := case when jsonb_typeof(p_lote) = 'object' then p_lote->'rendiciones' else null end;
  if v_filas is null or jsonb_typeof(v_filas) <> 'array'
     or jsonb_array_length(v_filas) < 1 or jsonb_array_length(v_filas) > 200 then
    return jsonb_build_object('ok', false, 'motivo', 'lote_invalido');
  end if;

  for v_fila in select value from jsonb_array_elements(v_filas) loop
    v_id := null;
    begin
      if jsonb_typeof(v_fila) <> 'object' then
        v_rechazados := v_rechazados || jsonb_build_object('id', null::text, 'motivo', 'datos_invalidos');
        continue;
      end if;
      v_id := v_fila->>'id';
      v_uuid := v_id::uuid;
      -- Reintento: si ya existe (vigente o anulada) se confirma igual, sin tocar nada.
      if exists (select 1 from public.rendiciones where id = v_uuid) then
        v_confirmados := v_confirmados || to_jsonb(v_id);
        continue;
      end if;
      v_pid := coalesce(v_fila->>'pedido_id', '');
      v_tipo := coalesce(v_fila->>'tipo', '');
      v_motivo := trim(coalesce(v_fila->>'motivo', ''));
      if v_pid !~ '^[0-9A-Za-z-]{1,64}$'
         or v_tipo not in ('devolucion','cambio','nc')
         or char_length(v_motivo) < 3 or char_length(v_motivo) > 300
         or coalesce(v_fila->>'credito_cents', '') !~ '^-?[0-9]{1,12}$'
         or coalesce(v_fila->>'credito_comision_cents', '0') !~ '^-?[0-9]{1,12}$'
         or coalesce(v_fila->>'fecha', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         or (nullif(v_fila->>'tipo_factura', '') is not null and v_fila->>'tipo_factura' not in ('A','B'))
         or char_length(coalesce(v_fila->>'nro_nc', '')) > 30
         or char_length(coalesce(v_fila->>'cliente_id', '')) > 64
         or char_length(coalesce(v_fila->>'cliente_nombre', '')) > 200
         or jsonb_typeof(v_fila->'renglones') is distinct from 'array'
         or jsonb_array_length(v_fila->'renglones') > 200
         or jsonb_typeof(v_fila->'comision_renglones') is distinct from 'array'
         or jsonb_array_length(v_fila->'comision_renglones') > 100 then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo', 'datos_invalidos');
        continue;
      end if;
      v_cred := (v_fila->>'credito_cents')::bigint;
      v_cred_com := coalesce((v_fila->>'credito_comision_cents')::bigint, 0);
      if abs(v_cred) > 100000000000 or abs(v_cred_com) > 100000000000 then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo', 'datos_invalidos');
        continue;
      end if;

      -- Renglones: forma y conteo por sentido.
      v_entra := 0;
      v_sale := 0;
      v_suma_e := 0;
      v_suma_s := 0;
      for v_ren in select value from jsonb_array_elements(v_fila->'renglones') loop
        if jsonb_typeof(v_ren) <> 'object'
           or coalesce(v_ren->>'productoId', '') !~ '^[0-9A-Za-z_-]{1,64}$'
           or coalesce(v_ren->>'cantidad', '') !~ '^[0-9]{1,7}$'
           or (v_ren->>'cantidad')::integer < 1 or (v_ren->>'cantidad')::integer > 1000000
           or coalesce(v_ren->>'precioCents', '') !~ '^[0-9]{1,12}$'
           or coalesce(v_ren->>'sentido', '') not in ('entra','sale')
           or coalesce(jsonb_typeof(v_ren->'vuelveAlStock'), 'boolean') <> 'boolean' then
          raise exception 'renglon_invalido' using errcode = '22023';
        end if;
        if v_ren->>'sentido' = 'entra' then
          v_entra := v_entra + 1;
          v_suma_e := v_suma_e + (v_ren->>'precioCents')::numeric * (v_ren->>'cantidad')::numeric;
        else
          v_sale := v_sale + 1;
          v_suma_s := v_suma_s + (v_ren->>'precioCents')::numeric * (v_ren->>'cantidad')::numeric;
        end if;
      end loop;
      if (v_tipo = 'nc' and (v_entra + v_sale > 0 or v_cred <= 0))
         or (v_tipo = 'devolucion' and (v_entra < 1 or v_sale > 0 or v_cred < 0))
         or (v_tipo = 'cambio' and (v_entra < 1 or v_sale < 1)) then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo', 'datos_invalidos');
        continue;
      end if;

      -- S-REN-04: el credito lo recalcula el servidor desde los renglones (devolucion: lo que
      -- entra; cambio: entra - sale) y el de comision es el mismo numero (NC incluida).
      if (v_tipo = 'devolucion' and v_cred::numeric <> v_suma_e)
         or (v_tipo = 'cambio' and v_cred::numeric <> v_suma_e - v_suma_s)
         or v_cred_com <> v_cred then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo', 'credito_inconsistente');
        continue;
      end if;

      -- Comision congelada: la suma de los renglones es exactamente -credito_comision_cents.
      select coalesce(sum((c->>'subtotalCents')::numeric), 0) into v_suma_com
        from jsonb_array_elements(v_fila->'comision_renglones') c;
      if exists (select 1 from jsonb_array_elements(v_fila->'comision_renglones') c
                  where jsonb_typeof(c) <> 'object'
                     or coalesce(c->>'subtotalCents', '') !~ '^-?[0-9]{1,13}$'
                     or char_length(coalesce(c->>'rubro', '')) > 120)
         or v_suma_com <> -v_cred_com then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo', 'comision_inconsistente');
        continue;
      end if;

      -- Serializa las rendiciones del mismo pedido (dos dispositivos a la vez).
      perform pg_advisory_xact_lock(hashtext('rendicion:' || v_pid));
      select p.total into v_total from public.pedidos p
       where p.id::text = v_pid and lower(coalesce(p.estado, '')) = 'facturado';
      if not found then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo', 'pedido_invalido');
        continue;
      end if;

      -- Cantidades: lo que entra <= facturado - devuelto en rendiciones vigentes.
      for v_prod in
        select x->>'productoId' as producto_id, sum((x->>'cantidad')::integer) as cant,
               max((x->>'precioCents')::numeric) as pmax
          from jsonb_array_elements(v_fila->'renglones') x
         where x->>'sentido' = 'entra'
         group by x->>'productoId'
      loop
        select coalesce(sum(case when coalesce(i->>'cantidad', '') ~ '^[0-9]{1,9}(\.[0-9]{1,6})?$'
                                 then (i->>'cantidad')::numeric else 0 end), 0),
               min(case when coalesce(i->>'precio', '') ~ '^-?[0-9]{1,12}(\.[0-9]{1,20})?$'
                        then greatest(round((i->>'precio')::numeric * 100), 0) else 0 end)
          into v_fact, v_pmin
          from public.pedidos p
          cross join lateral jsonb_array_elements(
            case when jsonb_typeof(p.items::jsonb) = 'array' then p.items::jsonb else '[]'::jsonb end) i
         where p.id::text = v_pid
           and coalesce(i->>'eliminado', '') <> 'true'
           and i->>'productoId' = v_prod.producto_id;
        select coalesce(sum((x->>'cantidad')::numeric), 0) into v_dev
          from public.rendiciones r
          cross join lateral jsonb_array_elements(r.renglones) x
         where r.pedido_id = v_pid and r.estado = 'vigente'
           and x->>'sentido' = 'entra' and x->>'productoId' = v_prod.producto_id;
        if v_prod.cant + v_dev > floor(v_fact) then
          raise exception 'cantidad_excedida' using errcode = 'P0001';
        end if;
        -- S-REN-04: lo que vuelve se acredita a lo sumo al precio facturado (el menor).
        if v_prod.pmax > coalesce(v_pmin, 0) then
          raise exception 'credito_inconsistente' using errcode = 'P0001';
        end if;
      end loop;

      -- Tope del credito (S-REN-04, toda rendicion): la suma de los creditos a favor de las
      -- rendiciones vigentes del pedido no puede pasar del total del pedido.
      select coalesce(sum(greatest(r.credito_cents, 0)), 0) into v_previo
        from public.rendiciones r where r.pedido_id = v_pid and r.estado = 'vigente';
      if greatest(v_cred, 0) > round(coalesce(v_total, 0)::numeric * 100) - v_previo then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo', 'monto_excedido');
        continue;
      end if;

      insert into public.rendiciones
        (id, pedido_id, cliente_id, cliente_nombre, fecha, tipo, renglones, credito_cents,
         credito_comision_cents, comision_renglones, tipo_factura, nro_nc, motivo, estado, usuario, created_at)
      values
        (v_uuid, v_pid, nullif(v_fila->>'cliente_id', ''), nullif(v_fila->>'cliente_nombre', ''),
         (v_fila->>'fecha')::date, v_tipo, v_fila->'renglones', v_cred, v_cred_com, v_fila->'comision_renglones',
         nullif(v_fila->>'tipo_factura', ''), nullif(trim(coalesce(v_fila->>'nro_nc', '')), ''), v_motivo,
         'vigente', left(coalesce(nullif(v_fila->>'usuario', ''), v_admin), 80),
         least(coalesce((v_fila->>'created_at')::timestamptz, now()), now() + interval '5 minutes'))
      on conflict (id) do nothing;
      v_confirmados := v_confirmados || to_jsonb(v_id);
    exception
      when raise_exception then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo',
          case when sqlerrm in ('cantidad_excedida', 'credito_inconsistente') then sqlerrm else 'datos_invalidos' end);
      when check_violation or not_null_violation or foreign_key_violation
        or invalid_text_representation or invalid_datetime_format or datetime_field_overflow
        or numeric_value_out_of_range or invalid_parameter_value or string_data_right_truncation then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo', 'datos_invalidos');
    end;
  end loop;

  return jsonb_build_object('ok', true, 'confirmados', v_confirmados, 'rechazados', v_rechazados);
end $$;

-- 4b. Anular (AC-REN-4). Atomica: gana un solo dispositivo (update ... where estado = 'vigente').
create or replace function public.admin_rendicion_anular(p_admin_id text, p_admin_pin text, p_id uuid, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin  text := left(trim(coalesce(p_admin_id, '')), 64);
  v_motivo text := trim(coalesce(p_motivo, ''));
  v_ok     uuid;
begin
  if not public._es_admin_con_pin(p_admin_id, p_admin_pin) then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if p_id is null or char_length(v_motivo) < 3 or char_length(v_motivo) > 300 then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;
  update public.rendiciones
     set estado = 'anulada', anulada_at = now(), anulada_por = v_admin, motivo_anulacion = v_motivo
   where id = p_id and estado = 'vigente'
  returning id into v_ok;
  if v_ok is not null then
    return jsonb_build_object('ok', true, 'ya_anulada', false);
  end if;
  if exists (select 1 from public.rendiciones where id = p_id) then
    return jsonb_build_object('ok', true, 'ya_anulada', true);
  end if;
  return jsonb_build_object('ok', false, 'motivo', 'inexistente');
end $$;

-- 4c. Anotar el efecto en la cuenta del cliente UNA vez (alta o anulacion). Si ya habia uno,
--     aplicado = false y el dispositivo NO lo vuelve a aplicar (AC-REN-3, sin doble credito).
create or replace function public.admin_rendicion_efecto(p_admin_id text, p_admin_pin text, p_id uuid, p_efecto jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ok uuid;
begin
  if not public._es_admin_con_pin(p_admin_id, p_admin_pin) then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if p_id is null or p_efecto is null or jsonb_typeof(p_efecto) <> 'object' or pg_column_size(p_efecto) >= 65536 then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;
  if coalesce(p_efecto->>'clase', 'alta') = 'anulacion' then
    update public.rendiciones set efecto_anulacion = p_efecto
     where id = p_id and estado = 'anulada' and efecto_anulacion is null
    returning id into v_ok;
  else
    -- S-REN-03: solo sobre una rendicion vigente (si otro admin ya la anulo, no se aplica).
    update public.rendiciones set efecto = p_efecto
     where id = p_id and efecto is null and estado = 'vigente'
    returning id into v_ok;
  end if;
  if v_ok is null and not exists (select 1 from public.rendiciones where id = p_id) then
    return jsonb_build_object('ok', false, 'motivo', 'inexistente');
  end if;
  return jsonb_build_object('ok', true, 'aplicado', v_ok is not null);
end $$;

-- 4d. Asientos de saldo a favor. on conflict do nothing (ids deterministas): no duplica.
create or replace function public.admin_cuenta_clientes_guardar(p_admin_id text, p_admin_pin text, p_lote jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin text := left(trim(coalesce(p_admin_id, '')), 64);
  v_fila  jsonb;
  v_id    text;
  v_cli   text;
  v_monto bigint;
  v_cred  bigint;
  v_saldo bigint;
  v_confirmados jsonb := '[]'::jsonb;
  v_rechazados  jsonb := '[]'::jsonb;
begin
  if not public._es_admin_con_pin(p_admin_id, p_admin_pin) then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if p_lote is null or jsonb_typeof(p_lote) <> 'array'
     or jsonb_array_length(p_lote) < 1 or jsonb_array_length(p_lote) > 500 then
    return jsonb_build_object('ok', false, 'motivo', 'lote_invalido');
  end if;
  for v_fila in select value from jsonb_array_elements(p_lote) loop
    v_id := null;
    begin
      if jsonb_typeof(v_fila) <> 'object' then
        v_rechazados := v_rechazados || jsonb_build_object('id', null::text, 'motivo', 'datos_invalidos');
        continue;
      end if;
      v_id := v_fila->>'id';
      if coalesce(v_id, '') !~ '^[0-9A-Za-z:-]{1,64}$'
         or coalesce(v_fila->>'cliente_id', '') !~ '^[0-9A-Za-z_.:-]{1,64}$'
         or coalesce(v_fila->>'tipo', '') not in ('saldo_favor','uso_saldo')
         or coalesce(v_fila->>'monto_cents', '') !~ '^-?[0-9]{1,12}$'
         or coalesce(v_fila->>'fecha', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo', 'datos_invalidos');
        continue;
      end if;
      -- Reintento: si ya existe se confirma sin volver a controlar.
      if exists (select 1 from public.cuenta_clientes where id = v_id) then
        v_confirmados := v_confirmados || to_jsonb(v_id);
        continue;
      end if;
      v_cli := v_fila->>'cliente_id';
      v_monto := (v_fila->>'monto_cents')::bigint;
      -- S-REN-06: serializa los asientos del mismo cliente (control de saldo disponible).
      perform pg_advisory_xact_lock(hashtext('cuenta_clientes:' || v_cli));
      if v_fila->>'tipo' = 'saldo_favor' then
        -- Un credito sale siempre de una rendicion del mismo cliente y no supera su monto.
        v_cred := null;
        select abs(r.credito_cents) into v_cred from public.rendiciones r
         where r.id = nullif(v_fila->>'rendicion_id', '')::uuid and r.cliente_id = v_cli;
        if v_cred is null or abs(v_monto) > v_cred then
          v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo', 'sin_rendicion');
          continue;
        end if;
      else
        -- uso_saldo: negativo y sin pasar del saldo a favor disponible del cliente.
        select coalesce(sum(c.monto_cents), 0) into v_saldo
          from public.cuenta_clientes c where c.cliente_id = v_cli;
        if v_monto >= 0 or -v_monto > v_saldo then
          v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo', 'saldo_insuficiente');
          continue;
        end if;
      end if;
      insert into public.cuenta_clientes (id, cliente_id, rendicion_id, tipo, monto_cents, fecha, usuario)
      values (v_id, v_fila->>'cliente_id', nullif(v_fila->>'rendicion_id', '')::uuid, v_fila->>'tipo',
              (v_fila->>'monto_cents')::bigint, (v_fila->>'fecha')::date,
              left(coalesce(nullif(v_fila->>'usuario', ''), v_admin), 80))
      on conflict (id) do nothing;
      v_confirmados := v_confirmados || to_jsonb(v_id);
    exception
      when check_violation or not_null_violation or foreign_key_violation
        or invalid_text_representation or invalid_datetime_format or datetime_field_overflow
        or numeric_value_out_of_range or invalid_parameter_value or string_data_right_truncation then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo', 'datos_invalidos');
    end;
  end loop;
  return jsonb_build_object('ok', true, 'confirmados', v_confirmados, 'rechazados', v_rechazados);
end $$;

-- 4e. Bajar (cursor por tabla sobre (synced_at, id), que pone el servidor). 1000 filas por tabla.
--     p_cursor = {"rendiciones": {"ts", "id"}, "cuenta": {"ts", "id"}} (cada uno opcional).
create or replace function public.admin_rendiciones_bajar(p_admin_id text, p_admin_pin text, p_cursor jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cur  jsonb := case when jsonb_typeof(p_cursor) = 'object' then p_cursor else '{}'::jsonb end;
  v_ts_r timestamptz;
  v_id_r text;
  v_ts_c timestamptz;
  v_id_c text;
  v_r    jsonb;
  v_c    jsonb;
begin
  if not public._es_admin_con_pin(p_admin_id, p_admin_pin) then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  begin
    v_ts_r := coalesce((v_cur->'rendiciones'->>'ts')::timestamptz, '-infinity'::timestamptz);
    v_ts_c := coalesce((v_cur->'cuenta'->>'ts')::timestamptz, '-infinity'::timestamptz);
  exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
    return jsonb_build_object('ok', false, 'motivo', 'lote_invalido');
  end;
  v_id_r := left(coalesce(v_cur->'rendiciones'->>'id', ''), 64);
  v_id_c := left(coalesce(v_cur->'cuenta'->>'id', ''), 64);

  select coalesce(jsonb_agg(to_jsonb(t) order by t.synced_at, t.id::text), '[]'::jsonb) into v_r from (
    select * from public.rendiciones
     where (synced_at, id::text) > (v_ts_r, v_id_r)
     order by synced_at, id::text limit 1000) t;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.synced_at, t.id), '[]'::jsonb) into v_c from (
    select * from public.cuenta_clientes
     where (synced_at, id) > (v_ts_c, v_id_c)
     order by synced_at, id limit 1000) t;

  return jsonb_build_object('ok', true, 'rendiciones', v_r, 'cuenta', v_c);
end $$;

-- 5. Comisiones (AC-REN-5). Helpers NO expuestos (sin execute para anon/authenticated).
-- Total del pedido para comisiones: total - creditos de comision de las rendiciones vigentes.
create or replace function public._pedido_total_comision(p_pedido_id text)
returns numeric
language sql stable set search_path = public, pg_temp as $$
  select greatest(
           round(coalesce(p.total, 0)::numeric, 2)
           - coalesce((select sum(r.credito_comision_cents) from public.rendiciones r
                        where r.pedido_id = p_pedido_id and r.estado = 'vigente'), 0)::numeric / 100,
           0)
    from public.pedidos p
   where p.id::text = p_pedido_id
$$;

-- Base por rubro (misma de la 005) + los renglones de comision congelados en las rendiciones
-- vigentes del pedido (negativos por devolucion/NC, positivos por lo que sale en un cambio).
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
       and coalesce(item->>'precio', '') ~ '^-?[0-9]{1,12}(\.[0-9]{1,20})?$'
       and coalesce(item->>'cantidad', '') ~ '^[0-9]{1,9}(\.[0-9]{1,6})?$'
       and case when coalesce(item->>'precio', '') ~ '^-?[0-9]{1,12}(\.[0-9]{1,20})?$' then (item->>'precio')::numeric >= 0 else false end
       and case when coalesce(item->>'cantidad', '') ~ '^[0-9]{1,9}(\.[0-9]{1,6})?$' then (item->>'cantidad')::numeric > 0 else false end
  ), extras as (
    select nullif(public.rubro_normalizado(case when jsonb_typeof(e->'rubro') in ('string', 'number') then e->>'rubro' end), '') as rubro,
           (e->>'subtotalCents')::numeric / 100 as subtotal
      from public.rendiciones rd
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(rd.comision_renglones) = 'array' then rd.comision_renglones else '[]'::jsonb end) e
     where rd.pedido_id = p_pedido_id and rd.estado = 'vigente'
       and coalesce(e->>'subtotalCents', '') ~ '^-?[0-9]{1,13}$'
  ), todos as (
    select v.rubro, v.subtotal from validos v
    union all
    select x.rubro, x.subtotal from extras x
  )
  select public.rubro_clave(t.rubro), min(nullif(t.rubro, '')), sum(t.subtotal)
    from todos t
   group by public.rubro_clave(t.rubro)
$$;

-- 5c. cerrar_comisiones: COPIA TEXTUAL de la 005 (ultima definicion vigente). Solo cambia el
--     total del pedido en 5a y 6a: public._pedido_total_comision(p.id::text) en lugar de
--     greatest(round(coalesce(p.total, 0)::numeric, 2), 0). Diffear contra la 005 (S8).
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
             (select public._pedido_total_comision(p.id::text)
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
             coalesce((select public._pedido_total_comision(p.id::text)
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

-- 6. Permisos (firma exacta). Los helpers y triggers no tienen execute.
revoke all on function public._pedido_total_comision(text) from public, anon, authenticated;
revoke all on function public.comision_rubro_base(text) from public, anon, authenticated;
revoke all on function public.tg_rendicion_inmutable() from public, anon, authenticated;
revoke all on function public.tg_cuenta_clientes_inmutable() from public, anon, authenticated;
revoke all on function public.tg_movimiento_rendicion_con_cabecera() from public, anon, authenticated;
revoke all on function public.cerrar_comisiones(jsonb, jsonb, text, text) from public;
grant execute on function public.cerrar_comisiones(jsonb, jsonb, text, text) to anon, authenticated;
revoke all on function public.admin_rendiciones_guardar(text, text, jsonb) from public;
grant execute on function public.admin_rendiciones_guardar(text, text, jsonb) to anon, authenticated;
revoke all on function public.admin_rendicion_anular(text, text, uuid, text) from public;
grant execute on function public.admin_rendicion_anular(text, text, uuid, text) to anon, authenticated;
revoke all on function public.admin_rendicion_efecto(text, text, uuid, jsonb) from public;
grant execute on function public.admin_rendicion_efecto(text, text, uuid, jsonb) to anon, authenticated;
revoke all on function public.admin_cuenta_clientes_guardar(text, text, jsonb) from public;
grant execute on function public.admin_cuenta_clientes_guardar(text, text, jsonb) to anon, authenticated;
revoke all on function public.admin_rendiciones_bajar(text, text, jsonb) from public;
grant execute on function public.admin_rendiciones_bajar(text, text, jsonb) to anon, authenticated;

commit;
