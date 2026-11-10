# Revision final — RUN 20261110-t1 (EDP, MUL, CBU, SST2, MIN2, ASV, PEN)

VEREDICTO: CAMBIOS REQUERIDOS

Corrido por mi: `CI=true npx react-scripts test --watchAll=false` => 247 suites, 3517 pasan, 1 skipped (preexistente AC-SEC-4) y 5 todo.
`run-gates.mjs` => todos PASS (unit, traceability, build, secret-scan, security-rules, npm-audit); gates.json regenerado.

## Cambios requeridos
1. BLOQUEANTE supabase/migrations/024_pedidos_edicion_vendedor.sql:53, 79, 107 (cierres en 57, 91, 149): las funciones
   `tg_set_updated_at`, `tg_pedidos_vendedor_inmutable` y `admin_reasignar_vendedor_pedido` abren el cuerpo con `as $`
   (un solo dolar, delimitador invalido en PostgreSQL) y cierran con `end $$;` / `end $;` (desparejos). Al correrla en el SQL
   Editor falla por sintaxis y el begin/commit revierte TODO (sin perdida de datos, pero la T1-A-01 y el updated_at del
   servidor NO quedarian aplicados). Corregir a `as $$ ... end $$;` en las tres (la 023 y la funcion de la linea 190 usan `$$`).
   Agregar a migracion024.sql.test.js un chequeo de que cada `as $x` tenga su `end $x;` pareado (hoy el test no lo detecta).
2. (menor) AC-BUL-3 en SPEC.md:132 sigue diciendo que "− Bulto" con menos de 1 bulto "baja al piso"; el codigo ahora no hace nada
   (bultos.js:123). Anotar en SPEC la modificacion por AC-CBU-2/BUG-1 para que SPEC y tests no se contradigan.

## Tabla AC -> test -> resultado (todos VERDE)
EDP-1 tanda1.bloqueA, ListaPedidos.tanda1, NuevoPedido.tanda1, pedidoRepository.edicion | EDP-2 bloqueA, Armado.tanda1, qa.tanda1.bordes
EDP-3 pedidoRepository.edicion, Armado.tanda1 | MUL-1/2 minimos, NuevoPedido.tanda1, tienda.carrito, qa bordes, migracion024 (SQL no ejecutable en jest)
CBU-1/2/3 NuevoPedido.tanda1, qa bordes (3 GAP + BUG-1 ahora verdes) | SST2-1 NuevoPedido/Armado.tanda1 | MIN2-1 Armado.tanda1, minimos, unidadVenta
ASV-1/2 nuevoPedido.vendedor, listaPedidos.asignacion, pedidosWeb.vendedor, tanda1.seguridad | PEN-1 ListaPedidos.tanda1, bloqueA

## Hallazgos de seguridad
- T1-A-01 (Alto): diseno correcto (trigger BEFORE UPDATE conserva vendedor/vendedor_id/cargado_por para anon/authenticated, flag set_config
  local, RPC security definer con search_path fijo, PIN admin + vendedor activo, revoke/grant). Queda efectivo SOLO al arreglar el punto 1.
- T1-A-02 corregido (edicionPedido.js congelarPrecios recalcula; manual/descuento ignorados para no-admin). T1-A-03 corregido (remoteUpdatedAt
  al insertar, pedidoRepository.js:114/195). T1-A-04 corregido (base por registro local, pedidoRepository.js:130-133, 228). T1-A-05 corregido (permisos.js:50-53).
- T1-A-06 corregido en la 024 (search_path). T1-A-07/08/09 (bajos) quedan abiertos, aceptables.
- 024: idempotente (if not exists / drop trigger if exists / create or replace), sin drop de datos, checks `not valid`.
  tienda_crear_pedido conserva las validaciones de la 019 (direccion_exacta, topes, idempotencia, limites, precios del servidor);
  solo agrega tienda_cantidad_valida.

## AC-CBU-2 (desvio)
Resuelto: BultoControl tiene sueltas-mas/menos, cambiarCasillero('sueltas') opera sobre c % bultoX, "− Bulto" con 0 bultos no hace nada.
Cantidad guardada sigue en unidades (stock/comisiones intactos).

## Tests adaptados (revisados con lupa)
- bultos.test/pedido/armado/facturacion (5 u. => queda 5): consecuencia legitima de CBU-2/BUG-1; protege datos (antes borraba sueltas). No debilita
  la garantia de piso; restarBulto(12,12) y (41,12)=29 siguen verificados.
- precioMinimoStock.pedido: usa "− Bulto" en vez de "−" (el − ahora es de sueltas por CBU-2); mismo resultado esperado (10, sin precio por bulto). OK.
- precioMinimoStock.armado: 8+12=20 pasa a 6+12=18 por AC-MUL-2 (20 no es multiplo de 6); misma garantia de precio $8. OK.
- minimos/unidadVenta (admin en armado) y tienda.carrito/tiendaCasos (minimo 2 => 4 u.): cambios exigidos por MIN2-1 y MUL-2; el armador sigue bloqueado (agregado). OK.
- pedidosWeb.test: la eleccion del admin gana (ASV-2). OK. Ningun test borrado ni salteado (el unico skip es preexistente).

## Reglas duras CLAUDE.md
Stock solo por movimientos (sin cambios), IDs sin cambios, DB_VERSION sin cambios (campos nuevos son props de pedidos), legacy intactos,
sin .env/claves, sin migracion de columnas publicas de productos (no aplica regla 8). Sin regresion de perdida de datos detectada.

## Pasos manuales para el dueno (tras corregir el punto 1)
1. Backup, aplicar 023 y luego 024 en Supabase SQL Editor (verificar que la 019 ya este aplicada).
2. Probar: reasignar vendedor con PIN admin; PATCH directo de vendedor por anon no debe cambiarlo; carrito web con cantidad no multiplo => "cambio".
3. Deploy de la app despues de la migracion.
