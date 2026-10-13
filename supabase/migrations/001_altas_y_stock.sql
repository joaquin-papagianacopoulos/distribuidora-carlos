-- 001_altas_y_stock.sql — REQ-CLI, REQ-PROV, REQ-PROD, REQ-ING, REQ-STK
-- Idempotente: se puede correr más de una vez. Pegar en Supabase → SQL Editor → Run.
-- La app tolera que esto todavía no se haya corrido (sube solo columnas viejas),
-- pero los datos nuevos NO se comparten entre dispositivos hasta correrlo.

begin;

-- ============ Clientes: campos del alta (REQ-CLI) ============
alter table public.clientes add column if not exists codigo        text;
alter table public.clientes add column if not exists ciudad        text;
alter table public.clientes add column if not exists codigo_postal text;
alter table public.clientes add column if not exists provincia     text;
alter table public.clientes add column if not exists zona          text;
alter table public.clientes add column if not exists pais          text default 'Argentina';
alter table public.clientes add column if not exists tipo_iva      text;
alter table public.clientes add column if not exists cuit          text;
alter table public.clientes add column if not exists vendedor      text;
alter table public.clientes add column if not exists cobrador      text;
alter table public.clientes add column if not exists comision      numeric(5,2);
alter table public.clientes add column if not exists fecha_alta    date;
alter table public.clientes add column if not exists tipo_cliente  text;
alter table public.clientes add column if not exists rubro         text;

do $$ begin
  alter table public.clientes add constraint clientes_comision_chk check (comision is null or (comision >= 0 and comision <= 100));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.clientes add constraint clientes_cuit_chk check (cuit is null or cuit ~ '^\d{2}-\d{8}-\d$') not valid;  -- not valid: no revalida filas viejas
exception when duplicate_object then null; end $$;
-- Antes de correr: verificar que no haya códigos repetidos (si la columna ya existía):
--   select lower(codigo), count(*) from public.clientes where coalesce(codigo,'')<>'' group by 1 having count(*)>1;
create unique index if not exists clientes_codigo_uq on public.clientes (lower(codigo)) where codigo is not null and codigo <> '';

-- ============ Proveedores (REQ-PROV) ============
create table if not exists public.proveedores (
  id          text primary key,              -- UUID generado en el dispositivo
  codigo      text not null,
  descripcion text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists proveedores_codigo_uq on public.proveedores (lower(codigo));

-- ============ Productos: campos del alta (REQ-PROD) ============
-- Sin FK a proveedores a propósito: un producto puede subir antes que su proveedor
-- (sync offline). La integridad la valida la app (validarProducto / AC-PROV-3).
alter table public.productos add column if not exists proveedor_id  text;
alter table public.productos add column if not exists costo_final   numeric(14,2) default 0;
alter table public.productos add column if not exists descuento1    numeric(5,2)  default 0;
alter table public.productos add column if not exists descuento2    numeric(5,2)  default 0;
alter table public.productos add column if not exists ganancia      numeric(7,2)  default 0;
alter table public.productos add column if not exists precio_venta2 numeric(14,2) default 0;
alter table public.productos add column if not exists bulto_x       integer default 1;
alter table public.productos add column if not exists minimo_venta  integer default 1;
do $$ begin
  alter table public.productos add constraint productos_valores_chk check (
    coalesce(costo_final,0) >= 0 and coalesce(descuento1,0) between 0 and 100 and coalesce(descuento2,0) between 0 and 100
    and coalesce(ganancia,0) >= 0 and coalesce(precio_venta2,0) >= 0 and coalesce(bulto_x,1) >= 1 and coalesce(minimo_venta,1) >= 1);
exception when duplicate_object then null; end $$;

-- ============ Ledger de stock (REQ-STK) ============
create table if not exists public.movimientos_stock (
  id          text primary key,              -- UUID: el upsert es idempotente
  producto_id text not null,
  cantidad    integer not null check (cantidad <> 0 and abs(cantidad) <= 1000000),
  tipo        text not null check (tipo in ('inicial','ajuste','ingreso','venta','anulacion')),
  ref         text not null,
  fecha       timestamptz not null,
  usuario     text,
  nota        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists movimientos_stock_producto_idx on public.movimientos_stock (producto_id);
create index if not exists movimientos_stock_ref_idx      on public.movimientos_stock (ref);
create index if not exists movimientos_stock_updated_idx  on public.movimientos_stock (updated_at);

-- ============ Ingresos de mercadería (REQ-ING) ============
create table if not exists public.ingresos_mercaderia (
  id                text primary key,
  factura_proveedor text not null,
  proveedor_id      text not null references public.proveedores(id) on delete restrict,
  proveedor_nombre  text,
  fecha             timestamptz not null,
  usuario           text,
  items             jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists ingresos_factura_uq on public.ingresos_mercaderia (proveedor_id, lower(factura_proveedor));
create index if not exists ingresos_updated_idx on public.ingresos_mercaderia (updated_at);

-- ============ updated_at automático (sync incremental) ============
create or replace function public.tg_set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists set_updated_at on public.proveedores;
create trigger set_updated_at before update on public.proveedores for each row execute function public.tg_set_updated_at();
drop trigger if exists set_updated_at on public.movimientos_stock;
create trigger set_updated_at before update on public.movimientos_stock for each row execute function public.tg_set_updated_at();
drop trigger if exists set_updated_at on public.ingresos_mercaderia;
create trigger set_updated_at before update on public.ingresos_mercaderia for each row execute function public.tg_set_updated_at();

-- ============ Inmutabilidad del ledger (seguridad / integridad) ============
-- Un movimiento solo puede cambiar su "ref" (re-key de pedido offline → id remoto).
-- Cantidad, producto y tipo NO se pueden modificar: un error se corrige con otro movimiento.
create or replace function public.tg_movimiento_inmutable() returns trigger language plpgsql as $$
begin
  if new.producto_id is distinct from old.producto_id
     or new.cantidad is distinct from old.cantidad
     or new.tipo is distinct from old.tipo then
    raise exception 'movimientos_stock es inmutable: registrá un ajuste en lugar de modificar';
  end if;
  return new;
end $$;
drop trigger if exists movimiento_inmutable on public.movimientos_stock;
create trigger movimiento_inmutable before update on public.movimientos_stock for each row execute function public.tg_movimiento_inmutable();

-- Las cabeceras de ingreso tampoco cambian sus renglones.
create or replace function public.tg_ingreso_inmutable() returns trigger language plpgsql as $$
begin
  if new.items is distinct from old.items or new.proveedor_id is distinct from old.proveedor_id then
    raise exception 'ingresos_mercaderia es inmutable';
  end if;
  return new;
end $$;
drop trigger if exists ingreso_inmutable on public.ingresos_mercaderia;
create trigger ingreso_inmutable before update on public.ingresos_mercaderia for each row execute function public.tg_ingreso_inmutable();

-- ============ Vista de stock actual ============
create or replace view public.stock_actual with (security_invoker = true) as
  select producto_id, sum(cantidad)::integer as stock, max(fecha) as ultimo_movimiento
  from public.movimientos_stock group by producto_id;

-- ============ RLS (AC-SEC-5) ============
-- La app hoy no usa Supabase Auth (entra con la anon key), así que las políticas
-- habilitan a "anon" a leer/insertar/actualizar, pero NUNCA a borrar el ledger.
-- Ver supabase/migrations/002_seguridad_recomendada.sql para endurecer.
alter table public.proveedores         enable row level security;
alter table public.movimientos_stock   enable row level security;
alter table public.ingresos_mercaderia enable row level security;

drop policy if exists proveedores_rw on public.proveedores;
create policy proveedores_rw on public.proveedores for all to anon, authenticated using (true) with check (true);

drop policy if exists movs_select on public.movimientos_stock;
drop policy if exists movs_insert on public.movimientos_stock;
drop policy if exists movs_update on public.movimientos_stock;
create policy movs_select on public.movimientos_stock for select to anon, authenticated using (true);
create policy movs_insert on public.movimientos_stock for insert to anon, authenticated with check (true);
create policy movs_update on public.movimientos_stock for update to anon, authenticated using (true) with check (true);
-- (sin política de DELETE ⇒ nadie con anon key puede borrar movimientos)

drop policy if exists ing_select on public.ingresos_mercaderia;
drop policy if exists ing_insert on public.ingresos_mercaderia;
drop policy if exists ing_update on public.ingresos_mercaderia;
create policy ing_select on public.ingresos_mercaderia for select to anon, authenticated using (true);
create policy ing_insert on public.ingresos_mercaderia for insert to anon, authenticated with check (true);
create policy ing_update on public.ingresos_mercaderia for update to anon, authenticated using (true) with check (true);

commit;
