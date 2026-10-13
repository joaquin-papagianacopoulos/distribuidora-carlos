# Veredicto — RUN 20261007-run1 (re-revisión, iteración 4)

Rol: `revisor` (tech lead).

**Alcance:**
- Primera revisión: `git diff 213abbd..HEAD -- src/ supabase/ public/ package.json .env.production`.
- Re-revisión: `git diff b700f7e..HEAD` (commits `5a52cf3` y `bf8ea5f`). Lo leí con `--ignore-cr-at-eol`.

**Verificación propia:** volví a correr las dos cosas.
- `CI=true npx react-scripts test --watchAll=false` da **374 tests que pasan y 1 en skip** (20 suites). El skip es el límite conocido: sin autenticación en el servidor no se puede cerrar.
- `node harness/gates/run-gates.mjs --fast` da **todos los gates en PASS**.

**VEREDICTO: APROBADO**

Los 2 bloqueantes de la primera revisión están corregidos y tienen tests de regresión que fallarían si se reintrodujera el bug. Los no bloqueantes 3, 4, 7, 8, 9, 10, 11, 12 y 13 también se aplicaron. El 5 quedó resuelto a medias (ver más abajo). Lo que sigue abierto no bloquea el merge y queda como mejora.

---

## Bloqueantes de la primera revisión: verificación

### 1. Un dispositivo desactualizado pisaba con NULL los campos nuevos de clientes y productos → ✅ CORREGIDO

**Código:**
- `Configuracion.js:235-236` marca `extrasDirty: true` solo cuando se guarda desde el formulario de alta o edición. Productos: `Configuracion.js:248,251`.
- `syncService.js` `syncClientes` → `subirGrupos`:
  - Las filas con `extrasDirty || extrasPendientes` van con columnas nuevas, por `upsertTolerante`.
  - El resto va en **otro** `upsert`, solo con las columnas básicas. Así no se mezclan columnas en el mismo request.
  - Después de subir bien, `extrasDirty` se pone en `false` solo en las filas con extras.
  - El camino 23505 fila por fila usa la misma separación.
- `syncProductos` aplica la misma separación. La importación CSV y la búsqueda de imágenes suben solo lo básico.

**Tests** (`syncTolerante.test.js:257-319`):
- Un cliente reordenado desde "Orden", sin `extrasDirty`, sube `orden_entrega`/`dia_entrega` y **no** manda `codigo`, `cuit`, `ciudad`, etc.
- Un lote mixto genera 2 upserts (extras solo para los dirty, más uno básico).
- Después de subir, se limpia la marca y el siguiente guardado que no es del formulario sube solo lo básico.
- Un producto importado por CSV sube solo las columnas básicas.
- `downloadMaestros` no pisa un producto pendiente con `extrasDirty`.

### 2. Editar un producto generaba un ajuste de stock sin pedirlo → ✅ CORREGIDO

**Código:**
- `ProductoForm.js` fija `stockMostrado` con `useState(stockActual)` al abrir, y no cambia aunque el sync actualice la prop.
- Solo manda `stock` si el usuario cambió el campo (`cambioStock`); si no, manda `null`.
- `stockService.ajustarStock(..., { base })` calcula `nuevo − base`, no contra el ledger actual.

**Semántica:** si el usuario pasa de 10 a 12 mientras llegó una venta de −3, queda un ajuste de +2 y el stock final es 9. La venta no se pierde, que era el objetivo del ledger.

**Tests:**
- `ProductoForm.test.js:136-158`: sin tocar Stock, `onGuardar(producto, null, 10)` aunque la prop ya sea 7; al cambiar a 12, `(producto, 12, 10)`; en el alta, `(producto, n, 0)`.
- `stockService.test.js:372-389`: con `base`, el ajuste es `nuevo − base`; si `base` es igual al nuevo valor, no se registra nada; `base: 0` se respeta.

## No bloqueantes aplicados: lo revisé y está bien

- **3.** Se agregó `order('id')` como desempate en `pullDesde`.
- **4.** El cursor incremental tiene 5 minutos de solape. El upsert local es idempotente y `mergeRemotos` protege lo que está pendiente.
- **7.** `same` ahora incluye los campos nuevos y nunca da por igual un producto con `extrasDirty`.
- **8.** Un proveedor borrado en otro dispositivo se borra local. Hay guarda si el pull trae 0 filas, y no se toca lo que tiene `pendingSync`.
- **9.** En el camino fila por fila, un error que no es 23505 se relanza (test `AC-CLI-4 iter 4`).
- **10.** `onblocked` muestra un aviso y `onversionchange` cierra la conexión.
- **11.** La validación del PIN se recuerda 12 h en `localStorage` (`{id, exp}`). La seguridad contra alguien con DevTools es la misma que antes y la experiencia de uso es mucho mejor. "Cambiar" limpia la validación.
- **12.** El CHECK de CUIT pasó a `not valid` y se agregó la consulta de verificación de duplicados en la 001.
- **13.** Al editar un cliente viejo sin código, se sugiere uno.

## Observaciones que quedan (NO bloqueantes, para la próxima iteración)

1. **Sync completo en cada arranque** (`useAppContext.js`, `runSync({ full: true, reason: 'startup' })` → `syncStock({ full: true })`).
   - **Es aceptable hoy:** con el cursor con solape, el sync completo ya no hace falta para que los datos sean correctos. Solo cuesta tiempo y datos, y ese costo crece con el ledger (unos 500 movimientos por día → más de 100.000 en el año).
   - **Arreglo sugerido** (1 línea): `syncStock({ full: reason === 'manual' })`.
   - **Cuándo hacerlo:** antes de que `movimientos_stock` pase de unas ~20.000 filas, o si se nota lentitud al abrir la app.
2. **No bloqueante 5, resuelto a medias.** Facturar ahora controla solo los productos que ya tienen movimientos. Pero después de la **primera** factura de un producto sin inventario, ese producto queda en negativo y desde la segunda vuelve a pedir confirmación. La mitigación real es cargar el inventario el mismo día del deploy (paso manual 4).
3. **`db/index.js` `onversionchange`.** Pone `db = null` sin recargar. En una pestaña vieja, la siguiente operación reabre con la versión anterior y da `VersionError`. Conviene agregar `location.reload()`.
4. **Performance del ledger.** `rekeyMovimientosRef` y `aplicarStockPedido` leen todo el ledger (`getAll`) en cada guardado de pedido. Conviene usar el índice `ref` que ya existe.
5. **Carrera chica en `patchRegistros`.** Si el admin vuelve a editar desde el formulario justo entre el upsert y el patch, `extrasDirty` se pone en `false` aunque la fila quede pendiente. Esa edición se sube igual, pero sin columnas nuevas. Es poco probable. Para evitarlo, el patch tendría que limpiar la marca solo si `updatedAt` no cambió.
6. **CRLF → LF.** Agregar un `.gitattributes` (`* text=auto eol=lf`) para que `git blame` no se llene de ruido.

## Verificación manual de 3 AC al azar (primera revisión, sigue valiendo)

| AC | Test | Código | Resultado |
|---|---|---|---|
| AC-STK-5 | `stockService.test.js` (facturar dos veces no descuenta doble), `stock.test.js:80,88` | `domain/stock.js` `movimientosParaPedido`: emite solo el delta entre lo deseado y lo ya registrado, sobre las refs `pedido:` y `pedido-local:` | ✅ |
| AC-CLI-3 | `clientes.test.js:35-71`, `ClienteForm.test.js:118-139` | `validacion.js` `validarCuit`/`formatearCuit`. Lo verifiqué a mano: 20-12345678-6 → 148 mod 11 = 5 → dígito verificador 6 ✔. Coincide con el CHECK SQL | ✅ |
| AC-ING-4 | `stockService.test.js` (`' a-1 '` contra `A-1`), `stock.test.js:168` | `domain/stock.js` usa `claveUnica`. En el servidor lo respalda el índice único `(proveedor_id, lower(factura_proveedor))` | ✅ |

## Lo que ya estaba bien (primera revisión)

- **IndexedDB v3 → v4:** el upgrade es aditivo, con guardas `contains()`, y los datos existentes se conservan.
- **Ledger:**
  - Solo "Facturar" inicia el control de stock, así que no hay descuentos retroactivos en los pedidos legacy.
  - `markPedidoSynced` re-keyea las refs y se retienen las refs `pedido-local:*`.
  - Si falla el stock, el guardado del pedido no se corta.
- **Sync:** `syncStock` está aislado en try/catch y no bloquea los pedidos, y `upsertTolerante` + `extrasPendientes` funcionan aunque la 001 se corra tarde.
- **Seguridad:** RLS coherente con el cliente (DELETE de proveedores permitido y protegido por FK, ledger sin DELETE), la key ya no se loguea, `csvSafe` en la importación, headers configurados, sin sourcemaps y jspdf 4 con `applyPlugin`.

---

## Pasos manuales para el dueño

Hacerlos en este orden.

1. **Backup de Supabase.** En Dashboard → Database → Backups, bajar un backup (o hacer un `pg_dump`) de `clientes`, `productos`, `pedidos`, `vendedores`, `deudas` y `faltantes`.

2. **Correr `supabase/migrations/001_altas_y_stock.sql`** en el SQL Editor.
   - Antes, verificar. Si alguna consulta devuelve filas, hay que limpiarlas primero:
     ```sql
     select column_name from information_schema.columns
      where table_schema='public' and table_name='clientes' and column_name in ('codigo','cuit');
     -- si 'codigo' ya existía:
     select lower(codigo), count(*) from public.clientes where coalesce(codigo,'')<>'' group by 1 having count(*)>1;
     ```
     El CHECK de CUIT es `not valid`, así que no revalida filas viejas.
   - La migración es idempotente y transaccional. Al final, verificar que existan `proveedores`, `movimientos_stock`, `ingresos_mercaderia` y la vista `stock_actual`.

3. **Deploy del cliente nuevo.**
   - `npx react-scripts build` (sale sin `.map`) con el `.env` real en la máquina de build.
   - Borrar del hosting los `.map` viejos.
   - **Avisar a todos:**
     - Cierren y vuelvan a abrir la app (upgrade de IndexedDB a v4). Si queda otra ventana abierta, aparece un aviso para cerrarla.
     - Quien tenga PIN lo va a tener que escribir de nuevo una vez cada 12 h. Confirmar que todos lo recuerdan.
   - **Probar a mano:**
     - generar una boleta PDF y una lista de armado (jsPDF 4);
     - facturar un pedido;
     - revertirlo y ver que el stock vuelve;
     - dar de alta un proveedor y un ingreso de mercadería;
     - editar un cliente desde Configuración y reordenarlo desde "Orden" en otro celular, y ver que el código y el CUIT se mantienen.
   - Probar la CSP Report-Only en preview. Si la consola no muestra violaciones, cambiar `Content-Security-Policy-Report-Only` por `Content-Security-Policy` en `public/_headers`. Verificar que todos los subdominios tengan HTTPS (HSTS `includeSubDomains`).

4. **Cargar el inventario inicial el mismo día del deploy** (Configuración → Productos → Stock, o Stock → Ingreso de mercadería con una factura tipo "INVENTARIO-INICIAL"). Mientras falte, facturar un producto sin inventario lo deja en negativo y la siguiente factura de ese producto pide confirmación.

5. **`002_seguridad_recomendada.sql`, de a un paso, probando la app después de cada uno:**
   - Paso 0 y **paso 1** (PIN hasheado, anti-escalada), **paso 3** (sin DELETE ni TRUNCATE en las tablas críticas) y **paso 4** (integridad del ledger y políticas de proveedores por comando). No requieren cambios en el cliente.
   - **Paso 2 (ocultar `pin`): NO correrlo** hasta publicar un cliente que use `verificar_pin` / `tiene_pin` (`SelectorVendedor.js`, `useAppContext.js`). Si se corre antes, la app deja de pedir el PIN. Después del paso 2, **cambiar todos los PIN**.
   - Paso 5 (Supabase Auth) es una decisión de arquitectura pendiente. Sin eso, S-01, S-03 y S-14 siguen abiertos.
   - Si en algún momento corrió en producción la versión de la iteración 1, revisar una vez: `select count(*) from movimientos_stock where ref like 'pedido-local:%';`.

6. **xlsx (S-07):** `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (o la última versión publicada en cdn.sheetjs.com). Probar una importación .xlsx, sacar `xlsx` de `harness/gates/audit-baseline.json` (revisión 2026-11-07), volver a correr `node harness/gates/run-gates.mjs` y hacer deploy.
