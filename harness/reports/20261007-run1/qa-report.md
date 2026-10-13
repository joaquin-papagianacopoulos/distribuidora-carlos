# QA report — RUN 20261007-run1

Rol: `qa-tester`. Alcance: el commit `944c1e8` (altas de clientes, proveedores y productos, ledger de stock e ingreso de mercadería). No se tocó código de producción. Solo se agregaron tests.

## Resumen

| Métrica | Valor |
|---|---|
| Archivos de test nuevos (QA) | 7 |
| Tests nuevos (QA) | 131 (125 pasan y 6 están en `it.skip` porque documentan bugs) |
| Suite completa (`CI=true npx react-scripts test --watchAll=false`) | 271 tests: 262 pasan, 6 en skip y 3 fallan (ver nota) |
| Bugs reales encontrados | 6 (2 altos, 2 medios y 2 bajos) más 1 riesgo de diseño |
| Gate `traceability` | ✅ PASS: todos los AC del SPEC tienen al menos un test |
| Gate `coverage-domain` | ✅ PASS (dominio: 99,46 % stmts, 94,67 % branches, 100 % lines) |
| Gates `secret-scan` / `security-rules` | ✅ PASS |
| Gate `unit-tests` | ❌ FAIL, pero **no por tests de QA** (ver nota) |

> **Nota sobre `unit-tests` en rojo:** los 3 tests que fallan están en `src/__tests__/security.migracion.test.js`, que escribe el auditor de seguridad en paralelo. Son los tests `AC-SEC-6`, que buscan `security-report.md`, y ese reporte todavía no existe cuando se corrió esto. Las 7 suites de QA y las de dominio pasan todas. El gate debería quedar verde cuando el auditor publique su reporte.

### Archivos creados

- `src/components/__tests__/ClienteForm.test.js` (13 tests)
- `src/components/__tests__/ProductoForm.test.js` (11 tests)
- `src/pages/__tests__/ConfiguracionAltas.test.js` (25 tests: Configuración → proveedores, clientes y productos, permisos y regresión del CSV)
- `src/pages/__tests__/Stock.test.js` (24 tests: permisos, listado, ingreso e historial)
- `src/services/__tests__/stockService.test.js` (31 tests con una IndexedDB y un Supabase falsos en memoria)
- `src/services/__tests__/pedidoRepository.test.js` (9 tests: hooks de stock en guardar y borrar pedido)
- `src/services/__tests__/syncTolerante.test.js` (18 tests: `upsertTolerante`, `syncClientes`, `syncProductos` y `downloadMaestros`)

Patrón usado: `createRoot` + `act` y `jest.mock` de `db`, `lib/supabase`, `hooks/useAppContext` y `services/stockService`. Ojo: CRA corre con `resetMocks: true`, así que los mocks de db se reinstalan en cada `beforeEach` con un objeto `__impl`.

## Cobertura de criterios de aceptación

En la columna "UI / integración (QA)" están los tests nuevos. El dominio ya estaba cubierto por `src/domain/__tests__`.

| AC | UI / integración (QA) | Estado |
|---|---|---|
| AC-CLI-1 | 17 etiquetas exactas y en orden, obligatorios con `*`, defaults (código sugerido, País, Fecha) y listas de provincias, IVA y vendedores | ✅ |
| AC-CLI-2 | error por campo, campos con solo espacios, el error se limpia al corregir y `onGuardar` no se llama | ✅ |
| AC-CLI-3 | DV inválido rechazado, CUIT obligatorio salvo Consumidor Final, se guarda normalizado `20-12345678-6` | ✅ |
| AC-CLI-4 | duplicado case-insensitive (en el form y en Configuración); en edición el propio código no cuenta | ✅. Bug B4 entre dispositivos |
| AC-CLI-5 | `upsertTolerante` (PGRST204 / 42703 → reintento legacy), `syncClientes` en snake_case, `downloadMaestros` tolerante | ✅. **Bug B1** |
| AC-CLI-6 | se puede editar un cliente legacy; `updateCliente` preserva `alias` y `diaEntrega` | ✅ |
| AC-PROV-1 | pestaña Proveedores, listado con cantidad de productos, alta con UUID v4, edición conserva el id | ✅ |
| AC-PROV-2 | duplicado case-insensitive y vacíos | ✅ |
| AC-PROV-3 | con productos asociados avisa y no borra (ni local ni en Supabase); sin productos borra en los dos lados | ✅ |
| AC-PROV-4 | `syncStock` sube a `proveedores` con `onConflict:id`; si falla Supabase o no hay internet, no se borra local | ✅ |
| AC-PROD-1 | recálculo en vivo (1000 × 0,9 × 0,95 × 1,3 = 1111,5), coma decimal, 2 decimales, el override manual corta el recálculo, botón "Usar precio calculado", un producto legacy no se pisa | ✅ |
| AC-PROD-2 | el listado muestra el precio; `syncProductos` sube `precio` = PV1 | ✅ |
| AC-PROD-3 | `onGuardar(producto, stock)` con el stock aparte; alta → `ajustarStock(id, n, {inicial:true})`; edición → ajuste por la diferencia; stock decimal o negativo rechazado | ✅ |
| AC-PROD-4 | solo dominio (`avisosItemPedido`) | ⚠️ sin test de UI de `NuevoPedido` |
| AC-PROD-5 | regresión CSV: alta y actualización, separador `,` y `;`, comillas, error sin columna precio, sync | ✅ |
| AC-ING-1 | solo admin; si no hay proveedores avisa; cabecera Factura y Proveedor | ✅ |
| AC-ING-2 | búsqueda por código (el exacto primero) y por descripción sin tildes, Enter; columnas Código / Descripción / Stock actual / Ingreso / Stock total; total = actual + ingreso | ✅ |
| AC-ING-3 | el mismo producto no se agrega dos veces; ingresos decimales, cero o repetidos rechazados | ✅. Bug B5 (UI) |
| AC-ING-4 | factura duplicada (case-insensitive y con espacios); se muestran los errores de cabecera y de renglón | ✅ |
| AC-ING-5 | 1 cabecera + N movimientos `ingreso`, el stock sube exacto; excepción → error general | ✅ |
| AC-ING-6 | historial ordenado del más nuevo al más viejo, detalle desplegable, estado vacío | ✅ |
| AC-STK-1 | stock = Σ (listado y `getStockMap`) | ✅ |
| AC-STK-2 | facturar → `venta` negativa por ítem; un pendiente no genera nada; se ignoran cantidades inválidas | ✅ |
| AC-STK-3 | facturar → revertir → facturar → borrar deja el stock igual; borrar dos veces no suma; "cancelado" también devuelve | ✅ |
| AC-STK-4 | edición: solo la diferencia (venta o anulación); quitar un ítem devuelve su stock | ✅ |
| AC-STK-5 | facturar dos veces no descuenta doble; `previsualizar` no reporta faltante si ya está descontado | ✅. **Bug B2** |
| AC-STK-6 | `previsualizarStockPedido` → `ok` / `confirmar` / `bloquear` | ✅ (sin test de UI de `Facturacion.marcarFacturado`) |
| AC-STK-7 | listado, filtro, "Solo stock bajo", detalle de movimientos, `stockMap` undefined no rompe | ✅ |
| AC-STK-8 | offline → rekey → sin duplicar; otro dispositivo revierte por remoteId; push solo de pendientes con `onConflict:id`; reintento no re-sube; error no limpia; pull incremental con cursor; tabla inexistente → `{skipped:true}`; un fallo de stock no rompe el guardado del pedido | ✅. **Bug B3** |
| AC-SEC-2 | validaciones de comisión, celular, CP, descuentos y bulto en la UI | ✅ |
| AC-SEC-3 | `=cmd()`, `@`, `+` neutralizados en nombre y categoría al importar | ✅. Bug B6 |
| AC-SEC-4 | Configuración y Stock: vendedor (2), armador (3) y sin permiso → sin acceso; admin sí | ✅ |
| AC-SEC-1/5/6 | los cubre el auditor (`security*.test.js`) | trazado |

**AC sin test de UI específico:** AC-PROD-4 (avisos en `NuevoPedido`) y AC-STK-6 a nivel pantalla (`Facturacion.marcarFacturado`, el `confirm` y el `alert`). Las dos pantallas pasan de 1000 líneas y tienen muchas dependencias. La lógica está cubierta en dominio y servicio. Queda como pendiente para la próxima iteración.

## Bugs encontrados

Cada bug tiene un test en `it.skip` con un comentario `// BUG:` que explica cómo reproducirlo. Se verificó que los 6 tests **fallan** al habilitarlos (cambiando `it.skip` por `it.only`).

### B1 · ALTO · Se pierden los campos nuevos de clientes y productos si la migración se corre tarde (AC-CLI-5)
- **Dónde:** `src/sync/syncService.js:366-381` (el reintento legacy limpia `pendingSync`) junto con `src/domain/clientes.js:134-152` `clienteExtraFromRemote` (y lo mismo en `productoExtraFromRemote`, `src/domain/productos.js:109-121`).
- **Repro:**
  1. Con Supabase todavía sin la migración 001, dar de alta un cliente con código C7, ciudad Rosario y CUIT, y sincronizar. El upsert completo falla con PGRST204, el legacy pasa y `pendingSync` queda en `false`.
  2. Correr `001_altas_y_stock.sql`. Las columnas nuevas aparecen en NULL para las filas existentes.
  3. Volver a sincronizar. `downloadMaestros` ve `r.ciudad === null` (no `undefined`) y pisa el valor local con `''`.
- **Efecto:** se pierden código, CUIT, ciudad y tipo de IVA de todos los clientes cargados antes de la migración. Con los productos pasa lo mismo: costo, descuentos y proveedor vuelven a 0 o null. Además, el código de cliente vacío rompe la unicidad.
- **Test:** `syncTolerante.test.js` → `AC-CLI-5 BUG: después de un sync legacy...`
- **Sugerencia:** cuando el upsert cae a legacy, no limpiar `pendingSync` (o marcar `pendingExtras`), o en el pull preferir el valor local cuando el remoto es `null` y el local no está vacío.

### B2 · ALTO · Descuento retroactivo de stock en pedidos que ya estaban facturados (AC-STK-5)
- **Dónde:** `src/services/pedidoRepository.js:177-196` llama a `aplicarStockPedido` en **todo** guardado; `src/domain/stock.js` `efectoDeseado` no distingue entre "facturado antes del ledger" y "recién facturado".
- **Repro:**
  1. Cargar el stock inicial hoy (inventario físico).
  2. En Facturación, abrir un pedido facturado la semana pasada y tocar "Pasar a deudas" (`Facturacion.js:630`).
  3. El stock baja por toda esa venta, que ya había salido antes del inventario.

  Pasa lo mismo al marcar armado o "a reparto" (`Armado.js:335,349`) o al cambiar el vendedor o la fecha (`ListaPedidos.js:149,382`) de cualquier pedido facturado sin movimientos. También pasa con un pedido facturado en otro dispositivo cuyos movimientos todavía no bajaron: se descuenta doble cuando llegan.
- **Test:** `stockService.test.js` → `AC-STK-5 BUG: re-guardar un pedido facturado antes del ledger...`
- **Sugerencia:** aplicar el ledger solo cuando hay una transición de estado (comparar con el pedido original) o a partir de una marca `stockAplicado`/`facturadoAt` posterior a la fecha de activación.

### B3 · MEDIO · Las refs `pedido-local:<id>` chocan entre dispositivos (AC-STK-8)
- **Dónde:** `src/domain/stock.js` `refPedido`/`refsPedido` y `src/services/stockService.js:41-49`. Los ids locales son autoIncrement, así que se repiten en cada celular.
- **Repro:**
  1. El dispositivo A factura offline su pedido id 5 y sus movimientos suben a Supabase con la ref `pedido-local:5`, antes del rekey. Esto pasa si el sync liviano corta `syncPedidosPendientes` a los 3 lotes (`useAppContext.js:138-141`) y sigue con `syncStock`, o si falla el push del pedido.
  2. El dispositivo B baja esos movimientos y guarda **su** pedido id 5, que es otro y está pendiente.
  3. Se genera una `anulacion` de +3 que devuelve stock de una venta que no es suya.
- **Test:** `stockService.test.js` → `AC-STK-8 BUG: un movimiento remoto con ref local de OTRO dispositivo...`
- **Sugerencia:** incluir un id de dispositivo en la ref local (`pedido-local:<deviceId>:<id>`), o no subir movimientos cuya ref sigue siendo local.

### B4 · MEDIO · Un código de cliente duplicado entre dispositivos corta todo el sync (AC-CLI-4)
- **Dónde:** `src/domain/clientes.js` `sugerirCodigoCliente` (máximo local + 1, determinístico) + índice único `clientes_codigo_uq` (`supabase/migrations/001_altas_y_stock.sql:30`) + `src/sync/syncService.js:375` (`throw error`).
- **Repro:** dos vendedores dan de alta un cliente offline. Los dos reciben el código sugerido "0042". El segundo en sincronizar recibe 23505 y `syncClientes` lanza el error. Como corre antes de `syncPedidosPendientes` y sin try/catch (`useAppContext.js:119-136`), ese celular deja de subir **pedidos** hasta que alguien cambie el código a mano.
- **Test:** `syncTolerante.test.js` → `AC-CLI-4 BUG: un código duplicado en Supabase (23505)...`

### B5 · BAJO · Errores de renglón "pegados" al índice en Ingreso de mercadería (AC-ING-3)
- **Dónde:** `src/pages/Stock.js:183` lee ``errores[`item${idx}`]``, y los errores no se limpian al quitar o editar renglones (`Stock.js:113-114`).
- **Repro:** agregar Alfajor y Coca, confirmar con el ingreso de Alfajor inválido (error en `item0`) y quitar Alfajor. El error "Ingreso inválido para Alfajor" queda mostrado en el renglón de Coca Cola.
- **Test:** `Stock.test.js` → `AC-ING-3 BUG: al quitar un renglón con error...`

### B6 · BAJO · La importación CSV no neutraliza las fórmulas en `codigo` y `unidad` (AC-SEC-3)
- **Dónde:** `src/pages/Configuracion.js:99-100`. Solo `nombre` y `categoria` pasan por `csvSafe`/`texto`.
- **Repro:** importar `nombre;precio;codigo\nAlfajor;10;=HYPERLINK("http://x")`. El producto queda con `codigo` = `=HYPERLINK(...)` sin apóstrofo. Hoy no existe una exportación CSV, pero el valor queda en IndexedDB y en Supabase.
- **Test:** `ConfiguracionAltas.test.js` → `AC-SEC-3 BUG: una celda "=..." en código/unidad...`

### Observaciones (no son bugs nuevos ni bloqueantes)
- `Configuracion.js:186-189`: el texto para quien no es admin tiene mojibake (`ConfiguraciÃ³n`, `tenÃ©s`). **Ya estaba antes de este commit** (está en `HEAD~1`), pero viola la regla 7 de `CLAUDE.md`.
- Al importar, `csvSafe` se aplica al `nombre` **antes** de buscarlo por nombre. Un producto que ya existía con un nombre que empieza con `-` o `+` no se encuentra y se duplica.
- El parseo de precio del CSV interpreta `1.500,50` como 1,5. Esto ya estaba antes del commit y no cambió.
- `upsertTolerante` avisa de las columnas faltantes una sola vez por sesión (`avisoMigracion` es de módulo). Es correcto, pero conviene saberlo al testear.

## Cobertura de código (archivos tocados en el commit)

| Archivo | Stmts | Branch | Lines |
|---|---|---|---|
| components/CamposForm.js | 100 % | 93,9 % | 100 % |
| components/ClienteForm.js | 96,8 % | 100 % | 95 % |
| components/ProductoForm.js | 100 % | 97,4 % | 100 % |
| components/ProveedorForm.js | 100 % | 85,7 % | 100 % |
| pages/Stock.js | 100 % | 79,5 % | 100 % |
| pages/Configuracion.js | 73,4 % | 57,2 % | 75,2 % (lo que falta es sobre todo vendedores y XLSX, que ya existían) |
| services/stockService.js | 96,8 % | 91,8 % | 98,6 % |
| services/pedidoRepository.js | 77,1 % | 62 % | 79,7 % (falta `crearPedidoOnlineFirst`, que no cambió) |
| domain/* | 99,5 % | 94,7 % | 100 % |

## Resultado de `node harness/gates/run-gates.mjs --fast`

```
▶ unit-tests ... FAIL   (3 fallos, todos en src/__tests__/security.migracion.test.js: AC-SEC-6, falta security-report.md del auditor)
▶ coverage-domain ... PASS
▶ traceability ... PASS
▶ secret-scan ... PASS
▶ security-rules ... PASS
```

---

## Iteración 2 (commit 082c552)

### Resultado

| Métrica | Valor |
|---|---|
| Suite completa | **305 tests: 302 pasan, 3 en skip (bugs residuales documentados) y 0 fallan** |
| Tests de QA | 163 en 8 suites (160 pasan y 3 en skip). En la iteración 1 eran 131 |
| `node harness/gates/run-gates.mjs --fast` | ✅ **TODOS LOS GATES PASARON** (unit-tests, coverage-domain, traceability, secret-scan, security-rules) |

### Tests adaptados a los cambios de contrato (sin debilitar lo que verifican)

- **stockService**: la acción "Facturar" ahora se modela con `aplicarStockPedido(p, { iniciar: true })`. Las ediciones, reversiones y borrados siguen sin `iniciar`, que es el contrato real de los otros guardados. Los errores de renglón pasan a `item:<productoId>`. `syncStock().subidos.X` pasa a ser `{ subidos, fallidos }`.
- **Stock.test**: el mock de errores usa la nueva clave `item:1`.
- **syncTolerante**: se agregó el mock de `patchRegistros`, que aplica el patch sobre la base en memoria.

### Bugs de la iteración 1: verificación

| Bug | Estado | Evidencia |
|---|---|---|
| B1 · campos nuevos se perdían al migrar tarde | ✅ **Corregido** | Se reactivó el test: tras el sync legacy queda `extrasPendientes: true` y `downloadMaestros` conserva código, ciudad y CUIT. Se agregaron tests de productos (costo y proveedor) y de reintento de extras que limpia la marca |
| B2 · descuento retroactivo de pedidos ya facturados | ✅ **Corregido** | Se reactivó el test. Además: armado, a reparto, revertir y borrar un pedido legacy no tocan el stock; Facturar (`iniciar`) sí descuenta; un pedido con movimientos se sigue reconciliando; `pedidoRepository` pasa `iniciar: true` solo con `{ iniciarStock: true }` |
| B3 · refs `pedido-local` entre dispositivos | ⚠️ **Corregido en el origen y queda un residual** | Test nuevo (S-11): `syncStock` no sube refs `pedido-local:*`, quedan `pendingSync` y se suben después del re-key. El test original sigue en skip como **residual (bajo)**: `aplicarStockPedido` todavía cuenta un movimiento *bajado* con ref local de otro dispositivo. Solo aplica si ya hay filas así en Supabase (subidas por la versión de la iteración 1) o si las sube un cliente que no respeta la regla. Sugerencia: descartar en el pull los movimientos remotos con ref local |
| B4 · 23505 cortaba el sync | ✅ **Corregido** | Se reactivó el test. Además: en un lote mixto se suben fila por fila, se limpian las OK y solo la que choca queda con `syncConflicto`; al cambiar el código, `syncConflicto` se limpia; un error 500 sigue lanzando |
| B5 · error de renglón "saltaba" de fila | ✅ **Corregido** | Se reactivó el test. Además: el error sigue a su producto aunque se quite un renglón anterior |
| B6 · `codigo`/`unidad` sin `csvSafe` | ✅ **Corregido** | Se reactivó el test (`'=cmd()\|x`, `'@unidad`). Además: S-13 `"1.234,50"` → 1234.5, negativos o basura → 0, códigos numéricos `00123`/`-5` intactos, S-07 archivos de más de 5 MB rechazados sin leerlos |

### Regresión de los fixes nuevos

- **S-11** (retención de refs locales): 2 tests en `stockService.test.js`.
- **S-12** (errores de dato fila por fila): un 23514 sube las filas buenas y deja la mala en `fallidos` con `pendingSync`; un 503 sigue cortando sin limpiar nada.
- **S-03** (`src/hooks/__tests__/useAppContext.test.js`, archivo nuevo, 7 tests activos): un `permiso` forjado en localStorage (número o string) no cambia el rol; se resuelve por `id` o por `remoteId`; un id inexistente borra la sesión; un JSON roto no rompe el arranque; el permiso cambiado en la base se respeta al rearrancar.

### Bugs y residuales abiertos (en skip, cada uno falla al habilitarlo)

1. **B3 residual · BAJO.** `stockService.test.js` → `AC-STK-8 BUG(residual)`. Se describe arriba.
2. **B7 · BAJO (nuevo).** Al resolver al vendedor contra la base, `useAppContext` **no reescribe** el `localStorage`, y `pedidoRepository.js:174` (`usuarioActual`) firma los movimientos de stock con el `nombre` guardado ahí. Por eso el campo `usuario` del ledger se puede falsificar.
   - **Repro:** guardar `{"id":2,"nombre":"Jorge"}` en `localStorage.vendedorActual`, recargar y facturar. El movimiento queda firmado por "Jorge".
   - **Test:** `useAppContext.test.js` → `AC-SEC-4 BUG: tras resolver contra la base...`
3. **S-03 residual · MEDIO (identidad, no rol).** El `id` sigue saliendo de localStorage. Con escribir `{"id":1}` (el id del admin, que tiene PIN) se entra como admin **sin pasar por el PIN**. No es una regresión: el propio implementador lo deja asentado ("el arreglo de fondo requiere autenticación en Supabase").
   - **Test:** `useAppContext.test.js` → `AC-SEC-4 BUG(residual)`.

### Observación sin test

Ante un 23505, `syncClientes` marca como "código repetido" **cualquier** error de la subida fila por fila. Por ejemplo, un 401 en una fila también se marcaría como conflicto de código. Es de impacto bajo.

---

## Iteración 3 (commit 5ead627)

### Resultado

| Métrica | Valor |
|---|---|
| Suite completa | **335 tests: 333 pasan, 2 en skip y 0 fallan** (20 suites) |
| Tests de QA | 173 (172 pasan y 1 en skip: una limitación documentada) |
| `node harness/gates/run-gates.mjs --fast` | ✅ **TODOS LOS GATES PASARON** |

### (A) Tests restaurados en `pedidoRepository.test.js`

El `git checkout` del coordinador borró de este archivo el bloque **"Fix B2 (iter 2): solo Facturar inicia el stock"**. Lo volví a agregar sobre la versión actual y respetando el contrato S-20: la firma sale de `setUsuarioSesion`, no de localStorage. Son 7 tests:

- `iniciarStock: true` pasa `{ usuario, iniciar: true }`, tanto offline como online (con el remoteId nuevo).
- Cualquier otro guardado (sin opciones, `iniciarStock:false` o una opción desconocida) solo reconcilia.
- Borrar nunca inicia stock.
- "Facturar" firma con la sesión aunque localStorage diga otro nombre.

### (B) Verificación de los fixes

| Ítem | Estado | Evidencia (`src/hooks/__tests__/useAppContext.test.js`) |
|---|---|---|
| **B7** · el JSON forjado quedaba en localStorage y firmaba movimientos | ✅ **Corregido** | Se reactivó el test. Después de resolver, localStorage queda **exactamente** `{id, remoteId, nombre}` con los datos reales (sin permiso ni PIN), y `getUsuarioSesion()` devuelve el vendedor real |
| **S-03 residual** · con `{"id":1}` se entraba como admin sin PIN | ✅ **Corregido**. El test se ajustó a "vuelve a la selección y pide PIN" | Se reactivó el test. Además: tampoco se entra por el remoteId del admin con permiso/PIN forjados; una sesión validada de **otro** vendedor no habilita al admin; en la misma sesión de la app (PIN ya validado) el admin se restaura al recargar; una sesión nueva (sessionStorage vacío) vuelve a pedir PIN; "Cambiar" limpia la sesión, el storage y la firma; localStorage nunca guarda `pin` ni `permiso` |
| **S-20** · firma desde la sesión | ✅ | Los tests de `pedidoRepository` (incluido el de un nombre forjado en localStorage) usan la sesión en memoria |
| **S-21** · precio > `MAX_IMPORTE` en CSV | ✅ | Test nuevo en `ConfiguracionAltas.test.js`: la fila se saltea y cuenta como "1 línea ignorada"; `999999999999` (el tope exacto) sí entra; un precio gigante no pisa un producto existente |
| **B3 residual** · ref local de otro dispositivo | ✅ **Cerrado como "no alcanzable"** (coincido con el coordinador) | El `it.skip` se convirtió en el test `AC-STK-8 B3 (no alcanzable)`. Hace toda la secuencia offline (facturar, editar, revertir, re-facturar y borrar) más 250 movimientos locales (más de un lote de 200), y fuerza el camino de reintento fila por fila (23514). Verifica que **ninguna** fila subida tenga ref `pedido-local:*` y que todas sigan `pendingSync`. Salvedad: si quedaron filas de la versión de la iteración 1 en una base real, habría que limpiarlas una vez a mano (`delete … where ref like 'pedido-local:%'`) |

### Abierto

- **Limitación conocida, no corregible en el cliente (skip documentado).** Hay dos caminos y los dos requieren DevTools:
  - `sessionStorage` se edita desde la consola igual que `localStorage`. Escribiendo `sesionVendedorId=1` más `{"id":1}` se entra como admin.
  - Además, el PIN está en texto plano en IndexedDB y se compara en el cliente.

  El PIN por sesión cubre el caso real (un celular compartido o la app reabierta), no a un atacante con consola. Para cerrarlo hace falta autenticación en Supabase.
  - **Test:** `useAppContext.test.js` → `AC-SEC-4 LIMITACIÓN: …`. Falla al habilitarlo.
- `src/hooks/__tests__/security.sesion.test.js:101` (archivo del auditor, no lo toqué) sigue en `test.skip` como "S-03 ABIERTO". Con el fix de la iteración 3 ese comportamiento ya está implementado y verificado en mis tests, así que el auditor puede habilitarlo.

### Observaciones (no son de esta iteración y quedan sin test)

- Al importar un CSV, un precio no numérico (`abc`) se toma como **0**. Si la fila coincide con un producto existente, **le pisa el precio con 0**. Ya pasaba antes y conviene ignorar esa fila en lugar de importarla en 0.
- `"1e15"` se importa como 115: el regex quita la `e`. Es un caso raro, porque XLSX con `raw:false` exporta los números ya formateados.

---

## Iteración 4 (commit 5a52cf3)

### Resultado

| Métrica | Valor |
|---|---|
| Suite completa | **374 tests: 373 pasan, 1 en skip (la limitación documentada) y 0 fallan** (20 suites) |
| Tests de QA | 205 (204 pasan y 1 en skip) |
| `node harness/gates/run-gates.mjs --fast` | ✅ **TODOS LOS GATES PASARON** |

### Tests adaptados a los contratos nuevos (12, sin debilitarlos)

- **syncTolerante** (6): los fixtures de cliente y producto "guardado desde el formulario" ahora llevan `extrasDirty: true`. Las aserciones son las mismas que antes: columnas nuevas, legacy, 23505 y `extrasPendientes`.
- **stockService** (2):
  - Se agregó `deleteProveedor` al mock.
  - El cursor incremental ahora se verifica con el solape de 5 minutos (`10:55:00.000Z`).
  - El test de proveedores declara el remoto, para que el borrado de los locales que no vinieron en el pull no afecte lo que mide.
- **ConfiguracionAltas** (1): `ajustarStock(2, 8, { usuario, base: 5 })` y `extrasDirty: true` en `updateProducto`.
- **useAppContext** (2) y **`security.sesion.test.js` del auditor** (1): la marca de PIN pasó de `sessionStorage.sesionVendedorId` a `localStorage.sesionVendedor = {id, exp}`. ⚠️ **Toqué el archivo del auditor**, con el cambio mínimo: solo la clave de sesión, en 2 líneas.

### Regresiones nuevas

| Pedido del revisor | Tests |
|---|---|
| **Bloqueante 1** (`extrasDirty`) | <ul><li>Un cliente `pendingSync` **sin** `extrasDirty` (reordenado desde Orden) sube solo `orden_entrega`/`dia_entrega` y lo básico: **ni `codigo` ni `cuit` ni ninguna otra columna nueva**.</li><li>Un lote mixto se parte en 1 upsert con extras (solo los dirty) y 1 upsert básico.</li><li>Una vez subido, `extrasDirty` se limpia y el siguiente guardado que no viene del formulario vuelve a ser básico.</li><li>Un producto importado por CSV sube sin `costo_final`, `proveedor_id`, etc.</li><li>Configuración marca `extrasDirty` en el alta y la edición de clientes, y el CSV no lo marca.</li><li>`downloadMaestros` no pisa un producto pendiente con `extrasDirty`, ni uno que difiere solo en `minimoVenta`, y limpia uno idéntico (también en los campos nuevos).</li><li>En el camino 23505 fila por fila, un 401 se relanza y no queda marcado como conflicto.</li></ul> |
| **Bloqueante 2** (ajuste contra el stock mostrado) | <ul><li>`ProductoForm`: si no se toca el stock, se llama `onGuardar(p, null, 10)` aunque la prop cambie a 7 con el form abierto. 10 → 12 manda `(p, 12, 10)`. En el alta se manda `(p, n, 0)`.</li><li>Configuración: editar **solo el precio** con el ledger cambiando en medio **no llama a `ajustarStock`**. Stock mostrado 10 → 12 con el ledger ya en 7 llama `ajustarStock(id, 12, {base: 10})`. Reescribir el mismo valor no ajusta nada.</li><li>`ajustarStock`: con `base: 10` y el ledger en 7, registra **+2** y el stock queda en 9. Si base es igual al nuevo, no hay movimiento. Una base 0 explícita se respeta.</li></ul> |
| **Sesión con vencimiento de 12 h** | <ul><li>La marca guarda `exp ≈ now + 12 h`.</li><li>A las 12 h + 1 s pide PIN; a las 11 h 59 m restaura.</li><li>Una marca vencida, sin `exp`, con el id de otro vendedor o con JSON roto no restaura al admin.</li><li>"Cambiar" borra la marca.</li></ul> |
| **Proveedores borrados en remoto** | <ul><li>Un proveedor que no vino en el pull completo se borra local (`deleteProveedor`).</li><li>Uno pendiente de subir no se borra.</li><li>Si la tabla no existe (`skipped`), no se borra nada.</li></ul> |
| **Facturar sin inventario cargado** | <ul><li>`previsualizarStockPedido` sin movimientos devuelve `ok` y no pide confirmación (tampoco con la política `bloquear`), y los `nuevos` igual se calculan.</li><li>Con inventario de solo algunos productos, se controlan solo esos.</li><li>Un inventario cargado en 0 (movimientos netos 0) **sí** se controla.</li></ul> |
| **ClienteForm, cliente viejo sin código** | Se sugiere el siguiente código libre y se puede guardar. Un cliente que ya tiene código lo conserva. |

### Riesgos y observaciones (sin test que falle)

- **Borrado de proveedores con un pull vacío (riesgo medio).** Si Supabase devuelve **0 filas sin error** (por ejemplo, una política RLS de SELECT mal configurada o una vista vacía), `syncStock` borra **todos** los proveedores locales que no están pendientes. Los productos quedan con un `proveedorId` huérfano. Sugerencia: no borrar cuando el pull vino vacío y local hay más de N proveedores, o hacer un *soft delete*.
- **Limitación conocida (skip):** con DevTools se puede forjar `localStorage.sesionVendedor = {id:'1', exp:…}` y entrar como admin. Se cierra con autenticación en Supabase.
