# Plan de arquitectura — RUN 20261012-2106 — cierre y consolidación de todo el SPEC

Alcance: todo `harness/SPEC.md` (REQ-CLI, PROV, PROD, ING, STK, SEC, BUL, COM, VEN, PLA).
Fuentes leídas: `CLAUDE.md`, `harness/SPEC.md`, reportes `20261007-run1` (veredicto), `20261007-2004` (security-report, veredicto), `20261007-2022` (security-report, veredicto), `20261012-ven/implementacion.md`, `20261012-pla/implementacion.md`, y el código de `src/domain/{vendedores,bultos,comisiones,plantillas,stock}.js`, `src/services/vendedoresService.js`, `src/components/SelectorVendedor.js`, `src/hooks/useAppContext.js`, `src/pages/{Configuracion,Facturacion,NuevoPedido,Armado,Comisiones}.js`, `src/db/index.js`, `supabase/migrations/002|003|004`, `harness/gates/run-gates.mjs`.

Esta corrida **no agrega funcionalidad nueva**. Cierra gaps de REQ-VEN/REQ-PLA (que salieron sin QA, auditoría ni revisión), corrige en código los hallazgos de seguridad abiertos que no necesitan decisión del dueño, mejora la UX de la anulación de cierres y arregla el mojibake (regla dura 7).

---

## 1. Gap analysis por REQ / AC

Leyenda:
- **OK**: implementado y con un test que lo ejercita de verdad.
- **OK\***: implementado y con test, pero con un residual que se corrige en esta corrida (ver la columna "Gap").
- **DUEÑO**: el residual depende de una decisión del dueño (sección 6).

El gate `traceability` da 74/74 AC con test (`20261012-pla/gates.json`). Esta tabla mira **si el test prueba lo que dice el AC**, no solo si el ID aparece.

### REQ-CLI, REQ-PROV, REQ-PROD, REQ-ING, REQ-STK, REQ-SEC (aprobados en 20261007-run1)

| AC | Estado | Evidencia / gap |
|---|---|---|
| AC-CLI-1..6 | OK | `ClienteForm.test.js`, `clientes.test.js`, `syncTolerante.test.js`. El veredicto de run1 verificó a mano AC-CLI-3 (dígito verificador) |
| AC-PROV-1..4 | OK | `productos_proveedores.test.js`, `ConfiguracionAltas.test.js` |
| AC-PROD-1..3, 5 | OK | `ProductoForm.test.js`, `productos_proveedores.test.js`; AC-PROD-5 sigue verde con REQ-PLA (`ConfiguracionAltas.test.js`) |
| AC-PROD-4 | OK / DUEÑO | Los avisos andan en Nuevo Pedido. Al **editar un pedido ya facturado** (Facturación/Armado) no se previsualiza el stock (S-BUL-04): queda como decisión del dueño |
| AC-ING-1..6 | OK | `Stock.test.js`, `stock.test.js`, `stockService.test.js` (el veredicto de run1 verificó AC-ING-4) |
| AC-STK-1..8 | OK* | `stock.test.js`, `stockService.test.js`, `security.stockSync.test.js`. Residual: una cantidad tipeada mayor que `MAX_CANTIDAD` genera un movimiento que el servidor rechaza (`abs(cantidad) <= 1000000`) y queda pendiente para siempre en ese dispositivo (S-BUL-06). Afecta AC-STK-8: se corrige en el **cambio C3** |
| AC-SEC-1 | OK | gate `secret-scan` |
| AC-SEC-2 | OK* | Faltan validar en el dominio las cantidades tipeadas en los renglones (S-BUL-06): cambio C3 |
| AC-SEC-3 | OK | `security.validacion.test.js`, `plantillas.test.js`, `plantillaExcel.test.js` |
| AC-SEC-4 | OK* / DUEÑO | Después de `verificar_pin`, el login usa el registro **local** (S-COM-18): cambio C5. El rol forjable en localStorage (S-BUL-01) necesita Auth: lo decide el dueño |
| AC-SEC-5 | OK* | RLS en 001/003/004. S-COM-20 (002) y S-COM-21 (003) se corrigen en SQL que todavía no se aplicó: cambios C6 y C7 |
| AC-SEC-6 | — | Lo tiene que producir el auditor de esta corrida sobre los cambios C1..C9 |

### REQ-BUL (20261007-2004, aprobado)

| AC | Estado | Gap |
|---|---|---|
| AC-BUL-1 | OK* | **S-BUL-08**: en Facturación, `getProductoActual` (`Facturacion.js:239-243`) cae a buscar por **nombre** y el `bultoX` (y el botón) puede salir de un producto homónimo. Cambio C4 |
| AC-BUL-2..5, 8, 9 | OK | `bultos*.test.js`, `BultoControl.test.js`, `security.bultos.test.js` |
| AC-BUL-6 | OK* / DUEÑO | Una cantidad tipeada no tiene tope (S-BUL-06, cambio C3). Que no se avise el stock al editar pedidos facturados es S-BUL-04 (dueño) |
| AC-BUL-7 | OK* | Funciona por diferencia. La suma de filas duplicadas en Armado (`Armado.js:487-492`) puede superar `MAX_CANTIDAD` (S-BUL-06, cambio C3) |

### REQ-COM (20261007-2022, aprobado)

| AC | Estado | Gap |
|---|---|---|
| AC-COM-1..11, 13..15, 17 | OK | `comisiones*.test.js`, `entregado*.test.js`, `comisionesService.test.js`, `comisiones.page.test.js` |
| AC-COM-12 | OK* (UX) | El botón "Confirmar anulación" queda deshabilitado sin explicar por qué (motivo de menos de 3 caracteres o PIN vacío), y el error del servidor aparece arriba de la página, lejos del formulario. El dueño se confundió. Cambio C2 (**el botón no se renombra**) |
| AC-COM-16 | OK* | **S-COM-21**: hasta 5000 `pg_advisory_xact_lock` por transacción en `003:312-316` y `:522-526`. Pueden agotar la tabla de locks compartida. Se cambia por un único lock global en la 003, que todavía no se aplicó. Cambio C7 |
| Decisión "Entregado vs A reparto" | DUEÑO | Sigue pendiente (sección 6) |

### REQ-VEN (20261012-ven, sin QA, auditoría ni revisión)

| AC | Estado | Evidencia | Gap |
|---|---|---|---|
| AC-VEN-1 | OK | `bajaVendedores.test.js` (servicio y página), `migracion004.test.js`, `vendedores.baja.test.js` | — |
| AC-VEN-2 | **Gap** | La RPC pone `activo=false` y `pin_hash=null` | (a) `admin_guardar_vendedor` (002) puede **volver a ponerle PIN** a un vendedor dado de baja, y no verifica que el admin que autoriza esté `activo`. (b) Si este dispositivo cree que el vendedor tiene PIN, el login va directo a `verificar_pin` y **nunca mira `activo` en el servidor**: hoy lo salva que `pin_hash` es null, o sea que depende de (a). Cambios C5 y C6 |
| AC-VEN-3 | OK* | Ingreso, Configuración y selector de cliente tienen test | Faltan los tests del selector de **Comisiones** ("Vendedor asignado", `Comisiones.js:141`) y del de **ListaPedidos** ("Asignar vendedor", `ListaPedidos.js:326`). El código existe, pero ningún test lo ejercita. Cambio C8 |
| AC-VEN-4 | **Gap** | Cliente (`puedeDarDeBaja`) y servidor (004) cuentan como "admin activo" a un admin **sin PIN** | Si se da de baja al único admin con PIN y queda otro admin sin PIN, nadie puede autorizar RPC y el que queda entra como admin sin clave. Además, el servidor no impide **degradar** (cambiar `permiso`) ni **quitarle el PIN** al último admin por `admin_guardar_vendedor` (S-COM-20). Cambios C6 (servidor) y C5b (cliente) |
| AC-VEN-5 | OK | `migracion004.test.js`, fallback del pull | El cambio C6 tiene que conservar la idempotencia y el chequeo del PASO 1 |
| AC-VEN-6 | OK | `vendedores.baja.test.js` | — |

### REQ-PLA (20261012-pla, sin QA, auditoría ni revisión)

| AC | Estado | Evidencia | Gap |
|---|---|---|---|
| AC-PLA-1, 2 | OK | `plantillas.test.js`, `plantillaExcel.test.js`, `plantillas.page.test.js` | — |
| AC-PLA-3 | **Gap** | Validación por fila con `validarProducto`; stock solo en productos nuevos | `importarProductos` (`Configuracion.js:76-89`) hace `addProductoLocal` y `ajustarStock` dentro del **mismo try**. Si falla el `ajustarStock`, el producto **queda creado**, pero la fila se informa como "rechazada". Al reimportar, el producto ya existe y el Stock **se ignora**: el stock inicial se pierde sin que nadie se entere (AC-PROD-3). Cambio C9 |
| AC-PLA-4, 5, 7 | OK | idem | — |
| AC-PLA-6 | OK* | 5 MB y formula injection probados | No hay un test específico de REQ-PLA que pruebe que vendedor y armador **no ven** los inputs de archivo ni el botón de plantilla. Hoy lo cubre el return temprano de la página, con el test genérico `ConfiguracionAltas.test.js:136`. Se agrega el test en C8 (sin cambio de código salvo que falle) |

### Transversal: regla dura 7 (mojibake)

Mojibake confirmado por grep (`Ã` en `src/`), siempre en archivos de producción:
- `src/pages/Configuracion.js:167` "ConfiguraciÃ³n" y `:170` "No tenÃ©s permisos para acceder a ConfiguraciÃ³n";
- `src/pages/Facturacion.js:262` "FacturaciÃ³n", `:265` "No tenÃ©s permisos para facturar" y `:519` "Porcentaje invÃ¡lido (0-100)."; además `:538` dice "Porcentaje invalido", sin tilde, y se unifica a "inválido";
- `src/pages/NuevoPedido.js:89` "Porcentaje invÃ¡lido (0-100).".

Cambio C1.

---

## 2. Modelo de datos

### IndexedDB
**Sin cambios.** `DB_VERSION` sigue en **6**. No hay stores ni índices nuevos. `activo`, `tienePin`, `permiso`, `nombre` y `zona` del store `vendedores` ya existen. C5 solo **actualiza** el registro local del vendedor con lo que dice el servidor (lo mismo que ya hace el pull, `vendedorDesdeRemoto`), sin borrar registros (regla dura 6).

### Supabase
**No hay tablas ni columnas nuevas.** Solo se cambian funciones, y solo en migraciones que **todavía no se aplicaron**:

| Archivo | Cambio | Motivo |
|---|---|---|
| `supabase/migrations/003_comisiones.sql` | `cerrar_comisiones` y `anular_cierre_comisiones`: un único `pg_advisory_xact_lock(hashtext('comisiones_global'))` reemplaza el lock por id de cierre y los loops de un lock por pedido | S-COM-21 (AC-COM-16) |
| `supabase/migrations/004_baja_vendedores.sql` | (1) `admin_baja_vendedor` cuenta como "otro admin" solo a uno `activo` **y con `pin_hash`**. (2) **`create or replace` de `admin_guardar_vendedor`** con la **misma firma y los mismos defaults** que la 002, más los chequeos de S-COM-20 y de `activo` | S-COM-20, AC-VEN-2, AC-VEN-4 |
| `supabase/migrations/002_seguridad_recomendada.sql` | **Solo un comentario** arriba de `admin_guardar_vendedor`: "La 004 la redefine (S-COM-20 + activo). Si se vuelve a correr la 002 PASO 1, volver a correr la 004." El cuerpo no se toca, porque la versión nueva usa `activo`, que no existe hasta la 004 | Documentación |

Por qué S-COM-20 va en la 004 y no en la 002: la 004 ya exige el PASO 1 de la 002 y es la que crea `activo`. Si la 002 ya se aplicó, un cambio en la 002 no tendría efecto. La 004 funciona en los dos casos.

Las dos migraciones (003 y 004) llevan en la cabecera una nota "Modificada en RUN 20261012-2106 antes de aplicarse (S-COM-21 / S-COM-20)".

### Mapeo campo UI → interno → remoto (vendedores, lo que toca esta corrida)

| UI | Interno (IndexedDB) | Remoto (`public.vendedores`) | Quién manda |
|---|---|---|---|
| Nombre | `nombre` | `nombre` | Servidor (pull y, desde C5, también el login) |
| Zona | `zona` | `zona` | Servidor |
| Permiso | `permiso` (1/2/3) | `permiso` | **Servidor**. Desde C5, en el login también. Un registro solo-local entra siempre como 2 |
| Candado | `tienePin` | `tiene_pin` | Servidor |
| (oculto) | `activo` (ausente = activo) | `activo boolean not null default true` (004) | Servidor, solo por RPC |
| (oculto) | `remoteId` | `id` | Servidor |
| — | (nunca) | `pin`, `pin_hash` | Solo servidor; nunca se baja |

---

## 3. Cambios a implementar (en orden, acotados)

El orden va de menor a mayor riesgo. Cada cambio se puede mergear solo y deja `npm test` y el build verdes.

### C1 — Mojibake (regla dura 7)
- **Archivos:**
  - `src/pages/Configuracion.js` (`:167`, `:170`);
  - `src/pages/Facturacion.js` (`:262`, `:265`, `:519`, `:538`);
  - `src/pages/NuevoPedido.js` (`:89`).
- **Textos correctos:** "Configuración", "No tenés permisos para acceder a Configuración", "Facturación", "No tenés permisos para facturar", "Porcentaje inválido (0-100).".
- **Cómo:** editar en UTF-8 sin BOM, conservando los finales de línea que ya tiene cada archivo. No hay que reformatear ni tocar otras líneas.
- **Test:** `src/domain/__tests__/encoding.regla7.test.js`.
  - Recorre `src/**/*.js` (incluidos los tests) y falla si encuentra `/Ã[\u0080-¿]|Â[\u0080-¿]|â€/`. El test escribe esos caracteres solo como escapes `\u`, para no contener mojibake él mismo.
  - Además, `ConfiguracionAltas.test.js:136` se **endurece**: pasa de `/No ten.*s permisos para acceder/` a `toContain('No tenés permisos para acceder a Configuración')`.
- **REQ:** regla dura 7; AC-SEC-4, porque son las pantallas de "sin permisos".

### C2 — UX del formulario de anulación de cierres (AC-COM-12)
- **Dominio** (`src/domain/comisiones.js`), función pura nueva:
  ```js
  // Estado del botón "Confirmar anulación" y texto de ayuda visible.
  // Usa la MISMA normalización y el mismo MIN_MOTIVO que validarAnulacion.
  export const ayudaAnulacion = ({ motivo, pin, procesando } = {}) =>
    ({ habilitado: boolean, ayuda: string | null })
  ```
  Contrato:
  - `procesando` → `{ habilitado:false, ayuda:'Anulando...' }`;
  - motivo normalizado (con `texto()`, igual que `validarAnulacion`) de menos de `MIN_MOTIVO` → `{ habilitado:false, ayuda:'Escribí el motivo (mínimo 3 letras)' }`;
  - motivo de más de `MAX_MOTIVO` → `{ false, 'El motivo no puede superar 300 caracteres' }`;
  - PIN vacío → `{ false, 'Ingresá tu PIN de admin' }`;
  - en cualquier otro caso → `{ habilitado:true, ayuda:null }`.

  Entradas hostiles (null, número, objeto) no lanzan error.
- **UI** (`src/pages/Comisiones.js`, `Historial`):
  - `disabled={!ayudaAnulacion(...).habilitado}`;
  - debajo del botón, `<div id="ayuda-anular-<id>" data-testid="ayuda-anular-<id>">` con la ayuda mientras esté deshabilitado, y `aria-describedby` en el botón;
  - **el texto del botón sigue siendo "Confirmar anulación"**;
  - `onAnular` pasa a devolver `{ ok, mensaje }` en vez de un booleano. `Historial` guarda `errorAnular` y lo muestra **inline** (`data-testid="error-anular-<id>"`, color `--danger`) sin cerrar el formulario. El error se borra al editar el motivo o el PIN, o al tocar "Volver";
  - el mensaje global de arriba se mantiene, para no romper el test `comisiones.page.test.js:286`;
  - el PIN se sigue borrando del estado antes de llamar.

### C3 — S-BUL-06: tope `MAX_CANTIDAD` en cantidades tipeadas (AC-BUL-6/7, AC-STK-8, AC-SEC-2)
- **Dominio** (`src/domain/bultos.js`), funciones puras nuevas:
  ```js
  // Texto tipeado -> entero en [1, MAX_CANTIDAD] o null (vacío, 0, negativo,
  // decimal, NaN, > MAX_CANTIDAD). Saca separadores como hoy ("1.000" -> 1000).
  export function cantidadTipeada(texto) -> number | null
  // Suma de dos renglones del mismo producto (fusión en Armado):
  // entero o null si alguna parte es inválida o la suma supera MAX_CANTIDAD.
  export function sumarCantidades(a, b) -> number | null
  // Validación del pedido entero antes de guardar (defensa en profundidad):
  export function validarCantidadesItems(items) -> { ok: boolean, errores: Array<{ productoId, nombre, cantidad }> }
  //   ok:false si algún item tiene cantidad no entera, <= 0 o > MAX_CANTIDAD.
  //   Las cantidades decimales legacy (S-BUL-02) NO se rechazan si el item no
  //   cambió: la función recibe { previos } opcional y solo valida lo que cambió.
  ```
- **Pantallas:**
  - `NuevoPedido.js`: `handleCantidadChange` y `handleCantidadBlur` usan `cantidadTipeada`. Con `null` y el texto no vacío, no se cambia la cantidad (queda la anterior). El blur restaura el texto a la última cantidad válida. Antes de `crearPedidoOnlineFirst`, `validarCantidadesItems` y un `alert` si falla.
  - `Facturacion.js`: `handleCantidadBlur`, `draftCantidad` y `guardarEdicion` (`:611`) usan `cantidadTipeada`. Antes de guardar, `validarCantidadesItems(itemsFinal, { previos: pedidoEditando.items })`. Si falla, `alert('Cantidad inválida en: ... (máximo 1.000.000)')` y no se guarda.
  - `Armado.js`: `setCantidadArmadoTexto` usa `cantidadTipeada`; la fusión de duplicados (`:490-492`) usa `sumarCantidades`; si da `null`, aviso y no se guarda.
- **Sin cambios de comportamiento** para cantidades válidas, para el botón Bulto ni para el piso de 1.

### C4 — S-BUL-08: el bulto se resuelve solo por id (AC-BUL-1, 4)
- **Dominio** (`src/domain/bultos.js`):
  ```js
  // Producto para el botón Bulto y el desglose: SOLO por id (String). Sin match -> null
  // (el botón no aparece, igual que con bultoX <= 1). Nunca por nombre.
  export function productoParaBulto(item, productosById /* Map<string, producto> */) -> producto | null
  ```
- **`Facturacion.js`:** `aplicarBulto` (`:459`) y la prop `producto` de `FacturacionItemRow` (`:919`, que se usa solo para `bultoX`, `:184`) pasan a usar `productoParaBulto(item, productosIndex.byId)`. `getProductoActual`, con el fallback por nombre, **se mantiene solo para "precio de lista"** (`:897-903`). Ese comportamiento no cambia.
- `Armado.js` ya resuelve por id (`productosById`): se reemplaza el acceso directo por la misma función, para tener una sola fuente.

### C5 — S-COM-18: el login usa la fila del **servidor** después de verificar (AC-SEC-4, AC-VEN-2, AC-VEN-3)
- **Dominio** (`src/domain/vendedores.js`):
  ```js
  // Registro de sesión a partir de la fila del servidor (select explícito, sin pin).
  // nombre/zona/permiso/tienePin/activo/remoteId salen de `fila`; de `local` solo
  // id local y createdAt. Fila ausente o activo === false -> null (no entra).
  // permiso inválido -> ROLES.VENDEDOR. Nunca copia pin/pin_hash.
  export const vendedorDeSesion = (local, fila) -> object | null
  // decidirIngreso: el caso "entrar" de un registro solo-local (sin remoteId)
  // devuelve además { permiso: ROLES.VENDEDOR } (nunca el permiso local).
  // Resultado de leer la fila tras verificar: error de red -> sin_conexion;
  // sin fila -> no_existe; activo false -> inactivo (MSG_DADO_DE_BAJA); ok -> { ok, fila }.
  export const interpretarFilaIngreso = ({ data, error }) -> { ok, motivo, mensaje, fila? }
  ```
- **Servicio** (`src/services/vendedoresService.js`):
  - `leerFilaVendedor(remoteId)` (interna): `select(COLUMNAS_VENDEDOR_REMOTO)`, y si falta la columna `SIN_ACTIVO`, después `LEGACY` (mismo patrón que el pull, AC-VEN-5).
  - `ingresarConPin(vendedor, pin)` (nueva): `verificarPinIngreso` → si da ok, `leerFilaVendedor` → `vendedorDeSesion` → `updateVendedor(sesion)` → `{ ok:true, vendedor: sesion }`.
    - Si falla la lectura, **no entra** (fail-closed) y muestra "No se pudo confirmar tu usuario. Probá de nuevo.".
    - `verificarPinIngreso` se mantiene igual, por compatibilidad con los tests existentes.
  - `iniciarIngreso`: en el caso `consultar` lee la fila completa (`leerFilaVendedor`) y devuelve `{ accion:'entrar', vendedor: vendedorDeSesion(...) }`, después de `updateVendedor`.
    - Con la rama *fail-open* de la 002 sin aplicar (S-COM-22(1)), se usa igual la fila `LEGACY` del servidor para `permiso` y `nombre`.
    - Para un solo-local devuelve `vendedor: { ...v, permiso: 2 }` y hace `updateVendedor` solo si el permiso local era distinto.
- **`SelectorVendedor.js`:**
  - `trySelect` llama a `seleccionarVendedor(r.vendedor)` y nunca con el `v` local;
  - `confirmarPin` usa `ingresarConPin` y `seleccionarVendedor(r.vendedor)`;
  - se juntan los dos imports de `../sync/syncService` (sugerencia 10 del veredicto 2022).
- **Por qué hay que persistir con `updateVendedor`:** el efecto de `useAppContext.js:372-391` mezcla `found` (el registro local) sobre `vendedorActual`. Si solo se pasara la fila del servidor a `seleccionarVendedor`, el siguiente render volvería a poner el `permiso` forjado del registro local. **No se cambia `useAppContext.js`.**
- **Residual documentado (S-BUL-01, dueño):** editar IndexedDB o localStorage **después** del login sigue pudiendo forjar la UI hasta el próximo pull. Esto solo se arregla con Auth.

### C5b — AC-VEN-4 en el cliente: "admin activo" quiere decir activo **y con PIN**
- `puedeDarDeBaja` (`src/domain/vendedores.js:217-234`): `otros` = admins activos **con `tienePin(v)`**. Mensaje: "No se puede dar de baja al último admin activo con PIN.".
- Función pura nueva, el espejo en el cliente de S-COM-20:
  ```js
  // Al editar: ¿el cambio deja la base sin admin activo con PIN?
  export const chequeoUltimoAdmin = ({ previo, datos, vendedores }) -> { ok, motivo:'ultimo_admin'|null, mensaje }
  ```
  `guardarVendedorAdmin` la llama después de `validarFormVendedor` y antes de la RPC.
- `interpretarGuardarVendedor`: mapea los mensajes nuevos de la 004 (ver C6):
  - `admin_sin_pin` → "Un admin tiene que tener PIN (4 a 8 dígitos).";
  - `ultimo_admin` → "No se puede quitar el último admin activo con PIN.";
  - `vendedor_inexistente` → "Ese vendedor ya no existe en el servidor. Sincronizá vendedores.";
  - `vendedor_inactivo` → "Ese vendedor está dado de baja.".

  `data === null` sigue siendo "PIN de admin incorrecto." (`no_autorizado`).

### C6 — SQL 004: S-COM-20 y endurecimiento de AC-VEN-2/4 (no aplicada todavía)
En `supabase/migrations/004_baja_vendedores.sql`, dentro del mismo `begin/commit` y después de crear `activo`:
1. `admin_baja_vendedor`: el conteo `v_otros_admin` agrega `and pin_hash is not null`. Todo lo demás queda igual.
2. `create or replace function public.admin_guardar_vendedor(p_admin_id text, p_admin_pin text, p_vendedor_id text, p_nombre text, p_zona text, p_permiso int, p_pin_nuevo text default null, p_borrar_pin boolean default false) returns text`, con `security definer set search_path = public, extensions, pg_temp`. Orden obligatorio:
   - a) **Autorización**, igual que la 002: `verificar_pin` **siempre**, y `return null` **sin raise** si el PIN falla o si el admin no es `permiso = 1 and activo and pin_hash is not null`. Lo único nuevo es `activo`.
   - b) Validación de `p_permiso` y `p_nombre`, igual que la 002.
   - c) `perform pg_advisory_xact_lock(hashtext('vendedores_baja'))`: la **misma clave** que la baja, para que se serialicen la baja y la degradación concurrentes.
   - d) Si `p_vendedor_id` no es null: si no existe la fila, `raise exception 'vendedor_inexistente'`; si tiene `activo = false`, `raise exception 'vendedor_inactivo'`. Esto impide volver a ponerle PIN a un dado de baja (AC-VEN-2).
   - e) Si el resultado es `p_permiso = 1` y queda sin PIN (`p_borrar_pin`, o sin `p_pin_nuevo` y sin `pin_hash` previo): `raise exception 'admin_sin_pin'`.
   - f) Si el destino hoy es admin activo con PIN y el cambio lo degrada (`p_permiso <> 1`) o le borra el PIN, y no hay **otro** admin `activo` con `pin_hash`: `raise exception 'ultimo_admin'`.
   - g) Insert y update iguales a la 002. Si el `update ... returning` no devuelve id (carrera), `raise exception 'vendedor_inexistente'`.
   - Los `raise` de d) a g) van **después** de autorizar. El rollback solo descarta un intento **exitoso** de `verificar_pin`, así que no habilita fuerza bruta (mismo razonamiento que el security-report de 2022).
   - Al final: `revoke all ... from public; grant execute ... to anon, authenticated;` con la firma exacta.
3. La cabecera de la 004 documenta: "redefine admin_guardar_vendedor de la 002 (S-COM-20). Si se re-corre la 002 PASO 1, re-correr la 004".

### C7 — SQL 003: S-COM-21, lock global (no aplicada todavía)
En `supabase/migrations/003_comisiones.sql`:
- **`cerrar_comisiones`:** `perform pg_advisory_xact_lock(hashtext('comisiones_global'));` en el lugar del lock por id (`:250`), o sea **después** de `verificar_pin` y de la respuesta `no_autorizado`, y **antes** del chequeo de idempotencia (`ya_existia`). Se borran el lock `comisiones_cierre:` y el loop `comisiones_pedido:` (`:312-316`). Todas las validaciones (`pedido_invalido`, `ajuste_invalido`, `montos_inconsistentes`, el índice único, `ajuste_seq` del servidor) quedan igual y ahora corren bajo el lock global.
- **`anular_cierre_comisiones`:** el mismo lock global **después** de autorizar y **antes** del `select ... for update` (`:506`). Se borra el loop `:522-526`. `tiene_ajustes_vigentes` sigue antes del `update`.
- **Orden de locks:** el global siempre va primero y el lock de fila después, así que no hay ciclo posible. Un comentario en el SQL lo explica, y explica por qué alcanza con serializar: los cierres son raros y los hace un admin.

### C8 — Tests faltantes de REQ-VEN y REQ-PLA (sin código de producción, salvo que fallen)
- AC-VEN-3: los selectores de Comisiones y ListaPedidos no muestran a los dados de baja, pero Comisiones conserva al ya asignado.
- AC-PLA-6: vendedor (2) y armador (3) en Configuración no ven `input[type=file]` ni "Descargar plantilla Excel".

### C9 — AC-PLA-3 / AC-PROD-3: no perder el stock inicial en una importación parcial
- **Dominio** (`src/domain/plantillas.js`): `resumirEntradas` acepta `stockFallido: true` en una entrada `crear`, que cuenta como **creado**, y suma `resumen.stockFallido` con `{ fila, motivo }`. `textoResumen` agrega "N producto(s) creados SIN stock inicial: cargalo desde Stock (Ajuste)". Es una función pura y retrocompatible: sin el flag, el resultado es idéntico.
- **`Configuracion.js` `importarProductos`:** `addProductoLocal` en su try. Si no falla, `ajustarStock` en **otro** try. Si falla el stock, se hace `entradas.push({ ...e, stockFallido: true, errores:[...] })` y se sigue. Nunca se escribe un número de stock (regla dura 4): el reintento lo hace el usuario con un ajuste, que es un movimiento con UUID.

---

## 4. Funciones puras de dominio nuevas o cambiadas (resumen)

| Archivo | Firma | Cambio |
|---|---|---|
| `src/domain/comisiones.js` | `ayudaAnulacion({ motivo, pin, procesando }) -> { habilitado, ayuda }` | C2 |
| `src/domain/bultos.js` | `cantidadTipeada(texto) -> int \| null` | C3 |
| `src/domain/bultos.js` | `sumarCantidades(a, b) -> int \| null` | C3 |
| `src/domain/bultos.js` | `validarCantidadesItems(items, { previos } = {}) -> { ok, errores }` | C3 |
| `src/domain/bultos.js` | `productoParaBulto(item, productosById) -> producto \| null` | C4 |
| `src/domain/vendedores.js` | `vendedorDeSesion(local, fila) -> object \| null` | C5 |
| `src/domain/vendedores.js` | `interpretarFilaIngreso({ data, error }) -> { ok, motivo, mensaje, fila? }` | C5 |
| `src/domain/vendedores.js` | `decidirIngreso(...)`: el solo-local devuelve `permiso: ROLES.VENDEDOR` | C5 (aditivo) |
| `src/domain/vendedores.js` | `puedeDarDeBaja(...)`: solo cuentan admins activos **con PIN** | C5b (más estricto) |
| `src/domain/vendedores.js` | `chequeoUltimoAdmin({ previo, datos, vendedores }) -> { ok, motivo, mensaje }` | C5b |
| `src/domain/vendedores.js` | `interpretarGuardarVendedor`: 4 motivos nuevos | C5b (aditivo) |
| `src/domain/plantillas.js` | `resumirEntradas` / `textoResumen`: `stockFallido` | C9 (aditivo) |

Todas sin React ni IndexedDB, y robustas ante null, NaN, objetos y strings. El gate `coverage-domain` exige la cobertura actual (100 % de líneas), así que cada rama necesita su test.

---

## 5. Riesgos (concurrencia offline/multidispositivo y otros) y mitigación

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | **C5:** `updateVendedor` en el login compite con un pull de vendedores que corre en paralelo | Los dos escriben la verdad del servidor sobre el mismo registro (gana el último, con el mismo contenido), así que es idempotente. No se borran registros ni se crean duplicados: se actualiza el registro local existente, por id local |
| R2 | **C5:** ataque B (`remoteId` cambiado en el registro del admin) | La fila se lee **por el mismo `remoteId` que verificó el PIN**, así que la sesión queda con el nombre y el permiso del dueño real de ese PIN. El registro local "del admin" queda pisado con esos datos hasta el próximo pull (es el dispositivo del atacante) |
| R3 | **C5:** la red se cae entre `verificar_pin` OK y la lectura de la fila | Fail-closed: no entra y aparece el mensaje "Probá de nuevo". El intento OK ya contó, así que no consume intentos fallidos |
| R4 | **C5:** la 004 o la 002 PASO 1 no están aplicadas | Lectura con fallback `REMOTO → SIN_ACTIVO → LEGACY`, igual que el pull (AC-VEN-5). El *fail-open* de S-COM-22(1) sigue (decisión del dueño), pero ahora con el permiso del servidor |
| R5 | **C6:** dos admins dan de baja o degradan al "otro" admin al mismo tiempo, desde dos dispositivos | El mismo `pg_advisory_xact_lock(hashtext('vendedores_baja'))` en las dos RPC. El conteo de admins activos con PIN se hace bajo el lock |
| R6 | **C6:** la 002 PASO 1 se vuelve a correr después de la 004 y pisa `admin_guardar_vendedor` | Documentado en la 002 y en la 004. Un test (`T-19`) fija que la 004 redefine la función con la firma exacta, así que re-correr la 004 la restaura |
| R7 | **C6:** `create or replace` con defaults distintos falla en Postgres | Misma firma **y mismos defaults** que la 002 (lo fija `T-19`) |
| R8 | **C7:** el lock global serializa todos los cierres y anulaciones; un cierre largo hace esperar a otro admin | Los cierres son raros (mensuales) y los hace un admin. La espera es corta y no hay deadlock (siempre global primero, fila después). Hay que probar en staging un cierre con miles de pedidos (paso manual) |
| R9 | **C7:** se reintenta el mismo cierre (mismo UUID) desde dos dispositivos | La idempotencia (`ya_existia` por `cerrado_por_id`) sigue **bajo** el lock global, que reemplaza al lock por id: la garantía de S-COM-09 se conserva |
| R10 | **C3:** pedidos que **ya** tienen una cantidad mayor que `MAX_CANTIDAD` o decimal, pendientes en algún dispositivo | `validarCantidadesItems` valida solo lo que cambió (`previos`), así que un pedido legacy no queda bloqueado al editar otra cosa. Los movimientos ya trabados en el servidor no se arreglan acá (fuera de alcance; se documenta) |
| R11 | **C4:** pedidos viejos cuyo `productoId` no coincide con ningún producto local pierden el botón Bulto en Facturación | Es el comportamiento seguro que pide S-BUL-08 (mejor sin botón que con el `bultoX` de un homónimo). El precio de lista sigue usando el fallback por nombre, así que no cambia nada más |
| R12 | **C1:** un editor o herramienta reescribe el archivo en otra codificación o cambia los finales de línea | Test `T-01` (escaneo de mojibake) y diff acotado a las líneas tocadas |
| R13 | **C9:** reintentos de importación | El stock inicial es un movimiento con UUID. Con el producto ya creado, la reimportación ignora el Stock, como hasta ahora, y avisa. El usuario lo carga con un Ajuste (ledger). Nunca se sincroniza un número |
| R14 | **C2:** cambiar el contrato de `onAnular` (de booleano a `{ ok, mensaje }`) | `Historial` es el único consumidor (`Comisiones.js:522`). Se ajusta en el mismo cambio |

Idempotencia y UUID: ningún cambio crea tablas, ni stores, ni IDs nuevos. Todos los flujos de stock siguen por `movimientosStock` con UUID y `pendingSync`. Ningún cambio agrega `delete`.

---

## 6. Fuera de alcance / decisión del dueño (NO se implementa)

| Tema | Por qué |
|---|---|
| **S-BUL-04**: confirmar o bloquear stock negativo al **editar** un pedido ya facturado (Facturación/Armado), y si el armador puede editar facturados | Cambia el flujo operativo: lo decide el dueño (advertir o bloquear según `STOCK_POLICY`) |
| **S-COM-19**: auto-alta "+ Agregar vendedor" sin PIN en la pantalla de ingreso | Decisión del dueño: quitar el botón o pedir el PIN del admin; `revoke insert` y un índice único por nombre |
| **S-COM-03**: los cierres se pueden leer con la anon key | Hay que elegir entre una RPC de lectura con PIN y Auth: cambia la arquitectura de lectura |
| **Supabase Auth** (002 paso 5): S-01, S-BUL-01, S-COM-06 | Es la única protección real del rol y de `pedidos`. Decisión de arquitectura |
| **S-COM-14**: el bloqueo por PIN se puede usar como DoS; PIN de admin de 6 o más dígitos | SQL de la 002 y política de PIN: decisión del dueño |
| **S-COM-22(1)**: login *fail-open* si falta la 002 PASO 1 | Cerrarlo dejaría a todos sin poder entrar si se publica antes de la 002. Depende del orden de despliegue que elija el dueño |
| **S-DEP-01** (xlsx desde el CDN) y **S-HDR-01** (CSP en modo enforce) | Cambios de dependencias e infraestructura |
| "Entregado" contra "A reparto"; comisiones de pedidos WEB; ajustes negativos; sesión de 12 h | Decisiones de negocio pendientes (veredicto 2022, paso 10) |
| Reactivar un vendedor desde la app | No está en el SPEC (hoy se hace por SQL) |
| Sugerencias menores no tomadas: `onversionchange` con reload (run1, obs. 3); que el PIN no se borre antes de validar en Configuración (2022, sug. 7); un test v4→v6 (2022, sug. 9) | Fuera del cierre acotado. Quedan para una próxima corrida |

---

## 7. Plan de pruebas (IDs de test)

Los títulos llevan el AC (para el gate `traceability`) y el hallazgo. Ningún test existente se relaja. Los tests que se **modifican** están marcados con (MOD) y mantienen o endurecen sus garantías.

| ID | Archivo | Tipo | Qué prueba |
|---|---|---|---|
| T-01 | `src/domain/__tests__/encoding.regla7.test.js` (nuevo) | Estático | "REGLA-7 AC-SEC-4 ningún .js de src tiene mojibake" |
| T-02 | `src/pages/__tests__/ConfiguracionAltas.test.js:136` (MOD) | Página | "AC-SEC-4 sin permisos muestra 'No tenés permisos para acceder a Configuración'" (texto exacto) |
| T-03 | `src/pages/__tests__/bultos.facturacion.test.js` o uno nuevo `facturacion.textos.test.js` | Página | "AC-SEC-4 Facturación sin permisos muestra 'Facturación' y 'No tenés permisos para facturar'" |
| T-04 | `src/domain/__tests__/comisiones.anulacion.ux.test.js` (nuevo) | Unit | "AC-COM-12 ayudaAnulacion": vacío, "ab", "  ab  ", 3 letras sin PIN, válido, más de 300 caracteres, procesando y entradas hostiles; coherente con `validarAnulacion` (el mismo motivo da el mismo veredicto) |
| T-05 | `src/pages/__tests__/comisiones.page.test.js` (casos nuevos) | Página | "AC-COM-12 con el botón deshabilitado se ve 'Escribí el motivo (mínimo 3 letras)'"; "...con motivo y sin PIN se ve 'Ingresá tu PIN de admin'"; "...el botón sigue llamándose 'Confirmar anulación'"; "...el error del servidor se muestra inline debajo del formulario, que queda abierto"; "...el error inline se limpia al editar el motivo" |
| T-06 | `src/domain/__tests__/security.bultos.test.js` (casos nuevos) | Unit | "AC-BUL-6 AC-SEC-2 S-BUL-06 cantidadTipeada": "0", "-3", "2,5", "1.000", "1000001", "abc", null; `sumarCantidades` en el límite; `validarCantidadesItems` con y sin `previos` (un legacy decimal sin cambios pasa) |
| T-07 | `src/pages/__tests__/bultos.armado.test.js` (caso nuevo) | Página | "AC-BUL-7 S-BUL-06 Armado: tipear 2000000 no cambia la cantidad; fusionar duplicados por encima del tope no guarda y avisa" |
| T-08 | `src/pages/__tests__/bultos.facturacion.test.js` (caso nuevo) | Página | "AC-BUL-7 AC-STK-8 S-BUL-06 Facturación: una cantidad tipeada mayor que MAX_CANTIDAD no se guarda ni genera movimiento" |
| T-09 | `src/pages/__tests__/bultos.pedido.test.js` (caso nuevo) | Página | "AC-BUL-6 S-BUL-06 Nuevo Pedido: una cantidad mayor que MAX_CANTIDAD no se toma; el blur restaura la última válida" |
| T-10 | `src/domain/__tests__/bultos.test.js` (casos nuevos) | Unit | "AC-BUL-1 S-BUL-08 productoParaBulto resuelve solo por id; un homónimo con otro id da null" |
| T-11 | `src/pages/__tests__/bultos.facturacion.test.js` (caso nuevo) | Página | "AC-BUL-1 S-BUL-08 un renglón sin match por id no muestra '+ Bulto' aunque exista un homónimo con bultoX; el precio de lista sigue apareciendo" |
| T-12 | `src/domain/__tests__/vendedores.test.js` (casos nuevos) | Unit | "AC-SEC-4 S-COM-18 vendedorDeSesion toma permiso/nombre/zona del servidor, ignora el permiso local, null si activo false, permiso inválido = 2, sin pin"; "decidirIngreso solo-local = permiso 2"; "interpretarFilaIngreso" (red, sin fila, inactivo, ok) |
| T-13 | `src/services/__tests__/vendedoresService.test.js` (casos nuevos) | Servicio (mock de supabase) | "AC-SEC-4 S-COM-18 ingresarConPin: PIN OK → lee la fila por el remoteId verificado → updateVendedor con los datos del servidor"; "falla la lectura → no entra"; "fila inactiva → MSG_DADO_DE_BAJA (AC-VEN-2)"; "sin la 004 → fallback de columnas (AC-VEN-5)"; "iniciarIngreso consultar → vendedor del servidor" |
| T-14 | `src/components/__tests__/SelectorVendedor.test.js` (casos nuevos) | Componente | "AC-SEC-4 S-COM-18 ataque A: local permiso 1, servidor 2 → seleccionarVendedor con permiso 2"; "ataque B: remoteId cambiado → la sesión tiene nombre y permiso del dueño del PIN"; "un solo-local con permiso 1 entra con permiso 2" |
| T-15 | `src/hooks/__tests__/useAppContext.test.js` (caso nuevo) | Hook | "AC-SEC-4 S-COM-18 después de entrar con los datos del servidor, recargar no vuelve a subir el permiso" (el registro local quedó actualizado) |
| T-16 | `src/domain/__tests__/vendedores.baja.test.js` (casos nuevos/MOD) | Unit | "AC-VEN-4 un admin activo sin PIN no cuenta como 'otro admin'"; "chequeoUltimoAdmin: degradar o borrar el PIN del último admin con PIN se frena; con otro admin con PIN pasa"; "interpretarGuardarVendedor mapea admin_sin_pin / ultimo_admin / vendedor_inexistente / vendedor_inactivo". Los fixtures de los tests de AC-VEN-4 existentes se ajustan solo si sus admins no tenían `tienePin`, y eso se documenta |
| T-17 | `src/services/__tests__/bajaVendedores.test.js` / `vendedoresService.test.js` (casos nuevos) | Servicio | "AC-VEN-4 S-COM-20 guardarVendedorAdmin no llama a la RPC si deja la base sin admin con PIN" |
| T-18 | `src/domain/__tests__/migracion004.test.js` (casos nuevos) | Estático SQL | "AC-VEN-4 admin_baja_vendedor cuenta solo admins activos con pin_hash" |
| T-19 | `src/domain/__tests__/migracion004.test.js` (casos nuevos) | Estático SQL | "AC-VEN-2 AC-VEN-4 S-COM-20 la 004 redefine admin_guardar_vendedor con la firma y los defaults de la 002":<br>- `verificar_pin` siempre, `return null` sin raise antes de autorizar y exige `activo`;<br>- lock `vendedores_baja` después de autorizar;<br>- `vendedor_inexistente` / `vendedor_inactivo` / `admin_sin_pin` / `ultimo_admin` después del lock y antes del insert/update;<br>- `search_path` fijo, `revoke public` + `grant`;<br>- sin `delete`;<br>- todo dentro de `begin/commit` y después del chequeo del PASO 1 |
| T-20 | `src/domain/__tests__/security.comisiones.iter2.test.js` (MOD, los 2 tests de S-COM-15) | Estático SQL | "AC-COM-16 S-COM-21 cerrar_comisiones toma UN lock global después de autorizar y antes de idempotencia/validaciones/insert; no quedan locks por pedido"; "AC-COM-12 S-COM-21 anular toma el lock global después de autorizar y antes del `for update` y de 'tiene_ajustes_vigentes'". Las aserciones de orden de los tests viejos **se conservan** y se aplican al lock global. Se agrega `count(pg_advisory_xact_lock) === 1` por función |
| T-21 | `src/domain/__tests__/security.comisiones.auditoria.test.js:132` (MOD, S-COM-09) | Estático SQL | "AC-COM-16 S-COM-09 S-COM-21 el lock global va antes del chequeo de idempotencia" (la misma garantía de orden que hoy, con la clave nueva) |
| T-22 | `src/pages/__tests__/comisiones.page.test.js` (caso nuevo) | Página | "AC-VEN-3 el selector 'Vendedor asignado' no ofrece dados de baja pero conserva al ya asignado" |
| T-23 | `src/pages/__tests__/listaPedidos.vendedores.test.js` (nuevo) | Página | "AC-VEN-3 'Asignar vendedor' en ListaPedidos no muestra dados de baja" |
| T-24 | `src/pages/__tests__/plantillas.page.test.js` (caso nuevo) | Página | "AC-PLA-6 AC-SEC-4 vendedor y armador no ven inputs de archivo ni 'Descargar plantilla Excel'" |
| T-25 | `src/domain/__tests__/plantillas.test.js` (casos nuevos) | Unit | "AC-PLA-5 AC-PROD-3 resumirEntradas cuenta stockFallido como creado y textoResumen lo avisa; sin el flag, el resultado es idéntico" |
| T-26 | `src/pages/__tests__/plantillas.page.test.js` (caso nuevo) | Página | "AC-PLA-3 AC-PROD-3 si falla ajustarStock el producto queda creado y el resumen dice 'creado SIN stock inicial' (no 'rechazado')" |

Al cerrar: `CI=true npx react-scripts test --watchAll=false`, `npx react-scripts build` y `node harness/gates/run-gates.mjs --out harness/reports/20261012-2106/gates.json`, todo en PASS. Tienen que dar `traceability` 74/74 y `coverage-domain` sin bajar del 100 % de líneas.

---

## 8. Supuestos (opción conservadora elegida)

1. **La 003 y la 004 no están aplicadas** en Supabase, según los reportes 2022/ven y lo que indica el orquestador. Si el dueño ya corrió alguna, los cambios C6/C7 **no** se editan in-place: van a una `005_consolidacion.sql` con los mismos `create or replace`. El implementador lo tiene que confirmar con el dueño **antes** de aplicar, no antes de codificar.
2. **"Mínimo 3 letras"** se interpreta como 3 caracteres después de trim (`MIN_MOTIVO = 3`, la misma regla que `validarAnulacion` y que el servidor). No se cuentan solo letras, porque eso desalinearía el cliente y el servidor.
3. **Admin "activo"** para AC-VEN-4 quiere decir `activo` **y con PIN**. Es más estricto que la letra del SPEC, pero evita quedarse sin nadie que pueda autorizar las RPC y que entre un admin sin clave.
4. Una **cantidad tipeada inválida** (mayor que `MAX_CANTIDAD`, 0, texto) **no cambia** la cantidad del renglón (queda la anterior) en vez de recortarla al tope. Es el mismo criterio que `sumarBulto`.
5. S-COM-18 se corrige **en el cliente** (se lee la fila después de verificar). No se agrega una RPC `ingresar` nueva, para no sumar una dependencia de migración al login. La solución definitiva sigue siendo Auth.
6. El mensaje global de error de la anulación se mantiene además del inline, por compatibilidad con el test existente.
7. No se toca `useAppContext.js`: el efecto que mezcla el registro local se neutraliza persistiendo la verdad del servidor en el login (C5).
