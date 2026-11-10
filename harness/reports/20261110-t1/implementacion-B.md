# Implementacion Bloque B — RUN 20261110-t1

## Por AC
- **AC-CBU-1** `NuevoPedido` (lista de sugerencias): botones `lista-unidad` "Unidad $X" y `lista-bulto` "Bulto xN $Y" (`botonesProductoLista`; solo con permiso de bulto, `bultoX > 1`, y "Unidad" oculto si el producto es solo bulto); "Bulto" usa `agregarBultoDesdeLista` (1 bulto, sin sumar minimo).
- **AC-CBU-2** `BultoControl`: casillero "Bultos: N · Unidades sueltas: M" (`partirBultos`), con `bulto-mas`/`bulto-menos` (+/− de bulto, `restarBulto` como antes). El `.qty-control` sigue siendo la cantidad total en unidades (ver desvio abajo).
- **AC-CBU-3** `ItemRow`: `precio-vigente` ("Precio unidad $X" / "Precio bulto $Y c/u", `precioVigenteRenglon`) en productos con bulto.
- **AC-MUL-1/2** `NuevoPedido`, `Armado`, `Facturacion`: +/− y volver a tocar el producto con `cantidadConPasoMinimo` (via `cambiarCasillero` en NuevoPedido); al salir del campo (blur) lo tipeado se ajusta con `ajustarAMultiploMinimo` y aviso `aviso-ajuste` "Se ajustó a N (de a m)"; error `error-multiplo` por renglon; guardar valida `validarMultiplosMinimoItems` (Nuevo pedido/edicion: bloquea; Armado/Facturacion: admin con `window.confirm`).
- **AC-SST2-1** Etiqueta "Sin stock — por recibir" en sugerencias (`sugerencia-sin-stock`) y renglones de NuevoPedido/Armado/Facturacion (`sin-stock-por-recibir`). Nunca oculta ni bloquea (se confirmo que `searchProductos` no filtra por stock).
- **AC-MIN2-1** `Armado.guardarArmado`: bajo el minimo / fuera de multiplo del bulto o del minimo => admin `window.confirm`, vendedor/armador `alert` y no guardan; el aviso del renglon dice "como admin lo podés guardar con confirmación" solo para admin. Orden de chequeo: minimo, luego multiplo.
- **AC-EDP-2** `Armado`: badge `badge-modificado` en la lista, banner `banner-modificado` con "Confirmar cambios" (`confirmarModificacionOnlineFirst`, la marca se va) y renglones `renglon-modificado` resaltados (`productoIds`).
- **AC-EDP-3** `Armado.guardarArmado` pasa `{ versionBase: armando.remoteUpdatedAt }` (solo si existe; sin version llama con 1 argumento como antes); `mode:'conflicto'` => avisa, baja la version del servidor, recarga y cierra el armado.
- **AC-EDP-1 / AC-PEN-1** (pendiente de A): tests de pagina nuevos para modo edicion y bloque Pendientes.

## Archivos tocados
`src/components/BultoControl.js`, `src/pages/NuevoPedido.js` (ItemRow, handlers, sugerencias, guardar), `src/pages/Armado.js`, `src/pages/Facturacion.js`.

## Tests nuevos
`pages/__tests__/NuevoPedido.tanda1.test.js` (CBU-1/2/3, MUL-1/2, SST2-1, EDP-1 edicion), `pages/__tests__/ListaPedidos.tanda1.test.js` (EDP-1 boton Editar, PEN-1 Pendientes), `pages/__tests__/Armado.tanda1.test.js` (MIN2-1 por rol, MUL, SST2-1, EDP-2 banner/confirmar, EDP-3 version/conflicto).

## Tests viejos adaptados (no borrados ni salteados)
- `precioMinimoStock.armado.test.js` "AC-PBU-3 ... sumar un bulto": el pedido arranca en 6 (multiplo del minimo 6) y queda 6+12=18, total 144; antes 8+12=20 que ahora es fuera de multiplo (AC-MUL-2).
- Todos los `data-testid` existentes se mantienen (`bulto-mas`, `bulto-menos`, `bulto-desglose`, `bulto-precio`, `aviso-stock`, `aviso-minimo`, `aviso-multiplo`).

## Desvios / decisiones
- Casillero "Unidades sueltas": para no romper los tests de bultos/minimos (el `.qty-input` es el total, ej. 41) se mantuvo el `.qty-control` como cantidad total y las sueltas se muestran como lectura ("Unidades sueltas: M") junto al contador de bultos. Los +/− de bultos y del total son independientes. Si se quiere un casillero de sueltas editable aparte hay que reescribir esos tests.
- Facturacion: `+` en el tope MAX_CANTIDAD sigue pasandose de largo a proposito para que el guardado lo frene (test AC-BUL-7/STK-8 intacto).
- `Facturacion`/`Armado` mantienen `BultoControl` (ahora con el casillero de lectura); B5 (tienda) no requirio cambios: `pasoUnidades` ya usa `pasoMinimo`.

## Resultado
`CI=true npx react-scripts test --watchAll=false`: 242 suites, 3463 pasan (1 skipped y 5 todo preexistentes). `npx react-scripts build`: OK. No se corrio `run-gates.mjs` completo.

## Nota (segunda vuelta, hecha desde el bloque A)
- AC-CBU-2: `BultoControl` suma `sueltas-mas`/`sueltas-menos`; el casillero de sueltas opera solo sobre `c % bultoX` y "− Bulto" con 0 bultos no hace nada. Cableado en NuevoPedido, Facturacion y Armado (ops 'sumarSueltas'/'restarSueltas'). Tests de AC-BUL-3 adaptados (desde 5 u. queda 5). Detalle en implementacion-A.md.
- T1-A-04: Armado/Facturacion ya guardan con update condicional por version (centralizado en `guardarPedidoOnlineFirst`); ante conflicto lanzan error visible.
