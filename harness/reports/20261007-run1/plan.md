# Plan técnico — RUN 20261007-run1 (fase arquitecto)

## Modelo de datos
### IndexedDB (`DB_VERSION` 3 → 4, aditivo)
| Store | keyPath | Índices | Nota |
|---|---|---|---|
| `proveedores` | `id` (UUID) | `codigo` | nuevo |
| `movimientosStock` | `id` (UUID) | `productoId`, `ref` | nuevo — ledger |
| `ingresos` | `id` (UUID) | `proveedorId` | nuevo — cabecera + items embebidos |
| `clientes`, `productos` | sin cambios de clave | — | campos nuevos opcionales |

### Supabase (`supabase/migrations/001_altas_y_stock.sql`)
- `clientes` + 14 columnas; `productos` + 8 columnas (todas `add column if not exists`, nullables).
- Tablas nuevas `proveedores`, `movimientos_stock`, `ingresos_mercaderia` (PK `uuid`/`text`, `updated_at` con trigger), vista `stock_actual`.
- `unique (proveedor_id, lower(factura_proveedor))` en ingresos. RLS habilitado.

### Mapeo UI → interno (retrocompatible)
Razón social→`nombre`, Domicilio de entrega→`direccion`, Celular→`telefono`, Descripción (producto)→`nombre`, Rubro (producto)→`categoria`, Precio venta 1→`precio`.

## Dominio puro (`src/domain/`)
- `validacion.js`: `toNum`, `toInt`, `texto`, `validarCuit`, `formatearCuit`, `csvSafe`.
- `clientes.js`: `validarCliente(form, existentes, {editId})`, `clienteToRemote`, `clienteFromRemote`.
- `proveedores.js`: `validarProveedor`, `puedeBorrarProveedor`.
- `productos.js`: `calcularPrecioVenta`, `validarProducto`, `productoToRemote`, `productoFromRemote`.
- `stock.js`: `calcularStock`, `refsPedido`, `movimientosParaPedido` (delta idempotente), `verificarStock`, `movimientoAjuste`, `validarIngreso`.

## Servicios
- `src/services/stockService.js`: `aplicarStockPedido`, `ajustarStock`, `registrarIngreso`, `syncStock` (push UUID upsert + pull incremental por `updated_at`).
- `markPedidoSynced` re-keyea `pedido-local:<id>` → `pedido:<remoteId>` en los movimientos.

## UI
- `components/ClienteForm.js`, `ProductoForm.js`, `ProveedorForm.js`.
- `Configuracion.js`: pestaña Proveedores + formularios nuevos.
- `pages/Stock.js` (admin): listado/alertas, ingreso de mercadería, historial, movimientos.
- `NuevoPedido.js`: stock disponible + aviso mínimo de venta.
- `Facturacion.js`: facturar / revertir / borrar / editar → `aplicarStockPedido`.

## Riesgos y mitigación
| Riesgo | Mitigación |
|---|---|
| Dos dispositivos descuentan stock offline | Ledger con UUID; nunca se sincroniza el número |
| Reintentos duplican descuentos | `movimientosParaPedido` calcula delta contra lo ya registrado (idempotente) + upsert por id |
| Supabase sin las columnas nuevas | upsert tolerante: reintenta con columnas legacy y avisa |
| Pedido facturado offline sin remoteId | ref local + re-key al sincronizar |

## Supuestos
- "Precio venta 2" es una segunda lista manual (no se calcula).
- Stock inicial de productos existentes = 0 hasta que se cargue (ajuste o ingreso).
- `STOCK_POLICY = 'advertir'` por defecto (el stock real todavía no está cargado).
