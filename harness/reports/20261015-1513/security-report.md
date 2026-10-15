# Reporte de seguridad - run 20261015-1513 (REQ-FAB, REQ-AGR, REQ-TRQ, REQ-ZON)

## Resumen ejecutivo
Alcance: diff de la corrida + archivos nuevos (migracion 011, facturacionService, FacturasAEmitir, syncService, pedidoRepository, App, pdfGen).
Crítico: 0, Alto: 0 (nuevos), Medio: 2, Bajo: 3. CORREGIDO: ninguno (no se modifico `src/**` de produccion; no hubo defectos en lo nuevo que lo exigieran).
Las decisiones S1-S4 del arquitecto se VALIDAN: el dato fiscal (A/B) queda fuera del alcance de la anon key y el CUIT del reporte solo sale por RPC con PIN de admin.
Los Medio son riesgos heredados del modelo "todo es anon" (no introducidos por esta corrida). Tests: `src/__tests__/security.lote011.run1513.test.js` (10 verdes).

## Tabla de hallazgos
| Id | Severidad | Hallazgo | Evidencia | Estado | Dónde se corrige |
|---|---|---|---|---|---|
| S-011-01 | Medio | `clientes.cuit`/`tipo_iva` legibles (y `clientes` escribible) con la anon key; el reporte A/B no agrega exposicion pero el CUIT sigue publico | 001_altas_y_stock.sql:16, 002:367 | ABIERTO | Requiere acción del dueño (ver Detalle) |
| S-011-02 | Medio | `admin_facturas_a_emitir` confia en `pedidos.estado/total/fecha`, que cualquier anon puede escribir: se puede inflar o inventar lo que ve el contador | 011.sql:170-186 | ABIERTO | Dueño / Auth real (PASO 5 de 002) |
| S-011-03 | Bajo | DoS del admin: 5 PIN fallidos contra su id (ids de vendedor publicos) lo bloquean 15 min. Patron heredado de 002/007/010 | 011.sql:98, 002:108-113 | ABIERTO | Dueño (rate limit en edge, o Auth) |
| S-011-04 | Bajo | `updated_at` lo manda el cliente (admin): una marca con fecha futura congela el tipo A/B del pedido (last-write-wins). Requiere PIN admin | 011.sql:132,145 | ABIERTO | Migracion 012: `v_ts := least(v_ts, now() + interval '5 minutes')` |
| S-011-05 | Bajo | `pedidos.grupos` sin limite de tamaño en BD: anon puede escribir un jsonb enorme (pedidos ya es escribible); el cliente lo acota al leer | 011.sql:28, gruposFactura.js (normalizarGrupos) | ABIERTO | Migracion 012: `check (grupos is null or pg_column_size(grupos) < 65536)` |
| S-DEP-xlsx | Alto (heredado) | `xlsx` con Prototype Pollution y ReDoS, sin fix en npm. `npm audit --omit=dev` lista ademas muchas vulnerabilidades del arbol CRA. Ya reportado en corridas previas | package.json | ABIERTO | Ver reportes previos (migrar a exceljs) |

## Detalle
**Validado, sin hallazgo:**
- `pedidos_factura`: RLS activo, `revoke all` a public/anon/authenticated, sin policies ni grants (011:81-82). Con la anon key no se lee ni escribe. `tipo_factura` no viaja en ninguna fila de `pedidos` (test).
- Ambas RPC y el helper: `security definer set search_path = public, pg_temp`. `_es_admin_con_pin` sin grant a anon. RPC publicas: `revoke from public` + grant a anon/authenticated (el PIN es la barrera, igual que 007/010). El PIN se valida con `verificar_pin` (bcrypt + bloqueo 5 fallos/15 min); el fallo devuelve `no_autorizado` por `return`, no `raise`, asi el intento fallido queda registrado. "No es admin" y "PIN malo" dan la misma respuesta.
- Limites: lote 1..500, regex de `pedido_id` `^[0-9a-zA-Z-]{1,64}$`, tipo en lista cerrada, rango maximo 366 dias, `p_admin_id` max 64, fila mala aislada por subtransaccion. El unico `execute format` usa el tipo de `pedidos.id` del catalogo (sin entrada de usuario). Sin inyeccion SQL.
- Sonda `sondearMigracion011` con id vacio: responde `no_autorizado` antes de `verificar_pin`, no consume intentos.
- PIN: por parametro, `setPin('')` tras usarlo, sin localStorage/console (test). No se loguean filas con CUIT.
- Autorizacion UI: tab y render con `isAdmin` (App.js). Forjar `permiso` en IndexedDB solo muestra una pantalla sin datos: la fuente real es la RPC con PIN.
- Grupos (jsonb editable): `normalizarGrupos` aplica `texto()` (sin control chars, 60 chars), tope 50 grupos/500 claves, descarta duplicados, claves inexistentes y basura estructural. Con nombres de 5000 chars, HTML, `=cmd|calc` o NUL, el total sigue siendo la suma de `items` (test). Las filas de detalle no se suman (sin doble conteo). Peor caso: un nombre de grupo engañoso en la boleta, nunca un monto distinto.
- XSS/PDF: jsPDF dibuja texto sin interpretar HTML; React escapa. El reporte no exporta CSV/XLSX: sin formula injection nueva. El nombre del PDF no lleva CUIT y el periodo se filtra a `[0-9-]`. `encabezadoTipoFactura` es lista cerrada. REQ-TRQ solo reposiciona texto fijo.
- Stock: nada de esta corrida toca `movimientosStock`. Los reintentos de la RPC son idempotentes (upsert por `pedido_id`).
- `orden_zona`: check `> 0`; el cliente sube `floor(Number)>0` o null (sin NaN/negativos/Infinity). La inicializacion es unica y no pisa datos (`where orden_zona is null`, solo si no hay ninguno cargado).
- Headers: `_headers` sin cambios; la CSP sigue en Report-Only (ya reportado antes).

**S-011-01 CUIT en clientes (CVSS ~5.3) - evaluacion de cierre.** Es posible pero NO barato: `downloadMaestros` hace `select('*')` sobre clientes y `syncClientes` hace upsert directo; ClienteForm, PedidosWeb, plantillas, pdfGen y la tienda (Checkout) usan el CUIT. Camino: (1) `revoke select on public.clientes from anon` y `grant select (columnas sin cuit/tipo_iva)` como en 004/007; (2) leer CUIT solo por RPC con PIN o moverlo a una tabla lateral estilo `pedidos_factura`; (3) cambiar `select('*')` por lista de columnas y subir el CUIT por RPC. Costo: 1 migracion + cambios en syncService/ClienteForm/tienda + tests, 1 a 2 dias, con riesgo de romper el alta de clientes de los vendedores. Recomendacion: NO ahora; hacerlo junto con Supabase Auth (PASO 5 de 002), que resuelve S-011-01/02/03 a la vez.

**S-011-02 (CVSS ~4.3).** Cualquiera con la anon key puede marcar un pedido como `facturado` o cambiar `total`. Mitigacion barata opcional: en el reporte del contador recalcular el total desde `items` y marcar diferencias.

## Corregido en esta corrida
CORREGIDO: ninguno. Se agrego `src/__tests__/security.lote011.run1513.test.js`, que fija lo validado (RLS/grants/search_path/limites de la 011, grupos hostiles, frontera fiscal, PDF sin CUIT en el nombre).

## Requiere acción del dueño
1. Aplicar `011_lote_operacion_facturacion_zonas.sql` a mano (backup antes) y verificar con la anon key que `select * from pedidos_factura` da "permission denied".
2. Decidir S-011-01 (CUIT publico): recomendado diferir a la migracion a Supabase Auth; si se quiere ya, 1-2 dias (ver Detalle).
3. Opcional, bajo costo: migracion 012 con el tope de `updated_at` (S-011-04) y el check de tamaño de `grupos` (S-011-05).
4. Mantener un PIN de admin fuerte (4-8 digitos es la unica barrera de las RPC; el bloqueo mitiga fuerza bruta pero habilita S-011-03).
5. Dependencias: `xlsx` sigue abierto (ver reportes previos).
