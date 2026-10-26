-- Baja logica de proveedores (Configuracion > Proveedores).
-- Un proveedor con ingresos de mercaderia no se puede borrar (ingresos_mercaderia.proveedor_id
-- tiene on delete restrict y se perderia el historial): se marca activo = false y deja de
-- aparecer en listas y selectores. Seguro de correr varias veces.
alter table public.proveedores add column if not exists activo boolean not null default true;
