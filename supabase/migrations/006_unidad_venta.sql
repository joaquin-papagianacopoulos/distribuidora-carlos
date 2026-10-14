-- 006_unidad_venta.sql — REQ-VTA (AC-VTA-1, AC-VTA-5): unidad de venta y marca del producto.
-- Idempotente: se puede correr más de una vez. Pegar en Supabase → SQL Editor → Run.
-- La app tolera que esto todavía no se haya corrido (sube las columnas de la 001
-- sin estas cuatro y deja "extras pendientes" hasta que exista), pero Se vende por,
-- Etiqueta del bulto y Mostrar en tienda NO se comparten entre dispositivos hasta correrlo.
-- No borra ni modifica datos existentes. Sin grants ni policies nuevas: aplican las de
-- public.productos (RLS ya habilitado en 002).

begin;

-- marca ya existe en el esquema base; se repite por si falta en algún entorno.
alter table public.productos add column if not exists marca         text;
-- null = "derivar de bulto_x" (ambos si bulto_x > 1, si no unidad). Sin default a propósito.
alter table public.productos add column if not exists venta_por     text;
-- null = 'Bulto'.
alter table public.productos add column if not exists bulto_nombre  text;
alter table public.productos add column if not exists visible_tienda boolean not null default true;

-- Las restricciones son "not valid": no revalidan filas viejas, solo escrituras nuevas.
do $$ begin
  alter table public.productos add constraint productos_venta_por_chk
    check (venta_por is null or venta_por in ('unidad','bulto','ambos')) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.productos add constraint productos_bulto_nombre_chk
    check (bulto_nombre is null or bulto_nombre in ('Bulto','Display','Caja','Pack')) not valid;
exception when duplicate_object then null; end $$;

-- "bulto" exige bulto_x > 1 (misma regla que la app).
do $$ begin
  alter table public.productos add constraint productos_venta_bulto_chk
    check (venta_por is distinct from 'bulto' or coalesce(bulto_x, 1) > 1) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.productos add constraint productos_marca_len_chk
    check (marca is null or char_length(marca) <= 60) not valid;
exception when duplicate_object then null; end $$;

commit;
