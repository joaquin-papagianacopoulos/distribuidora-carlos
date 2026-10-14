# Plan — RUN 20261014-1621 — REQ-VTA (unidad de venta y marca)

Alcance: solo REQ-VTA (AC-VTA-1..5). Reutiliza la normalizacion de REQ-COMR (AC-COMR-4, `src/domain/rubros.js`).

## 1. Hallazgos del codigo actual (condicionan el diseño)
- `marca` YA existe: local (`producto.marca`) y remoto (columna `productos.marca` del esquema base, sin migracion), y viaja en el upsert **basico** de `syncProductos` (syncService.js ~L219) y en el pull (~L853). Hoy se llena sola con `detectarMarca(nombre)` (Configuracion.js L56/59/213/216, `backfillMarcas`). No hay forma de cargarla a mano.
- `bultoX` ya existe (001, `bulto_x integer default 1`). `normalizarBultoX` (bultos.js) ya define "con bulto" = entero > 1.
- Renglones de pedido: `pedidos.items` es JSON (pedidoRepository.js L24) => `bultos`/`bultoX`/`bultoNombre` del renglon NO requieren columna nueva.
- Facturacion es solo admin (Facturacion.js L263): el vendedor nunca llega ahi. "Vendedor no puede guardar" se cumple en Nuevo pedido (y Armado).
- `upsertTolerante` cae directo del upsert completo al basico: si falta solo la 006 se perderian tambien las columnas de la 001. Hay que escalonarlo.
- IndexedDB guarda productos como objetos libres (store `productos`, keyPath `id`): los campos nuevos no necesitan store ni indice.

## 2. Modelo de datos

### IndexedDB
- **Sin cambio de `DB_VERSION` (queda 7).** Campos nuevos opcionales dentro del objeto producto y del renglon. Productos/pedidos viejos se leen con defaults derivados (no se reescriben).

### Supabase — `supabase/migrations/006_unidad_venta.sql` (REQ-VTA, AC-VTA-5)
- `alter table public.productos add column if not exists marca text;` (defensivo; ya existe en prod).
- `add column if not exists venta_por text` — **nullable, sin default** (null = "derivar de bulto_x"; un default 'unidad' pisaria el 'ambos' derivado de productos viejos).
- `add column if not exists bulto_nombre text` — nullable (null = 'Bulto').
- `add column if not exists visible_tienda boolean not null default true`.
- Constraints en bloque `do $$ ... if not exists ... $$` (idempotente):
  - `venta_por is null or venta_por in ('unidad','bulto','ambos')`
  - `bulto_nombre is null or bulto_nombre in ('Bulto','Display','Caja','Pack')`
  - `venta_por is distinct from 'bulto' or coalesce(bulto_x,1) > 1`
  - `marca is null or char_length(marca) <= 60`
- Sin grants/policies nuevas (las de productos ya existentes aplican). Comentario de cabecera: "la app tolera que no se haya corrido". Revisa el auditor (punto 7 del SPEC).

### Mapeo UI -> interno -> remoto
| Etiqueta UI | Interno (producto) | Columna | Default si falta |
|---|---|---|---|
| Marca | `marca` | `marca` (existente) | '' (fallback `detectarMarca`) |
| Se vende por | `ventaPor` | `venta_por` | derivado: `ambos` si bultoX>1, si no `unidad` |
| Etiqueta del bulto | `bultoNombre` | `bulto_nombre` | `Bulto` |
| Mostrar en tienda | `visibleTienda` | `visible_tienda` | `true` |
| (renglon) | `item.bultos`, `item.bultoX`, `item.bultoNombre` | dentro de `pedidos.items` (JSON) | ausentes = pedido viejo |

`item.cantidad` sigue siendo SIEMPRE unidades (AC-VTA-2). Stock (ledger), armado, facturacion, PDF y comisiones no cambian su calculo.

## 3. Funciones puras de dominio

### `src/domain/unidadVenta.js` (nuevo) — AC-VTA-2/3/4
- `VENTA_POR = ['unidad','bulto','ambos']`, `BULTO_NOMBRES = ['Bulto','Display','Caja','Pack']`.
- `ventaPorPorDefecto(bultoX) -> 'ambos'|'unidad'` — usa `normalizarBultoX` (vacio/0/1/decimal/texto => 'unidad').
- `ventaPorEfectivo(producto) -> VentaPor` — valor guardado si es valido Y consistente; `bulto` con bultoX<=1 (dato inconsistente de otro dispositivo) degrada a `unidad`; ausente => default.
- `normalizarBultoNombre(v) -> string` — match sin mayusculas/tildes contra la lista; otro => 'Bulto'.
- `parsearBooleano(v) -> true|false|null` — Si/Sí/si/true/1/x => true; No/false/0 => false; vacio/otro => null.
- `validarUnidadVenta({ ventaPor, bultoX, bultoNombre, visibleTienda }) -> { ok, errores: {ventaPor?, bultoNombre?}, valor }` — `bulto` con bultoX<=1 => `errores.ventaPor = 'Para vender por bulto, "Bulto x" tiene que ser mayor que 1'`.
- `unidadesDeBultos(bultos, bultoX) -> int|null` — 1,16 => 16; 3,16 => 48; invalido o > MAX_CANTIDAD => null.
- `bultosDeUnidades(unidades, bultoX) -> { bultos, sueltas }|null`.
- `precioBulto(precioUnit, bultoX) -> number|null` — aritmetica en centavos (Math.round(p*100) * bx / 100); 900,16 => 14400; centavos con redondeo; sin bulto => null.
- `importeBultos(bultos, bultoX, precioUnit) -> { unidades, importe }|null` — Dos Corazones: 1 => {16, 14400}; 3 => {48, 43200}.
- `esMultiploDeBulto(cantidad, bultoX) -> boolean`.
- `cantidadInicialRenglon(producto) -> int` — `bulto` => bultoX; resto => 1 (legacy intacto).
- `pasoCantidad(producto) -> int` — `bulto` => bultoX; resto => 1 (botones +/−).
- `avisoMultiplo(cantidad, producto) -> string|null` — "Se vende por Display de 16: 20 u. no es multiplo".
- `puedeGuardarNoMultiplo(permiso, pantalla) -> boolean` — solo `permiso===1 && pantalla==='facturacion'`.
- `validarMultiplosItems(items, productosById, { permiso, pantalla, previos }) -> { ok, avisos: [{productoId,nombre,cantidad,bultoX}], bloquea: boolean }` — renglones sin cambio respecto de `previos` (mismo patron que `validarCantidadesItems`) se saltean: pedidos viejos no se bloquean.
- `congelarBultosRenglon(item, producto, previo?) -> item` — si la cantidad no cambio respecto del previo, conserva lo congelado; si cambio y `ventaPorEfectivo !== 'unidad'` y es multiplo exacto (>=1 bulto) del bultoX actual => setea `bultos`, `bultoX`, `bultoNombre`; si no, los quita. Nunca toca `cantidad`.
- `congelarBultosItems(items, productosById, { previos }) -> items`.
- `textoRenglonBultos(item) -> string|null` — solo con campos congelados: "3 Display (48 u.)", "1 Display (16 u.)"; sin congelado => null (se muestra como hoy).

### `src/domain/marcas.js` (nuevo) — AC-VTA-1, punto 2 de tests
- `normalizarMarca = normalizarRubro`, `claveMarca = claveRubro` (re-export; misma regla AC-COMR-4).
- `listarMarcas(productos, extras) -> string[]` — via `listarRubros(productos, extras, { campo: 'marca' })`.
- `resolverMarca(valor, existentes) -> { marca, clave, esNuevo }` — wrapper de `resolverRubro`.
- `marcaParaGuardar({ marcaForm, marcaExistente, nombre, marcas, detectar }) -> string` — prioridad: tipeada > existente > `detectar(nombre)`; siempre pasada por `resolverMarca` (dedupe).

### Cambios en dominio existente (aditivos)
- `rubros.js`: `listarRubros(productos, extras = [], { campo = 'categoria' } = {})` — 3er parametro opcional, retrocompatible.
- `productos.js`: `CAMPOS_PRODUCTO` suma `marca` (tipo `marca`, tras Rubro), `ventaPor` (opciones), `bultoNombre` (opciones) tras "Bulto x", `visibleTienda` (tipo `booleano`) antes de Stock. `validarProducto(form, { ..., marcas = null })` normaliza marca y llama a `validarUnidadVenta` (error en `errores.ventaPor`). Nuevo `productoVentaToRemote(p)`; `productoExtraFromRemote` suma `ventaPor/bultoNombre/visibleTienda` con `pick` (columna ausente => local => default).
- `plantillas.js`: `INFO_PRODUCTO` suma las 4 columnas; `SOLO_PLANTILLA_PRODUCTO` las incluye; alias `marca`, `sevendepor`/`ventapor`, `etiquetadelbulto`/`tipobulto`, `mostrarentienda`/`tienda`/`visible`; `validarFilaProducto` toma `marcas` y aplica: columna ausente/vacia => conserva `existente` o default (Excel viejo importa igual); `visibleTienda` via `parsearBooleano` (invalido => error de fila). Verificar que los parciales (`unidad`, `categ`) no capturen los encabezados nuevos.
- `bultos.js`: `renglonNuevo(producto, extra)` usa `cantidadInicialRenglon` (solo cambia para `ventaPor:'bulto'`; AC-BUL-9 intacto en legacy).

## 4. Archivos a crear/modificar (en orden)
1. `src/domain/unidadVenta.js` (nuevo) — AC-VTA-2/3/4.
2. `src/domain/marcas.js` (nuevo) + `src/domain/rubros.js` (param `campo`) — AC-VTA-1.
3. `src/domain/productos.js` — AC-VTA-1, AC-VTA-5 (to/fromRemote).
4. `src/domain/bultos.js` (`renglonNuevo`) — AC-VTA-3.
5. `src/domain/plantillas.js` — AC-VTA-1 (plantilla Excel).
6. `src/components/SelectorRubro.js` — props opcionales `name`, `etiqueta` ("rubro"/"marca"), `testId` con defaults actuales (tests de COMR siguen verdes). `src/components/SelectorMarca.js` (nuevo, wrapper) — AC-VTA-1.
7. `src/components/ProductoForm.js` — estado inicial de los 4 campos (ventaPor inicial = `ventaPorEfectivo(inicial)`), prop `marcas`, `renderCampo` para marca y checkbox `visibleTienda`, error de `ventaPor` en el campo; al cambiar bultoX a <=1 con `bulto`, el error aparece al guardar — AC-VTA-1.
8. `src/pages/Configuracion.js` — pasar `marcas={listarMarcas(productos)}`; reemplazar `editItem.marca || detectarMarca(...)` por `marcaParaGuardar` (form y plantilla, L56/59/213/216); `extrasDirty: true` ya cubre los campos nuevos — AC-VTA-1.
9. `src/components/BultoControl.js` — mostrar `bultoNombre` ("+ Display (x 16)") y precio del bulto si `ventaPor !== 'unidad'` — AC-VTA-3. `etiquetaBotonBulto(bultoX, nombre='Bulto')` parametro opcional en bultos.js.
10. `src/pages/NuevoPedido.js` — `agregarProducto`/`cambiarCantidad` con `pasoCantidad`; aviso por renglon (`avisoMultiplo`); en `guardar`: `validarMultiplosItems(..., {permiso, pantalla:'pedido'})` bloquea + `congelarBultosItems` antes de `quitarMarcasRenglones`; renglon muestra `textoRenglonBultos` — AC-VTA-2/3.
11. `src/pages/Facturacion.js` — idem con `pantalla:'facturacion'`, `previos: pedidoEditando.items`; admin: aviso + `window.confirm` para guardar igual — AC-VTA-2/3.
12. `src/pages/Armado.js` — aviso + bloqueo (pantalla 'armado'), `previos: armando.items`, congelar en `guardarArmado` despues de fusionar — AC-VTA-2/3.
13. `src/sync/syncService.js` — upsert escalonado de productos + `same` del pull — AC-VTA-5 (ver 5).
14. `supabase/migrations/006_unidad_venta.sql` (nuevo) — AC-VTA-5.
15. Tests (seccion 7) y `harness/SPEC.md` sin cambios.

## 5. Sync tolerante (AC-VTA-5)
- Nuevo helper en `syncService.js`: `upsertEscalonado(table, variantes) -> { error, nivel }` — prueba `[completo(001+006), solo001, basico]` en orden; baja de nivel solo si `esColumnaInexistente(error)`; avisa una vez por nivel ("Correr 006_unidad_venta.sql"). `upsertTolerante` queda igual (lo usan clientes).
- Productos con extras: nivel 0 => `extrasPendientes:false`; nivel >=1 => `extrasPendientes:true` (se reintenta en la proxima pasada; el pull no pisa extras locales mientras este en true, comportamiento actual).
- `marca` sigue en el upsert basico (columna ya existe). Pull: `same` suma `marca` y compara los campos nuevos con defaults aplicados en ambos lados (evita que `undefined` vs `true` marque diferencia eterna).
- Pull desde un Supabase sin 006: `r.venta_por === undefined` => conserva local / default (via `pick`).

## 6. Concurrencia offline / multidispositivo
- Stock: sin cambios; sigue siendo ledger en unidades (`item.cantidad`). Nada de esto escribe un numero de stock. Vender por bulto genera el mismo movimiento que hoy (unidades).
- Renglon congelado: `bultoX` del renglon es snapshot; si otro dispositivo cambia el `bultoX` del producto, los pedidos guardados no cambian (igual que `rubro` en AC-COMR-5). Botones de bulto siguen usando bultoX ACTUAL (AC-BUL-4); al guardar, `congelarBultosRenglon` recalcula solo si cambio la cantidad.
- Producto editado en dos dispositivos: last-write-wins por producto (patron actual, `pendingSync` + `extrasDirty`, limpiando solo ids subidos). Riesgo: A pone `ventaPor:bulto` y B baja `bultoX` a 1 => remoto queda inconsistente si la 006 no esta (con 006 el CHECK rechaza; el upsert falla y queda pendiente). Mitigacion: `ventaPorEfectivo` degrada a `unidad` al leer; el form muestra el error al editar.
- CHECK de 006 rechaza una fila => el batch entero falla. Mitigacion: `validarProducto` aplica la misma regla antes de guardar; dejar anotado en reporte que una fila invalida remota bloquea la tanda (patron existente, no nuevo).
- Renglones nuevos: sin IDs nuevos (viven en `items` JSON del pedido con su UUID). No hay tablas nuevas => no aplica `crypto.randomUUID()`.
- Pedidos viejos/legacy: exentos de multiplos si la cantidad no cambio (`previos`), sin campos congelados => se muestran como hoy.

## 7. Plan de pruebas (cada `it(...)` nombra su AC)
| AC | Archivo de test | Tipo | Casos clave |
|---|---|---|---|
| AC-VTA-4 | `src/domain/__tests__/unidadVenta.test.js` (nuevo) | unit | Dos Corazones 1=>16u/$14.400, 3=>48u/$43.200; `ambos`; multiplos; centavos y redondeo (ej. 12.345 x 7); totales grandes y tope MAX_CANTIDAD; NaN/negativo/texto/null; bultoX ''/0/1/2.5/'abc'; defaults de ventaPor; `ventaPorEfectivo` con dato inconsistente |
| AC-VTA-1 | `src/domain/__tests__/marcas.test.js` (nuevo) | unit | normalizacion/dedupe (mayusculas, espacios, tildes, NFC combinante); `marcaParaGuardar` prioridades |
| AC-VTA-1 | `src/domain/__tests__/productos.unidadVenta.test.js` (nuevo) | unit | `validarProducto` con `bulto` y bultoX<=1 => `errores.ventaPor`; defaults; to/fromRemote |
| AC-VTA-1 | `src/components/__tests__/ProductoForm.test.js` (extender) | RTL | 4 campos visibles; "Agregar marca nueva…" con dedupe; error en el campo Se vende por; checkbox tienda |
| AC-VTA-1 | `src/components/__tests__/SelectorRubro.test.js` (extender) | RTL | props nuevas no rompen rubro; variante marca |
| AC-VTA-1 | `src/services/__tests__/plantillaExcel.test.js` + `src/domain/__tests__/plantillas.test.js` (extender) | unit | columnas nuevas en plantilla e instrucciones; Excel viejo sin columnas => defaults; Si/No; `bulto` con bulto x 1 => fila rechazada |
| AC-VTA-2 | `unidadVenta.test.js` | unit | `congelarBultosRenglon` no toca `cantidad`; conserva congelado si no cambio; `textoRenglonBultos` "3 Display (48 u.)" |
| AC-VTA-2/3 | `src/pages/__tests__/NuevoPedido.ventaPor.test.js` (nuevo) | RTL | alta arranca en 16; +/− de a bulto; tipear 20 => aviso y vendedor no guarda; guarda `cantidad:48, bultos:3`; renglon "3 Display (48 u.)" |
| AC-VTA-3 | `src/pages/__tests__/Facturacion.ventaPor.test.js` (nuevo) | RTL | aviso de no multiplo; admin confirma y guarda; pedido viejo no multiplo editado en otro campo no bloquea |
| AC-VTA-3 | `src/pages/__tests__/Armado.ventaPor.test.js` (nuevo) | RTL | aviso + bloqueo de no multiplo; tachar el renglon sigue funcionando |
| AC-VTA-5 | `src/services/__tests__/syncTolerante.test.js` (extender) | unit/mocks | sin 006 => baja a nivel 001 y sube bulto_x igual; sin 001 => basico; `extrasPendientes`; pull sin columnas => defaults |
| AC-VTA-5 | `src/domain/__tests__/migracion006.sql.test.js` (nuevo) | estatico | SQL: `if not exists`, CHECKs, sin `drop`/`delete`, sin grants nuevos |
| Regresion | suites existentes de bultos/comisiones/stock/PDF + 1 test "producto viejo sin campos" en Nuevo pedido | todas | ningun test existente se borra ni saltea |

No hace falta test de upgrade IndexedDB (no cambia `DB_VERSION`); `migracionV7.test.js` debe seguir verde.

## 8. Supuestos (opcion conservadora)
- S1: `ventaPor` de productos viejos no se persiste al leer; se deriva. Se persiste recien al guardar el form o importar.
- S2: Armado bloquea cantidades no multiplo para todos (armador y admin); solo Facturacion permite guardarlas (admin, con confirmacion). Tachar el renglon sigue disponible.
- S3: en `ambos` no se exige multiplo; se congelan `bultos` solo si la cantidad es multiplo exacto.
- S4: se congela tambien `bultoNombre` en el renglon (aditivo) para poder mostrar "Display" aunque cambie el producto.
- S5: `visibleTienda` no afecta la app interna (solo se guarda/sincroniza para REQ-TIE).
- S6: `marca` manual tiene prioridad sobre `detectarMarca`; `backfillMarcas` solo completa vacias (sin cambio).
- S7: el precio del pedido sigue siendo unitario (`item.precio`); el descuento % del renglon aplica igual.

## 9. A confirmar con el dueño (no bloquea)
- AC-VTA-3: ¿el vendedor puede cargar unidades sueltas de un producto "solo por display" en la app interna? Por ahora: no; solo el admin en Facturacion.
- Armado: si al armar faltan unidades de un display (ej. hay 10 de 16), ¿se tacha el display entero o el admin lo ajusta en Facturacion? (por ahora S2).

## 10. Pasos manuales
- Correr `supabase/migrations/006_unidad_venta.sql` en el SQL editor (la app funciona sin ella, con extras pendientes).
