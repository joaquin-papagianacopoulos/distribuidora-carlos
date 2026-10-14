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
