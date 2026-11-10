# QA — RUN 20261110-t1 (EDP, MUL, CBU, SST2, MIN2, ASV, PEN)

Suite completa: 243 suites, 3486 pasan, **4 fallan (todos GAP/BUG de AC-CBU-2, a proposito)**. Tests nuevos: `src/domain/__tests__/qa.tanda1.bordes.test.js` (27 tests, 23 verdes). No se toco produccion.

## Tabla AC -> test
| AC | Tests existentes (implementadores) | Bordes QA agregados |
|---|---|---|
| EDP-1 | domain `tanda1.bloqueA` puedeEditarPedido; `ListaPedidos.tanda1` (propio si, ajeno no, facturado no, cargadoPor, sin onEditar); `NuevoPedido.tanda1` modo edicion; `pedidoRepository.edicion` (ajeno) | nombre con espacios/mayus/tildes, prefijo no, 'Facturado' en otra capitalizacion, vendedor sin nombre/WEB, armador; vendedor no cambia precio ni vendedor/estado |
| EDP-2 | `aplicarEdicion` marca; Armado banner/confirmar/sin marca | guardar sin cambios no marca; quitar renglon marca; ediciones seguidas acumulan ids; armado solo por armadoLog |
| EDP-3 | `hayConflictoVersion`; repo: update condicional, 0 filas => conflicto, offline; Armado versionBase/conflicto | version invalida/vacia/null; pedido viejo sin remoteUpdatedAt |
| MUL-1 | 3->6->9, vacio/0/1, tipear 7->9 (domain y UI) | 0->3, 7->6 al restar, minimo string, producto null, valores basura/decimales |
| MUL-2 | convive con bulto, Armado 6->12->6, validarMultiplos | 9->12->24 y 24->12->9 con minimo 3 + bulto 12; pedido viejo no se bloquea si no se toca; eliminado se saltea |
| CBU-1 | domain botones y agregar bulto; UI NuevoPedido | - |
| CBU-2 | partir/juntar; bulto no suma minimo; UI partidos | **GAP/BUG, ver abajo** |
| CBU-3 | precioVigenteRenglon; UI cambia al cruzar bulto | - |
| SST2-1 | etiquetaSinStock; UI stock 0 y negativo en NuevoPedido y Armado | - |
| MIN2-1 | Armado admin confirma/cancela; armador bloqueado por multiplo | matriz por rol (1/2/3/null/undefined) y pantalla 'pedido'; vendedor y armador bloquean multiplo |
| ASV-1 | datosVendedorAlCrear, comision al dueno | elegido inactivo/inexistente, vacio, sin args |
| ASV-2 | sin comision + aviso, ajuste COM-13 | WEB con espacios/mayus/null/vacio |
| PEN-1 | domain pedidosPendientesVisibles; ListaPedidos bloque Pendientes | ayer/manana (singular), fecha con hora, hoy invalido, basura |

No cubierto por tests de pagina: selector "Vendedor del pedido" en NuevoPedido y selector de ListaPedidos/PedidosWeb (solo hay domain). Recomendado para otra tanda.

## Desvio AC-CBU-2: NO cumple la intencion
El AC pide dos casilleros (Bultos / Unidades sueltas) con +/− cada uno. Hoy: "Unidades sueltas" es solo texto en `BultoControl`; el `.qty-control` opera sobre el TOTAL de unidades con `cambiarCasillero(...,'sueltas')`, que es `cantidadConPasoMinimo` (AC-FRB-4: desde el bulto va de a bulto). Resultado, con bultoX 12 'ambos':
- 24 u. (2 bultos, 0 sueltas), "−" => 12: baja un bulto entero (no hay sueltas que restar).
- 30 u. (2 bultos + 6), "−" => 24: quita las 6 sueltas de golpe, no 1 (o 3 con minimo 3).
- Sin minimo/"ambos" en otros casos, "−" por debajo del bulto parte un bulto en sueltas (12 -> 11) => "restar a mano" sigue siendo necesario.
Falta exactamente:
1. En `BultoControl` (y NuevoPedido/Armado/Facturacion): botones `sueltas-mas` / `sueltas-menos` junto a "Unidades sueltas", y el casillero de Bultos con su contador propio.
2. `cambiarCasillero(c, prod, 'sueltas', op)` debe operar solo sobre `c % bultoX` (paso = minimo si > 1, si no 1), sin tocar los bultos: con 0 sueltas el "−" no hace nada; "+" que llega a bultoX puede pasar a +1 bulto y 0 sueltas (misma cuenta total).
3. Mantener `item.cantidad` = bultos*bultoX + sueltas (ya es asi) y mover el `.qty-input` total a lectura o dejarlo, ajustando los tests viejos.
Tests que fallan: `AC-CBU-2 GAP ...` (3) en `qa.tanda1.bordes.test.js`.

## Bugs
- **BUG-1 (AC-CBU-2, `cambiarCasillero(...,'bultos','restar')` y `aplicarBulto` en NuevoPedido)**: con 0 bultos y solo sueltas (ej. 5 u., bultoX 12) tocar "− Bulto" lleva la cantidad al piso (0 en dominio; 1 o el minimo en pantalla) y borra las sueltas en vez de no hacer nada. Repro: agregar producto bultoX 12, tipear 5, tocar "− Bulto". Test: `AC-CBU-2 BUG restar bulto con 0 bultos ...` (falla). Causa: `restarBulto` usa `Math.max(piso, c - bx)`; deberia no actuar si `c < bx`.
