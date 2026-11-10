-- supabase/verificacion/026_escalas_casos.sql — REQ-ESC (AC-ESC-2, AC-ESC-4).
-- Se corre A MANO en Supabase -> SQL Editor, DESPUES de aplicar 026_escalas_bulto.sql. Solo lee.
-- Mismos casos que src/domain/__fixtures__/escalasCasos.js (los que usa el cliente JS): el servidor
-- tiene que dar el mismo centavo. Devuelve SOLO las filas que no coinciden: 0 filas = todo OK.
-- Columnas de los casos: id, precio, precio_bulto, bulto_x, escalas, cantidad, base, esperado, escala.
-- No editar a mano: si cambia el fixture, se regenera y migracion026.sql.test.js lo verifica.

with casos(id, precio, precio_bulto, bulto_x, escalas, cantidad, base, esperado, escala) as (
  values
  ('sin-escalas', 1000, 0, 12, '[]'::jsonb, 120, 1000, 1000, null::integer),
  ('borde-4-bultos-no', 1000, 0, 10, '[{"desde":5,"pct":8}]'::jsonb, 49, 1000, 1000, null::integer),
  ('borde-5-bultos-si', 1000, 0, 10, '[{"desde":5,"pct":8}]'::jsonb, 50, 1000, 920, 5),
  ('escala-mas-alta', 1000, 0, 10, '[{"desde":5,"pct":8},{"desde":10,"pct":12}]'::jsonb, 100, 1000, 880, 10),
  ('escala-intermedia', 1000, 0, 10, '[{"desde":5,"pct":8},{"desde":10,"pct":12}]'::jsonb, 99, 1000, 920, 5),
  ('redondeo-arriba', 815, 0, 6, '[{"desde":3,"pct":8}]'::jsonb, 18, 815, 750, 3),
  ('redondeo-exacto', 800, 0, 6, '[{"desde":3,"pct":8}]'::jsonb, 18, 800, 736, 3),
  ('base-con-centavos', 799.5, 0, 6, '[{"desde":3,"pct":8}]'::jsonb, 18, 799.5, 736, 3),
  ('sobre-precio-bulto', 1000, 800, 12, '[{"desde":5,"pct":8}]'::jsonb, 60, 800, 736, 5),
  ('precio-bulto-mayor', 800, 1000, 12, '[{"desde":5,"pct":10}]'::jsonb, 60, 800, 720, 5),
  ('pct-con-decimales', 1000, 0, 10, '[{"desde":2,"pct":7.5}]'::jsonb, 20, 1000, 925, 2),
  ('desordenadas', 1000, 0, 10, '[{"desde":10,"pct":12},{"desde":5,"pct":8}]'::jsonb, 100, 1000, 880, 10),
  ('duplicadas', 1000, 0, 10, '[{"desde":5,"pct":8},{"desde":5,"pct":20}]'::jsonb, 50, 1000, 920, 5),
  ('desde-1-ignorada', 1000, 0, 10, '[{"desde":1,"pct":50}]'::jsonb, 10, 1000, 1000, null::integer),
  ('pct-cero-ignorado', 1000, 0, 10, '[{"desde":2,"pct":0}]'::jsonb, 20, 1000, 1000, null::integer),
  ('pct-100-ignorado', 1000, 0, 10, '[{"desde":2,"pct":100}]'::jsonb, 20, 1000, 1000, null::integer),
  ('pct-3-decimales-ignorado', 1000, 0, 10, '[{"desde":2,"pct":7.125}]'::jsonb, 20, 1000, 1000, null::integer),
  ('desde-texto-ignorado', 1000, 0, 10, '[{"desde":"2","pct":10}]'::jsonb, 20, 1000, 1000, null::integer),
  ('cuatro-escalas-corta-en-3', 1000, 0, 10, '[{"desde":2,"pct":1},{"desde":3,"pct":2},{"desde":4,"pct":3},{"desde":5,"pct":50}]'::jsonb, 50, 1000, 970, 4),
  ('bultox-1-sin-escala', 1000, 0, 1, '[{"desde":2,"pct":10}]'::jsonb, 20, 1000, 1000, null::integer),
  ('bultox-0-sin-escala', 1000, 0, 0, '[{"desde":2,"pct":10}]'::jsonb, 20, 1000, 1000, null::integer),
  ('cantidad-decimal', 1000, 0, 10, '[{"desde":5,"pct":8}]'::jsonb, 49.9, 1000, 1000, null::integer),
  ('no-baja-precio-chico', 5, 0, 10, '[{"desde":2,"pct":8}]'::jsonb, 20, 5, 5, null::integer),
  ('escalas-null', 1000, 0, 10, null::jsonb, 50, 1000, 1000, null::integer)
),
calculo as (
  select c.*,
         public.tienda_precio_aplicado(c.precio, c.precio_bulto, c.bulto_x, c.cantidad) as base_srv
    from casos c
),
resultado as (
  select k.*,
         public.tienda_precio_con_escala(k.base_srv, k.escalas, k.bulto_x, k.cantidad) as final_srv
    from calculo k
)
select r.id, r.base, r.base_srv, r.esperado, r.final_srv, r.escala,
       (case when r.final_srv < r.base_srv
             then (public.tienda_escala_alcanzada(r.escalas, r.bulto_x, r.cantidad)->>'desde')::integer
             else null end) as escala_srv
  from resultado r
 where r.base_srv is distinct from r.base::numeric
    or r.final_srv is distinct from r.esperado::numeric
    or (case when r.final_srv < r.base_srv
             then (public.tienda_escala_alcanzada(r.escalas, r.bulto_x, r.cantidad)->>'desde')::integer
             else null end) is distinct from r.escala;
