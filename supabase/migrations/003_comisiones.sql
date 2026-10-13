-- 003_comisiones.sql — REQ-COM (AC-COM-1, 11, 12, 16) + AC-SEC-5.
-- Corrida 20261007-2022. Se aplica A MANO en Supabase -> SQL Editor (hacer
-- backup antes). Es idempotente: se puede correr más de una vez. No borra datos.
--
-- La app tolera que esto no se haya corrido: la marca "Entregado" queda local
-- (entregaPendiente) y se reintenta en cada sync; la pantalla Comisiones
-- muestra "falta la migración 003" y NO deja cerrar (no hay cierres solo-locales).
--
-- Modelo:
--  * pedidos.entregado / entregado_at / entregado_por: marca de entrega (AC-COM-1).
--    No cambia "estado" ni genera movimientos de stock.
--  * comisiones_cierres: cabecera inmutable del cierre + detalle congelado (jsonb).
--  * comisiones_cierre_pedidos: un renglón por pedido (o ajuste) cerrado. El
--    índice único PARCIAL "where vigente and tipo = 'pedido'" hace imposible que
--    un pedido quede en dos cierres vigentes, aunque dos admins cierren el mismo
--    período a la vez desde dos dispositivos (AC-COM-16).
--  * Escritura SOLO por las RPC cerrar_comisiones / anular_cierre_comisiones
--    (security definer). Las tablas son solo-lectura para anon/authenticated y
--    no tienen política de borrado.
--
-- ORDEN DE APLICACIÓN (iteración 2, S-COM-01): esta migración REQUIERE el
-- PASO 1 de 002_seguridad_recomendada.sql (pin_hash + public.verificar_pin).
-- Si verificar_pin no existe, el script aborta al principio sin tocar nada.
--
-- Autorización (S-COM-01): las RPC reciben el id remoto del admin + su PIN y lo
-- validan en el servidor con public.verificar_pin (bcrypt + bloqueo por
-- intentos). cerrado_por / anulado_por los fija el SERVIDOR con el nombre del
-- vendedor autenticado; lo que mande el cliente en "cerrado_por" se ignora.
-- El admin necesita tener PIN cargado (pin_hash) para poder cerrar/anular.
-- La solución definitiva sigue siendo Supabase Auth (claim "permiso").
--
-- Montos (S-COM-02 / S-COM-07), decisión: el servidor RECALCULA y RECHAZA si no
-- coincide (no reemplaza en silencio). Motivo: "detalle"/"totales" (jsonb que se
-- ven en el historial y el PDF) los arma el cliente; si el servidor pisara solo
-- las columnas numéricas, el cierre quedaría incoherente consigo mismo. Lo que
-- se graba en las columnas numéricas (total, comision, total_vendido,
-- total_comision) son los valores verificados contra public.pedidos, y
-- cerrado_at = now() del servidor.
--
-- Criterio de entregado (S-COM-04): la RPC exige coalesce(p.entregado, false),
-- igual que CONFIG_COMISIONES.criterioEntregado = 'entregado' en
-- src/domain/comisiones.js. Si el dueño elige "A reparto", hay que cambiar
-- JUNTOS la RPC (p.a_reparto) y CONFIG_COMISIONES.criterioEntregado ('aReparto').

begin;

-- =====================================================================
-- 0. Prerrequisito: PASO 1 de la 002 (S-COM-01)
-- =====================================================================
do $$
begin
  if to_regprocedure('public.verificar_pin(text, text)') is null then
    raise exception 'Falta public.verificar_pin(text, text): aplicar antes 002_seguridad_recomendada.sql PASO 1 (PIN hasheado) y despues volver a correr esta 003.';
  end if;
end $$;

-- =====================================================================
-- 1. Marca de entregado en pedidos (AC-COM-1)
-- =====================================================================
alter table public.pedidos add column if not exists entregado boolean not null default false;
alter table public.pedidos add column if not exists entregado_at timestamptz;
alter table public.pedidos add column if not exists entregado_por text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pedidos_entregado_por_len') then
    alter table public.pedidos add constraint pedidos_entregado_por_len
      check (length(coalesce(entregado_por, '')) <= 80) not valid;
  end if;
end $$;

-- =====================================================================
-- 2. Cabecera de cierres (AC-COM-10, 11, 12)
-- =====================================================================
create table if not exists public.comisiones_cierres (
  id               text primary key check (length(id) between 1 and 64),
  desde            date not null,
  hasta            date not null,
  cerrado_at       timestamptz not null,
  cerrado_por      text not null check (length(cerrado_por) between 1 and 80),
  estado           text not null default 'vigente' check (estado in ('vigente','anulado')),
  anulado_at       timestamptz,
  anulado_por      text check (anulado_por is null or length(anulado_por) <= 80),
  motivo_anulacion text check (motivo_anulacion is null or length(motivo_anulacion) between 3 and 300),
  total_vendido    numeric(16,2) not null default 0,
  total_comision   numeric(16,2) not null default 0,
  totales          jsonb not null default '{}'::jsonb,
  detalle          jsonb not null default '[]'::jsonb,
  lineas           jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint comisiones_cierres_rango check (desde <= hasta),
  constraint comisiones_cierres_anulacion check (
    estado = 'vigente'
    or (anulado_at is not null and anulado_por is not null and length(trim(coalesce(motivo_anulacion, ''))) >= 3)
  )
);
-- S-COM-16 (iteración 3): id remoto del admin que cerró. La idempotencia
-- compara por id, no por nombre (dos admins con el mismo nombre no comparten
-- "ya_existia"). Nullable para no romper filas previas; el servidor siempre lo llena.
alter table public.comisiones_cierres add column if not exists cerrado_por_id text
  check (cerrado_por_id is null or length(cerrado_por_id) between 1 and 64);
create index if not exists comisiones_cierres_updated_idx on public.comisiones_cierres (updated_at);
create index if not exists comisiones_cierres_periodo_idx on public.comisiones_cierres (desde, hasta);

-- =====================================================================
-- 3. Renglones (un pedido o ajuste por fila) — AC-COM-16
-- =====================================================================
create table if not exists public.comisiones_cierre_pedidos (
  cierre_id  text not null references public.comisiones_cierres(id) on delete restrict,
  pedido_id  text not null check (length(pedido_id) between 1 and 64),
  tipo       text not null check (tipo in ('pedido','ajuste')),
  ajuste_seq integer not null default 0 check (ajuste_seq between 0 and 100000),
  total      numeric(16,2) not null default 0,
  comision   numeric(16,2) not null default 0,
  vigente    boolean not null default true,
  primary key (cierre_id, pedido_id, tipo, ajuste_seq)
);
-- % congelado con el que el servidor verificó la comisión (S-COM-02) y si el
-- pedido se cerró "sin comisión" (no suma al total). Para ajustes posteriores
-- el servidor usa ESTE % (no el que mande el cliente).
alter table public.comisiones_cierre_pedidos add column if not exists pct numeric(5,2)
  check (pct is null or (pct >= 0 and pct <= 100));
alter table public.comisiones_cierre_pedidos add column if not exists sin_comision boolean not null default false;
-- Un pedido no puede estar en dos cierres vigentes (AC-COM-16).
create unique index if not exists comisiones_pedido_vigente_uq
  on public.comisiones_cierre_pedidos (pedido_id) where vigente and tipo = 'pedido';
-- Un mismo ajuste no se cobra en dos cierres vigentes.
create unique index if not exists comisiones_ajuste_vigente_uq
  on public.comisiones_cierre_pedidos (pedido_id, ajuste_seq) where vigente and tipo = 'ajuste';

-- =====================================================================
-- 4. Triggers: updated_at e inmutabilidad (AC-COM-11)
-- =====================================================================
create or replace function public.tg_set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists set_updated_at on public.comisiones_cierres;
create trigger set_updated_at before update on public.comisiones_cierres
  for each row execute function public.tg_set_updated_at();

-- Un cierre confirmado no se edita: lo único permitido es vigente -> anulado.
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
drop trigger if exists cierre_inmutable on public.comisiones_cierres;
create trigger cierre_inmutable before update or delete on public.comisiones_cierres
  for each row execute function public.tg_cierre_inmutable();

-- Renglones: solo se permite vigente true -> false (al anular).
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
     or (new.vigente and not old.vigente) then
    raise exception 'Un renglon de cierre solo puede pasar de vigente a no vigente';
  end if;
  return new;
end $$;
drop trigger if exists cierre_renglon_inmutable on public.comisiones_cierre_pedidos;
create trigger cierre_renglon_inmutable before update or delete on public.comisiones_cierre_pedidos
  for each row execute function public.tg_cierre_renglon_inmutable();

-- =====================================================================
-- 5. RPC cerrar_comisiones (atómica e idempotente por id) — AC-COM-10, 16
--    Iteración 2: S-COM-01 (PIN), S-COM-02/07 (recalcula y rechaza),
--    S-COM-04 (exige entregado), S-COM-09/10 (idempotencia tras autorizar),
--    S-COM-12 (search_path = public, pg_temp).
-- =====================================================================
-- Firmas viejas (autorizaban por nombre): se eliminan para que no quede una
-- sobrecarga insegura si la 003 anterior ya se había corrido. No borra datos.
drop function if exists public.cerrar_comisiones(jsonb, jsonb);
drop function if exists public.anular_cierre_comisiones(text, text, text);

create or replace function public.cerrar_comisiones(p_cierre jsonb, p_renglones jsonb, p_admin_id text, p_admin_pin text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id         text := p_cierre->>'id';
  v_admin_id   text := trim(coalesce(p_admin_id, ''));
  v_por        text;
  v_existente  text;
  v_desde      date;
  v_hasta      date;
  v_invalidos  text[];
  v_conflictos text[];
  v_tot_vend   numeric;
  v_tot_com    numeric;
  v_pin_ok     boolean;
  v_pid        text;
begin
  if v_id is null or length(v_id) = 0 or length(v_id) > 64 then
    return jsonb_build_object('ok', false, 'motivo', 'id_invalido');
  end if;

  -- 1) Autorización (S-COM-01): id remoto del admin + PIN verificado acá.
  --    S-COM-16 (iteración 3): una sola respuesta 'no_autorizado' tanto si el
  --    id no es admin como si el PIN es incorrecto, y verificar_pin se llama
  --    SIEMPRE (no hay oráculo de qué ids son admin, ni por respuesta ni por tiempo).
  if length(v_admin_id) = 0 or length(v_admin_id) > 64 then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  select left(trim(ve.nombre), 80) into v_por
    from public.vendedores ve
   where ve.id::text = v_admin_id and ve.permiso = 1;
  -- return (no raise): así el intento fallido queda registrado en
  -- vendedores_pin_intentos y cuenta para el bloqueo por fuerza bruta.
  v_pin_ok := coalesce(public.verificar_pin(v_admin_id, p_admin_pin), false);
  if not v_pin_ok or v_por is null or length(v_por) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  -- 2) Idempotencia DESPUÉS de autorizar (S-COM-10), serializada por id
  --    (S-COM-09): dos reintentos con el mismo UUID no compiten entre sí.
  --    Solo es "ya_existia" si lo cerró el mismo admin, comparando por ID
  --    (S-COM-16), no por nombre.
  perform pg_advisory_xact_lock(hashtext('comisiones_cierre:' || v_id));
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
        or case when jsonb_typeof(r->'pct') = 'number'
                then (r->>'pct')::numeric < 0 or (r->>'pct')::numeric > 100
                else false end
        or case when r->>'tipo' = 'ajuste' and r ? 'ajuste_seq'
                then coalesce(r->>'ajuste_seq', '') !~ '^[0-9]{1,5}$'
                else false end
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'renglones_invalidos');
  end if;

  -- Período válido (máx. 366 días, como CONFIG_COMISIONES.maxDiasPeriodo).
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

  -- S-COM-15 (iteración 3): serializar por PEDIDO. Dos cierres concurrentes
  -- con el mismo pedido (como pedido o como ajuste) se ejecutan de a uno: el
  -- segundo valida contra lo que ya grabó el primero (READ COMMITTED: cada
  -- sentencia de abajo ve lo commiteado al tomar el lock) y su ajuste deja de
  -- coincidir => 'ajuste_invalido'. Los locks se toman en orden para no
  -- generar deadlocks (anular_cierre_comisiones usa el mismo orden y prefijo).
  for v_pid in
    select distinct r->>'pedido_id' from jsonb_array_elements(p_renglones) r order by 1
  loop
    perform pg_advisory_xact_lock(hashtext('comisiones_pedido:' || v_pid));
  end loop;

  -- S-COM-07: "lineas" (lo que usa el cliente para saber qué está cerrado y
  -- calcular ajustes) tiene que ser exactamente el mismo set que p_renglones
  -- (lo que protege el índice único), con los mismos montos.
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

  -- 4) Cada pedido: existe, facturado, ENTREGADO (S-COM-04) y con fecha dentro
  --    del período. Criterio = CONFIG_COMISIONES.criterioEntregado ('entregado').
  --    Si el dueño elige "A reparto": cambiar acá (y en el ajuste de abajo) a
  --    coalesce(p.a_reparto, false) JUNTO con CONFIG_COMISIONES.
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

  -- 5) S-COM-02: total del pedido = public.pedidos.total (negativo => 0, como
  --    el cliente) y comisión = round(total * % congelado / 100, 2), con el %
  --    enviado ya validado entre 0 y 100 (null = sin % => comisión 0).
  select array_agg(x.pedido_id) into v_invalidos
    from (
      select r->>'pedido_id' as pedido_id,
             round((r->>'total')::numeric, 2) as total_env,
             round((r->>'comision')::numeric, 2) as com_env,
             case when jsonb_typeof(r->'pct') = 'number' then round((r->>'pct')::numeric, 2) else 0 end as pct,
             (select greatest(round(coalesce(p.total, 0)::numeric, 2), 0)
                from public.pedidos p where p.id::text = r->>'pedido_id') as total_srv
        from jsonb_array_elements(p_renglones) r
       where r->>'tipo' = 'pedido'
    ) x
   where x.total_env <> x.total_srv
      or x.com_env <> round(x.total_srv * x.pct / 100, 2);
  if v_invalidos is not null then
    return jsonb_build_object('ok', false, 'motivo', 'montos_inconsistentes', 'conflictos', to_jsonb(v_invalidos));
  end if;

  -- Ajustes (AC-COM-13): tiene que existir el renglón base vigente (con
  -- comisión) y la diferencia se recalcula con el % congelado del SERVIDOR:
  -- (total actual si sigue facturado y entregado, si no 0) - lo ya cerrado.
  select array_agg(a.pedido_id) into v_invalidos
    from (
      select r->>'pedido_id' as pedido_id,
             round((r->>'total')::numeric, 2) as total_env,
             round((r->>'comision')::numeric, 2) as com_env,
             (select count(*) from public.comisiones_cierre_pedidos cp
               where cp.pedido_id = r->>'pedido_id' and cp.tipo = 'pedido' and cp.vigente and not cp.sin_comision) as hay_base,
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
      or a.com_env <> round(a.tot_actual * a.pct_base / 100, 2) - a.com_cerrada;
  if v_invalidos is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ajuste_invalido', 'conflictos', to_jsonb(v_invalidos));
  end if;

  -- 6) Totales del cierre (S-COM-02): con cada renglón ya verificado, el
  --    servidor suma. total_vendido = pedidos; total_comision = todo lo que no
  --    es "sin comisión" (igual que resumirPorVendedor). Si lo enviado no
  --    coincide (columnas, totales jsonb o suma por vendedor) se rechaza.
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

  -- 7) Grabar con valores del servidor: cerrado_por = admin autenticado,
  --    cerrado_at = now(), totales numéricos = los recalculados.
  begin
    insert into public.comisiones_cierres (id, desde, hasta, cerrado_at, cerrado_por, cerrado_por_id, estado,
      total_vendido, total_comision, totales, detalle, lineas)
    values (v_id, v_desde, v_hasta, now(), v_por, v_admin_id, 'vigente',
      v_tot_vend, v_tot_com,
      coalesce(p_cierre->'totales', '{}'::jsonb), coalesce(p_cierre->'detalle', '[]'::jsonb), p_cierre->'lineas');

    insert into public.comisiones_cierre_pedidos (cierre_id, pedido_id, tipo, ajuste_seq, total, comision, pct, sin_comision, vigente)
    -- S-COM-15: ajuste_seq lo ASIGNA el servidor (max histórico del pedido + 1,
    -- bajo el lock por pedido); el valor que mande el cliente se ignora.
    select v_id, r->>'pedido_id', r->>'tipo',
           case when r->>'tipo' = 'ajuste'
                then coalesce((select max(cp.ajuste_seq) from public.comisiones_cierre_pedidos cp
                                where cp.pedido_id = r->>'pedido_id' and cp.tipo = 'ajuste'), 0) + 1
                else 0 end,
           round((r->>'total')::numeric, 2), round((r->>'comision')::numeric, 2),
           case when jsonb_typeof(r->'pct') = 'number' then round((r->>'pct')::numeric, 2) end,
           coalesce(r->>'sin_comision', 'false') = 'true', true
      from jsonb_array_elements(p_renglones) r;
  exception when unique_violation then
    -- Otro admin ya cerró alguno de estos pedidos: se revierte TODO este cierre.
    select array_agg(distinct cp.pedido_id) into v_conflictos
      from public.comisiones_cierre_pedidos cp
      join jsonb_array_elements(p_renglones) r on r->>'pedido_id' = cp.pedido_id
     where cp.vigente and cp.tipo = r->>'tipo';
    return jsonb_build_object('ok', false, 'motivo', 'ya_cerrado', 'conflictos', coalesce(to_jsonb(v_conflictos), '[]'::jsonb));
  end;

  return jsonb_build_object('ok', true);
end $$;

-- =====================================================================
-- 6. RPC anular_cierre_comisiones — AC-COM-12 (+ S-COM-01: PIN del admin)
-- =====================================================================
create or replace function public.anular_cierre_comisiones(p_id text, p_admin_id text, p_admin_pin text, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_estado   text;
  v_motivo   text := trim(coalesce(p_motivo, ''));
  v_admin_id text := trim(coalesce(p_admin_id, ''));
  v_por      text;
  v_pin_ok   boolean;
  v_pid      text;
  v_dep      text[];
begin
  if length(v_motivo) < 3 or length(v_motivo) > 300 then
    return jsonb_build_object('ok', false, 'motivo', 'motivo_invalido');
  end if;
  -- S-COM-16: misma respuesta para "no es admin" y "PIN incorrecto".
  if length(v_admin_id) = 0 or length(v_admin_id) > 64 then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  select left(trim(ve.nombre), 80) into v_por
    from public.vendedores ve
   where ve.id::text = v_admin_id and ve.permiso = 1;
  v_pin_ok := coalesce(public.verificar_pin(v_admin_id, p_admin_pin), false);
  if not v_pin_ok or v_por is null or length(v_por) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  select c.estado into v_estado from public.comisiones_cierres c where c.id = p_id for update;
  if v_estado is null then
    return jsonb_build_object('ok', false, 'motivo', 'no_existe');
  end if;
  if v_estado = 'anulado' then
    return jsonb_build_object('ok', true, 'ya_anulado', true);
  end if;

  -- S-COM-15 (iteración 3), decisión: BLOQUEAR. Mismo lock por pedido que
  -- cerrar_comisiones (mismo orden y prefijo). Si algún pedido que este cierre
  -- tiene como BASE ('pedido') tiene ajustes vigentes en OTROS cierres, no se
  -- anula: esos ajustes quedarían huérfanos (cobrando una diferencia sobre una
  -- base que ya no cuenta). El admin anula primero los cierres con ajustes
  -- (se devuelven sus ids) y después éste. Se eligió bloquear y no anular en
  -- cascada porque la cascada modificaría cierres vigentes cuyos totales y PDF
  -- ya incluyen esos ajustes.
  for v_pid in
    select distinct cp.pedido_id from public.comisiones_cierre_pedidos cp where cp.cierre_id = p_id order by 1
  loop
    perform pg_advisory_xact_lock(hashtext('comisiones_pedido:' || v_pid));
  end loop;
  select array_agg(distinct aj.cierre_id) into v_dep
    from public.comisiones_cierre_pedidos base
    join public.comisiones_cierre_pedidos aj
      on aj.pedido_id = base.pedido_id and aj.tipo = 'ajuste' and aj.vigente and aj.cierre_id <> p_id
   where base.cierre_id = p_id and base.tipo = 'pedido' and base.vigente;
  if v_dep is not null then
    return jsonb_build_object('ok', false, 'motivo', 'tiene_ajustes_vigentes', 'conflictos', to_jsonb(v_dep));
  end if;
  -- anulado_por lo fija el servidor (admin autenticado), no el cliente.
  update public.comisiones_cierres
     set estado = 'anulado', anulado_at = now(), anulado_por = v_por, motivo_anulacion = v_motivo
   where id = p_id;
  update public.comisiones_cierre_pedidos set vigente = false where cierre_id = p_id and vigente;
  return jsonb_build_object('ok', true);
end $$;

-- =====================================================================
-- 7. RLS y permisos (AC-SEC-5): solo lectura; escritura solo por las RPC.
--    Sin políticas de insert/update/delete.
-- =====================================================================
alter table public.comisiones_cierres enable row level security;
alter table public.comisiones_cierre_pedidos enable row level security;

drop policy if exists comisiones_cierres_select on public.comisiones_cierres;
create policy comisiones_cierres_select on public.comisiones_cierres for select to anon, authenticated using (true);
drop policy if exists comisiones_cierre_pedidos_select on public.comisiones_cierre_pedidos;
create policy comisiones_cierre_pedidos_select on public.comisiones_cierre_pedidos for select to anon, authenticated using (true);

revoke insert, update, delete, truncate on public.comisiones_cierres from anon, authenticated;
revoke insert, update, delete, truncate on public.comisiones_cierre_pedidos from anon, authenticated;
grant select on public.comisiones_cierres to anon, authenticated;
grant select on public.comisiones_cierre_pedidos to anon, authenticated;

revoke all on function public.cerrar_comisiones(jsonb, jsonb, text, text) from public;
revoke all on function public.anular_cierre_comisiones(text, text, text, text) from public;
grant execute on function public.cerrar_comisiones(jsonb, jsonb, text, text) to anon, authenticated;
grant execute on function public.anular_cierre_comisiones(text, text, text, text) to anon, authenticated;

commit;
