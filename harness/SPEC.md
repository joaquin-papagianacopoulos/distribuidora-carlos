# SPEC — Cambios pedidos por el cliente (Distribuidora Jorge)

> Fuente de verdad funcional para todos los agentes del harness.
> Cada requerimiento tiene un ID (`REQ-*`) y criterios de aceptación (`AC-*`) verificables.
> Ningún agente puede dar por terminado un REQ si alguno de sus AC no está cubierto por un test.

## Decisiones de negocio ya tomadas

| Tema | Decisión |
|---|---|
| Momento de descuento de stock | **Al facturar** (pasar el pedido a `facturado`). Revertir a pendiente o borrar un pedido facturado devuelve el stock. Editar un pedido facturado ajusta la diferencia. |
| Stock insuficiente al facturar | Configurable (`STOCK_POLICY` en `src/domain/stock.js`): `advertir` (default: pide confirmación) o `bloquear`. |
| Modelo de stock | **Libro de movimientos** (ledger) inmutable con IDs UUID. El stock de un producto = suma de sus movimientos. Nunca se sincroniza un "número de stock" pisándolo (evita pérdidas entre dispositivos offline). |
| Compatibilidad | Los campos internos existentes se conservan (`nombre`, `direccion`, `telefono`, `precio`, `categoria`) y se mapean a las etiquetas que pide el cliente. Nada de lo que hoy funciona (pedidos, armado, facturación, deudas, orden de entrega) puede romperse. |

---

## REQ-CLI — Alta de clientes

Campos (etiqueta UI → campo interno → columna Supabase):

| Etiqueta | Campo | Columna | Reglas |
|---|---|---|---|
| Código cliente | `codigo` | `codigo` | Obligatorio, único (case-insensitive) |
| Razón social | `nombre` | `nombre` | Obligatorio |
| Domicilio de entrega | `direccion` | `direccion` | Obligatorio |
| Ciudad | `ciudad` | `ciudad` | |
| Código postal | `codigoPostal` | `codigo_postal` | Alfanumérico (CPA) 4–8 chars |
| Provincia | `provincia` | `provincia` | Lista de las 24 jurisdicciones |
| Zona | `zona` | `zona` | |
| País | `pais` | `pais` | Default "Argentina" |
| Tipo de IVA | `tipoIva` | `tipo_iva` | Responsable Inscripto / Monotributo / Exento / Consumidor Final / No Responsable |
| CUIT | `cuit` | `cuit` | 11 dígitos con dígito verificador válido (obligatorio salvo Consumidor Final) |
| Celular | `telefono` | `telefono` | 8–15 dígitos |
| Vendedor | `vendedor` | `vendedor` | Lista de vendedores |
| Cobrador | `cobrador` | `cobrador` | |
| ~~Comisión~~ | `comision` | `comision` | **Eliminado del formulario por REQ-COMR (AC-COMR-1)**. El dato viejo se conserva en IndexedDB y en Supabase, pero no se muestra ni se usa |
| Fecha de alta | `fechaAlta` | `fecha_alta` | Default hoy (YYYY-MM-DD) |
| Tipo de cliente | `tipoCliente` | `tipo_cliente` | |
| Rubro | `rubro` | `rubro` | |

- **AC-CLI-1** El formulario de alta/edición muestra exactamente esos **16** campos con esas etiquetas (sin Comisión — modificado por AC-COMR-1, 2026-10-12).
- **AC-CLI-2** No se puede guardar con código, razón social o domicilio vacíos; se muestra el error por campo.
- **AC-CLI-3** CUIT inválido (dígito verificador) se rechaza; se guarda normalizado `XX-XXXXXXXX-X`.
- **AC-CLI-4** Código de cliente duplicado se rechaza.
- **AC-CLI-5** Los campos nuevos se suben a Supabase y se bajan en otros dispositivos (sync), tolerando que la columna todavía no exista.
- **AC-CLI-6** Los clientes viejos (sin campos nuevos) siguen funcionando en pedidos/orden de entrega.

## REQ-PROV — Alta de proveedores

| Etiqueta | Campo | Reglas |
|---|---|---|
| Código | `codigo` | Obligatorio, único |
| Descripción | `descripcion` | Obligatorio |

- **AC-PROV-1** ABM de proveedores en Configuración → Proveedores.
- **AC-PROV-2** Código duplicado se rechaza.
- **AC-PROV-3** No se puede borrar un proveedor que tenga productos asociados.
- **AC-PROV-4** Sincroniza con tabla `proveedores` (PK UUID).

## REQ-PROD — Alta de productos

| Etiqueta | Campo | Reglas |
|---|---|---|
| Código | `codigo` | Obligatorio, único |
| Descripción | `nombre` | Obligatorio |
| Rubro | `categoria` | Selector de rubros existentes + "Agregar rubro nuevo…", normalizado (AC-COMR-3/4). Base del % de comisión (REQ-COMR) |
| Proveedor | `proveedorId` | Debe existir |
| Costo final | `costoFinal` | ≥ 0 |
| Descuento 1 | `descuento1` | % 0–100 |
| Descuento 2 | `descuento2` | % 0–100 |
| % Ganancia | `ganancia` | ≥ 0 |
| Precio venta 1 | `precio` | Calculado, editable |
| Precio venta 2 | `precioVenta2` | Manual, ≥ 0 |
| Bulto x | `bultoX` | Entero ≥ 1 |
| Mínimo venta | `minimoVenta` | Entero ≥ 1 |
| Stock | (ledger) | Al alta = stock inicial; al editar = ajuste |

- **AC-PROD-1** Fórmula: `costoNeto = costoFinal × (1 − d1/100) × (1 − d2/100)`; `precioVenta1 = costoNeto × (1 + ganancia/100)`, redondeado a 2 decimales. Se recalcula al cambiar costo/descuentos/ganancia (si el usuario no lo pisó a mano).
- **AC-PROD-2** El `precio` que usan los pedidos es Precio venta 1.
- **AC-PROD-3** Stock inicial genera un movimiento `inicial`; cambiar el stock en edición genera un movimiento `ajuste` por la diferencia.
- **AC-PROD-4** Al cargar un pedido se muestra el stock disponible y se advierte si la cantidad supera el stock o no llega al mínimo de venta.
- **AC-PROD-5** La importación CSV/XLSX existente sigue funcionando.

## REQ-ING — Ingreso de mercadería al stock

Cabecera: **Factura proveedor**, **Proveedor**. Renglones: **Código producto**, **Descripción**, **Stock actual**, **Ingreso**, **Stock total** (= actual + ingreso, calculado).

- **AC-ING-1** Pantalla "Stock → Ingreso de mercadería" (solo admin).
- **AC-ING-2** Buscar producto por código o descripción; se completan descripción y stock actual.
- **AC-ING-3** Ingreso debe ser entero > 0; no se permite el mismo producto dos veces en el comprobante.
- **AC-ING-4** Factura proveedor + proveedor obligatorios; la misma factura del mismo proveedor no se puede ingresar dos veces.
- **AC-ING-5** Al confirmar se graban 1 cabecera + N movimientos `ingreso` y el stock de cada producto sube exactamente en `ingreso`.
- **AC-ING-6** Historial de ingresos consultable.

## REQ-STK — Control de stock

- **AC-STK-1** Stock(producto) = Σ movimientos(producto).
- **AC-STK-2** Al pasar un pedido a `facturado` se generan movimientos `venta` (negativos) por cada ítem.
- **AC-STK-3** Revertir a pendiente / borrar un pedido facturado → movimientos compensatorios; stock vuelve al valor previo.
- **AC-STK-4** Editar un pedido facturado → solo se registra la diferencia.
- **AC-STK-5** Operación idempotente: facturar dos veces (o reintentar sync) no descuenta doble.
- **AC-STK-6** Stock insuficiente: según `STOCK_POLICY`.
- **AC-STK-7** Pantalla de stock con listado, filtro, alerta de stock bajo (≤ mínimo de venta) y movimientos por producto.
- **AC-STK-8** Funciona offline; los movimientos se suben al volver la conexión sin duplicarse (upsert por UUID).

## REQ-SEC — Seguridad (no funcional)

- **AC-SEC-1** Sin secretos en el código ni en logs (no loguear la anon key).
- **AC-SEC-2** Toda entrada de formulario se valida y normaliza en la capa de dominio (no solo en la UI).
- **AC-SEC-3** Exportaciones/importaciones CSV protegidas contra *formula injection*.
- **AC-SEC-4** Las pantallas nuevas respetan los roles (admin=1, vendedor=2, armador=3).
- **AC-SEC-5** Migración SQL con RLS habilitado en las tablas nuevas.
- **AC-SEC-6** Reporte de auditoría con hallazgos priorizados (crítico/alto/medio/bajo) y remediación.



---

## REQ-BUL — Botón "Bulto" al cargar productos en un pedido

Contexto: el producto ya tiene el campo **Bulto x** (`bultoX`, cuántas unidades trae el bulto).

| Decisión | Valor |
|---|---|
| Pantallas | **Pedido** (carga del vendedor), **Facturación** (editar pedido) y **Armado** |
| Qué suma el botón | `bultoX` unidades por cada toque (se acumula sobre la cantidad que ya tenga el renglón) |
| Productos sin bulto | Si `bultoX` es 1 o no está cargado, el botón no se muestra |

- **AC-BUL-1** En los renglones de las tres pantallas, un producto con `bultoX > 1` muestra un botón "+ Bulto (x N)", donde N = `bultoX`. Con `bultoX` ≤ 1 o vacío, no aparece.
- **AC-BUL-2** Cada toque suma exactamente `bultoX` a la cantidad del renglón: con bulto x12, tocar 3 veces sobre un renglón en 0 deja 36; sobre un renglón con 5 deja 41.
- **AC-BUL-3** Hay un botón "− Bulto" que resta `bultoX` sin bajar de 0 unidades (si quedaría en 0 o menos, se comporta como hoy al vaciar la cantidad: el renglón no se borra solo).
- **AC-BUL-4** El renglón muestra el desglose: "36 u. = 3 bultos" o "41 u. = 3 bultos + 5 u.". El desglose se calcula con el `bultoX` actual del producto.
- **AC-BUL-5** El cálculo (sumar/restar bultos, desglose) es una función pura en `src/domain/` con tests, incluyendo `bultoX` decimal, negativo, texto o ausente (se trata como "sin bulto").
- **AC-BUL-6** Los avisos existentes siguen funcionando con la cantidad resultante: mínimo de venta y stock disponible (AC-PROD-4).
- **AC-BUL-7** En Facturación y Armado, sumar bultos a un pedido ya facturado ajusta el stock solo por la diferencia (mismo mecanismo de AC-STK-4). En Armado, el registro de lo que cambió el armador (`armadoLog`) refleja el cambio de cantidad.
- **AC-BUL-8** Los botones respetan los permisos actuales de cada pantalla (el vendedor solo en Pedido; el armador en Armado; el admin en las tres).
- **AC-BUL-9** (decisión del dueño, 2026-10-08) Si el renglón todavía tiene la unidad que se pone sola al agregar el producto (nadie tocó la cantidad), el primer "+ Bulto" **reemplaza** esa unidad: con bulto x12 queda en 12, no en 13. Los toques siguientes suman (24, 36…). Si el usuario ya escribió o cambió la cantidad a mano (aunque haya puesto 1), "+ Bulto" suma como en AC-BUL-2. Aplica en las tres pantallas.

---

## REQ-COM — Cierre de comisiones (dashboard para admin)

| Decisión | Valor |
|---|---|
| Base de cálculo | Pedidos **facturados y entregados** dentro del período |
| "Entregado" | La app hoy no tiene esa marca (solo "A reparto"). Se agrega una marca **Entregado** al pedido (ver AC-COM-1). **⚠ A confirmar con el dueño** si alcanza con "A reparto" |
| Período | Rango de fechas elegido por el admin; se usa la **fecha del pedido** |
| % de comisión | ~~El de la ficha del cliente~~ → **Reemplazado por REQ-COMR**: % por vendedor y por rubro del producto, por renglón. Se congela al momento del cierre. Los cierres viejos conservan el modelo por cliente |
| A quién le corresponde | Al **vendedor de la ficha del cliente**. Si el pedido lo cargó otro vendedor, el admin decide: todo a uno, todo al otro, o dividir |
| Cierre | Por período: se revisa, se confirma y queda guardado e inmodificable. Un pedido cerrado no vuelve a contar en otro cierre |

### Marca de entregado
- **AC-COM-1** En Facturación y en Orden de entrega, un pedido facturado tiene un botón "Marcar entregado" / "Desmarcar". Guarda `entregado`, `entregadoAt` y `entregadoPor`, se sincroniza con Supabase (columnas nuevas, tolerando que no existan todavía, como AC-CLI-5) y no modifica `estado` ni el stock.

### Dashboard
- **AC-COM-2** Nueva sección "Comisiones" solo para admin (AC-SEC-4). Un vendedor o armador no la ve ni puede entrar.
- **AC-COM-3** El admin elige el período (por defecto, el mes en curso). Cuentan solo pedidos `facturado` + `entregado`, no borrados/cancelados, con fecha dentro del rango y que **no** pertenezcan a un cierre vigente.
- **AC-COM-4** *(Reemplazado por AC-COMR-9; vale solo para cierres viejos con `modelo: 'cliente'`)* Comisión del pedido = total del pedido × % de comisión del cliente / 100, redondeado a 2 decimales. Cliente sin % cargado → comisión 0 y aviso "cliente sin % de comisión".
- **AC-COM-5** Resumen por vendedor: cantidad de pedidos, cantidad de clientes, total vendido y total de comisión. Al tocar un vendedor se ve el detalle por cliente y por pedido.
- **AC-COM-6** Avisos visibles arriba del dashboard, con contador: (a) pedido cargado por un vendedor distinto al de la ficha del cliente, (b) cliente sin vendedor asignado en la ficha, (c) ~~cliente sin % de comisión~~ → reemplazado por (c1)/(c2) de AC-COMR-11, (d) pedidos facturados del período sin marcar como entregados (informativo, no se cuentan).

### Asignación cuando el pedido lo cargó otro vendedor
- **AC-COM-7** Por defecto la comisión va al vendedor de la ficha. En los pedidos con aviso (a), el admin puede elegir: 100 % al vendedor de la ficha, 100 % al que cargó el pedido, o **dividir** con un % para cada uno (la suma tiene que dar 100; por defecto 50/50).
- **AC-COM-8** Un cliente sin vendedor en la ficha no se puede cerrar hasta que el admin asigne la comisión de sus pedidos a un vendedor (o la marque "sin comisión").
- **AC-COM-9** Las asignaciones se guardan como borrador del período (no se pierden al salir de la pantalla) hasta confirmar el cierre.
- **AC-COM-17** (decisión del dueño, 2026-10-08) Cada pedido de "Pedidos para asignar" tiene un botón **"Confirmar asignación"**, habilitado solo si la asignación elegida es válida (vendedor elegido, "sin comisión", o división que suma 100). Al confirmarla, ese pedido deja de contar en los avisos (a) y (b) de AC-COM-6 y su tarjeta queda resumida ("Asignado a X ✓") con un botón **Editar**. Si se cambia la asignación después de confirmarla, vuelve a pendiente y vuelve a contar en el aviso. La confirmación se guarda en el borrador del período (AC-COM-9). No cambia el cálculo de comisiones ni las reglas de AC-COM-8.

### Cierre
- **AC-COM-10** "Cerrar comisiones" pide confirmación mostrando los totales por vendedor. Al confirmar se graba un **cierre** (UUID) con: período, fecha, admin que cerró, y el detalle congelado por vendedor → cliente → pedido (total, %, comisión, asignación/división).
- **AC-COM-11** Un cierre confirmado no se puede editar. Los pedidos incluidos quedan marcados con el id del cierre y no vuelven a aparecer en otro período.
- **AC-COM-12** El admin puede **anular** un cierre indicando un motivo obligatorio. Queda registrado (quién, cuándo, motivo) y sus pedidos vuelven a estar disponibles. Un cierre anulado se sigue viendo en el historial, marcado como anulado.
- **AC-COM-13** Si un pedido ya cerrado cambia después (se edita el total, se revierte a pendiente o se borra), el dashboard lo muestra como **ajuste pendiente** con la diferencia de comisión, para incluirla en el próximo cierre.
- **AC-COM-14** Historial de cierres con sus totales, y exportación a PDF de un cierre (resumen por vendedor + detalle). El PDF usa el mismo generador de la app (`pdfGen`).
- **AC-COM-15** Cálculos, filtros, divisiones y validaciones (suma = 100 %, redondeos, montos negativos/NaN) son funciones puras en `src/domain/comisiones.js` con tests.
- **AC-COM-16** Persistencia offline-first como el resto: store IndexedDB nuevo con id UUID, sincronización por upsert y migración `supabase/migrations/003_comisiones.sql` con RLS y sin política de borrado para los cierres. Dos admins cerrando el mismo período desde dos dispositivos no puede dejar pedidos contados en dos cierres vigentes (restricción única en Supabase o validación equivalente).

---

## REQ-VEN — Baja de vendedores (bug: el botón de borrar no anda)

Causa (2026-10-12): el botón de Configuración borraba el vendedor solo de IndexedDB; Supabase lo seguía teniendo y el próximo pull lo volvía a bajar. Además la 002 (PASO 3) revoca `delete` sobre `vendedores` a anon, y borrar de verdad rompería el historial (pedidos y cierres de comisiones referencian al vendedor por nombre).

| Decisión | Valor |
|---|---|
| Tipo de baja | **Baja lógica** (`activo = false`), nunca `delete` en Supabase (regla dura 6) |
| Quién | Solo admin, con su PIN, vía RPC (mismo mecanismo que `admin_guardar_vendedor`) |

- **AC-VEN-1** "Eliminar" en la pestaña Vendedores da de baja al vendedor en Supabase con una RPC `admin_baja_vendedor(p_admin_id, p_admin_pin, p_vendedor_id)` (security definer, `search_path = public, pg_temp`, misma respuesta genérica de no autorizado que S-COM-16). Requiere conexión; sin conexión avisa y no hace nada. Solo si el servidor confirma se actualiza la base local.
- **AC-VEN-2** La baja pone `activo = false` y borra `pin_hash` (no puede volver a ingresar). No borra filas. Los pedidos, clientes y cierres que lo nombran no cambian.
- **AC-VEN-3** Un vendedor dado de baja no aparece en la pantalla de ingreso, ni en Configuración, ni en los selectores de vendedor (clientes, asignación de comisiones). Sí se sigue viendo su nombre en pedidos e historial. El pull lo marca inactivo localmente (no reaparece activo al sincronizar).
- **AC-VEN-4** No se puede dar de baja al propio admin que está operando ni al último admin activo (servidor y cliente). Si el vendedor dado de baja tenía la sesión abierta en ese dispositivo, se cierra.
- **AC-VEN-5** Migración `supabase/migrations/004_baja_vendedores.sql` idempotente (columna `activo boolean not null default true` + RPC), que requiere la 002 PASO 1. La app tolera que la 004 no esté aplicada: muestra "Falta la migración 004 en Supabase" y no borra nada (ni local).
- **AC-VEN-6** La lógica (puede darse de baja, filtrado de activos) es pura en `src/domain/vendedores.js` con tests.

---

## REQ-PLA — Plantillas Excel para cargar productos y clientes

Pedido del dueño (2026-10-12): botón "Descargar plantilla Excel" en Productos y en Clientes; la plantilla tiene que servir exactamente para cargar todos los atributos que hoy tiene cada producto/cliente.

| Decisión | Valor |
|---|---|
| Columnas | Exactamente los campos del formulario de alta actual (REQ-PROD / REQ-CLI), mismas etiquetas y mismo orden. Una sola fuente de verdad en `src/domain/` para columnas de plantilla e importación |
| Contenido | Hoja 1 con encabezados vacía; hoja 2 "Instrucciones" (por columna: obligatorio, formato, valores válidos, ejemplo) |
| Stock (productos) | Solo para productos **nuevos**: genera movimiento `inicial` (AC-PROD-3). En productos existentes se ignora (regla dura 4) |
| Proveedor / Vendedor | Por **nombre** (como lo ve el usuario); si no existe, la fila se rechaza |
| Quién | Solo admin (igual que la importación actual) |

- **AC-PLA-1** En Configuración → Productos hay un botón "Descargar plantilla Excel" que baja `plantilla_productos.xlsx` con una columna por campo de REQ-PROD (Código, Descripción, Rubro, Proveedor, Costo final, Descuento 1, Descuento 2, % Ganancia, Precio venta 1, Precio venta 2, Bulto x, Mínimo venta, Stock — más cualquier otro campo que tenga hoy el formulario, p.ej. Unidad).
- **AC-PLA-2** En Configuración → Clientes hay un botón "Descargar plantilla Excel" que baja `plantilla_clientes.xlsx` con los campos de REQ-CLI, en ese orden y con esas etiquetas, **excepto Comisión** (decisión del dueño, 2026-10-12; desde REQ-COMR el cliente ya no tiene comisión — AC-COMR-2). Son 16 columnas.
- **AC-PLA-3** La importación de productos (CSV/XLSX) reconoce todas las columnas de la plantilla y valida con las mismas reglas que el formulario (código obligatorio y único, % 0–100, enteros ≥ 1 para bulto/mínimo, precios ≥ 0, proveedor existente). Si Precio venta 1 viene vacío se calcula con AC-PROD-1. Upsert por código (si no hay código, por nombre, como hoy). Sigue aceptando los archivos viejos (nombre/precio/código/unidad/categoría) — AC-PROD-5. El Rubro importado se normaliza y deduplica con la misma regla que el formulario (AC-COMR-4).
- **AC-PLA-3b** (decisión del dueño, 2026-10-13) En la plantilla de productos **no son obligatorios** Descuento 1, Descuento 2, % Ganancia, Precio venta 2 ni Mínimo venta. Celda vacía, solo espacios, "-" o "–" cuentan como vacío: en productos nuevos quedan descuentos/ganancia/precio 2 en 0 y mínimo venta en 1; en existentes se conserva el valor actual. "10%" se lee como 10. Mínimo venta 0 se toma como 1 (sin mínimo). Ninguna de estas celdas vacías rechaza la fila. La hoja Instrucciones lo dice explícitamente.
- **AC-PLA-4** Nueva importación de clientes (CSV/XLSX) desde la pestaña Clientes, con las mismas validaciones de REQ-CLI (código obligatorio y único, razón social y domicilio obligatorios, CUIT con dígito verificador y normalizado, provincia de la lista, tipo de IVA de la lista, vendedor existente, fecha de alta default hoy). Upsert por código de cliente. Una columna "Comisión" en el archivo (Excel viejo) se **ignora** sin fallar (no crea ni pisa el dato viejo) y se avisa en el resumen como informativo, no como error (AC-COMR-2). Se sincroniza como un alta normal (AC-CLI-5).
- **AC-PLA-5** Al terminar, un resumen: creados, actualizados y rechazados, con número de fila y motivo de cada rechazo. Una fila inválida no frena el resto.
- **AC-PLA-6** Seguridad: celdas exportadas e importadas protegidas contra formula injection (AC-SEC-3); límite de 5 MB y solo admin para parsear XLSX (S-07 / S-DEP-01).
- **AC-PLA-7** Columnas, validación por fila y armado de la plantilla son funciones puras en `src/domain/` con tests; un test garantiza que plantilla e importación usan las mismas columnas (round-trip: plantilla → completar → importar).

---

## REQ-COMR — Comisiones por vendedor y por rubro (reemplaza el % del cliente)

> Pedido del dueño 2026-10-12 (`harness/pedidos/2026-10-12_REQ-COMR.md`). Modifica REQ-CLI (AC-CLI-1), REQ-PROD (Rubro), REQ-PLA (AC-PLA-2/3/4) y REQ-COM (AC-COM-4, AC-COM-6 c).

Contexto: hoy (REQ-COM, AC-COM-4) la comisión de un pedido = total del pedido × `cliente.comision` / 100.
A partir de ahora **el cliente no tiene comisión**. Cada **vendedor** tiene un % por **rubro** de producto, y la comisión se calcula **por renglón** del pedido.

| Decisión | Valor |
|---|---|
| Dónde vive el % | En el **vendedor**: una tabla vendedor × rubro → % (0–100, hasta 2 decimales) |
| Rubro | Atributo del **producto** (campo interno legacy `categoria`, etiqueta "Rubro"). Se elige de una lista dentro del formulario del producto (ver AC-COMR-3) |
| Base de cálculo | Por renglón: `precio × cantidad` del renglón (el `precio` ya trae el descuento % por ítem de Facturación). Comisión del pedido = suma de los renglones |
| Rubro usado | El rubro **al momento de cargar el renglón** (se guarda en el renglón). Renglones viejos sin ese dato usan el rubro actual del producto |
| Rubro sin % para ese vendedor, o producto sin rubro | Ese renglón comisiona **0** y se muestra un **aviso** en el dashboard |
| Pedido dividido entre dos vendedores (AC-COM-7) | **Cada vendedor aplica su propia tabla** sobre su parte. Ej.: rubro Golosinas, A = 5 %, B = 3 %, división 50/50 de un renglón de $1000 → A cobra 5 % de $500 = $25, B cobra 3 % de $500 = $15 |
| Asignación "todo a uno" / "otro" | Se aplica la tabla del vendedor que recibe la comisión |
| Cierres ya confirmados | **No se tocan**: conservan su % congelado y su detalle. Se siguen viendo y exportando igual |
| Visibilidad | La tabla de % la ve y la edita **solo el admin** (igual que REQ-COM, AC-SEC-4) |
| Datos viejos | El `comision` que ya tengan los clientes **no se borra** (ni en IndexedDB ni la columna en Supabase); simplemente deja de usarse y de mostrarse |

### Cliente sin comisión
- **AC-COMR-1** El formulario de alta/edición de clientes deja de mostrar "Comisión": quedan **16 campos** (actualizar AC-CLI-1 y su test). Se quitan la validación y el mapeo de `comision` de `src/domain/clientes.js`, pero el sync **no pisa ni borra** la columna `comision` existente en Supabase (no mandarla en el upsert o mandar lo que ya tenía; el arquitecto elige y lo justifica).
- **AC-COMR-2** La plantilla Excel de clientes (REQ-PLA) ya no tiene la columna "Comisión". Importar un Excel viejo que **sí** la tenga no falla: la columna se ignora (con aviso informativo, no error).

### Rubro como atributo del producto
- **AC-COMR-3** En el formulario del producto, "Rubro" es un **selector** con los rubros existentes (los distintos `categoria` de los productos, ordenados alfabéticamente) + opción **"Agregar rubro nuevo…"** que permite escribir uno nuevo sin salir del formulario. No hay pantalla aparte de ABM de rubros.
- **AC-COMR-4** Normalización: se recortan espacios y se colapsan los dobles; "golosinas", "Golosinas " y "GOLOSINAS" son el **mismo** rubro (comparación case-insensitive y sin tildes), y al agregar uno que ya existe se reutiliza el existente con su escritura original. La importación Excel de productos aplica la misma regla.
- **AC-COMR-5** Al agregar un producto a un pedido (Nuevo pedido, Facturación y Armado) el renglón guarda `rubro` con el rubro normalizado del producto en ese momento. Cambiar después el rubro del producto **no** cambia los renglones ya guardados. Pedidos viejos sin `rubro` en el renglón siguen funcionando en todas las pantallas (pedidos, armado, facturación, orden de entrega, reportes, PDF).

### Tabla de % por vendedor
- **AC-COMR-6** En Configuración → Vendedores, el admin abre un vendedor y ve una grilla **Rubro → %** con todos los rubros existentes. Puede cargar/editar/vaciar cada %. Vacío = sin % (cuenta como 0 con aviso). Validación: número 0–100 con hasta 2 decimales (acepta coma decimal, como el resto de la app).
- **AC-COMR-7** Persistencia offline-first: store IndexedDB nuevo (subir `DB_VERSION`, solo **agregar** el store, sin borrar nada), registros con id `crypto.randomUUID()`, únicos por (vendedor, rubro normalizado). Sync por upsert con `pendingSync` limpiando solo los ids subidos. Migración `supabase/migrations/005_comisiones_rubro.sql` con tabla nueva, restricción única (vendedor, rubro), RLS: solo admin lee/escribe. El sync tolera que la tabla todavía no exista (como AC-CLI-5).
- **AC-COMR-8** El vendedor se identifica de forma estable (el arquitecto revisa cómo REQ-COM y REQ-VEN identifican vendedores hoy). Renombrar un vendedor no le hace perder su tabla; borrar un vendedor (REQ-VEN) no rompe el dashboard ni los cierres.

### Cálculo y dashboard (modifica REQ-COM)
- **AC-COMR-9** Reemplaza AC-COM-4: comisión de un renglón = `precio × cantidad × pct(vendedor, rubro) / 100`; comisión del pedido para un vendedor = suma de sus renglones, redondeando **al centavo una sola vez por pedido y por vendedor** (documentar y testear el criterio de redondeo; usar la misma aritmética en centavos que ya tiene `src/domain/comisiones.js`). Renglones eliminados/tachados (`eliminado`) no cuentan.
- **AC-COMR-10** Con división (AC-COM-7), cada parte = (pct de la división) × suma de renglones con la tabla **de ese vendedor**. El total vendido repartido se sigue mostrando como hoy. La suma de las partes de comisión **no** tiene que coincidir con ninguna "comisión total del pedido" (cada vendedor tiene su %), y la UI no debe mostrar una comisión total única engañosa para pedidos divididos.
- **AC-COMR-11** Reemplaza el aviso (c) de AC-COM-6 ("cliente sin % de comisión") por: (c1) **vendedor sin % para un rubro** que aparece en el período (agrupado por vendedor + rubro, con contador y monto vendido afectado) y (c2) **productos sin rubro** vendidos en el período. Desde el aviso (c1) el admin puede ir directo a cargar ese % (o al menos ver qué falta cargar).
- **AC-COMR-12** El detalle de un pedido en el dashboard muestra el desglose por rubro: rubro, subtotal, % aplicado y comisión, por vendedor.
- **AC-COMR-13** El cierre (AC-COM-10) congela, por pedido y por vendedor, el desglose por rubro (subtotal, %, comisión). El PDF del cierre (AC-COM-14) muestra el resumen por vendedor y, en el detalle, el desglose por rubro. Los cierres viejos (modelo por cliente) se siguen mostrando y exportando con su formato original; marcar el cierre con una versión de modelo (p. ej. `modelo: 'cliente' | 'rubro'`) para distinguirlos.
- **AC-COMR-14** Ajustes pendientes (AC-COM-13) de pedidos cerrados con el **modelo viejo**: el cambio de modelo por sí solo **no** genera ajustes. Si el pedido cambia después de cerrado, el ajuste se calcula con el modelo del cierre original (diferencia de total × % congelado). Para pedidos cerrados con el modelo nuevo, el ajuste es la diferencia recalculada por rubro.
- **AC-COMR-15** Todo el cálculo (lookup de %, normalización de rubro, comisión por renglón/pedido/vendedor, división, avisos, ajustes) son funciones **puras** en `src/domain/` (`comisiones.js` y/o un módulo nuevo `rubros.js`) con tests. Nada de lógica de cálculo en las pages.

### Tests y revisión (OBLIGATORIO — pedido explícito del dueño)

El pipeline **no** puede darse por terminado si falta alguno de estos puntos. QA y el revisor tienen que verificarlos uno por uno.

1. **Cobertura por AC:** cada `AC-COMR-*` tiene al menos un test que lo nombra en el `it(...)` (como `AC-COM-16` en los tests existentes). El revisor arma una tabla AC → archivo de test → resultado.
2. **Dominio (unitarios), mínimo:**
   - Comisión por renglón y por pedido con varios rubros y % distintos; renglón con rubro sin % (0 + aviso); producto sin rubro; renglones `eliminado`.
   - Redondeo: casos que fuercen el medio centavo, % con 2 decimales, totales grandes, valores negativos, `NaN`, texto, `null`/`undefined`.
   - División 50/50 y 70/30 con tablas distintas (el ejemplo de la tabla de decisiones tiene que dar exactamente $25 y $15), modo `cargador`, `otro` y `sin_comision`.
   - Normalización de rubros (mayúsculas, espacios, tildes) y dedupe.
   - Renglón con `rubro` guardado vs renglón viejo sin `rubro` (fallback al producto actual) vs producto borrado.
   - Ajustes: pedido cerrado con modelo viejo sin cambios (0 ajustes), con total cambiado (ajuste con % congelado), y pedido cerrado con modelo nuevo editado.
   - Validación del % en la tabla (0, 100, 100.01, -1, "5,5", "", texto, 3 decimales).
3. **Migraciones:** test de upgrade IndexedDB desde la versión actual (como `migracionV5/V6.test.js`): crea solo el store nuevo y **no borra ni vacía** ningún store, y los clientes conservan su `comision` vieja.
4. **Sync:** upsert de la tabla nueva limpiando solo los ids subidos; tolerancia a tabla inexistente; el upsert de clientes no pisa `comision` en Supabase (extender `syncTolerante.test.js`).
5. **UI (Testing Library):** formulario de cliente sin "Comisión" (16 campos); selector de rubro en producto incluido "Agregar rubro nuevo…" y dedupe; grilla de % en vendedor (validación y guardado); dashboard de Comisiones con desglose por rubro y avisos (c1)/(c2); que un vendedor/armador no vea la grilla ni el dashboard.
6. **Plantillas Excel:** actualizar los tests de `plantillas.test.js` / `plantillaExcel.test.js` (sin columna Comisión en clientes; Excel viejo con Comisión se importa igual; rubro de productos normalizado).
7. **Regresión:** actualizar (no borrar) los tests existentes que asumían `cliente.comision` (`ClienteForm.test.js`, `clientes.test.js`, tests de `comisiones`), dejando explícito en el reporte cuáles se modificaron y por qué. Ningún test existente se borra o se saltea (`skip`/`only`) para que pase.
8. **Seguridad:** el auditor revisa la RLS de `005_comisiones_rubro.sql` (solo admin) y agrega su test de seguridad.
9. **Gates:** `CI=true npx react-scripts test --watchAll=false`, `npx react-scripts build` y `node harness/gates/run-gates.mjs` en verde. El reporte final pega el resumen de cada uno.

### Fuera de alcance
- Borrar la columna `comision` de clientes en Supabase (se hace más adelante, a mano, si el dueño lo pide).
- Que el vendedor vea sus propias comisiones.
- Recalcular o modificar cierres ya confirmados.

### A confirmar con el dueño (el arquitecto lo deja anotado, no bloquea)
- ¿El selector de rubro del producto debe permitir **renombrar** un rubro para todos los productos a la vez? (por ahora: no).
- ¿Hace falta un % "por defecto" por vendedor para rubros nuevos? (por ahora: no, se avisa con 0).

---

## REQ-VTA — Unidad de venta y marca del producto (afecta la app interna)

> Pedido del dueño 2026-10-14 (`harness/pedidos/2026-10-14_REQ-TIE.md`). Base de la tienda online (REQ-TIE/REQ-WEB/REQ-POR, corridas posteriores). Depende de la normalización de rubros de REQ-COMR (AC-COMR-4). Modifica REQ-PROD, REQ-PLA y REQ-BUL.

| Decisión | Valor |
|---|---|
| Precio unitario vs bulto | El precio cargado es **por unidad**. Un producto vendido por display/bulto muestra el precio unitario y el precio del bulto = precio × `bultoX` |

| Etiqueta | Campo | Columna | Reglas |
|---|---|---|---|
| Marca | `marca` | `marca` | Texto, misma normalización que el rubro (AC-COMR-4). Selector + "Agregar marca nueva…" |
| Se vende por | `ventaPor` | `venta_por` | `unidad` / `bulto` / `ambos`. Default: `ambos` si `bultoX > 1`, si no `unidad`. `bulto` exige `bultoX > 1` |
| Etiqueta del bulto | `bultoNombre` | `bulto_nombre` | `Bulto` / `Display` / `Caja` / `Pack` (default `Bulto`) |
| Mostrar en tienda | `visibleTienda` | `visible_tienda` | Booleano, default `true` |

Ejemplo de referencia (tiene que estar en los tests): **Dos Corazones**, precio $900, `bultoX` 16, `ventaPor: bulto`, `bultoNombre: Display`. El cliente elige **1** → el renglón es **1 Display = 16 u. × $900 = $14.400**. Con 3 → 48 u. = $43.200.

- **AC-VTA-1** El formulario de producto (y la plantilla Excel REQ-PLA) suma Marca, Se vende por, Etiqueta del bulto y Mostrar en tienda. Validación: `ventaPor = bulto` con `bultoX ≤ 1` se rechaza con error en el campo.
- **AC-VTA-2** El renglón de un pedido **siempre guarda la cantidad en unidades** (como hoy), así armado, stock (ledger), facturación, PDF y comisiones siguen funcionando sin cambios. Además guarda `bultos` y `bultoX` congelados cuando se pidió por bulto, para mostrar "3 Display (48 u.)".
- **AC-VTA-3** En la app interna (Nuevo pedido, Facturación, Armado), un producto `ventaPor: bulto` solo deja cargar múltiplos de `bultoX` con los botones de bulto (REQ-BUL); si se tipea una cantidad que no es múltiplo, se muestra un aviso (el admin puede igual guardarla en Facturación; el vendedor no).
- **AC-VTA-4** Las funciones de unidad de venta (unidades ⇄ bultos, precio del bulto, validación de múltiplos, defaults de `ventaPor`) son puras en `src/domain/` con tests, incluyendo `bultoX` vacío, 0, 1, decimal y texto.
- **AC-VTA-5** Columnas nuevas en Supabase vía migración, sincronizadas tolerando que no existan todavía (como AC-CLI-5). Productos viejos sin estos campos siguen funcionando con los defaults.

### Tests y revisión (OBLIGATORIO)

1. **Trazabilidad:** cada `AC-VTA-*` tiene al menos un test que lo nombra en el `it(...)`. El revisor arma la tabla AC → test → resultado.
2. **Dominio (unidad de venta):** el caso **Dos Corazones** (1 → 16 u. / $14.400; 3 → 48 u. / $43.200), `ambos`, múltiplos, precios con centavos y redondeo, totales grandes, entradas inválidas (NaN, negativos, texto, null) y `bultoX` vacío/0/1/decimal/texto. Normalización y dedupe de marcas (mayúsculas, espacios, tildes).
3. **UI (Testing Library):** formulario de producto con los 4 campos nuevos (selector de marca con "Agregar marca nueva…", error en el campo con `bulto` y `bultoX ≤ 1`); aviso de cantidad no múltiplo en Nuevo pedido/Facturación/Armado; admin puede guardar igual en Facturación, vendedor no; renglón mostrado como "3 Display (48 u.)".
4. **Plantillas Excel:** la plantilla de productos suma las columnas nuevas; un Excel viejo sin ellas se importa igual con defaults.
5. **Sync/migración:** columnas nuevas sincronizadas tolerando que no existan en Supabase (extender `syncTolerante.test.js`); si cambia el schema IndexedDB, test de upgrade que no borra ni vacía stores.
6. **Regresión:** pedidos viejos y productos viejos (sin campos nuevos) siguen funcionando en todas las pantallas; stock, armado, facturación, PDF y comisiones siguen trabajando en unidades. Ningún test existente se borra ni se saltea.
7. **Seguridad:** el auditor revisa la migración de las columnas nuevas.
8. **Gates:** `CI=true npx react-scripts test --watchAll=false`, `npx react-scripts build` y `node harness/gates/run-gates.mjs` en verde, con el resumen en el reporte final, más la lista de pasos manuales (migración SQL).

### A confirmar con el dueño (no bloquea, el arquitecto lo deja anotado)
- AC-VTA-3: ¿el vendedor puede cargar unidades sueltas de un producto "solo por display" en la app interna? (por ahora: no, solo el admin en Facturación).

---

## REQ-TIE — Tienda pública: catálogo, carrito y checkout

> Pedido del dueño 2026-10-14 (`harness/pedidos/2026-10-14_REQ-TIE.md`). Corrida 2 de 3: va junto con REQ-WEB (el pedido web necesita su bandeja). Depende de REQ-VTA (ya implementado) y de la normalización de rubros de REQ-COMR. REQ-POR (portada, banners, ofertas, personalización) es la corrida siguiente: mientras tanto la tienda usa defaults (nombre/logo/colores fijos, sin ofertas) y la config mínima de AC-TIE-2/AC-TIE-7/AC-TIE-15 vive en `tienda_config` con valores por defecto. Las secciones **Supabase** y **Tests y revisión** (compartidas con REQ-WEB) están al final de REQ-WEB.

### Visión

Una tienda tipo Mercado Libre (catálogo, buscador, filtros, carrito y checkout) a la que los clientes entran **por una URL distinta** a la de la app interna, **sin login**. El cliente arma su pedido, completa nombre, dirección y ciudad, y el pedido **cae en la app de la distribuidora** (bandeja "Pedidos web") con la fecha del día, sus renglones y el vendedor del link.

### Decisiones (tienda)

| Tema | Decisión |
|---|---|
| Arquitectura | **Mismo repo, mismo deploy y mismo Supabase**, pero **otra URL** de entrada. La tienda es un bundle separado por code-splitting (`React.lazy`) que **no** importa IndexedDB, sync, sesión ni pantallas internas |
| URL | La tienda se sirve en `/tienda` **y** en la raíz de cualquier hostname listado en `REACT_APP_TIENDA_HOSTS` (ej. `tienda.midominio.com`, que apunta al mismo deploy). En un host de tienda **no** se puede llegar a la app interna |
| Ingreso del pedido | A una bandeja **"Pedidos web"** como *por revisar*. El admin lo vincula a un cliente existente o crea uno, y recién ahí pasa al flujo normal |
| Vendedor | **Link por vendedor**: `/tienda?v=<token>`. El pedido entra a nombre de ese vendedor. El link general (sin `v`) entra sin vendedor y se asigna al vendedor de la ficha del cliente al vincularlo (o el admin elige) |
| Precio | Se muestra **Precio venta 1** (`precio`). Nunca se exponen costo, descuentos de compra, ganancia ni precio venta 2 |
| Stock | No se muestra la cantidad. Producto sin stock disponible → "Sin stock", no se puede agregar (el admin puede desactivar esta regla en la configuración de la tienda) |
| Precio unitario vs bulto | El precio cargado es **por unidad**. Un producto vendido por display/bulto muestra el precio unitario y el precio del bulto = precio × `bultoX` |
| Seguridad | Todo lo público pasa por **RPC `security definer`** en Supabase. El rol `anon` no lee ni escribe tablas directamente. El servidor **recalcula** precios, bultos y totales: nunca confía en lo que manda el navegador |


### Acceso y estructura
- **AC-TIE-1** `/tienda` (y la raíz de un host de `REACT_APP_TIENDA_HOSTS`) muestra la tienda **sin login**. El bundle de la tienda no incluye código de IndexedDB, sync, sesión ni pantallas internas (verificable por test de imports o análisis del build). En un host de tienda, cualquier otra ruta muestra la tienda, nunca la app interna.
- **AC-TIE-2** La tienda tiene su propio `<title>`, favicon/logo y colores de la configuración (REQ-POR). No ofrece instalar la PWA interna ni registra el service worker de la app interna; el SW existente no rompe ni cachea mal la tienda.
- **AC-TIE-3** El catálogo se pide con una RPC pública (`tienda_catalogo`) que devuelve **solo**: id, código, nombre, marca, rubro, imagen, precio (venta 1, o el de oferta vigente), `ventaPor`, `bultoX`, `bultoNombre`, `minimoVenta` y un booleano `disponible`. Solo productos con `visibleTienda`, no borrados y con precio > 0. Un test/auditoría verifica que `anon` no puede leer `productos`, `clientes`, `pedidos`, `vendedores` ni `movimientos_stock` directamente.

### Navegación tipo Mercado Libre
- **AC-TIE-4** Encabezado fijo con logo, buscador y carrito con contador. Diseño mobile-first (usable a 360 px, sin scroll horizontal) y grilla de 2–5 columnas según el ancho.
- **AC-TIE-5** Buscador por nombre (y código/marca), sin distinguir mayúsculas ni tildes, que tolera palabras en cualquier orden ("corazones dos" encuentra "Dos Corazones"). Con debounce; no dispara una consulta al servidor por tecla (filtra el catálogo ya descargado).
- **AC-TIE-6** Filtros por **rubro** y **marca** (selección múltiple, con contador de productos), combinables con la búsqueda; orden por relevancia, precio ↑/↓ y nombre. En celular, los filtros van en un panel desplegable. Los filtros activos quedan en la URL (se pueden compartir y sobreviven a recargar).
- **AC-TIE-7** Tarjeta de producto: imagen (o placeholder), nombre, marca, precio por unidad y, si se vende por bulto, "Display x16 · $14.400". Botón "Agregar". Producto no disponible → "Sin stock", botón deshabilitado (salvo que la tienda permita pedir sin stock).
- **AC-TIE-8** Detalle de producto (ruta propia, compartible) con imagen grande, datos, selector de cantidad y productos del mismo rubro.

### Carrito
- **AC-TIE-9** Selector de cantidad según `ventaPor`: `unidad` → unidades; `bulto` → bultos ("1 Display = 16 u."); `ambos` → el cliente elige "Unidad" o "Display x16" (en el carrito pueden convivir un renglón por unidades y otro por bultos del mismo producto, o se unifican en unidades: el arquitecto elige y lo documenta). Respeta `minimoVenta`.
- **AC-TIE-10** El carrito muestra cada renglón (cantidad, unidades equivalentes, precio, subtotal), permite cambiar cantidad y quitar, y muestra el total. Persiste en `localStorage` (con try/catch; si falla, funciona en memoria) y se descarta si pasó más de 7 días.
- **AC-TIE-11** Cálculo de carrito (subtotales, total, unidades equivalentes, validaciones de mínimo y múltiplos) son funciones puras en `src/domain/tienda.js` con tests — **la misma lógica que usa el servidor** está documentada y probada con los mismos casos.

### Checkout
- **AC-TIE-12** Formulario: Nombre o razón social\*, Teléfono/WhatsApp\*, Dirección de entrega\*, Ciudad\*, Código postal, Provincia (lista de REQ-CLI), CUIT (opcional, validado con dígito verificador si se carga) y Observaciones (máx. 500). Errores por campo. Los datos se recuerdan en el dispositivo para el próximo pedido.
- **AC-TIE-13** Al confirmar se llama a la RPC `tienda_crear_pedido` con: renglones (`productoId`, cantidad, modo unidad/bulto), datos de contacto, token del vendedor (si hay) y un id de idempotencia (UUID generado en el navegador). El servidor:
  1. valida y recalcula todo con los precios y reglas **actuales** (incluida la oferta vigente);
  2. si algún precio, disponibilidad o regla cambió respecto de lo que vio el cliente, **no** crea el pedido y devuelve el carrito corregido para que el cliente lo vuelva a confirmar ("Cambiaron algunos precios");
  3. crea el pedido con `origen: 'web'`, `webEstado: 'por_revisar'`, `estado: 'pendiente'`, `fecha` = **hoy en hora de Argentina** (`America/Argentina/Buenos_Aires`), `vendedor` del token, y los datos de contacto;
  4. con el mismo id de idempotencia devuelve el mismo pedido (doble clic o reintento no duplican).
- **AC-TIE-14** Pantalla de confirmación con número de pedido, resumen y total; el carrito se vacía. Sin conexión o con error, el carrito **no** se pierde y se puede reintentar.
- **AC-TIE-15** Antiabuso: límite de pedidos por origen y por hora (configurable, default 5/h), campo trampa (honeypot) y topes (máx. 150 renglones, cantidades y totales razonables). Al superar el límite se muestra un mensaje claro, sin detalles internos.

## REQ-WEB — Bandeja "Pedidos web" en la app interna

- **AC-WEB-1** Nueva pestaña "Pedidos web" (admin) con contador de *por revisar*. Los pedidos `origen: web` *por revisar* **no** aparecen en Armado, Facturación, Orden de entrega, Reportes ni Comisiones hasta ser aceptados, y **no** mueven stock.
- **AC-WEB-2** Cada pedido muestra los datos de contacto, la fecha, el vendedor del link, los renglones (con unidades y bultos) y el total. El admin puede editar renglones antes de aceptar (mismas reglas que Facturación, incluida AC-VTA-3).
- **AC-WEB-3** Vincular cliente: la app sugiere clientes existentes por CUIT, teléfono y nombre normalizado (función pura con tests, ordenada por coincidencia). El admin elige uno o **crea un cliente nuevo** con el formulario de REQ-CLI precargado con los datos del pedido (código obligatorio, como siempre).
- **AC-WEB-4** **Aceptar**: el pedido queda vinculado (`clienteId`, `clienteNombre`, zona de la ficha), `webEstado: 'aceptado'` (con quién y cuándo) y entra al flujo normal como pendiente. Vendedor: el del link; si vino sin vendedor, el de la ficha del cliente; si la ficha tampoco tiene, el admin lo elige.
- **AC-WEB-5** **Rechazar** con motivo obligatorio: queda registrado (quién, cuándo, motivo), no se borra y se ve en un historial filtrable (por revisar / aceptados / rechazados).
- **AC-WEB-6** Los pedidos web llegan a la app interna por el sync existente (pull) sin romper el modelo offline-first; aceptar/rechazar offline queda `pendingSync` y se sube después. Dos admins aceptando el mismo pedido desde dos dispositivos no lo duplican ni lo vinculan a dos clientes (resolver en el servidor).
- **AC-WEB-7** Links por vendedor: en Configuración → Vendedores, el admin genera, copia y **regenera** el link de tienda de cada vendedor (`token` aleatorio, no el nombre ni el id). Regenerar invalida el anterior. Un token inválido o de un vendedor borrado → la tienda funciona igual, como link general.

### Supabase (REQ-TIE + REQ-WEB)

Migración `supabase/migrations/008_tienda.sql` (se aplica a mano; la 006 ya es `006_unidad_venta.sql` y la 007 `007_productos_escritura_admin.sql`). Lo de REQ-POR (`tienda_banners`, `tienda_ofertas`, bucket `tienda`, RPC `tienda_portada`) queda para su corrida; si el arquitecto deja la oferta vigente preparada en `tienda_catalogo`/`tienda_crear_pedido`, debe tolerar que la tabla no exista todavía.
- columnas nuevas de `pedidos` (`origen`, `web_estado`, `web_contacto` jsonb, `web_revisado_por`, `web_revisado_at`, `web_motivo_rechazo`, `idempotencia` único);
- `tienda_config` (mínima: permitir sin stock, límite por hora), `vendedores_tienda_tokens`, `tienda_intentos` (antiabuso, sin guardar la IP en claro: hash con sal);
- RPC `tienda_catalogo`, `tienda_crear_pedido` y las que necesite la bandeja para aceptar/rechazar de forma atómica (AC-WEB-6) (`security definer`, `search_path` fijo, `grant execute` solo lo necesario a `anon`);
- RLS: `anon` sin acceso directo a ninguna tabla; admin lee/escribe la config y los tokens.

### Tests y revisión (OBLIGATORIO)

1. **Trazabilidad:** cada AC de los REQ de la corrida tiene al menos un test que lo nombra. El revisor arma la tabla AC → test → resultado.
2. **Dominio (`src/domain/tienda.js`, unidad de venta, sugerencia de clientes):** el caso **Dos Corazones** (1 → 16 u. / $14.400; 3 → 48 u. / $43.200), `ambos`, `minimoVenta`, múltiplos, precios con centavos y redondeo, oferta vigente/vencida/en el borde del día, totales grandes, entradas inválidas (NaN, negativos, texto, null).
3. **Búsqueda y filtros:** tildes, mayúsculas, orden de palabras, combinación búsqueda + rubro + marca, filtros en la URL.
4. **UI (Testing Library):** catálogo, filtros en mobile, carrito (agregar/cambiar/quitar/persistencia), checkout con errores por campo, carrito corregido por cambio de precio, confirmación, error de red sin perder el carrito, bandeja de pedidos web (vincular, crear cliente, aceptar, rechazar).
5. **Aislamiento:** test que verifica que el entry de la tienda no importa `src/db`, `src/sync` ni `src/services/sesion`; que un host de tienda nunca renderiza la app interna.
6. **Servidor/seguridad:** el auditor revisa la migración y las RPC: precios recalculados en el servidor (un carrito con precio manipulado no se acepta), idempotencia, límite por hora, honeypot, `anon` sin acceso a tablas que `tienda_catalogo` no filtre costo/ganancia/stock exacto, y que el token de vendedor no se pueda enumerar. Escribe sus tests de seguridad.
7. **Regresión:** pedidos viejos y productos viejos (sin campos nuevos) siguen funcionando en todas las pantallas; los pedidos web por revisar no aparecen en Armado/Facturación/Comisiones ni mueven stock. Ningún test existente se borra ni se saltea.
8. **Gates:** `CI=true npx react-scripts test --watchAll=false`, `npx react-scripts build` y `node harness/gates/run-gates.mjs` en verde, con el resumen en el reporte final, más la lista de pasos manuales (migración SQL, variable `REACT_APP_TIENDA_HOSTS`, DNS del dominio de la tienda).

### Fuera de alcance
- Pago online, cuentas de cliente con contraseña, historial de pedidos del cliente, notificaciones por WhatsApp/email automáticas.
- Precio venta 2 o listas de precios por cliente en la tienda.
- REQ-POR (portada, banners, ofertas, Configuración → Tienda, bucket de imágenes): corrida siguiente.

### A confirmar con el dueño (no bloquea, el arquitecto lo deja anotado)
- ¿Los vendedores también ven/aceptan los pedidos web de su propio link, o solo el admin? (por ahora: solo admin).
- ¿Se manda un aviso (WhatsApp/notificación) al admin cuando entra un pedido web? (por ahora: solo el contador en la pestaña).

---

## REQ-POR — Portada y personalización de la tienda

> Pedido del dueño 2026-10-14 (`harness/pedidos/2026-10-14_REQ-TIE.md`). Corrida 3 de 3. Depende de REQ-TIE/REQ-WEB (ya implementados, migración 008). La app interna no usa Supabase Auth: "solo admin" se resuelve igual que en 008, con RPC `security definer` que verifican id + PIN del admin (`tienda_admin_ok`).

- **AC-POR-1** Portada: banners rotativos arriba (imagen, título, subtítulo y destino: un rubro, una marca, un producto o la búsqueda de ofertas), fila de **Ofertas**, filas de **Destacados** por rubro y acceso a todos los rubros.
- **AC-POR-2** Configuración → Tienda (solo admin): nombre de la tienda, logo, color principal (con control de contraste legible), texto de bienvenida, datos de contacto/WhatsApp en el pie, permitir o no pedir sin stock, límite de pedidos por hora, banners (alta/baja/orden/vigencia) y filas de destacados.
- **AC-POR-3** Ofertas: el admin elige productos, un **precio de oferta por unidad** opcional y vigencia desde/hasta. Mientras esté vigente, la tienda muestra el precio anterior tachado y el de oferta, y **el servidor cobra el de oferta** (AC-TIE-13). Fuera de vigencia desaparece sola.
- **AC-POR-4** Imágenes de logo y banners en un bucket de Supabase Storage `tienda`: lectura pública, escritura solo admin, solo jpg/png/webp y máx. 2 MB (validado en el navegador y en las políticas del bucket).
- **AC-POR-5** Vista previa de la tienda desde Configuración antes de publicar los cambios. La configuración se guarda en Supabase (tabla `tienda_config`, escritura solo admin, lectura pública vía RPC `tienda_portada`).

### Supabase (REQ-POR)

Migración `supabase/migrations/009_tienda_portada.sql` (se aplica a mano, después de la 008; idempotente y no destructiva):
- columnas nuevas de `tienda_config` (nombre, logo, color, bienvenida, contacto, WhatsApp, destacados); tablas `tienda_banners`, `tienda_ofertas` (la 008 ya cobra la oferta vigente vía `tienda_precio_vigente`) y `tienda_subidas` (permisos de subida de un solo nombre, con vencimiento);
- RPC pública `tienda_portada` (solo datos de vitrina); RPC admin `admin_tienda_leer`, `admin_tienda_guardar` (valida en el servidor) y `admin_tienda_subida` (habilita subir UNA imagen a un nombre aleatorio por 10 minutos); `tienda_catalogo` suma `precioAnterior`/`enOferta`;
- bucket `tienda` público con `file_size_limit` 2 MB y `allowed_mime_types` jpg/png/webp; `anon` solo puede insertar en un nombre habilitado por `admin_tienda_subida`, sin update ni delete;
- RLS: `anon` sin acceso directo a ninguna tabla nueva.

### Tests y revisión (OBLIGATORIO)
1. **Trazabilidad:** cada `AC-POR-*` tiene al menos un test que lo nombra.
2. **Dominio (`src/domain/tiendaPortada.js`):** contraste legible, vigencia de banners y ofertas (incluido el borde del día), destinos de banner, armado de la portada, validación de config, ofertas e imágenes (tipo y tamaño).
3. **UI:** portada con banners/ofertas/destacados/rubros y precio tachado; Configuración → Tienda con error de contraste y vista previa.
4. **Seguridad:** chequeo estático de la migración 009 (RPC `security definer` con `search_path` fijo, admin con PIN, sin grants directos a `anon`, políticas del bucket). Recomendado `/auditar-seguridad`.
5. **Gates** en verde. Pasos manuales: correr la 009 en el SQL Editor.

---

## REQ-FOT — Foto de cada producto

> Pedido del dueño 2026-10-15: "quiero que cada producto tenga su foto". Hasta ahora la foto (`imagen_url`) solo se completaba sola con la búsqueda de Google al importar. Usa el bucket `tienda` y el permiso de subida de REQ-POR (`admin_tienda_subida`, PIN del admin): no requiere migración nueva.

- **AC-FOT-1** El formulario de producto permite subir una foto (jpg/png/webp, máx. 2 MB, validado en el navegador) con el PIN del admin; se muestra la miniatura y al guardar queda en `imagen_url`. Con el PIN cargado, guardar **sube el producto a Supabase en el momento** (sin el PIN queda pendiente para "Subir productos" y se avisa), así la tienda muestra la foto nueva. El formulario de alta/edición se abre arriba de todo, en lugar de la lista.
- **AC-FOT-2** Se puede quitar la foto. Editar un producto sin tocar la foto conserva la que tenía (incluidas las que encontró la búsqueda automática).
- **AC-FOT-3** La lista de productos marca los que no tienen foto y muestra cuántos faltan.

---

## Lote operación — principios (pedido 2026-10-15)

> Autorización del dueño: decisiones de seguridad delegadas al arquitecto/auditor ("lo más fácil y recomendable"), anotadas en plan y reporte.

- **Lo más simple que funcione**, reutilizando lo que ya existe (bultos/`unidadVenta`, `stockService`/ledger, `pdfGen`, `rubros`/`marcas`, patrón de RPC con PIN de admin de la migración 007, selectores con "Agregar nuevo…").
- **Nada se rompe:** pedidos, productos, clientes e ingresos viejos (sin los campos nuevos) siguen funcionando con defaults.
- Stock **solo** por movimientos. Todo cálculo (precios, agrupado, rentabilidad, saldos, A/B) en funciones puras de `src/domain/` con tests.
- **Seguridad de datos financieros:** costos, ganancias, pagos y saldos con proveedores, notas de crédito y facturación A/B **no** pueden quedar legibles ni escribibles con la anon key. Usar el patrón más simple que lo garantice (RPC `security definer` con PIN de admin como 007, o el que el auditor justifique mejor). Pantallas nuevas: **solo admin**, salvo que el REQ diga otra cosa.
- Migraciones nuevas numeradas después de la última existente, idempotentes, sin `drop` de datos.

## REQ-PBU — Precio por unidad llevando bulto
| Decisión | Valor |
|---|---|
| Campo nuevo | `precioBulto` (columna `precio_bulto`), etiqueta **"Precio por unidad llevando bulto"**. Vacío/0 = no hay precio por bulto |
| Etiqueta del precio actual | `precio` pasa a mostrarse como **"Precio por unidad"** (antes "Precio venta 1"; el campo interno no cambia). "Precio venta 2" queda como está |
| Regla | Si la cantidad del renglón llega a **al menos 1 bulto completo** (`cantidad ≥ bultoX`, con `bultoX > 1`) y hay `precioBulto`, **todas las unidades del renglón** van a `precioBulto`. Si no, `precio`. Ej.: unidad $900, llevando bulto $800, bulto x16: 10 u. → $9.000; 16 u. → $12.800; 20 u. → $16.000 |
| Cómo se guarda | `item.precio` = precio aplicado; `item.precioOriginal` = precio por unidad; `item.precioPorBulto = true`. Así boleta, totales y "Total sin descuento" siguen funcionando |

- **AC-PBU-1** Formulario de producto con "Precio por unidad" y "Precio por unidad llevando bulto" (≥ 0; si es mayor que el precio por unidad se avisa, no se bloquea).
- **AC-PBU-2** Plantilla Excel de productos (REQ-PLA): columnas **"Precio por unidad"** y **"Precio por unidad llevando bulto"**; un Excel viejo con "Precio venta 1" se sigue importando.
- **AC-PBU-3** Nuevo pedido, Facturación y Armado aplican la regla al cambiar la cantidad (subir o bajar del bulto cambia el precio), salvo que el admin haya puesto un precio/descuento manual en ese renglón (se respeta el manual).
- **AC-PBU-4** La tienda muestra "Llevando el display: $800 c/u" y el servidor (`tienda_crear_pedido`/`tienda_catalogo`) aplica la **misma** regla; un carrito con precio manipulado no pasa.
- **AC-PBU-5** Función pura `precioAplicado(producto, cantidad)` con tests (bordes: `bultoX` 0/1/vacío, `precioBulto` vacío/0/mayor que el unitario, cantidades decimales, el ejemplo de la tabla).

## REQ-MIN — Mínimo para pedir un producto
Se usa el campo existente **"Mínimo venta"** (`minimoVenta`).
- **AC-MIN-1** Al agregar un producto con mínimo a un pedido (Nuevo pedido y tienda), la cantidad arranca en el mínimo y **no** se puede guardar por debajo (error claro en el renglón). Mínimo vacío/0/1 = sin restricción.
- **AC-MIN-2** En Facturación el admin puede guardar por debajo del mínimo con confirmación; el armador no puede bajar de él (si falta mercadería, lo anota como faltante como hoy).
- **AC-MIN-3** Si el producto se vende por bulto, el mínimo se redondea al múltiplo de bulto superior. Función pura con tests.

## REQ-SST — Vender sin stock con aviso
- **AC-SST-1** En Nuevo pedido, Facturación y Armado se puede cargar y facturar un producto sin stock suficiente: **nunca se bloquea**, se muestra el aviso "Sin stock (hay N)" en el renglón y un resumen al facturar ("3 productos quedan con stock negativo"). `STOCK_POLICY` queda en `advertir`.
- **AC-SST-2** El stock puede quedar negativo (sigue siendo la suma de movimientos) y Stock lo muestra en rojo. Revertir/borrar el pedido lo devuelve como hoy (AC-STK-3).
- **AC-SST-3** La tienda mantiene su configuración propia (`permitir pedir sin stock`, REQ-POR); este REQ no la cambia.

## REQ-HPR — Cambios de precio del día en PDF
- **AC-HPR-1** Cada vez que cambia `precio` o `precioBulto` de un producto (formulario, plantilla Excel, cualquier otro camino) se registra un cambio: producto, precio anterior → nuevo (de cada uno), fecha y hora, usuario. Registro con UUID, offline-first, sincronizado. Sin cambio real (mismo valor) no se registra.
- **AC-HPR-2** Sección "Cambios de precio" (Configuración o Productos, admin): elegir un día (default hoy) o un rango, ver la lista y bajar un **PDF** con código, producto, rubro, precio anterior, precio nuevo y variación %, ordenado por rubro y nombre. Si un producto cambió varias veces en el período, se muestra el primero anterior y el último nuevo.
- **AC-HPR-3** Opción "solo precio nuevo" para el PDF (lista para pasarle a clientes/vendedores: código, producto, precio por unidad, precio llevando bulto).
- **AC-HPR-4** El historial empieza a registrarse desde esta versión (no se reconstruye el pasado) y la pantalla lo aclara.

---

## REQ-FAB — Facturas A y B en pedidos + PDF para el contador
- **AC-FAB-1** En Facturación cada pedido tiene un selector **Factura A / Factura B / Sin factura** (`tipoFactura`, columna `tipo_factura`). Sugerencia por defecto según el tipo de IVA del cliente: Responsable Inscripto → A; el resto → B; sin dato → sin factura. Se puede marcar varios pedidos a la vez.
- **AC-FAB-2** Pedido marcado A con cliente sin CUIT válido → aviso visible (no bloquea).
- **AC-FAB-3** Reporte "Facturas a emitir" (admin): rango de fechas y filtro A/B/todas → lista y **PDF** con cliente, CUIT, tipo de IVA, tipo de factura, n.º de pedido, fecha y monto, agrupado A y B con subtotales y total general. Solo pedidos facturados no borrados.
- **AC-FAB-4** La boleta impresa muestra "Factura A" / "Factura B" en el encabezado cuando corresponde.

## REQ-AGR — Agrupar productos al facturar
Ej.: pedido con 10 sabores de Saphirus → en la boleta sale una línea "Saphirus — 3 bultos (36 u.) — $X".
- **AC-AGR-1** En Facturación el admin selecciona renglones y toca **"Agrupar"**; el nombre del grupo se sugiere con la marca común (o el rubro) y se puede editar. Se pueden deshacer grupos.
- **AC-AGR-2** El grupo se guarda en el pedido (`grupos: [{id, nombre, itemIds}]`); los renglones **siguen separados** para stock, armado, comisiones y estadísticas (agrupar no toca movimientos de stock).
- **AC-AGR-3** En la boleta (PDF) el grupo sale como una sola línea: nombre, unidades totales, bultos (si todos los renglones comparten `bultoX` → "3 bultos (36 u.)"; si no, solo unidades) y subtotal. Opción al imprimir: "con detalle" (el grupo y debajo sus renglones) o "solo grupos".
- **AC-AGR-4** Funciones puras (armar grupos, totales, texto de bultos) con tests, incluidos grupos con bultos mixtos, renglones eliminados y grupos vacíos.

## REQ-TRQ — Casilla "Transferencia a proveedor" en el troquel
- **AC-TRQ-1** En la parte de recorte de la boleta (abajo de todo, donde están "Efectivo" y "Transferencia") se agrega la casilla **"Transf. a proveedor"** con una línea "Proveedor: ________". No se superpone con nada (probar con boleta larga y con deuda pendiente).

## REQ-ZON — Logística por zona en lugar de por día
- **AC-ZON-1** Orden de entrega se organiza por **zona** (la zona de la ficha del cliente): cada cliente tiene un puesto (`ordenZona`) dentro de su zona. La pantalla deja elegir la zona, ver y reordenar sus clientes (mover arriba/abajo o escribir el número, corriendo a los demás como hoy).
- **AC-ZON-2** Imprimir: se eligen fecha(s) de pedido y una o varias zonas; los pedidos salen agrupados por zona y numerados sin huecos dentro de cada zona según quién tiene pedido (mismo criterio que hoy por día). El número de "ORDEN" de la boleta es el de la zona.
- **AC-ZON-3** Migración sin pérdida: la primera vez, el orden por zona se inicializa con el orden actual (día y luego orden). `diaEntrega`/`ordenEntrega` se conservan (no se borran ni se muestran). Clientes sin zona van a "Sin zona" al final.
- **AC-ZON-4** Funciones puras de orden por zona con tests (renumeración, empates, clientes sin zona, zonas con mayúsculas/espacios distintos se tratan como la misma).

---

## REQ-INA — Ingresos de mercadería con costo y Factura A/B
- **AC-INA-1** En el ingreso de mercadería (REQ-ING) cada renglón suma **Costo unitario** (opcional, ≥ 0) y **Factura A / Factura B** (default el de la cabecera, que también se elige). Un mismo ingreso puede tener renglones A y B. Se puede cargar el número de factura A y el de B.
- **AC-INA-2** El comprobante muestra subtotales de unidades y costo **por A y por B** y total.
- **AC-INA-3** Historial de ingresos filtrable por proveedor, fechas y A/B, con totales A vs B; y por producto se ve qué entró en A y qué en B. Exportable a PDF.
- **AC-INA-4** Al confirmar un ingreso con costo, opcionalmente (tilde, default sí) se actualiza el "Costo final" del producto (registra cambio de precio de venta si se recalcula, REQ-HPR).
- **AC-INA-5** Ingresos viejos sin costo/A-B se siguen viendo ("sin dato"). Los movimientos de stock no cambian (AC-ING-5).

## REQ-CPR — Cuenta con proveedores y pedidos al proveedor
- **AC-CPR-1** Sección **"Proveedores"** (admin): por proveedor, una **cuenta corriente** con saldo = compras − pagos. Compras = ingresos con costo (se cargan solos al confirmar el ingreso) + cargos manuales (ej. factura sin ingreso). Pagos = los que carga el admin.
- **AC-CPR-2** Cargar pago: fecha, monto, medio (**Efectivo / Transferencia / Transferencia directa del cliente al proveedor**), referencia/nota, y en "directa" el cliente/pedido opcional. Comprobante adjunto opcional (imagen/PDF máx. 5 MB a Storage privado, solo admin).
- **AC-CPR-3** Movimientos de la cuenta en orden de fecha con saldo acumulado, filtro por fechas y medio, totales por medio. PDF de estado de cuenta.
- **AC-CPR-4** **Pedido al proveedor**: el admin arma una lista (producto, cantidad en unidades o bultos) — con botón "Agregar los de stock bajo" (REQ-STB) —, la guarda como borrador, la comparte (PDF/WhatsApp con `share` existente) y la marca **recibida**: eso abre un Ingreso de mercadería precargado con esos productos y cantidades.
- **AC-CPR-5** Anular un pago o cargo con motivo (no se borra; queda registrado quién/cuándo). Saldos y totales en funciones puras con tests (centavos, negativos, anulados).

## REQ-STB — Sector Stock: búsqueda y avisos de stock bajo
- **AC-STB-1** Campo nuevo de producto **"Stock mínimo"** (`stockMinimo`, punto de reposición). Si está vacío se usa "Mínimo venta" como hoy (AC-STK-7 sigue valiendo).
- **AC-STB-2** Pantalla Stock: buscador por nombre/código/marca (sin tildes ni mayúsculas, palabras en cualquier orden) y filtros por rubro, marca, proveedor y estado (**sin stock / bajo / ok / negativo**).
- **AC-STB-3** Avisos: contador "N productos con stock bajo" visible en la pestaña Stock y arriba de la pantalla; lista de stock bajo con botón "Agregar al pedido al proveedor" (REQ-CPR) por producto o todos los de un proveedor.

---

## REQ-REN — Rendición: notas de crédito, devoluciones y cambios
- **AC-REN-1** Sección **"Rendición"** (admin): se anota sobre un pedido facturado (buscar por cliente/n.º/fecha) uno de: **Devolución** (productos y cantidades ≤ lo facturado menos lo ya devuelto, motivo), **Cambio** (sale producto X / entra producto Y con cantidades; diferencia de precio calculada) o **Nota de crédito** (monto y motivo, sin mercadería; opcional Factura A/B y n.º de NC).
- **AC-REN-2** Stock: devolución → movimientos `devolucion` positivos (vuelven al stock); cambio → `devolucion` del que vuelve + `venta` del que sale. Idempotente (reintentos o dos dispositivos no duplican), con UUID, como el resto del ledger. Opción por renglón "no vuelve al stock (roto/vencido)" → no genera movimiento y queda registrado como merma.
- **AC-REN-3** Plata: el crédito (devolución, NC o diferencia del cambio) se descuenta de la deuda pendiente del cliente si tiene; si no, queda como **saldo a favor** que se muestra en su próxima boleta. Una diferencia a pagar por el cliente en un cambio suma a su deuda.
- **AC-REN-4** Rendición del día: lista por fecha con totales (devuelto, NC, cambios, mermas) y **PDF**. Anular una rendición con motivo revierte sus movimientos de stock y su efecto en la cuenta del cliente (sin borrar nada).
- **AC-REN-5** Comisiones (REQ-COM/COMR): una devolución o NC sobre un pedido ya cerrado aparece como **ajuste pendiente** (AC-COM-13); si no está cerrado, baja la comisión del período.
- **AC-REN-6** Cálculos (cantidades disponibles para devolver, montos, saldo a favor, efecto en comisión) en funciones puras con tests.

---

## REQ-PAN — Panel de ganancia y rentabilidad
- **AC-PAN-1** Al facturar, cada renglón guarda su **costo unitario** del momento (`costoUnitario`: costo final neto de descuentos del producto, misma fórmula que `calcularPrecioVenta`). Pedidos viejos sin ese dato usan el costo actual y se marcan "costo estimado".
- **AC-PAN-2** Sección **"Panel"** (admin), período elegible (default mes en curso) con comparación contra el período anterior: ventas, costo, **ganancia bruta**, **margen %**, cantidad de pedidos y ticket promedio. Netos de devoluciones y NC (REQ-REN).
- **AC-PAN-3** Rentabilidad por **producto**, **rubro** y **marca** (ventas, unidades, ganancia, margen %), ordenable; y por vendedor y cliente.
- **AC-PAN-4** **Más vendidos** (top 10 por unidades y por importe), **en alza / en baja** (variación vs período anterior), **sin ventas** en el período y **tendencia** semanal/mensual (gráfico de barras simple en SVG, sin librerías nuevas).
- **AC-PAN-5** Avisos: productos con margen negativo o sin costo cargado.
- **AC-PAN-6** Todo el cálculo en `src/domain/panel.js` puro con tests (centavos, períodos vacíos, productos borrados, costo estimado). Rendimiento: con 20.000 renglones el cálculo tarda < 1 s (test).
