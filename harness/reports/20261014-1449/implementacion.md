# Implementación — RUN 20261014-1449 — REQ-COMR (iteración 1)

Alcance: `harness/reports/20261014-1449/plan.md` (REQ-COMR, AC-COMR-1..15, y los ajustes en REQ-CLI, REQ-PROD, REQ-PLA y REQ-COM).

## 1. Archivos tocados

### Producción (nuevos)
| Archivo | Qué | AC |
|---|---|---|
| `src/domain/rubros.js` | Normalización y clave de rubro (tabla explícita `ACENTOS_DESDE/HASTA`), `listarRubros`, `resolverRubro`, `rubroDeRenglon`, `validarPctRubro`, `indexarTablaRubros`, `pctDe`, `upsertPctLocal`, `filasGrillaVendedor`, mapeo remoto (`filaRubroToRemote/FromRemote`), `mezclarTablaRubros`, `interpretarGuardarRubros`, `vendedorIdPorNombre` | 3, 4, 5, 6, 7, 8, 15 |
| `src/services/comisionesRubroService.js` | `cargarTablaRubros`, `contarPendientesRubro`, `guardarPctsVendedor`, `syncComisionesRubro` (sube solo pendientes, limpia solo ids aceptados y no reeditados, marca rechazados y obsoletos, después lee y mezcla), `sondearMigracion005`, `credencialesAdminRubro`. Solo admin; el PIN no se guarda | 6, 7, 8 |
| `src/components/SelectorRubro.js` | Selector de Rubro con "Agregar rubro nuevo…" y dedupe | 3, 4 |
| `src/components/ComisionRubroGrid.js` | Grilla Rubro → % por vendedor, validación por fila, PIN opcional, `rubroFoco` | 6, 8, 11 |
| `supabase/migrations/005_comisiones_rubro.sql` | Tabla `comisiones_rubro` (RLS sin políticas ni grants), RPC `admin_leer_/admin_guardar_comisiones_rubro` (PIN), `rubro_clave()`, helpers de cálculo, columnas `modelo`/`desglose` en cierres, triggers de inmutabilidad, `cerrar_comisiones` redefinida (misma firma) | 7, 8, 9, 13, 14, AC-SEC-5 |

### Producción (modificados)
| Archivo | Cambio | AC |
|---|---|---|
| `src/domain/comisiones.js` | `MODELOS_COMISION`/`MODELO_VIGENTE`; aritmética exacta (`decimalACentavos`, `subtotalRenglonCentavos`, `baseRubrosPedido`, `comisionParteRubro` con BigInt y prorrateo Hamilton); `armarLineaRubro`; `resolverAsignacion` extraída (sin cambio de comportamiento); ajustes por modelo de la base; avisos c1/c2/vendedor sin sincronizar/renglón inválido; `resumirPorVendedor` con desglose y `comisionPedido:null` en divididos; `armarDashboard({modelo,...})`; `firmaDashboard` con vendedorId; `puedeCerrar` con motivos nuevos; `modeloDeCierre`; `lineaCongelada`/`construirCierre`/`cierreToRemote`/`cierreFromRemote`/`filasPdfCierre` con modelo `rubro`; `indexarProductos` | 9–15 |
| `src/domain/clientes.js` | Sin `comision` en `CAMPOS_CLIENTE` (16), `clienteVacio`, `validarCliente`, `clienteExtraToRemote` y `clienteExtraFromRemote` | 1, AC-CLI-1 |
| `src/domain/bultos.js` | `renglonNuevo` agrega `rubro` solo si el producto tiene uno | 5 |
| `src/domain/productos.js` | `categoria` con `tipo:'rubro'`; `validarProducto({rubros})` canoniza con `resolverRubro` | 3, 4 |
| `src/domain/plantillas.js` | Encabezados legacy de Comisión explícitos (`ENCABEZADOS_LEGACY_COMISION`); texto nuevo del aviso; rubro de productos canonizado contra existentes y contra las filas ya vistas del mismo archivo | 2, 4, AC-PLA-2/3/4 |
| `src/db/index.js` | `DB_VERSION` 6 → 7; store `comisionesRubro` (keyPath `id`, índices `vendedorId` y `clave`) con `if (!contains)`; `getComisionesRubro`, `putComisionesRubroLocal`, `putComisionesRubroRemotos`, `clearComisionesRubroPendingSync` | 7 |
| `src/services/comisionesService.js` | `cargarDatosComisiones` devuelve `modelo:'rubro'`, `productos`, `tablaRubros`, `pendientesRubro`, `faltaMigracion005`; `confirmarCierre`: pedidos → `syncProductos` + `downloadMaestros` → `syncComisionesRubro` (misma credencial) → recalcula/firma → RPC; mensajes `modelo_obsoleto` y `cierre_invalido` | 7, 9, 13 |
| `src/sync/syncService.js` | Solo comentario en `syncClientes` (por qué `comision` no viaja) | 1 |
| `src/components/CamposForm.js` | Prop aditiva `renderCampo` | 3 |
| `src/components/ProductoForm.js` | Prop `rubros`, Rubro con `SelectorRubro`, `validarProducto` con `rubros` | 3, 4 |
| `src/pages/Configuracion.js` | `rubros={listarRubros(productos)}` en `ProductoForm`; botón "% por rubro" por vendedor activo que abre `ComisionRubroGrid` | 3, 6, 8 |
| `src/pages/Comisiones.js` | Avisos c1 (con "Cargar %" que abre la grilla con el rubro enfocado), c2, vendedor sin sincronizar, renglón inválido; banner 005 faltante / % pendientes y "Actualizar % de comisión" (PIN); desglose por rubro por vendedor; sin comisión única en pedidos divididos; desglose en historial para cierres `rubro`. Sin aritmética | 10–13 |
| `supabase/migrations/003_comisiones.sql` | Solo un comentario de cabecera: la 005 redefine `cerrar_comisiones` | R7 |

`src/utils/pdfGen.js`, `useAppContext.js`, `NuevoPedido.js`, `Facturacion.js` y `Armado.js` no se tocaron. Revisé que todas las ediciones de renglones hacen spread (`...i`), así que el `rubro` sobrevive.

## 2. Tests existentes modificados (ninguno borrado, ningún `skip`/`only`)

Todos llevan el comentario `// MOD (RUN 20261014-1449, AC-COMR-x): antes ...; ahora ...`.

| Archivo | Qué cambió | Por qué |
|---|---|---|
| `src/domain/__tests__/clientes.test.js` | 17 → 16 etiquetas; `comision` ya no da error ni aparece en `r.cliente`; `clienteExtraToRemote` sin la clave; `clienteExtraFromRemote` no mapea `comision` | AC-COMR-1: se quitan la validación y el mapeo |
| `src/components/__tests__/ClienteForm.test.js` | 16 etiquetas y sin `#campo-comision`; se saca `comision` de `llenar` y del objeto esperado; el caso AC-SEC-2 afirma que no hay campo ni error de comisión (los demás errores siguen) | AC-COMR-1 |
| `src/pages/__tests__/ConfiguracionAltas.test.js` | 17 → 16 campos | AC-CLI-1 / AC-COMR-1 |
| `src/domain/__tests__/security.validacion.test.js` | `comision` hostil: antes `null` + error; ahora la clave no existe ni da error | AC-COMR-1 (la validación de % se movió a `validarPctRubro`) |
| `src/domain/__tests__/security.plantillas.test.js` | `valor.comision` null → la clave no existe | AC-COMR-2 |
| `src/domain/__tests__/plantillas.test.js` | `CAMPOS_CLIENTE` ya no contiene `comision`; altas sin la clave; `LABELS_CON_COMISION` explícito (16 + 'Comisión' en su lugar original); texto nuevo del aviso | AC-COMR-1/2 |
| `src/services/__tests__/plantillaExcel.test.js` | Alta sin `comision`; el XLSX viejo arma las columnas explícitas con 'Comisión' | AC-COMR-2 |
| `src/pages/__tests__/plantillas.page.test.js` | Altas sin `comision`; texto nuevo del aviso | AC-COMR-2 |
| `src/pages/__tests__/qa.plantillas.import.page.test.js` | Alta sin `comision` | AC-COMR-2 |
| `src/services/__tests__/syncTolerante.test.js` | El payload esperado no incluye `comision` (`not.toHaveProperty`). La aserción `:174` (la comision local se conserva tras el pull) sigue igual | AC-COMR-1 |
| `src/db/__tests__/migracionV5.test.js` | Versión 7; desde v4 también se crea `comisionesRubro`; idempotencia con el store nuevo | AC-COMR-7 |
| `src/db/__tests__/migracionV6.test.js` | `TODOS` incluye `comisionesRubro`; versión 7 | AC-COMR-7 |
| `src/domain/__tests__/security.comisiones.iter2.test.js` | `DB_VERSION = 6` → `7`; se agrega una aserción de que el paso a v6 sigue siendo `oldVersion < 6` | AC-COMR-7 (no estaba en la lista del plan) |
| `src/components/__tests__/ProductoForm.test.js` | Se renderiza con `rubros: ['Bebidas']`, porque el Rubro ahora es un `select`. Las aserciones no cambian | AC-COMR-3 |
| `src/services/__tests__/comisionesService.test.js` | Fixtures con `items` con rubro, `productos` y tabla (Carlos: X = 5 %); mocks de `getProductos`, `getComisionesRubro` y demás, `syncProductos`/`downloadMaestros` y RPC de rubros, registradas aparte. Los montos (50 / 25 / 75) se mantienen; el payload esperado lleva `pct:null`, `modelo:'rubro'` y `partes` | El servicio usa el modelo vigente |

Quedaron sin cambios (el modelo ausente se trata como `'cliente'`): `comisiones.test.js`, `qa.comisiones.test.js`, `comisiones.confirmacion.test.js`, `comisiones.anulacion.ux.test.js`, `security.comisiones*.test.js`, `pdfComisiones.test.js`, `comisiones.page.test.js`, `security.comisiones.roles.test.js`, `bultos.cantidadPorDefecto.test.js:16`.

## 3. Tests nuevos (cada `it` nombra su AC-COMR)

| Plan | Archivo |
|---|---|
| T1 | `src/domain/__tests__/rubros.test.js` |
| T2 | `src/domain/__tests__/comisiones.rubro.test.js` (incluye el ejemplo de $25 / $15 y el 70/30) |
| T3 | `src/domain/__tests__/comisiones.rubro.redondeo.test.js` |
| T4 | `src/domain/__tests__/comisiones.rubro.ajustes.test.js` |
| T5 | `src/domain/__tests__/comisiones.rubro.cierre.test.js` |
| T6 | `src/db/__tests__/migracionV7.test.js` |
| T7 | `src/services/__tests__/comisionesRubroService.test.js` |
| T8 | `src/services/__tests__/syncTolerante.test.js` (describe `AC-COMR-1 sync de clientes sin comision`) |
| T9 | `src/services/__tests__/comisionesService.test.js` (describe `AC-COMR-9 AC-COMR-13 ...`) |
| T10 | `src/domain/__tests__/migracion005.test.js` |
| T12 | `src/components/__tests__/SelectorRubro.test.js` |
| T13 | `src/components/__tests__/ComisionRubroGrid.test.js` |
| T14 | `src/pages/__tests__/comisionesRubro.config.page.test.js` |
| T15 | `src/pages/__tests__/comisiones.rubro.page.test.js` |
| T16 | `src/pages/__tests__/rubro.renglones.test.js` (3 describe: Nuevo pedido, Facturación, Armado) |
| T17 | `src/domain/__tests__/plantillas.test.js` (describe `AC-COMR-2 AC-COMR-4 ...`) |
| T18 | `src/domain/__tests__/bultos.cantidadPorDefecto.test.js` (describe `AC-COMR-5 ...`) |
| T19 | `src/domain/__tests__/comisiones.rubro.pureza.test.js` |

T11 (`security.comisionesRubro.test.js`) queda para el auditor, como dice el plan. Igual, T10 ya cubre la RLS solo-admin de la 005.

## 4. Desvíos del plan (y por qué)

1. **Salida legacy idéntica.** `modelo` se agrega solo cuando es `'rubro'`, tanto en el cierre como en la línea, `p_cierre` y `cierreFromRemote`. Los contadores `c1/c2/vendedorSinId/renglonInvalido` aparecen solo si hay líneas `rubro`. Los ajustes de base `'cliente'` **no** llevan `modelo` (el plan decía "modelo = el de la base"): así `comisiones.test.js` sigue con `toEqual` sin tocar. El servidor toma el modelo del ajuste del renglón base (`comisiones_cierre_pedidos.modelo`), no del cliente.
2. **`indexarTablaRubros` ignora las filas con `syncRechazo`.** Hay una opción `incluirRechazadas` para la grilla. Si no, un % rechazado por el servidor (vendedor inactivo) se usaría local y el cierre daría `montos_inconsistentes`. Las rechazadas no cuentan como pendientes.
3. **Funciones de dominio extra:** `filaRubroFromRemote`, `esFaltaMigracionRpc`, `MENSAJES_RUBRO`, `indexarProductos`, `ENCABEZADOS_LEGACY_COMISION`.
4. **Detección de la 005 faltante.** `sondearMigracion005()` llama a `admin_leer_comisiones_rubro` con id y PIN vacíos. La RPC responde `no_autorizado` **antes** de `verificar_pin`, así que no suma intentos de bloqueo. Si la RPC no existe, da `faltaMigracion005: true`. El plan no fijaba el mecanismo.
5. **`confirmarCierre` con la 005 faltante** devuelve el motivo `falta_migracion_005` (es distinto del `falta_migracion` de la 003).
6. **Detalles de la 005:**
   - se agregó `public.rubro_normalizado()`, espejo de `normalizarRubro`;
   - los helpers son `security invoker` sin execute para anon (los llama `cerrar_comisiones`, que es definer);
   - `admin_guardar` acota `editado_at` futuro a `now()`, para que un reloj adelantado no gane para siempre;
   - el desglose del servidor no incluye la fila "Sin rubro" (en JS es solo informativa, comisión 0).
7. **Desglose en JS:** se agrega una fila informativa "Sin rubro" (comisión 0) cuando hay productos sin rubro. Hamilton la ignora (peso 0).
8. **Gate de cobertura:** el plan hablaba de 100 %, pero `run-gates.mjs` exige 90 %. El resultado es 99,9 % de líneas en `src/domain/`, y `rubros.js` y `comisiones.js` al 100 %.
9. **Build:** se corrió con `BUILD_PATH` en el scratchpad de la sesión, para no generar `./build` dentro del repo. Es el mismo comando (`npx react-scripts build`) con `CI=true`.

## 5. Riesgos residuales

- **La 005 no se ejecutó contra un Postgres real.** Solo hay tests estáticos. Hay que aplicarla a mano (orden 002 P1 → 003 → 004 → 005) y probar un cierre real antes de usarla.
- Puede haber diferencias JS↔SQL en casos raros:
  - `\s` de Postgres frente a NBSP según el locale;
  - un precio JSON con exponente (`1e21`);
  - un `items` guardado como texto no-JSON.
  
  En esos casos el servidor rechaza el cierre (falla segura) y no se paga mal.

## 6. Resultados

**Tests** (`CI=true npx react-scripts test --watchAll=false`):
```
Test Suites: 87 passed, 87 total
Tests:       1 skipped, 3 todo, 1718 passed, 1722 total
```
El skipped y los 3 todo ya estaban antes de esta corrida. La base era 73 suites y 1512 passed.

**Build** (`npx react-scripts build`, `CI=true`):
```
Creating an optimized production build...
Compiled successfully.
```

**Gates** (`node harness/gates/run-gates.mjs --fast`):
```
▶ unit-tests ... PASS
▶ coverage-domain ... PASS   (líneas 99,9 % en src/domain; mínimo 90 %)
▶ traceability ... PASS      (incluye los 15 AC-COMR)
▶ secret-scan ... PASS
▶ security-rules ... PASS
✅ TODOS LOS GATES PASARON
```

---

# Iteración 2 (RUN 20261014-1449)

Entradas: `gates.json`, `qa-report.md` y `security-report.md`. No se tocó S-COMR-02 (requiere decisión del dueño) ni `security-report.md`. No se modificó ningún test de QA ni de seguridad.

**Decisión sobre la 005:** se corrigió **directamente la 005** y no se creó una 006. Justificación: no está aplicada en producción (los cambios son todos de la misma función y de las mismas tablas), y una 006 obligaría a redefinir otra vez `cerrar_comisiones` entera (~250 líneas duplicadas). Una restricción pesa: el test de seguridad `security.comisionesRubro.test.js` prohíbe `drop policy` en la 005, así que el paso de S-COMR-01 se hace solo con `revoke select`.

## Cambios

| Hallazgo | Qué se hizo | Dónde |
|---|---|---|
| **QA-1 / S-COMR-04** | `normalizarRubro` aplica `String(v).normalize('NFC')` antes de recortar y de buscar la clave. En SQL, `rubro_normalizado` aplica `normalize(coalesce(p, ''), NFC)`, así que JS y SQL dan la misma clave. `qa.rubros.borde.test.js` ("Lácteos" descompuesto) pasa **sin modificarlo**. | `src/domain/rubros.js`, `005` §1 |
| **S-COMR-05** | **Dominio:** regex con largo acotado (`precio` hasta 12 enteros y 20 decimales; `cantidad` hasta 9 enteros y 6 decimales). Un renglón que haría pasar la base del pedido de 10^13 centavos es inválido: comisiona 0 y el aviso "renglón inválido" nombra el pedido. **RPC:** las mismas regex en `comision_rubro_base` (un número patológico es un renglón inválido, ya no una excepción). Nuevo motivo `monto_desbordado` con `conflictos` = pedidos, para totales o comisiones de 10^13 o más y para una base de pedido mayor a 10^11 pesos. **Mensajes:** `mensajeRechazo('monto_desbordado' / 'desglose_inconsistente', conflictos)` lista los pedidos. | `src/domain/comisiones.js`, `src/services/comisionesService.js`, `005` |
| **S-COMR-01 (paso inmediato)** | Verificado antes: **la PWA nunca lee `comisiones_cierre_pedidos`** (cero referencias en `src/**` fuera de tests; solo lee `comisiones_cierres`). Se agregó `revoke select on public.comisiones_cierre_pedidos from anon, authenticated`. Las RPC `security definer` la siguen leyendo. Un test estático recorre todo `src/` para confirmar que ningún archivo la nombra. **No** se revocó `comisiones_cierres` (eso necesita `admin_leer_cierres` con PIN y es decisión del dueño, como indica el reporte). | `005` §9, `migracion005.test.js` |
| **S-COMR-03** | **Modelo:** lo decide el servidor (`'rubro'` si hay algún renglón `pedido` o con modelo `rubro`, si no `'cliente'`); el valor del cliente solo se valida contra el catálogo. **Desglose:** antes de grabar se compara `lineas[].partes[].desglose` contra el que calculó el servidor, por pedido, vendedor y rubro (clave, subtotal y %), en ambos sentidos; si no coincide devuelve `desglose_inconsistente` con los pedidos. La comisión por rubro (prorrateo informativo) no se compara, porque ya cierra contra el monto de cada parte, que sí se verifica. Los renglones `ajuste` y el rubro vacío ("Sin rubro") quedan fuera de la comparación, porque el servidor no los arma así. | `005` §8 |

## Tests

Nuevos, en archivos míos (los de QA y seguridad no se tocaron):
- `migracion005.test.js`: bloque "iteración 2" (NFC, revoke y que la PWA no la lee, `monto_desbordado`, modelo y desglose del servidor).
- `comisiones.rubro.redondeo.test.js`: topes de largo y base excedida con aviso que nombra el pedido.
- `comisionesService.test.js`: mensajes nuevos.

Modificado (mío): `migracion005.test.js`, aserción de la regex de `comision_rubro_base`. Antes `'^[0-9]+(\.[0-9]{1,6})?$'`, ahora los topes de S-COMR-05.

## Resultado real

- **Tests:** `Test Suites: 90 passed, 90 total` y `Tests: 1 skipped, 5 todo, 1789 passed, 1795 total`. Incluye `qa.rubros.borde.test.js` y `security.comisionesRubro*.test.js`. En `gates.json` fallaban 2 tests: el de QA-1, que ahora pasa, y uno que valida el formato de `security-report.md`, que ya pasa con el reporte vigente.
- **Build:** `Compiled successfully.`
- **Gates (`--fast`):** unit-tests, coverage-domain, traceability, secret-scan y security-rules en PASS.

## Pendiente / riesgos

- La 005 sigue sin probarse contra un Postgres real. Las partes nuevas (comparación de desglose con `except` y `lateral`, `normalize(..., NFC)`) hay que probarlas en un proyecto de prueba, **dos veces** (idempotencia) y con un cierre, un ajuste y una anulación reales.
- `normalize(text, NFC)` requiere Postgres 13 o más y base en UTF8 (Supabase lo cumple).
- Re-correr la 003 devuelve el `select` a anon sobre `comisiones_cierre_pedidos`; hay que volver a correr la 005.
- Sigue abierto S-COMR-01 en `comisiones_cierres.lineas` (legible con la anon key) y S-COMR-02, ambos del dueño.
