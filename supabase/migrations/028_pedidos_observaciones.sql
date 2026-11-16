-- 028_pedidos_observaciones.sql — Lote 2026-11-16: REQ-OBS (notas del pedido sincronizadas).
-- NO SE APLICA AUTOMATICAMENTE: se corre a mano en Supabase -> SQL Editor, DESPUES de la 027
-- (hacer backup antes). Idempotente (re-ejecutable), no borra datos y tolera tablas ausentes.
-- La app sigue funcionando sin esta migracion: la nota queda solo en el dispositivo que cargo el
-- pedido (como hasta ahora) y se avisa por consola.
--
--  1. pedidos.observaciones (text, hasta 500 caracteres): la nota que el vendedor escribe al pie
--     del pedido. Sin backfill: null = pedido anterior (cada dispositivo conserva su nota local).
-- No toca productos (sin grants por columna) ni ninguna funcion.

begin;

do $mig$
begin
  if to_regclass('public.pedidos') is null then
    raise notice '028: no existe public.pedidos, se saltea';
    return;
  end if;

  alter table public.pedidos add column if not exists observaciones text;

  if not exists (select 1 from pg_constraint where conname = 'pedidos_observaciones_largo') then
    alter table public.pedidos add constraint pedidos_observaciones_largo
      check (observaciones is null or char_length(observaciones) <= 500) not valid;
  end if;
end
$mig$;

commit;
