# Implementacion Bloque A — RUN 20261110-t1

## Por AC
- **AC-EDP-1**: `permisos.puedeEditarPedido`; boton "Editar" en `ListaPedidos` (prop `onEditar`); `App.js` guarda `pedidoAEditar` y monta `NuevoPedido pedidoEditarId/onFinEdicion`; `NuevoPedido` en modo edicion (carga el pedido, sin borrador, cliente/direccion/fecha bloqueados, mismas validaciones con `previos`). Facturado: sigue solo admin por Facturacion.
- **AC-EDP-2**: `edicionPedido.js` (`armadoEmpezado`, `renglonesCambiados`, `aplicarEdicion` con whitelist y marca `modificadoTrasArmado`, `confirmarModificacion`); badge "Modificado" en la lista; `confirmarModificacionOnlineFirst` listo para Armado (UI de Armado = B3).
- **AC-EDP-3**: mismo id/remoteId/clientUuid; `guardarPedidoOnlineFirst(p,{versionBase})` update condicional (0 filas => `{mode:'conflicto'}` y revierte); `editarPedidoOnlineFirst`, `resolverConflictoEdicion`; sync `syncPedidosPendientes` con update condicional por `baseRemoteUpdatedAt` (conflicto => `conflictoEdicion`, no throw, sigue); `traerPedidoRemoto`; `mapPedidoRemoto` guarda `remoteUpdatedAt`; lista con "Usar la del servidor" / "Subir la mia igual".
- **AC-MUL-1/2** (funciones puras): `minimos.js` (`pasoMinimo`, `cantidadConPasoMinimo`, `esCantidadValidaMinimo`, `ajustarAMultiploMinimo`, `validarMultiplosMinimoItems`); `tienda.js` (`pasoUnidades`, `validarRenglon`); migracion 024 (`tienda_cantidad_valida` + uso en `tienda_crear_pedido`).
- **AC-CBU-1/2/3** (funciones puras): `bultos.partirBultos/juntarBultos`, nuevo `casilleros.js` (`cambiarCasillero`, `botonesProductoLista`, `agregarBultoDesdeLista`, `precioVigenteRenglon`).
- **AC-SST2-1**: `stock.etiquetaSinStock` (la UI es B).
- **AC-MIN2-1**: `puedeGuardarBajoMinimo` y `puedeGuardarNoMultiplo` admitiendo admin en 'armado'.
- **AC-ASV-1**: `vendedorPedido.js`; selector "Vendedor del pedido" en NuevoPedido (admin y vendedor, solo activos, oculto si no hay a quien elegir; select comun porque `SelectorVendedor` es el login); guarda `vendedor`, `vendedorId`, `cargadoPor`, `cargadoPorId`, zona del dueño; `comisiones.asignacionPorDefecto` => 'cargador' al dueño si `cargadoPor` ≠ dueño.
- **AC-ASV-2**: web sin vendedor => `sin_comision`, `sinVendedorWeb` en la linea (tambien congelada), aviso (e) en `calcularAvisos` y `Comisiones.js`, ajuste `vendedor_asignado` (AC-COM-13); `PedidosWeb` con badge "Sin vendedor" y selector pre-cargado que el admin puede cambiar (`vendedorAlAceptar`: la eleccion gana); `ListaPedidos` selector generalizado para admin (cualquier pedido no borrado), via `asignarVendedorOnlineFirst`.
- **AC-PEN-1**: `pedidosPendientes.js`; bloque "Pendientes" en lista (solo hoy, sin busqueda); `pullPedidosPendientes` (syncService) expuesto como `traerPedidosPendientes` en `useAppContext`.
- Migracion `supabase/migrations/024_pedidos_edicion_vendedor.sql` (idempotente, tolerante, NO aplicada). `DB_VERSION` sin cambios.

## Tests nuevos
`domain/__tests__/tanda1.bloqueA.test.js`, `domain/__tests__/migracion024.sql.test.js`, `services/__tests__/pedidoRepository.edicion.test.js`.

## Tests viejos adaptados (no borrados)
- `minimos.test.js` `puedeGuardarBajoMinimo(1,'armado')`: 'no' => 'confirmar' (AC-MIN2-1).
- `unidadVenta.test.js`: `puedeGuardarNoMultiplo(1,'armado')` false => true; `validarMultiplosItems` admin en armado `bloquea` true => false (+ armador sigue bloqueando).
- `tienda.carrito.test.js`: `pasoUnidades(gaseosa,'unidad')` 1 => 2 (minimoVenta 2, AC-MUL-2); `__fixtures__/tiendaCasos.js`: caso Gaseosa 3 u. => 4 u. ($5.002).
- `pedidosWeb.test.js`: `vendedorAlAceptar` con eleccion del admin gana sobre el link (AC-ASV-2).

## Resultado
Tests completos: 239 suites, 3428 pasan. `npx react-scripts build`: OK.

## Queda para B
`BultoControl` (casillero Bultos), `ItemRow`/handlers de cantidad y lista de sugerencias de NuevoPedido (`cantidadConPasoMinimo`, `cambiarCasillero`, `ajustarAMultiploMinimo` con aviso, `precioVigenteRenglon`, botones Unidad/Bulto, "Sin stock — por recibir", `validarMultiplosMinimoItems` al guardar), Armado (banner Modificado, resaltar `productoIds`, "Confirmar cambios", confirm de admin bajo minimo/multiplo, `versionBase`), Facturacion. Notas: `pullPedidosByFecha` del vendedor sigue filtrando por `vendedor` (los pedidos que cargo para otro llegan por Pendientes o ya estan locales); `lineas` de cierres viejos sin `sinVendedorWeb` no generan ajuste de vendedor; sin tests de pagina para el modo edicion/Pendientes (pendiente para QA).

## Correcciones de seguridad y QA (segunda vuelta)
- **T1-A-01 (Alto)**: migracion 024 (sigue SIN aplicarse): trigger `set_vendedor_inmutable` (BEFORE UPDATE; conserva `vendedor`, `vendedor_id`, `cargado_por` para `anon/authenticated`; cargado_por/vendedor_id aceptan el primer valor si estaban vacios; INSERT intacto; las funciones security definer, p. ej. la RPC de la tienda y `admin_resolver_pedido_web`, no quedan afectadas) + RPC `admin_reasignar_vendedor_pedido` (security definer, `search_path` fijo, PIN de admin con `verificar_pin` como 023, flag `app.reasignando_vendedor`). App: `reasignarVendedorAdmin` (pedidoRepository) la usa desde ListaPedidos (pide PIN con `window.prompt`); sin la 024 o sin remoteId cae al camino anterior; offline no reasigna. PedidosWeb ya acepta por la RPC con PIN (sin cambios de escritura).
- **T1-A-02**: `congelarPrecios` recalcula el precio desde precios congelados/catalogo (`productosById`), ignora `precioManual`/`descuentoPct`; solo el grupoBulto admite un precio entre bulto y lista.
- **T1-A-03**: el alta por INSERT/upsert guarda `remoteUpdatedAt` (repositorio y sync; `markPedidoSynced` acepta `remoteUpdatedAt`).
- **T1-A-04**: todo guardado online de un pedido ya en la nube es condicional por la ultima version local conocida (Facturacion, entregado, Armado via `guardarPedidoOnlineFirst`; borrar tambien). Si el servidor cambio: error visible "El pedido cambio en otro dispositivo. Recarga..." y se revierte lo local; con `versionBase` explicito (editor) sigue devolviendo `{mode:'conflicto'}`. Offline no agrega base (evita conflictos por marcar entregado sin conexion).
- **T1-A-05**: `puedeEditarPedido` niega al vendedor pedidos `entregado` y `cerradoEn`.
- **T1-A-06**: `search_path` en `tg_set_updated_at` y `tienda_cantidad_valida`.
- Pendientes (bajos, anotados): T1-A-07 (guardar seccion 5 si falta 019), T1-A-08 (identidad por nombre), T1-A-09 (paginado de Pendientes sin desempate `order('id')`).
- **QA AC-CBU-2 / BUG-1**: `cambiarCasillero('sueltas')` opera solo sobre `c % bultoX` (con 0 sueltas no hace nada; completa el bulto al llegar a bultoX); 'bultos' solo sobre bultos; "solo bulto" conserva el paso de bulto. `restarBulto` con 0 bultos no hace nada; `BultoControl` agrega `sueltas-mas`/`sueltas-menos` (props `onSumarSueltas/onRestarSueltas`) y deshabilita "− Bulto" con 0 bultos; cableado en NuevoPedido, Facturacion y Armado (ops 'sumarSueltas'/'restarSueltas' en sus handlers de bulto). `qa.tanda1.bordes.test.js` esta en `__tests__` y queda en verde.
- Tests nuevos: `tanda1.seguridad.test.js`, `nuevoPedido.vendedor.test.js`, `listaPedidos.asignacion.test.js`, `pedidosWeb.vendedor.test.js`, casos en `pedidoRepository.edicion.test.js`.
- Tests viejos adaptados (anotados `// ADAPTADO`): `bultos.test.js` (restarBulto con 0 bultos), `bultos.pedido/armado/facturacion.test.js` (AC-BUL-3 desde 5: queda 5), `precioMinimoStock.pedido.test.js` (bajar del bulto con "− Bulto").
- Resultado: 247 suites, 3517 tests verdes; `npx react-scripts build` OK.
