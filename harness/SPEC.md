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
| Comisión | `comision` | `comision` | % entre 0 y 100 |
| Fecha de alta | `fechaAlta` | `fecha_alta` | Default hoy (YYYY-MM-DD) |
| Tipo de cliente | `tipoCliente` | `tipo_cliente` | |
| Rubro | `rubro` | `rubro` | |

- **AC-CLI-1** El formulario de alta/edición muestra exactamente esos 17 campos con esas etiquetas.
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
| Rubro | `categoria` | |
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
| % de comisión | El de la ficha del cliente (`comision`), congelado al momento del cierre |
| A quién le corresponde | Al **vendedor de la ficha del cliente**. Si el pedido lo cargó otro vendedor, el admin decide: todo a uno, todo al otro, o dividir |
| Cierre | Por período: se revisa, se confirma y queda guardado e inmodificable. Un pedido cerrado no vuelve a contar en otro cierre |

### Marca de entregado
- **AC-COM-1** En Facturación y en Orden de entrega, un pedido facturado tiene un botón "Marcar entregado" / "Desmarcar". Guarda `entregado`, `entregadoAt` y `entregadoPor`, se sincroniza con Supabase (columnas nuevas, tolerando que no existan todavía, como AC-CLI-5) y no modifica `estado` ni el stock.

### Dashboard
- **AC-COM-2** Nueva sección "Comisiones" solo para admin (AC-SEC-4). Un vendedor o armador no la ve ni puede entrar.
- **AC-COM-3** El admin elige el período (por defecto, el mes en curso). Cuentan solo pedidos `facturado` + `entregado`, no borrados/cancelados, con fecha dentro del rango y que **no** pertenezcan a un cierre vigente.
- **AC-COM-4** Comisión del pedido = total del pedido × % de comisión del cliente / 100, redondeado a 2 decimales. Cliente sin % cargado → comisión 0 y aviso "cliente sin % de comisión".
- **AC-COM-5** Resumen por vendedor: cantidad de pedidos, cantidad de clientes, total vendido y total de comisión. Al tocar un vendedor se ve el detalle por cliente y por pedido.
- **AC-COM-6** Avisos visibles arriba del dashboard, con contador: (a) pedido cargado por un vendedor distinto al de la ficha del cliente, (b) cliente sin vendedor asignado en la ficha, (c) cliente sin % de comisión, (d) pedidos facturados del período sin marcar como entregados (informativo, no se cuentan).

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
- **AC-PLA-2** En Configuración → Clientes hay un botón "Descargar plantilla Excel" que baja `plantilla_clientes.xlsx` con los 17 campos de REQ-CLI, en ese orden y con esas etiquetas.
- **AC-PLA-3** La importación de productos (CSV/XLSX) reconoce todas las columnas de la plantilla y valida con las mismas reglas que el formulario (código obligatorio y único, % 0–100, enteros ≥ 1 para bulto/mínimo, precios ≥ 0, proveedor existente). Si Precio venta 1 viene vacío se calcula con AC-PROD-1. Upsert por código (si no hay código, por nombre, como hoy). Sigue aceptando los archivos viejos (nombre/precio/código/unidad/categoría) — AC-PROD-5.
- **AC-PLA-4** Nueva importación de clientes (CSV/XLSX) desde la pestaña Clientes, con las mismas validaciones de REQ-CLI (código obligatorio y único, razón social y domicilio obligatorios, CUIT con dígito verificador y normalizado, provincia de la lista, tipo de IVA de la lista, comisión 0–100, vendedor existente, fecha de alta default hoy). Upsert por código de cliente. Se sincroniza como un alta normal (AC-CLI-5).
- **AC-PLA-5** Al terminar, un resumen: creados, actualizados y rechazados, con número de fila y motivo de cada rechazo. Una fila inválida no frena el resto.
- **AC-PLA-6** Seguridad: celdas exportadas e importadas protegidas contra formula injection (AC-SEC-3); límite de 5 MB y solo admin para parsear XLSX (S-07 / S-DEP-01).
- **AC-PLA-7** Columnas, validación por fila y armado de la plantilla son funciones puras en `src/domain/` con tests; un test garantiza que plantilla e importación usan las mismas columnas (round-trip: plantilla → completar → importar).
