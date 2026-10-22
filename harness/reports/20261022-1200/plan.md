# Plan — RUN 20261022-1200 (REQ-CON, REQ-DIR, REQ-FRB)

Pedido: `harness/pedidos/2026-10-22_LOTE-AJUSTES.md`. Lote chico, aditivo, sin tocar stock (no hay movimientos nuevos).

## 1. Qué existe hoy (verificado en el código)

| Tema | Estado actual | Consecuencia para los AC |
|---|---|---|
| Contacto del cliente | **No existe.** `CAMPOS_CLIENTE` (src/domain/clientes.js:19) tiene `telefono` = "Celular" y ningún campo de contacto. `contacto` solo existe en tienda (config / datos del checkout) | AC-CON-1: se agrega `contacto` (opcional). |
| Lista de clientes | `src/pages/Configuracion.js:862` arma una línea `codigo · direccion · telefono` | Se cambia a `... · contacto · celular`. |
| Plantilla Excel clientes | `COLUMNAS_PLANTILLA.clientes` se deriva de `CAMPOS_CLIENTE` (plantillas.js:94) y la importación recorre `CAMPOS_CLIENTE` | Insertar el campo antes de `telefono` alcanza para el orden; faltan `INFO_CLIENTE`, `TEXTO_CLIENTE` y alias. |
| PDF con celular | Ningún PDF imprime el celular del cliente (`pdfGen.js` no usa `telefono`) | AC-CON-2 (parte PDF): no aplica, se deja anotado. |
| Sync clientes | Extras via `clienteExtraToRemote` + `upsertTolerante` (cae a **legacy completo** si falta cualquier columna) | Riesgo de regresión, ver §5 R1: hace falta un escalón intermedio. |
| `precioAplicado` / REQ-PBU | **Ya implementado**: `src/domain/precios.js` (`precioAplicado`, `precioAplicadoRenglon`, `esPrecioManual`, `precioBaseRenglon`), `renglonNuevo` en bultos.js congela `precioOriginal/precioBultoOriginal/precioBultoX/precioPorBulto`; NuevoPedido, Facturación y Armado re-precian; el servidor (010) aplica la regla | FRB **no** necesita regla nueva; cierra huecos (abajo). |
| "Fraccionar" | No hay concepto propio: es un producto con `ventaPor='unidad'` y `bultoX>1` vendido por unidades sueltas. `renglonNuevo` no mira `ventaPor` → la regla ya aplica | Sin campo nuevo. |
| Hueco FRB-a | Renglones de **pedidos web** (`tienda_crear_pedido`, 010:449) traen `precioOriginal` y `precioPorBulto` pero **no** `precioBultoOriginal/precioBultoX` → `precioAplicadoRenglon` los trata como legacy: en Facturación, bajar 16→10 deja $800 y subir 10→16 deja $900 | Completar al aceptar (`armarItemsAceptar`). |
| Hueco FRB-b | `Facturacion.js:475` (destachar faltante) recrea el renglón sin precios de bulto | Usar el mismo completado. |
| Hueco FRB-c | PDF boleta (`pdfGen.js:283-293` + `filasBoleta` en gruposFactura.js:115) muestra `peso(i.precio)` sin marca, y "Total sin descuento" usa `precioOriginal` → el precio de bulto aparece como **descuento** (16 u.: "sin descuento $14.400 / TOTAL $12.800 / 11%") | Marca "x precio de bulto" y base de descuento = `precioBaseRenglon`. Ver Supuesto S3. |
| Dirección en tienda | `validarCheckout` (tienda.js:381) solo exige no vacía; el servidor (010:342) solo exige 1..160 chars. Botón de Checkout.js:109 solo se deshabilita mientras envía | AC-DIR-1/2 aplican tal cual. |
| Dirección en Nuevo pedido | **No hay campo de dirección en el pedido.** La dirección vive en el cliente (`direccion` = "Domicilio de entrega"); el alta rápida de cliente desde NuevoPedido.js:398 la crea vacía | AC-DIR-1 se reinterpreta (Supuesto S1). |
| Última migración | `018_pedidos_web_fecha.sql`; `tienda_crear_pedido` solo se define en 008 y 010 | Nueva: **019**. |

## 2. Modelo de datos

- **IndexedDB:** sin stores ni índices nuevos → **`DB_VERSION` queda en 12**. `clientes` es schemaless: `contacto` se agrega como propiedad opcional (registros viejos = `undefined` → `''`).
- **Supabase (019_ajustes_contacto_direccion.sql, idempotente, sin drop):**
  1. `alter table public.clientes add column if not exists contacto text;` (grants a nivel tabla ya cubren la columna; `clientes` no tiene select por columnas).
  2. `create or replace function public.direccion_exacta(t text) returns boolean language sql immutable` — espejo de la función JS.
  3. `create or replace function public.tienda_crear_pedido(p jsonb)` = **copia literal de la versión 010** + `or not public.direccion_exacta(v_contacto->>'direccion')` en el chequeo de contacto (010:339-349), mismo `motivo:'invalido'`. Re-emitir `revoke/grant execute` como 010:635-637. Sin cambios en la regla de precios.
- **Mapeo campo:**

| UI | Interno | Remoto |
|---|---|---|
| "Nombre de contacto" (cliente) | `cliente.contacto` | `clientes.contacto` |
| "Celular" (sin cambio) | `cliente.telefono` | `clientes.telefono` |
| "Dirección de entrega" (Nuevo pedido) | `cliente.direccion` (legacy) | `clientes.direccion` |
| "Dirección de entrega *" (tienda) | `contacto.direccion` del payload | `pedidos.web_contacto->>'direccion'` (privado, ya existe) |
| marca "x precio de bulto" | `item.precioPorBulto` (ya existe) | dentro de `pedidos.items` (ya existe) |

## 3. Funciones puras de dominio

`src/domain/direccion.js` (nuevo)
- `direccionExacta(texto) -> { ok: boolean, valor: string, motivo: null|'vacia'|'corta'|'sin_numero'|'sin_calle' }` — normaliza espacios (trim + colapsa); `<5` chars → `corta`; necesita al menos una letra Unicode (`\p{L}`, acepta tildes/ñ) **y** (un token numérico o `s/n` case-insensitive como token). Solo número → `sin_calle`; solo calle → `sin_numero`. (AC-DIR-3)
- `mensajeDireccion(motivo) -> string` — texto rioplatense para el campo (AC-DIR-1).
- `FIXTURES_DIRECCION` exportado (array `[texto, ok]`) para usar el mismo set en el test de dominio y en el test de paridad con el SQL (AC-DIR-2).

`src/domain/clientes.js` (cambios)
- `CAMPOS_CLIENTE`: insertar `{ key: 'contacto', label: 'Nombre de contacto' }` **inmediatamente antes** de `telefono` (AC-CON-1/2).
- `clienteVacio` y `validarCliente`: `contacto: texto(form.contacto, 80)` (opcional, sin error).
- `clienteExtraToRemote`/`clienteExtraFromRemote`: `contacto` (lectura tolerante ya resuelta por `pick`).
- `resumenCliente(c) -> string` — `"codigo · direccion · contacto · celular"` omitiendo vacíos (lista, AC-CON-1).
- `sinContacto(row) -> row` y `nombraColumnaContacto(error) -> boolean` para el escalón de sync (R1).

`src/domain/precios.js` (cambios, REQ-FRB)
- `completarPreciosBulto(item, producto) -> item` — si el renglón no tiene `precioBultoOriginal`, no es manual (`esPrecioManual`), el producto tiene `precioBulto>0` y `bultoX` válido, y `precioOriginal ?? precio` del renglón == `producto.precio` (precios sin cambios desde el pedido): congela `precioOriginal`, `precioBultoOriginal`, `precioBultoX` y devuelve `precioAplicadoRenglon(...)`. Si no se cumple: devuelve el mismo objeto (legacy intacto). (AC-FRB-1/2)
- `totalesBoleta(items) -> { total, totalSinDescuento, descuento, descuentoPct }` — base = `precioBaseRenglon(i)` (el precio de bulto no cuenta como descuento; el manual sí). Extrae el cálculo de pdfGen.js:287-293. (AC-FRB-2/3, S3)

`src/domain/gruposFactura.js` (cambio)
- `filasBoleta`: filas `item`/`detalle` con `precioPorBulto===true` agregan `porBulto: true` y el nombre lleva sufijo `" (x precio de bulto)"`; `precioTexto`/`subtotal` sin cambios (AC-FRB-2).

`src/domain/tienda.js` (cambio)
- `validarCheckout`: `direccion` usa `direccionExacta` (error = `mensajeDireccion`) (AC-DIR-1).

`src/domain/pedidosWeb.js` (cambio)
- `armarItemsAceptar`: mapear cada renglón con `completarPreciosBulto(it, productosById.get(...))` antes de `congelarBultosItems` (hueco FRB-a).

## 4. Archivos, en orden

1. `src/domain/direccion.js` (nuevo) — REQ-DIR (AC-DIR-3).
2. `src/domain/clientes.js` — REQ-CON (AC-CON-1).
3. `src/domain/plantillas.js` — `INFO_CLIENTE.contacto`, `TEXTO_CLIENTE.contacto: 80`, alias `contacto`, `nombredecontacto`, `nombrecontacto`, `personadecontacto` — REQ-CON (AC-CON-2). Excel viejo sin la columna: `contacto` del existente se conserva por el loop de `CAMPOS_CLIENTE`.
4. `src/sync/syncService.js` — `syncClientes`: grupo "extras" con escalones `[completo, sin contacto, legacy]` (reusar `upsertEscalonado` o encadenar `nombraColumnaContacto`); `extrasPendientes=true` solo si se cayó a algún escalón. Pull: sin cambios (ya tolerante) — REQ-CON (AC-CON-1).
5. `src/components/ClienteForm.js` — se dibuja desde `CAMPOS_CLIENTE`; solo verificar que no haya orden hardcodeado — AC-CON-1.
6. `src/pages/Configuracion.js` (~l.862) — usar `resumenCliente`; buscador (l.484) también matchea `contacto` — AC-CON-1.
7. `src/domain/precios.js` — `completarPreciosBulto`, `totalesBoleta` — REQ-FRB.
8. `src/domain/gruposFactura.js` — sufijo "x precio de bulto" — AC-FRB-2.
9. `src/utils/pdfGen.js` (l.283-293) — usar `totalesBoleta`; nada más del layout — AC-FRB-2/3.
10. `src/domain/pedidosWeb.js` — `armarItemsAceptar` + `completarPreciosBulto` — AC-FRB-1.
11. `src/pages/Facturacion.js` (l.464-477) — destachar faltante con `completarPreciosBulto(renglon, producto)` — AC-FRB-1.
12. `src/domain/tienda.js` — `validarCheckout` — AC-DIR-1.
13. `src/tienda/Checkout.js` — validar en vivo (`direccionExacta` en `onChange`/`onBlur`), botón `disabled` si la dirección no es exacta, error bajo el campo (`aria-describedby`) — AC-DIR-1.
14. `src/pages/NuevoPedido.js` — campo "Dirección de entrega" precargado con `cliente.direccion` al elegir cliente; error en vivo; botón Guardar `disabled` si no es exacta; al guardar: si difiere de la del cliente → `updateCliente({...cliente, direccion})` (pendingSync); cliente nuevo → `addCliente({..., direccion})`; incluir la dirección en el borrador (`draftKey`) — AC-DIR-1 (S1).
15. `supabase/migrations/019_ajustes_contacto_direccion.sql` — AC-CON-1, AC-DIR-2.
16. Tests (§6) y `harness/SPEC.md`: anotar en REQ-DIR/REQ-FRB las aclaraciones S1-S3 (no cambiar AC ids).

## 5. Riesgos offline / multidispositivo

- **R1 (regresión de sync clientes):** sumar `contacto` a `clienteExtraToRemote` hace que, sin la 019, `upsertTolerante` caiga a legacy y **dejen de subir** `codigo`, `cuit`, etc. que hoy suben. Mitigación: escalón intermedio sin `contacto` (paso 4) + test. El aviso de consola nombra la 019.
- **R2 (contacto pisado con null):** un dispositivo viejo (sin el campo) no manda la clave `contacto` → el `ON CONFLICT` no la toca. Solo viaja en filas con `extrasDirty/extrasPendientes` (mismo patrón que AC-COMR-1). En el lote, si una fila trae `contacto` y otra no, PostgREST manda null a la otra: por eso `clienteExtraToRemote` **siempre** incluye la clave en filas de extras (valor real o null coherente con lo editado), igual que hoy con `codigo`.
- **R3 (dirección editada desde Nuevo pedido en dos dispositivos):** LWW sobre `clientes.direccion` por el upsert básico, igual que hoy con "Orden". Aceptable: es el mismo dato; se limpia solo el `pendingSync` de los ids subidos (patrón existente). No se toca ningún otro campo del cliente.
- **R4 (pedidos web viejos con precios desactualizados):** `completarPreciosBulto` solo congela si el precio unitario del renglón coincide con el del producto actual; si no, deja el renglón como legacy (no re-precia con precios nuevos).
- **R5 (servidor vs. cliente en dirección):** misma regla en JS y SQL; test de paridad con `FIXTURES_DIRECCION` (ver §6). Idempotencia de `tienda_crear_pedido` intacta (el chequeo de `idempotencia` va antes que la validación de contacto en 010: un reintento de un pedido ya creado sigue devolviendo `repetido`).
- **R6 (copia de `tienda_crear_pedido`):** reescribir el cuerpo entero es frágil. El implementador copia 010 textual y solo agrega la condición; un test compara el SQL de 019 contra 010 (mismas líneas salvo el agregado).
- Stock: este lote **no** escribe movimientos ni números de stock.
- IDs: no hay tablas nuevas (no aplica `crypto.randomUUID`); clientes siguen con su id legacy.

## 6. Plan de pruebas (Jest, `CI=true npx react-scripts test --watchAll=false`)

| AC | Test | Tipo |
|---|---|---|
| AC-CON-1 | `domain/__tests__/clientes.test.js`: índice de `contacto` = índice de `telefono` − 1; `validarCliente` recorta a 80 y es opcional; to/fromRemote con y sin columna; `resumenCliente` (orden, vacíos) | unidad |
| AC-CON-1 | `services/__tests__/syncTolerante.test.js`: PGRST204 nombrando `contacto` → reintenta sin `contacto` y **sí** sube `codigo/cuit`; `extrasPendientes` queda true; fila básica no lleva la clave | servicio con mock Supabase |
| AC-CON-1 | `components/__tests__/ClienteForm.test.js` + test de Configuracion (lista): "Nombre de contacto" aparece antes de "Celular" | UI (RTL) |
| AC-CON-2 | `domain/__tests__/plantillas.test.js`: encabezados con "Nombre de contacto" antes de "Celular"; Excel viejo sin la columna importa y conserva el contacto existente; alias "Contacto" | unidad |
| AC-DIR-3 | `domain/__tests__/direccion.test.js`: vacío, espacios, solo calle, solo número, "s/n"/"S/N", tildes/ñ, <5 chars, "Av. Siempreviva 742" | unidad (table-driven con `FIXTURES_DIRECCION`) |
| AC-DIR-1 | `domain/__tests__/tienda.checkout.test.js` (dirección no exacta → error); `tienda/__tests__/checkout.direccion.test.js` (botón disabled + mensaje) | unidad + UI |
| AC-DIR-1 | `pages/__tests__/nuevoPedido.direccion.test.js`: cliente sin dirección → botón disabled; completar → guarda pedido y `updateCliente` con la dirección; cliente nuevo → `addCliente` con dirección | UI con mocks de db |
| AC-DIR-2 | `domain/__tests__/migracion019.test.js`: lee el SQL; existe `direccion_exacta`, `tienda_crear_pedido` la invoca, cuerpo = 010 + condición, `revoke/grant` presentes, sin `drop`; regex SQL extraída del archivo evaluada en JS contra `FIXTURES_DIRECCION` (paridad) | estático |
| AC-DIR-2 | Pedidos viejos/editar en Facturación no validan dirección (test de regresión en Facturación existente sigue verde) | regresión |
| AC-FRB-1 | `domain/__tests__/precios.test.js`: `completarPreciosBulto` (renglón web 16 u. → baja a 10 → $900; 10 → 16 → $800; manual intacto; precio cambiado → intacto; sin bulto → intacto) | unidad |
| AC-FRB-1 | `domain/__tests__/pedidosWeb.test.js`: `armarItemsAceptar` deja `precioBultoOriginal/X` | unidad |
| AC-FRB-1/2 | `pages/__tests__/precioMinimoStock.facturacion.test.js`: pedido web aceptado, cambiar cantidad cruza el bulto; destachar faltante conserva precio de bulto | UI |
| AC-FRB-2/3 | `domain/__tests__/gruposFactura.test.js`: sufijo "x precio de bulto" solo con `precioPorBulto`; `totalesBoleta` con el ejemplo (10 u. → 9.000 sin descuento; 16 u. → 12.800, descuento 0; manual 16 u. a $700 → descuento sobre base 800) | unidad |
| AC-FRB-3 | `utils/__tests__/pdfBoleta011.test.js` (o nuevo `pdfFrb.test.js` con el mismo mock de jsPDF): boleta 16 u. imprime "x precio de bulto", "$12.800" y no imprime "Total sin descuento" | PDF smoke |

Gates: `node harness/gates/run-gates.mjs` + `npx react-scripts build`.

## 7. Supuestos (opción conservadora)

- **S1 (AC-DIR-1, Nuevo pedido):** el pedido interno no tiene dirección propia; la "dirección de entrega" es `cliente.direccion` ("Domicilio de entrega", que ya usan reparto/orden). Nuevo pedido la muestra/edita y la guarda en el cliente. No se agrega columna a `pedidos` (evita otro escalón en `conFallbackEntrega`). `ClienteForm` **no** pasa a exigir dirección exacta (no bloquear la edición de clientes viejos); solo bloquea al enviar un pedido nuevo.
- **S2 (AC-DIR-2):** "pedidos y clientes viejos no se ven afectados" = no se re-validan pedidos existentes ni se migra ningún dato; editar en Facturación/Armado no exige dirección. El vendedor sí debe corregir la dirección de un cliente viejo la próxima vez que le carga un pedido nuevo.
- **S3 (AC-FRB-2):** el precio de bulto deja de mostrarse como "descuento" en la boleta (base = `precioBaseRenglon`). Es un cambio visible respecto de hoy; **confirmar con el dueño** en el reporte. Los descuentos manuales del admin se siguen mostrando igual.
- **S4:** "Calle 5" o "Ruta 9" se aceptan (tienen letra y número); no hay geocodificación.
- **S5 (AC-CON-2, PDF):** hoy ningún PDF imprime el celular del cliente; no se agrega uno nuevo.
- **S6:** label "Nombre de contacto", máx. 80 caracteres, sin validación de formato.
