# Plan RUN 20261110-t3 — REQ-ESC (descuento por escala de bultos)

Alcance: AC-ESC-1..4. Toca REQ-PBU (precioAplicado), REQ-FRB (remito), REQ-GBU (grupo), REQ-MUL/MIN (sin cambios de regla), REQ-TIE (servidor), REQ-PLA (plantilla).
Una sola implementacion secuencial. Sin cambios de stock (ledger intacto: nada de esto escribe stock).

## 1. Modelo de datos

| UI (etiqueta) | Interno (IndexedDB `productos`) | Remoto (`public.productos`) |
|---|---|---|
| "Descuento por escala de bultos" (3 filas: "Desde (bultos)" + "% desc.") | `escalasBulto: Array<{desde:int, pct:number}>` (normalizado, 0..3) | `escalas_bulto jsonb` null o `[{"desde":5,"pct":8}]` |
| Plantilla: columna "Escalas por bulto" (texto `5=8; 10=12`) | idem | idem |

Renglon de pedido (`items` jsonb, sin columna nueva; viaja tal cual en el sync de pedidos):
- Congelado al crear: `escalasBulto` (copia normalizada), `precioBultoX` (tambien si no hay `precioBulto` pero hay escalas), `precioOriginal`, `precioBultoOriginal` (como hoy).
- Derivado (lo recalcula el dominio, nunca se confia en lo que venga): `escalaDesde`, `escalaPct` (solo presentes si la escala se aplico). `precio` = precio unitario final.
- Pedidos ya hechos: el cambio posterior de escalas del producto no los toca (se re-precia con lo congelado, igual que AC-PBU-3).

IndexedDB: **sin cambio de `DB_VERSION` (queda 12)**. Es un campo mas dentro de objetos existentes, sin store ni indice nuevo. Productos viejos sin el campo => `[]`.

Supabase (migracion `026_escalas_bulto.sql`): columna `escalas_bulto jsonb` + check + `grant select (escalas_bulto) on public.productos to anon, authenticated` + helpers + 3 RPC reemplazadas (ver seccion 4).

## 2. Funciones puras de dominio (src/domain/precios.js)

| Firma | Contrato |
|---|---|
| `normalizarEscalasBulto(raw) -> Array<{desde,pct}>` | Acepta array o string JSON; otro => `[]`. Recorre en el orden recibido (max 10 elementos leidos): entrada valida si `desde` entero 2..9999, `pct` numero 0<pct<100 con <=2 decimales; se conserva solo si `desde` > ultimo `desde` conservado. Corta en 3. Desordenadas/invalidas se ignoran una a una, nunca tira. |
| `escalaAlcanzada(escalas, bultoX, unidades) -> {desde,pct}\|null` | `bx = normalizarBultoX(bultoX)`; null si bx null. `bultos = floor(unidades/bx)`; devuelve la de mayor `desde` con `bultos >= desde`. |
| `aplicarDescuentoEscala(precio, pct) -> number` | Aritmetica entera: `c = round(precio*100)`, `bp = round(pct*100)`; resultado en pesos enteros = `ceil(c*(10000-bp)/1_000_000)` con BigInt (sin error de float). |
| `precioConEscala(producto, cantidad) -> {precio, porBulto, escala?}` | Base = regla PBU actual (menor entre precio y precioBulto si llega a 1 bulto). Si `escalaAlcanzada` y el resultado < base: `precio` = resultado y `escala = {desde, pct, bultos}`. Si no, igual a la base sin clave `escala`. |
| `precioAplicado(producto, cantidad)` (cambia) | Delega en `precioConEscala`. Mismo shape que hoy; la clave `escala` aparece SOLO si se aplico (tests `toEqual({precio, porBulto})` siguen verdes). Lee `producto.escalasBulto`. |
| `precioAplicadoRenglon(item, cantidad)` (cambia) | Re-precia si hay `precioBultoOriginal>0` **o** `escalasBulto` no vacio (con `precioBultoX`). Pone/saca `escalaDesde`/`escalaPct`. Manual => sin cambios (AC-PBU-3). |
| `esPrecioManual(item)` (cambia) | Un `precio != precioOriginal` con `escalaPct>0` NO es manual. |
| `precioBaseRenglon(item)` (cambia) | Con `escalaPct>0`: `aplicarDescuentoEscala(base PBU, escalaPct)`. La escala NO cuenta como "descuento" en `totalesBoleta` (mismo criterio que REQ-FRB S3); el descuento manual si. |
| `completarPreciosBulto(item, producto)` (cambia) | Si el renglon ya trae `escalasBulto` no toca; si no, congela tambien las escalas del producto bajo la misma condicion de hoy (precio unitario igual al del producto). |
| `precioMinimoRenglon(ref) -> number` (nuevo) | Piso posible: base bulto con la escala de mayor pct. Lo usa `edicionPedido` para el rango del renglon de grupo. |
| `etiquetaEscala(item) -> string\|null` | `"x5 bultos −8 %"` para pantalla; `etiquetaEscala(item, {pdf:true})` usa `-` ASCII (jsPDF helvetica no tiene U+2212). |
| `validarEscalasBulto(filas, bultoX) -> {valor, errores, avisos}` | Estricto (form e importacion): fila vacia se ignora; fila a medias, N no entero/ <2, D fuera de (0,100) o >2 decimales, N no estrictamente creciente, >3 filas => error. Escalas con `bultoX<=1` => error "Las escalas necesitan Bulto x mayor a 1". D no creciente => aviso (no bloquea). Acepta `"7,5"` y `"8%"`. |
| `escalasATexto(arr)` / `parsearEscalasTexto(txt)` | `5=8; 10=12` <-> filas. Separador de escalas `;` o `\|`; entre N y D `=` o `:`; coma decimal en D. |

## 3. Archivos (en orden)

1. `src/domain/__fixtures__/escalasCasos.js` (nuevo) — casos compartidos cliente/servidor (seccion 6). AC-ESC-2, AC-ESC-4.
2. `src/domain/precios.js` — funciones de la seccion 2. AC-ESC-2, AC-ESC-4.
3. `src/domain/productos.js` — `CAMPOS_PRODUCTO` agrega al FINAL `{key:'escalasBulto', label:'Escalas por bulto', tipo:'escalas'}` (no corre columnas viejas); `validarProducto` usa `validarEscalasBulto` (`p.escalasBulto`, `errores.escalasBulto`); `COLUMNAS_PRODUCTO_PUBLICAS` agrega `'escalas_bulto'` al final (la mas nueva: el fallback `columnasSinLaMasNueva`/`columnasSinFaltante` la descarta si falta la 026); `productoPreciosToRemote` manda `escalas_bulto` solo si `p.escalasBulto !== undefined` (array normalizado o `null` si vacio); `productoExtraFromRemote` lee `escalas_bulto` (ausente => local; null => `[]`). AC-ESC-1.
4. `src/domain/bultos.js` (`renglonNuevo`) — congela `escalasBulto` + `precioBultoX` cuando hay escalas aunque no haya `precioBulto`; usa `precioAplicado` para precio y `escalaDesde/escalaPct`. AC-ESC-2.
5. `src/domain/grupoBulto.js` — sin cambio de regla (ya pasa el total del grupo a `precioAplicadoRenglon`, que ahora cuenta bultos del grupo). `lineaGrupoBulto` agrega sufijo de escala si todos los renglones tienen la misma `escalaPct`. `progresoGrupoBulto`: texto suma `· x5 bultos −8 %` cuando aplica. AC-ESC-2, AC-ESC-3.
6. `src/domain/edicionPedido.js` (`refPrecio`/`congelarPrecios`) — `ref.escalasBulto` (del renglon original o del catalogo para renglones nuevos); recalcula `escalaDesde/escalaPct` (no confia en el cliente: T1-A-02); piso del grupo = `precioMinimoRenglon(ref)`. AC-ESC-2/3 (edicion).
7. `src/domain/gruposFactura.js` — `nombreConMarca` suma `" (x5 bultos -8 %)"` (ASCII) ademas del sufijo de bulto. AC-ESC-3 (remito/PDF).
8. `src/utils/pdfGen.js` — sin cambio de logica (usa `filasBoleta`/`totalesBoleta`); solo verificar que totales coinciden. AC-ESC-3.
9. `src/domain/plantillas.js` — instrucciones de "Escalas por bulto" (formato, ejemplo `5=8; 10=12`, vacio conserva, `-` borra), alias de encabezado (`escalas`, `escalasbulto`, `escalasporbulto`, `descuentoporescala`), `SOLO_PLANTILLA_PRODUCTO` + `escalasBulto`, form desde existente con `escalasATexto`, celda -> `parsearEscalasTexto` con `textoSeguro` (anti formula injection). `src/domain/importacion.js` solo si arma el form por su cuenta (verificar con Grep). AC-ESC-1.
10. `src/components/ProductoForm.js` — render del tipo `escalas`: 3 filas (N, %), deshabilitadas con ayuda si `Bulto x <= 1`, error/aviso en el campo. AC-ESC-1.
11. `src/pages/NuevoPedido.js` — mostrar `etiquetaEscala(item)` en el renglon (junto a `progresoGrupo`); el resto ya pasa por `renglonNuevo`/`precioAplicadoRenglon`/`preciosPorGrupoBulto`. Edicion REQ-EDP usa la misma pantalla. AC-ESC-3.
12. `src/pages/Armado.js` y `src/pages/Facturacion.js` — mostrar `etiquetaEscala`; `reprecio` ya delega. Facturacion: `completarPreciosBulto` congela escalas (renglones re-agregados). AC-ESC-3.
13. `src/domain/tienda.js` — pasar `escalasBulto: prod.escalasBulto` en las 2 llamadas a `precioAplicado` (lineas ~151 y ~201); nuevo `textoEscalasTienda(prod)` ("Llevando 5 displays: 8 % menos"). `src/tienda/DetalleProducto.js` / `TarjetaProducto.js` lo muestran. AC-ESC-3.
14. `supabase/migrations/026_escalas_bulto.sql` (nuevo) — seccion 4. AC-ESC-1/3.
15. `supabase/verificacion/026_escalas_casos.sql` (nuevo) — los casos del fixture como `values (...)` + `select` que devuelve SOLO las filas que no coinciden (se corre a mano tras la 026; 0 filas = OK).
16. Tests (seccion 7).

## 4. Migracion 026 (idempotente, tolerante, `begin; ... commit;`)

- Guardas `do $$ ... $$`: exige `admin_guardar_productos(text,text,jsonb)` y la columna `grupo_bulto` (022) y `tienda_cantidad_valida` (024); si faltan, `raise exception` con el nombre de la migracion faltante.
- `alter table public.productos add column if not exists escalas_bulto jsonb;`
- Constraint `productos_escalas_bulto_chk` (creada solo si no existe, por `pg_constraint`): `check (case when escalas_bulto is null then true when jsonb_typeof(escalas_bulto)='array' then jsonb_array_length(escalas_bulto) <= 3 else false end)` (CASE para no depender del orden de evaluacion del AND).
- `grant select (escalas_bulto) on public.productos to anon, authenticated;` (regla 8).
- Helpers `language sql immutable set search_path = public, pg_temp`, con `revoke all ... from public, anon, authenticated` (los usan las RPC definer, como los de la 010):
  - `escalas_bulto_normalizar(p jsonb) returns jsonb` — misma regla que `normalizarEscalasBulto` (orden recibido, `with ordinality`, primeros 10, `desde` entero 2..9999 por regex `^[0-9]{1,4}$`, `pct` numeric 0<pct<100 y `pct = round(pct,2)`, `desde` estrictamente creciente sobre los conservados, max 3). Implementar como plpgsql con loop (mas legible que una CTE recursiva).
  - `tienda_escala_pct(p_escalas jsonb, p_bulto_x integer, p_unidades numeric) returns numeric` (0 si no aplica).
  - `tienda_precio_con_escala(p_precio numeric, p_escalas jsonb, p_bulto_x integer, p_unidades numeric) returns numeric` — `ceil(round(p_precio,2)*100*(10000-bp)/1000000)`; si no es menor que la base, devuelve `round(p_precio,2)`.
- `admin_guardar_productos`: COPIA FIEL de la 022 (ultima version) + `v_escalas jsonb`: si `v_fila ? 'escalas_bulto'` y el tipo no es array/null o tiene >3 elementos => `datos_invalidos`; se guarda `nullif(escalas_bulto_normalizar(...), '[]')`; en `on conflict` `escalas_bulto = case when v_fila ? 'escalas_bulto' then excluded.escalas_bulto else public.productos.escalas_bulto end` (app vieja no borra). Solo en la rama `v_extras`. Se conservan verificar_pin, topes, NaN/Infinity, costos que no viajan, revoke/grant.
- `tienda_catalogo`: COPIA FIEL de la 010 (ultima version) + clave `'escalasBulto'` = `case when coalesce(p.bulto_x,0) > 1 then escalas_bulto_normalizar(p.escalas_bulto) else '[]'::jsonb end`. Mantener `statement_timeout`, filtros, `search_path = public, extensions, pg_temp`. Revisar si la 010 tenia revoke/grant explicitos de `tienda_catalogo()` y repetirlos igual.
- `tienda_crear_pedido`: COPIA FIEL de la 024 (ultima version). Unico cambio marcado `-- REQ-ESC`: el select de `p3` suma `p3.escalas_bulto`; `v_base := tienda_precio_aplicado(...)` (lo de hoy) y `v_precio := tienda_precio_con_escala(v_base, v_prod.escalas_bulto, v_prod.bulto_x, v_u)`; `precioPorBulto := (v_base < v_unit)` (no se ensucia con la escala); el item suma `escalasBulto` (normalizado), `precioBultoX`, `precioBultoOriginal` y, si aplico, `escalaDesde`/`escalaPct`. Se mantienen idempotencia, honeypot, limites, advisory lock, REQ-DIR, REQ-MUL, carrito corregido, revoke/grant.
- Todos los `$$` pareados (`as $$ ... end $$;` / `$$;` en las sql). Sin `drop`, sin `delete`, sin revocar grants existentes.

## 5. Concurrencia offline / multidispositivo

- Producto editado offline con escalas: viaja por `admin_guardar_productos` con el patron `pendingSync` actual (limpia solo ids aceptados). Dispositivo/app vieja sin la clave => el servidor conserva las escalas (mismo cuidado que 022).
- Servidor sin la 026: la RPC 022 ignora la clave (jsonb extra) y el pull descarta la columna por el fallback de columnas => la escala queda solo local hasta aplicar la 026. Aviso en pasos manuales. No rompe sync.
- Pedidos: la escala se congela en el renglon (UUID/`clientUuid` y upsert idempotente de AC-SEG2-3 no cambian). Dos dispositivos con escalas distintas cargadas en momentos distintos: cada pedido queda con las que vio; no hay recalculo retroactivo.
- Vendedor editando (REQ-EDP): `escalaPct` siempre recalculado de lo congelado, nunca del item recibido.
- Tienda: el servidor recalcula; si el catalogo cacheado del cliente no tiene escalas y el servidor si, devuelve "cambio" con el carrito corregido (no se crea con precio distinto).
- Stock: no se toca; ninguna escritura de numero de stock.

## 6. Mismo centavo cliente/servidor

- Una sola regla escrita dos veces (JS `precioConEscala` y SQL `tienda_precio_con_escala` + `escalas_bulto_normalizar`), ambas en aritmetica exacta (BigInt / numeric) y con pct limitado a 2 decimales (sin redondeos dependientes de float).
- Fixture `escalasCasos.js` (>= 15 casos): sin escalas; borde exacto (4 bultos no, 5 si); escala mas alta alcanzada; redondeo para arriba (815 x 0.92 = 749,8 -> 750; 800 x 0.92 = 736 exacto); base con centavos (799,50); sin `precioBulto` (sobre precio por unidad); `precioBulto` > precio; oferta vigente < bulto; escalas desordenadas, duplicadas, N=1, D=0/100, D con 3 decimales, texto, null, 4 escalas; `bultoX` 0/1/vacio; cantidades decimales; resultado que no baja (precio $5, 8 % -> 5: sin escala).
- `precios.escalas.test.js` corre el fixture en JS; `migracion026.sql.test.js` verifica que `supabase/verificacion/026_escalas_casos.sql` contiene EXACTAMENTE los mismos casos (parsea el `values`) y que la 026 usa `ceil(` y `round(...,2)`; el SQL de verificacion lo corre el dueño en Supabase (paso manual).

## 7. Plan de pruebas

| AC | Test | Tipo |
|---|---|---|
| AC-ESC-4 | `src/domain/__tests__/precios.escalas.test.js`: normalizar, escalaAlcanzada, aplicarDescuentoEscala, precioConEscala (fixture), precioAplicado con/sin escala, precioAplicadoRenglon (subir/bajar de escala, manual respetado), esPrecioManual, precioBaseRenglon/totalesBoleta | unidad dominio |
| AC-ESC-1 | `productos.escalas.test.js`: validarEscalasBulto (errores/avisos), to/fromRemote (clave ausente no viaja, null -> []), `COLUMNAS_PRODUCTO_PUBLICAS` contiene `escalas_bulto` | unidad dominio |
| AC-ESC-1 | `plantillas.escalas.test.js`: columna en plantilla e instrucciones, alias, parseo `5=8; 10=7,5`, vacio conserva, `-` borra, invalida rechaza la fila con motivo, round-trip, formula injection | unidad dominio |
| AC-ESC-1 | `ProductoForm.escalas.test.js`: 3 filas, error en el campo, deshabilitado con bulto<=1 | UI Testing Library |
| AC-ESC-2 | `grupoBulto.escalas.test.js`: grupo Prime 3 productos suma bultos para la escala; baja del umbral vuelve; manual respetado; `edicionPedido` recalcula escala y piso | unidad dominio |
| AC-ESC-2 | `bultos.escalas.test.js`: `renglonNuevo` congela; cambio posterior de escalas del producto no altera el renglon; `completarPreciosBulto` | unidad dominio |
| AC-ESC-3 | `escalas.pantallas.test.js`: NuevoPedido/Armado/Facturacion muestran "x5 bultos −8 %" y re-precian al cambiar cantidad | UI Testing Library |
| AC-ESC-3 | `boleta.escalas.test.js`: `filasBoleta`/`lineaGrupoBulto` con sufijo ASCII, totales = pantalla | unidad dominio (PDF) |
| AC-ESC-3 | `tienda.escalas.test.js`: carrito/`precioUnitarioTienda` con escalas iguales al fixture | unidad dominio |
| AC-ESC-1/3 | `migracion026.sql.test.js`: columna + check + grant por columna; `admin_guardar_productos` conserva con `?`; las 3 RPC conservan todas las validaciones de la version previa (lista de fragmentos de 022/010/024 que deben seguir presentes), grants, `search_path` fijo, `$$` pareados, helpers revocados a anon; sin `drop`/`delete` | estatico SQL |
| Regresion | suite completa + `security.migracion`, `migraciones.plpgsql` (corren solos sobre la 026) | existentes |

Tests existentes que cambian (solo agregar la etiqueta/columna nueva al final, ningun borrado):
- `src/domain/__tests__/productos_proveedores.test.js:48` (labels de `CAMPOS_PRODUCTO` + "Escalas por bulto").
- `src/domain/__tests__/plantillas.test.js:43` (encabezados de plantilla).
- `src/components/__tests__/ProductoForm.test.js:54` (labels del form).
- `src/domain/__tests__/qa.plantillas.bordes.test.js:89-91` (solo si exigen el set completo de encabezados).
- `src/pages/__tests__/ConfiguracionAltas.test.js` (si cuenta inputs del form).
- Revisar sin cambiar: `precios.test.js`, `tienda.carrito.test.js`, `qa.tienda.bordes.test.js` (`toEqual({precio,...})` siguen verdes porque `escala` solo aparece si aplica), `syncCostosPrivados.test.js` (usa la lista dinamica).

## 8. Decisiones de seguridad (autorizado)

- Columna publica (no es costo) con grant por columna; los "Descuento 1/2" del producto (costo de proveedor) no se tocan ni se exponen.
- Escritura solo por `admin_guardar_productos` (PIN admin); normalizacion tambien en el servidor; check de forma y tope de 3 en la tabla.
- Helpers sin `grant execute` a anon (solo los usan las RPC definer). `search_path` fijo en todo.
- El servidor nunca confia en precio/escala del navegador ni del vendedor.

## 9. Supuestos (opcion conservadora)

- S1 Redondeo al **peso entero para arriba** (no hay "A confirmar" con otro multiplo en el SPEC). Si el dueño quiere $10, es una constante en ambos lados + nuevo caso de fixture.
- S2 La escala se aplica sobre el precio vigente ya resuelto (menor entre oferta y precio de bulto en la tienda); en la app interna sobre el de PBU.
- S3 Solo cuentan bultos completos (`floor(unidades/bultoX)`); la escala requiere `bultoX > 1`.
- S4 Si el redondeo deja el precio igual a la base, no hay escala ni etiqueta.
- S5 "Escala mas alta alcanzada" = mayor N alcanzado, aunque su D sea menor (el form avisa si D no crece).
- S6 Grupo REQ-GBU: cada renglon usa SUS escalas congeladas con el total de bultos del grupo. La tienda no combina grupos (hoy tampoco).
- S7 La escala no cuenta como "descuento" en "Total sin descuento" (igual que el precio de bulto, REQ-FRB S3); se ve en el renglon.
- S8 Etiqueta fija "bultos" (no usa `bultoNombre`) en la app interna; la tienda usa `bultoNombre`.
- S9 Cambios de escalas no entran al historial de precios REQ-HPR (fuera de alcance).

## 10. Pasos manuales

Backup; aplicar `026_escalas_bulto.sql` en el SQL Editor (despues de la 025); correr `supabase/verificacion/026_escalas_casos.sql` y verificar 0 filas.
