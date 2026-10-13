# Implementación — RUN 20261007-2004 — REQ-BUL

## Archivos
Nuevos:
- `src/domain/bultos.js`: `normalizarBultoX`, `tieneBulto`, `normalizarCantidad`, `sumarBulto`, `restarBulto`, `desgloseBultos`, `etiquetaBotonBulto`, `puedeUsarBulto`, `CANTIDAD_MINIMA_RENGLON`
- `src/domain/armado.js`: `cambiosDeCantidad`, `fusionarCambiosArmado`
- `src/components/BultoControl.js`: componente presentacional (botones + desglose)
- Tests: `src/domain/__tests__/bultos.test.js`, `src/domain/__tests__/armado.test.js`, `src/components/__tests__/BultoControl.test.js`, `src/pages/__tests__/bultos.pedido.test.js`, `src/pages/__tests__/bultos.facturacion.test.js`, `src/pages/__tests__/bultos.armado.test.js`

Modificados:
- `src/pages/NuevoPedido.js`: `ItemRow` recibe `producto`/`puedeBulto`/`onBulto`; handler `aplicarBulto` con updater funcional
- `src/pages/Facturacion.js`: `FacturacionItemRow` muestra `BultoControl`; `aplicarBulto` actualiza `itemsEdit` **y** `draftByPid` + `draftRef.current` (trampa del borrador); `ArmadoResumen` muestra `armadoLog.cambios` (tolera ausencia o dato no-array)
- `src/pages/Armado.js`: `ItemArmadoCard` con `BultoControl` (no en tachados); `aplicarBultoArmado` por `_key`; `guardarArmado` agrega `armadoLog.cambios` (fusionado con sesiones anteriores). CRLF preservado
- `src/services/__tests__/stockService.test.js`: 2 casos AC-BUL-7 agregados (sin tocar `stockService.js`)

Sin cambios: `DB_VERSION`, `src/db`, `src/sync`, `stockService.js`, migraciones SQL (no hace falta: `bulto_x` y `armado_log` ya existen).

## AC cubiertos
AC-BUL-1..8, todos con tests que llevan el ID en el título. La regresión de Facturación (borrador de texto pisando la cantidad) se verificó por mutación: sacando la actualización de `draftRef`/`draftByPid` fallan 2 tests.

## Resultados
- `CI=true npx react-scripts test --watchAll=false`: 26 suites OK, 426 passed, 1 skipped (427)
- `npx react-scripts build`: Compiled successfully (main +1.66 kB gzip)
- `node harness/gates/run-gates.mjs --fast`: unit-tests, coverage-domain, secret-scan y security-rules PASS; **traceability FAIL** solo por AC-COM-1..16 (REQ-COM, fuera del alcance de este run). Ningún AC-BUL queda sin test.

## Notas
- Piso del "− Bulto" en pantallas = 1 (supuesto 1 del plan); el dominio admite `minimo` 0.
- Preexistente, no tocado: textos con tildes rotas en `Facturacion.js` ("FacturaciÃ³n", "No tenÃ©s", "invÃ¡lido") y en `NuevoPedido.js` ("invÃ¡lido"); hooks (`useEffect`) después del `return` temprano de no-admin en `Facturacion.js`.

---

# Iteración 2 — correcciones de seguridad (security-report.md)

## Hallazgos corregidos
- **S-BUL-02** `src/domain/bultos.js`: `sumarBulto`/`restarBulto` devuelven la cantidad sin cambios si no es entera (dato legacy), así no se generan decimales hacia `movimientos_stock.cantidad` (integer).
- **S-BUL-03** `src/domain/armado.js`: `fusionarCambiosArmado(previos, nuevos, { productosVigentes })` poda los cambios de productos que ya no están en el pedido. `src/pages/Armado.js` (`guardarArmado`) pasa los ids de `itemsFinal`. En `Facturacion.js` (`guardarEdicion`) tampoco se re-suben cambios de productos que ya no están.
- **S-BUL-05** `src/domain/armado.js`: topes `MAX_CAMBIOS_ARMADO = 500` (lee como mucho 500 previos y devuelve como mucho 500), `MAX_NOMBRE_CAMBIO = 120` (recorta `nombre`), `MAX_PRODUCTO_ID_CAMBIO = 64` (descarta ids más largos o vacíos). Nueva `acotarCambiosArmado(cambios, opciones)` usada por `ArmadoResumen` (lectura) y por `guardarEdicion` (no re-sube JSON inflado) en `Facturacion.js`.
- **S-BUL-07** `src/pages/Facturacion.js`: `aplicarBulto` calcula afuera del updater usando `itemsEditRef` (espejo de `itemsEdit`, actualizado en `useEffect` y en el momento del toque); los updaters de `setItemsEdit`/`setDraftByPid` quedan puros. La regresión del borrador de texto sigue verde.
- **No tocado:** S-BUL-04 (decisión del dueño), S-BUL-06/08, `security-report.md`.

## Tests
- `src/domain/__tests__/security.bultos.test.js`: los 2 `test.todo` (S-BUL-02, S-BUL-03) pasaron a tests reales; agregado bloque S-BUL-05 (3 tests).
- `src/pages/__tests__/bultos.armado.test.js`: S-BUL-03 en pantalla (sacar del todo un producto con cambio previo). Verificado por mutación: sin `productosVigentes` en `Armado.js` el test falla.
- `src/pages/__tests__/bultos.facturacion.test.js`: S-BUL-05 (resumen acotado a 500 entradas y nombre <= 120), S-BUL-03/05 al guardar la edición, S-BUL-07 (dos toques en el mismo act acumulan 29 y luego − bulto guarda 17).

## Resultados (iteración 2)
- `CI=true npx react-scripts test --watchAll=false`: 27 suites OK, 478 passed, 1 skipped (479), 0 todo.
- `npx react-scripts build`: Compiled successfully (main +269 B gzip).
- `node harness/gates/run-gates.mjs --fast`: unit-tests, coverage-domain, secret-scan, security-rules PASS; **traceability FAIL** solo por AC-COM-1..16 (REQ-COM, fuera del alcance de este run; igual que iteración 1).
- Sin cambios de schema: no hay `DB_VERSION` nuevo ni migración SQL (el CHECK de `armado_log` del reporte queda para el dueño).

# AC-BUL-9 (2026-10-08)

Decisión del dueño: si el renglón todavía tiene la unidad que se pone sola al agregar el producto, el primer "+ Bulto" la **reemplaza** (x12 => 12, no 13); los siguientes suman. Si la cantidad se escribió/cambió a mano (aunque sea a 1), suma como AC-BUL-2.

## Diseño
- Marca transitoria en el renglón: `_cantidadPorDefecto: true` (`MARCA_CANTIDAD_POR_DEFECTO`). Se pone al agregar un producto nuevo y se quita al: escribir la cantidad, usar "+"/"−", "+ Bulto"/"− Bulto" (cuando cambian la cantidad), volver a tocar el mismo producto en el buscador (+1) y, en Armado, al fusionar con un tachado restaurado.
- La marca **no se persiste ni se sincroniza**: se quita antes de llamar a `crearPedidoOnlineFirst`/`guardarPedidoOnlineFirst` (mismo criterio que `_key`/`picked`/`eliminado` en Armado). Sí queda en el borrador de `localStorage` de Nuevo Pedido (es estado de pantalla: al recuperar el borrador el comportamiento es el mismo). Borradores viejos sin marca => suma normal (seguro).
- "− Bulto" sigue con piso `CANTIDAD_MINIMA_RENGLON` (1) en pantalla.

## Archivos
- `src/domain/bultos.js`: `CANTIDAD_INICIAL_RENGLON`, `MARCA_CANTIDAD_POR_DEFECTO`, `renglonNuevo(producto, extra)`, `sumarBultoRenglon(cantidad, bultoX, { cantidadPorDefecto })` (reemplaza solo si la marca es `true` estricto y la cantidad es 1; bultoX inválido => sin cambios; el resto delega en `sumarBulto`, así siguen valiendo S-BUL-02 y `MAX_CANTIDAD`), `quitarMarcasRenglon`, `quitarMarcasRenglones`. `sumarBulto` no cambió de firma.
- `src/pages/NuevoPedido.js`: alta con `renglonNuevo`; `cambiarCantidad`/`setCantidad`/`aplicarBulto`/re-toque limpian la marca; `guardar` manda `quitarMarcasRenglones(items)`.
- `src/pages/Facturacion.js`: alta con `renglonNuevo`; `aplicarBulto` usa `sumarBultoRenglon` y sigue actualizando `itemsEditRef` + `draftRef` + `draftByPid` (trampa del borrador de texto: `guardarEdicion` prioriza `cantidadText`, por eso los tests verifican lo guardado). `draftCantidad` quita la marca solo si el texto cambia respecto de `draftRef` (un blur sin cambios, que reescribe el mismo texto, no la quita; verificado por mutación). `guardarEdicion` parte de `quitarMarcasRenglones(itemsEdit)`.
- `src/pages/Armado.js` (CRLF conservado): alta con `renglonNuevo(prod, { eliminado, picked, _key })`; `cambiarCantidadArmado`/`setCantidadArmadoTexto`/`aplicarBultoArmado`/re-toque/fusión en `tocarTick` limpian la marca; `itemsFinal` pasa por `quitarMarcasRenglones` (antes de `registrarFaltantes`, `cambiosDeCantidad` y `guardarPedidoOnlineFirst`).
- Sin cambios de schema: ni `DB_VERSION` ni migración SQL.

## Tests (todos con "AC-BUL-9" en el título)
- `src/domain/__tests__/bultos.cantidadPorDefecto.test.js` (nuevo, 18 casos con el `test.each`): 1 -> 12 -> 24 -> 36; sin marca 1 -> 13; marca con cantidad != 1 (2, 12, 0, "1") suma normal; solo `true` estricto activa el reemplazo; bultoX inválido (1, 0, -3, 0.5, "abc", "", null, undefined, MAX+1) => sin cambios; S-BUL-02 y MAX_CANTIDAD; `quitarMarcasRenglon(es)` no muta y tolera no-array.
- `src/pages/__tests__/bultos.pedido.test.js` (+5): agregar + bulto => 12; x3 => 36; escribir 1 a mano => 13; "− Bulto" quita la marca; lo que llega a `crearPedidoOnlineFirst` no tiene la marca (un renglón tocado y otro sin tocar).
- `src/pages/__tests__/bultos.facturacion.test.js` (+5): agregar + bulto guarda 12; x3 guarda 36; 1 a mano => 13; blur sin cambios conserva la marca; lo guardado no tiene la marca.
- `src/pages/__tests__/bultos.armado.test.js` (+4): agregar + bulto guarda 12; x3 guarda 36; 1 a mano => 13; lo guardado no tiene la marca ni `_key`.
- **Tests existentes ajustados: ninguno.** Todos los tests previos de AC-BUL-2/6 parten de renglones sembrados desde un borrador o desde un pedido guardado (sin marca), que es justo el caso "cantidad ya existente" de AC-BUL-9 => siguen sumando (p. ej. AC-BUL-6 1 -> 13 -> 25 -> 37 sigue valiendo porque el renglón sembrado no es un alta nueva).

## Resultados (AC-BUL-9)
- `CI=true npx react-scripts test --watchAll=false`: 47 suites OK; 874 passed, 1 skipped, 2 todo (877).
- `npx react-scripts build`: Compiled successfully, sin warnings.
- `node harness/gates/run-gates.mjs --fast`: unit-tests, coverage-domain, traceability, secret-scan, security-rules PASS ("TODOS LOS GATES PASARON").
