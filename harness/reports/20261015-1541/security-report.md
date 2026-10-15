# Reporte de seguridad - run 20261015-1541 (REQ-INA, REQ-CPR, REQ-STB)

## Resumen ejecutivo
Alcance: migracion 012, comprasService, comprasLocalService, stockService, `ingresoToRemote`, Proveedores, pdfGen, `_headers`.
Vuelta 2 (verificada): Crítico: 0, Alto: 0, Medio: 0 abiertos; Bajo: 4 abiertos (S-012-04, 05, 07, 08, 09 incluye precauciones). Vuelta 1 había reportado Alto: 1, Medio: 2, Bajo: 4; todos los Alto/Medio quedaron CORREGIDO. El diseño D1-D8 es correcto y la 012 cierra bien lo nuevo: las 4 tablas
quedan con RLS, sin grants ni policies, y el bucket es privado. El único problema serio es D7: ahora que el
costo del ingreso se copia a `productos.costo_final` (AC-INA-4), el costo real de compra queda legible con la anon
key. Ese riesgo ya existía, pero este lote lo vuelve real. Dependencias: `npm audit --omit=dev` sigue con `xlsx`
(prototype pollution y ReDoS, sin fix) y los hallazgos de react-scripts, ya conocidos y sin cambios en este diff.
No se leyó `.env`; está en `.gitignore`; no hay logs de PIN ni de claves en el código nuevo.
Tests: `src/__tests__/security.lote012.run1541.test.js` (16 verdes).

## Tabla de hallazgos
| Id | Severidad | Hallazgo | Evidencia | Estado | Dónde se corrige |
|---|---|---|---|---|---|
| S-012-01 | Alto (CVSS 6.5) | Costo real de compra legible con anon: `productos.costo_final` (con descuentos y ganancia) | 007 l.47 `grant select on productos`; stockService.js:98-110 | CORREGIDO | 013 + syncService + costosProductosService |
| S-012-02 | Medio (5.3) | Bajada incremental por `updated_at` del cliente: un dispositivo que sube tarde no llega a los demás | 012 l.347, l.398, l.499-503; comprasService.js cursor | CORREGIDO | 012 v2 (synced_at + cursorCompras.js) |
| S-012-03 | Medio (4.3) | `exception when others` traga cualquier error y lo informa como `datos_invalidos` | 012 l.383, 434, 472 | CORREGIDO | 012 v2 (excepciones acotadas) |
| S-012-04 | Bajo (3.1) | El tipo del adjunto lo declara el cliente (sin magic bytes); sin límite de comprobantes por pago | 012 l.269-275; cuentaProveedores.js:98 | ABIERTO | Opcional |
| S-012-05 | Bajo (3.1) | `comprobante_path` no se liga al pago ni se verifica que exista; `admin_comprobante_lectura` pisa un permiso `subir` pendiente | 012 l.408, l.544 | ABIERTO | 012 v2 |
| S-012-06 | Bajo (3.5) | `admin_guardar_productos` no acota `costo_final`, descuentos, ganancia ni `precio` (acepta `Infinity` en PG14+); heredado de 007/010 | 012 l.101-104, l.131-135 | CORREGIDO | 012 v2 (rangos, NaN/Infinity) |
| S-012-07 | Bajo (3.7) | PIN en estado React hasta usarlo y bloqueo de 15 min por `vendedor_id` (DoS, heredado de 002) | Proveedores.js:42, 206; 002 l.108 | ABIERTO | Aceptado |
| S-012-08 | Bajo (3.1) | El grant por columnas de la 013 es estático: una columna futura de `productos` NO queda pública (el comentario de la 013 dice lo contrario); si se agrega a `COLUMNAS_PRODUCTO_PUBLICAS` sin grant, `fetchAll` falla con 42501 | 013 l.43-52; syncService.js:1064-1078 | ABIERTO | Precaución documentada |
| S-012-09 | Bajo (2.6) | Orden de despliegue: si la 012 vieja ya se aplicó, queda el overload `admin_compras_bajar(...,timestamptz)` (sigue con PIN); la 013 exige la 012 v2. Clientes viejos con `select('*')` fallan tras la 013 | 012 l.653; 013 l.23-28 | ABIERTO | Dueño (orden) |
| S-012-C1 | Alto (CVSS 6.5, evitado) | Costos y tipo A/B en `ingresos_mercaderia`, que es legible con anon | stock.js:256-268 (whitelist D2) | CORREGIDO | Este lote |
| S-012-C2 | Alto (evitado) | Tablas de compras abiertas a anon | 012 l.193-194, 217-218, 257-258, 266-267 | CORREGIDO | Este lote |
| S-012-C3 | Alto (evitado) | Comprobantes en bucket público o listable | 012 l.269-298 | CORREGIDO | Este lote |

## Detalle
**Verificado sin hallazgo.**
- *Anon sin acceso a las tablas.* `revoke all ... from public, anon, authenticated` más RLS sin policies. Si el default privileges de Supabase otorgara algo, el `revoke` explícito lo anula.
- *Costos que salen por filas anon.* Ninguna fila anon trae costos salvo S-012-01. `ingresos_mercaderia.items` pasa por la whitelist, y `cambios_precio` (010) no guarda costos. Aun así el servidor no obliga a la whitelist (un cliente modificado podría escribir `items` libres con anon, pero solo contaminaría sus propios datos).
- *RPC con PIN.* Las 4 RPC nuevas llaman a `_es_admin_con_pin`, que ejecuta `verificar_pin` siempre y devuelve (no hace `raise`), así que el intento fallido se registra y rige el bloqueo de 5 fallos. Todas fijan `search_path = public, pg_temp`. El helper no tiene grant. `tg_cuenta_prov_inmutable` tiene `revoke`.
- *Límites.* 500 filas por lote, 1000 por página, renglones <= 500, jsonb < 256 KB, monto <= 1e11 centavos, ids con regex, reloj acotado a now()+5 min.
- *Inmutabilidad de `cuenta_proveedores`.* El trigger impide editar monto, tipo, medio y similares. El `on conflict` solo completa el comprobante y la anulación una vez. No hay grant de delete.
- *Bucket.* `public=false`, 5 MB, 4 mimes. El insert exige un nombre habilitado en `comprobantes_habilitados` (regex estricta, UUID del servidor, 10 min, `upsert:false`). El select exige habilitación de lectura (2 min, nombre exacto). No hay update ni delete. El listado solo devuelve nombres ya habilitados. No hay URL pública ni firmada: `download()` más blob URL local. `window.open(..., 'noopener')` y revoke a los 120 s.
- *`admin_guardar_productos`.* Diff 010 -> 012: solo difiere `stock_minimo`. Se conservan admin activo, PIN, tope de 500, regex de id, NaN, `https?://`, límites de largo y `revoke` a public. Es un buen detalle que `stock_minimo` se conserve si la clave no viene.
- *PDF.* jsPDF dibuja texto, así que no hay HTML ni scripts. Los importes salen de centavos enteros con `Math.round`, y los nombres de archivo se sanean. La fórmula de CSV/XLSX no aplica: no hay export CSV nuevo.
- *Pedidos al proveedor.* No llevan costos (D4 ok).

**S-012-01 / D7 (Alto).** Con anon se puede pedir `GET /rest/v1/productos?select=nombre,costo_final,descuento1,descuento2,ganancia,precio_venta2`
y reconstruir el costo y el margen de toda la lista. La 007 hizo `grant select` de toda la tabla, y la app también
hace `fetchAll('productos')` con anon. Antes `costo_final` era un dato opcional cargado a mano. Ahora AC-INA-4 lo
completa por defecto (`actualizarCosto !== false`) con el costo real de la factura. La decisión D7 ("no empeora la
exposición") es incorrecta: la exposición crece. Costo y plan:
1. *Costo.* Una migración 013 y cambios en el pull (~1 día), sin tocar el modelo de stock.
2. *Opción A, recomendada.* Tabla `productos_costos(producto_id pk, costo_final, descuento1, descuento2, ganancia, precio_venta2, updated_at)` con RLS y `revoke all`. `admin_guardar_productos` escribe ahí. Se agrega `admin_productos_costos(pin, desde)` para el pull de admin, y se mantiene el valor en IndexedDB.
3. *Opción B.* `revoke select on public.productos from anon, authenticated; grant select (id, nombre, codigo, precio, ...) to anon, authenticated;`, que es más simple. Obliga a que todos los `select('*')` pasen a listar columnas.
4. *Mitigación inmediata (decisión del dueño).* Hasta aplicar la 013, poner el tilde "actualizar costo" por defecto en `false`, o aceptar que el costo de la factura queda visible para cualquiera con la anon key.

**S-012-02 (Medio).** El cursor se calcula con `updated_at` enviado por el cliente (acotado solo hacia el futuro).
Un dispositivo offline que sube con timestamps de hace días escribe filas con `updated_at` anterior al cursor de los
demás, y esos dispositivos no las bajan (solape de 5 min). Además, 1000 filas con el mismo `updated_at` en el borde
de página se saltean. Remediación: columna `synced_at timestamptz not null default now()` actualizada en cada
upsert/`on conflict`, con índice y cursor sobre ella (mantener `updated_at` para el last-write-wins).

**S-012-03 (Medio).** Un `when others` oculta fallos reales (permisos, bugs de la RPC, `query_canceled`) tras
"datos_invalidos", y el cliente deja la fila pendiente sin diagnóstico. Remediación: capturar solo
`check_violation, invalid_text_representation, invalid_datetime_format, numeric_value_out_of_range, raise_exception`
y dejar propagar el resto.

**S-012-04 / 05 (Bajo).** `allowed_mime_types` valida el header del upload, no el contenido, pero solo lo ve el
admin y no hay SVG ni HTML permitido. Para atar el path al pago, agregar en `admin_compras_guardar`
`left(comprobante_path, 43) = 'pagos/' || id::text` (el prefijo es el UUID del pago). En `admin_comprobante_lectura`,
usar `on conflict do nothing` en vez de pisar un `subir` vigente.

**S-012-06 (Bajo).** Agregar `check (costo_final between 0 and 999999999)` en productos, o validar en la RPC con `v_x = 'Infinity'`/rangos.

## Corregido en esta corrida
**Vuelta 2 (verificado con `security.lote012.vuelta2.test.js`, 7 tests verdes):**
- S-012-01 CORREGIDO: la 013 revoca el select de tabla y otorga solo las columnas públicas (sin `costo_final`, `descuento1/2`, `ganancia`, `precio_venta2`). `admin_productos_costos`: security definer, `search_path`, PIN, keyset por id, tope 1000, grant a anon (protegida por PIN). No quedan `select('*')` sobre `productos` en `src` (solo `delete` y `select('id')`, columna pública). La tienda y los RPC de 008/009/010 son security definer (corren como dueño) y ninguna vista usa `productos`, así que no se rompen. Vendedores/armadores bajan con `COLUMNAS_PRODUCTO_PUBLICAS`; los costos locales no se pisan con vacío (`aplicarCostosRemotos` salta filas con cambios pendientes).
- S-012-02 CORREGIDO: `synced_at` por trigger (`clock_timestamp`), índices y cursor (synced_at, id) con solape.
- S-012-03 CORREGIDO: sin `when others`; solo excepciones acotadas.
- S-012-06 CORREGIDO: costos <= 999999999999, descuentos 0..100, NaN/Infinity rechazados.
Vuelta 1:
CORREGIDO por diseño (verificado, con tests):
- S-012-C1: whitelist de `items` en `ingresoToRemote`; los costos van por `ingresos_costos` con PIN.
- S-012-C2: tablas nuevas cerradas a anon.
- S-012-C3: bucket privado con permisos cortos por RPC.
- Sin cambios de código de producción por parte del auditor (regla: no se toca `src/**`).
- Decisiones del arquitecto: D1, D2, D3, D4, D5, D6 y D8 validadas. **D7 corregida**: no es "fuera de alcance", ver S-012-01.

## Requiere acción del dueño
0. Orden de despliegue (S-012-09): publicar la app nueva, aplicar 012 (versión actual, aunque ya haya corrido la anterior; es idempotente) y después 013. Los PWA con bundle viejo fallan al sincronizar productos hasta actualizarse. Opcional: `drop function public.admin_compras_bajar(text, text, timestamptz);`.
0b. Precaución permanente (S-012-08): toda migración que agregue una columna a `productos` debe correr `grant select (<col>) on public.productos to anon, authenticated;` si es pública y agregarla a `COLUMNAS_PRODUCTO_PUBLICAS`; si es sensible, no otorgarla. Hay que volver a probar con la anon key que `select=costo_final` devuelve `permission denied`.
1. D7 resuelto con la Opción B (013): aplicarla y verificar con la anon key `GET /rest/v1/productos?select=costo_final` (esperado 401/403) y `?select=id,nombre,precio` (esperado 200).
2. Aplicar la 012 a mano en el SQL Editor (después de 010 y 011, con backup) y probar con la anon key que `select` a las 4 tablas devuelva `permission denied`/vacío, y que `list` del bucket sin permiso devuelva `[]`.
4. Las vulnerabilidades de `xlsx` y de la cadena react-scripts siguen abiertas (ver corridas anteriores).
