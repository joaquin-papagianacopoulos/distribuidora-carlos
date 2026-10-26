-- Permitir borrar clientes desde la app (Configuracion > Clientes).
-- La 002 le saco el DELETE a anon/authenticated sobre clientes, por eso el
-- borrado fallaba (o el cliente reaparecia al sincronizar).
grant delete on public.clientes to anon, authenticated;

drop policy if exists clientes_delete on public.clientes;
create policy clientes_delete on public.clientes for delete to anon, authenticated using (true);
