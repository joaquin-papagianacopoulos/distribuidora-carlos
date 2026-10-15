# Security report — RUN 20261015-0043 (REQ-PBU, REQ-MIN, REQ-SST, REQ-HPR)

Alcance: migracion 010, productosAdminService, syncService, precios.js, cambiosPrecioService, tienda/*, pdfGen. Analisis estatico (sin Postgres para ejecutar la 010). Tests: `src/domain/__tests__/security.lote010.test.js`.

## Resumen ejecutivo
Crítico: 0, Alto: 0, Medio: 1, Bajo: 4.

Las decisiones S1 a S5 del plan (sec. 6) se validan. No se perdio ninguna proteccion de 007/008/009 (diff verificado). Los hallazgos S-010-01 a S-010-04 fueron corregidos por el implementador y verificados en el SQL; queda abierto solo S-010-05 (`xlsx`, ya conocido).

## Tabla de hallazgos
| Id | Severidad | Hallazgo | Evidencia | Estado | Dónde se corrige |
|---|---|---|---|---|---|
| S-010-01 | Medio (4.3) | `cambios_precio` legible por anon exponia `usuario_id` (id del admin = mitad de la credencial del RPC). | 010:537-538 (grant select por columnas sin `usuario_id`); cambiosPrecioService.js:77 | CORREGIDO | 010 + cambiosPrecioService.js |
| S-010-02 | Bajo (3.1) | `'NaN'::numeric` pasaba las validaciones de precio/precio_bulto/cambios_precio; un precio NaN rompe `tienda_crear_pedido` (DoS acotado, requiere PIN admin). | 010:114, 597-598 | CORREGIDO | 010 |
| S-010-03 | Bajo (2.5) | `revoke` sin cubrir `references`/`trigger` en `cambios_precio`. | 010:537 (`revoke all ... from public, anon, authenticated`) | CORREGIDO | 010 |
| S-010-04 | Bajo (2.0) | `tienda_catalogo`/`tienda_crear_pedido` redefinidas sin re-emitir revoke/grant. | 010:634-637 | CORREGIDO | 010 |
| S-010-05 | Bajo | `xlsx` con 2 CVE sin fix (GHSA-4r6h-8v6p-xvw6 prototype pollution, GHSA-5pgg-2g8v-p4x9 ReDoS). Sin dependencias nuevas en esta corrida. | package.json; `npm audit --omit=dev` | ABIERTO | Dueño: migrar a SheetJS >= 0.20 (CDN) o exceljs |

## Detalle
1. **Servidor recalcula precio con bulto.** `tienda_crear_pedido` unifica renglones por producto, calcula `v_unit` (oferta vigente) y `tienda_precio_aplicado(v_unit, precio_bulto, bulto_x, unidades_totales)` con `least()`: nunca cobra mas que el precio vigente. Partir el carrito en renglones no da precio de bulto sin llegar al bulto completo. `precioVisto` del cliente solo se compara (difiere => `motivo:'cambio'`, no se crea el pedido). Minimo efectivo tambien server-side. Totales en centavos enteros.
2. **anon no escribe `cambios_precio` ni `precio_bulto`.** RLS on, una sola policy `select`, `revoke all` + `grant select` por columnas. Escritura solo por `admin_registrar_cambios_precio` (PIN verificado + `permiso=1 and activo`; id vacio => `no_autorizado` sin gastar intentos). `productos` sin insert/update/delete para anon (007); `precio_bulto` solo por la rama extras de `admin_guardar_productos`.
3. **search_path y grants.** Las 4 RPC `security definer` con `search_path` fijo (`public[, extensions], pg_temp`). Helpers nuevos `immutable`, search_path fijo, sin grant a public/anon/authenticated.
4. **007/008/009 intactas.** `tienda_crear_pedido` solo cambia precio/minimo/`precioOriginal` (se conservan idempotencia, honeypot, limite por IP con sal, advisory lock, normalizacion de ids, topes, token). `tienda_catalogo` solo suma `precioBulto` y `minimoVenta` (mantiene `statement_timeout`, `visible_tienda`, sin costo ni stock exacto). `admin_guardar_productos`: diff = solo `precio_bulto`.
5. **PDF.** `generarCambiosPrecioFile` usa `doc.text`/`autoTable` con texto plano, sin `html()`/`fromHTML`; nombre de archivo saneado. Sin `dangerouslySetInnerHTML` ni `javascript:` activo. Sin export CSV/XLSX nuevo (no aplica formula injection).
6. **Cliente.** `CambiosPrecio` solo `esAdmin` (UX; el servidor revalida PIN). PIN por parametro, no se guarda ni se loguea. Rechazos del servidor se marcan `syncRechazo`.
7. **Stock.** Sin cambios de modelo; pedido web idempotente por UUID; cambios de precio idempotentes (`on conflict (id) do nothing`).
8. **Headers/secretos.** `public/_headers` sin cambios; no se leyo `.env`; sin claves en el diff.

## Corregido en esta corrida
- S-010-01 a S-010-04 (verificados en el SQL de la 010 y en `leerRango`).
- Test `security.lote010.test.js` (search_path, grants, RLS, recalculo server-side, PDF).

## Requiere acción del dueño
1. Aplicar la 010 a mano en Supabase (despues de 007 y 009, con backup) y recien despues publicar la app.
2. Verificar con rol anon: `insert into cambios_precio ...` => permission denied; `select usuario_id from cambios_precio` => permission denied; `select tienda_precio_aplicado(10,8,12,12)` => permission denied; pedido con `precioVisto` manipulado => `motivo:'cambio'`.
3. Limpieza opcional previa: `select id from productos where precio = 'NaN' or precio_bulto = 'NaN';`.
4. S-010-05: reemplazar `xlsx` (ABIERTO).
