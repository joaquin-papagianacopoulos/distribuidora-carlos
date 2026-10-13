# Veredicto tech lead — RUN 20261007-2004 — REQ-BUL

VEREDICTO: APROBADO

Alcance revisado: AC-BUL-1..8 (harness/SPEC.md). Archivos: `src/domain/bultos.js`, `src/domain/armado.js`,
`src/components/BultoControl.js`, `src/pages/NuevoPedido.js`, `src/pages/Facturacion.js`, `src/pages/Armado.js`,
tests en `src/domain/__tests__/{bultos,armado,security.bultos}.test.js`, `src/components/__tests__/BultoControl.test.js`,
`src/pages/__tests__/bultos.{pedido,facturacion,armado}.test.js` y 2 casos nuevos en `src/services/__tests__/stockService.test.js`.
Sin diff de git disponible (archivos sin trackear): la revisión se hizo sobre el código actual + plan/implementación.

## Gates
- unit-tests PASS (re-corrido por el tech lead: 27 suites, 478 passed, 1 skipped), coverage-domain 100%, build, secret-scan, security-rules, npm-audit PASS.
- traceability FAIL **solo** por AC-COM-1..16 (REQ-COM, fuera de alcance, corrida 20261007-2022). Verificado en `gates.json`: ningún AC-BUL figura en `faltan`. Conteo de tests con ID en el título: BUL-1:9, BUL-2:10, BUL-3:10, BUL-4:5, BUL-5:4, BUL-6:1, BUL-7:25, BUL-8:8. No bloquea este merge.

## Revisión
- **Correctitud**: dominio puro, sin React/IndexedDB; `sumarBulto`/`restarBulto`/`desgloseBultos` cumplen los ejemplos literales del SPEC (0→36, 5→41, "36 u. = 3 bultos", "41 u. = 3 bultos + 5 u."). Etiqueta `+ Bulto (x N)` exacta. Handlers con updater funcional (NuevoPedido, Armado) y, en Facturación, cálculo fuera del updater con `itemsEditRef` y actualización de `draftByPid` + `draftRef` (cubre la trampa de `guardarEdicion` que prioriza el texto del borrador).
- **Stock (regla dura 4)**: ninguna pantalla escribe stock; solo cambia `item.cantidad`. `guardarPedidoOnlineFirst` sin `iniciarStock` → `aplicarStockPedido` → `movimientosParaPedido` emite solo la diferencia, idempotente, y no toca pedidos legacy sin movimientos (`stockService.js:44-56`).
- **Retrocompatibilidad**: sin cambios de `DB_VERSION`, stores ni sync. `bultoX` no se copia al ítem (desglose con el valor actual). `armadoLog.cambios` es clave opcional: lectores toleran ausencia/no-array (`acotarCambiosArmado`), y `guardarEdicion` la preserva solo si ya existía. Un cliente viejo que guarde desde Armado pierde `cambios` (aceptable, informativo).
- **Offline**: no hay llamadas de red nuevas; todo sigue el patrón local + `pendingSync`.
- **Hooks**: el `useEffect` nuevo de `Facturacion.js:218` está antes del return temprano de no-admin (`:251`); `productosById` en `Armado.js:136` sin returns previos.
- **UTF-8 (regla dura 7)**: archivos nuevos y cambios en UTF-8 sin mojibake. Las 4 cadenas rotas existentes (`Facturacion.js:254,257,500`, `NuevoPedido.js:89`) son anteriores a este REQ (ver más abajo, sugerencia 1).
- **Nombres / código muerto**: nombres claros en español. `tieneBulto` se exporta y solo se usa en tests (API de dominio documentada en el plan; aceptable).

## Verificación manual de 3 AC
1. **AC-BUL-3** — `bultos.pedido.test.js:100-116`: desde 5, "− Bulto" deja 1, el renglón sigue y el botón queda deshabilitado; desde 41 deja 29. Código: `NuevoPedido.js:290-299` llama `restarBulto(..., { minimo: CANTIDAD_MINIMA_RENGLON })`; `bultos.js:52-60` pone el piso y no borra el renglón. Cumple (piso 1 en pantalla = supuesto 1 del plan, coherente con "se comporta como hoy al vaciar la cantidad").
2. **AC-BUL-6** — `bultos.pedido.test.js:129-144`: mínimo 24 / stock 30; con 1 avisa mínimo, con 25 no hay avisos, con 37 avisa stock. Código: `NuevoPedido.js:456` recalcula `avisosItemPedido` en render con `item.cantidad` ya modificado por el bulto. Cumple.
3. **AC-BUL-7** — `bultos.facturacion.test.js:109-127` (guarda 41, total correcto, sin `iniciarStock`) + `stockService.test.js:646-669` (5→41 emite solo −36, re-aplicar no emite nada, legacy sin movimientos no descuenta) + `bultos.armado.test.js:102-121` (`armadoLog.cambios` = 5→41). Código: `Facturacion.js:443-461`, `Facturacion.js:583-620`, `Armado.js:531-539`, `stockService.js:44-56`. Cumple.

## Cambios requeridos (bloqueantes)
Ninguno.

## Sugerencias (no bloqueantes, para una próxima iteración)
1. `src/pages/Facturacion.js:254`, `:257`, `:500` y `src/pages/NuevoPedido.js:89` — mojibake anterior al REQ ("FacturaciÃ³n", "No tenÃ©s", "invÃ¡lido"). Se ven en la UI; corregir en un cambio chico aparte (regla dura 7).
2. S-BUL-04 (Medio, ABIERTO) — `src/pages/Facturacion.js:583-620` y `src/pages/Armado.js:479-545`: editar un pedido ya facturado no pasa por `previsualizarStockPedido`; "+ Bulto" amplifica el riesgo de dejar stock negativo sin aviso. Requiere decisión del dueño (avisar/confirmar o bloquear según `STOCK_POLICY`).
3. S-BUL-06 (Bajo) — `src/pages/Armado.js:462-467` (`setCantidadArmadoTexto`) y la fusión de duplicados en `guardarArmado` (`Armado.js:487-492`), más `Facturacion.js:591-592`: cantidades manuales sin tope `MAX_CANTIDAD` (el botón Bulto sí lo respeta).
4. S-BUL-08 (Info) — `getProductoActual` en `Facturacion.js` cae a búsqueda por nombre: el `bultoX` podría salir de un homónimo. Resolver solo por id para el bulto.
5. UX — `src/components/BultoControl.js:245-251`: con cantidad legacy decimal o cuando sumar superaría `MAX_CANTIDAD`, "+ Bulto" queda visible pero no hace nada sin feedback. Opcional: deshabilitarlo en esos casos.
6. `src/domain/bultos.js:22` — `tieneBulto` no lo usa ninguna pantalla (solo tests); usarlo o quitarlo cuando se toque la zona.

## Pasos manuales para el dueño
1. **Migración SQL**: no hace falta para REQ-BUL (`productos.bulto_x` y `pedidos.armado_log` ya existen).
   - Verificar en el SQL editor que `pedidos.armado_log` es `jsonb` (`select data_type from information_schema.columns where table_name='pedidos' and column_name='armado_log';`).
   - Recomendado (defensa en profundidad, S-BUL-05): aplicar el CHECK `pedidos_armado_log_chk` del `security-report.md` (con `not valid`).
   - Pendiente de seguridad general (S-01/S-BUL-01, crítico y preexistente): aplicar `supabase/migrations/002_seguridad_recomendada.sql` pasos 1-4 y planificar Auth (paso 5). Sin eso, AC-BUL-8 es solo control de UI.
2. **Deploy**: `npx react-scripts build` y publicar el build como siempre. Que armadores y admins actualicen la PWA (recargar/cerrar y abrir) para que no quede una versión vieja que, al guardar un armado, descarte `armadoLog.cambios`.
3. **Confirmar con el cliente** (supuestos del plan): (a) "− Bulto" no baja de 1 unidad en pantalla; (b) "+ Bulto" sobre un renglón recién agregado (cantidad 1) deja 1 + bultoX (p. ej. 13); (c) con menos de 1 bulto no se muestra desglose.
4. **Prueba de humo en un dispositivo real** después del deploy: en un pedido facturado de prueba, sumar un bulto en Facturación, guardar y revisar en la pantalla de Stock que el movimiento sea solo por la diferencia; repetir en Armado y ver "Cantidades cambiadas" en el resumen de Facturación.

---

# AC-BUL-9 (2026-10-08) — Veredicto tech lead

VEREDICTO: APROBADO

Alcance:
- `harness/SPEC.md` AC-BUL-9 y la sección "AC-BUL-9 (2026-10-08)" de `implementacion.md`.
- Código: `src/domain/bultos.js`, `src/pages/NuevoPedido.js`, `src/pages/Facturacion.js` y `src/pages/Armado.js`.
- Tests: `src/domain/__tests__/bultos.cantidadPorDefecto.test.js` y `src/pages/__tests__/bultos.{pedido,facturacion,armado}.test.js`.
- `gates-ac-bul-9.json`: 7/7 PASS.
- Lo volví a correr yo: `CI=true npx react-scripts test --watchAll=false` dio 47 suites OK; 874 passed, 1 skipped, 2 todo.

## La marca `_cantidadPorDefecto` no se persiste ni se sincroniza

**Dónde se pone:** en un solo lugar, `renglonNuevo` (`bultos.js:59-70`), y solo al agregar un producto nuevo (`NuevoPedido.js:264`, `Facturacion.js:417`, `Armado.js:413`).

**Dónde se quita:** en los tres únicos caminos que guardan renglones editados:
- `NuevoPedido.js:356`: `crearPedidoOnlineFirst({ items: quitarMarcasRenglones(items) })`;
- `Facturacion.js:607`: `guardarEdicion` parte de `quitarMarcasRenglones(itemsEdit)`;
- `Armado.js:495`: `itemsFinal` pasa por `quitarMarcasRenglones`. Lo hace antes de `registrarFaltantes`, de `cambiosDeCantidad`, del `armadoLog` y de `guardarPedidoOnlineFirst`. `removidos` se arma con campos explícitos, así que tampoco la lleva.

**Por qué no se filtra por otro lado:**
- Los demás guardados de esas pantallas trabajan sobre el pedido ya persistido, que nunca tiene la marca: facturar, deuda y revertir en `Facturacion.js:698,711,733-736`; armado y "a reparto" en `Armado.js:354,368`.
- No hay cambios de `DB_VERSION`, stores, `syncService` ni SQL.

**Tests que lo fijan:** los tres tests de pantalla "la marca no llega a lo que se guarda" (por ejemplo, `bultos.pedido.test.js:223-246` hace `expect(JSON.stringify(items)).not.toContain('_cantidadPorDefecto')`), con un renglón tocado y otro sin tocar.

**Única excepción, documentada y aceptada:** el borrador de Nuevo Pedido en localStorage (`NuevoPedido.js:224-238`) guarda la marca. Es estado de pantalla, queda en el dispositivo y nunca se sube. Al recuperar el borrador el comportamiento es el mismo. Un borrador viejo sin marca suma normal, que es el lado seguro.

## AC-BUL-1..8 siguen valiendo
- **AC-BUL-1, 4, 5 y 8:** `sumarBulto`, `restarBulto`, `desgloseBultos`, `etiquetaBotonBulto`, `normalizarBultoX` y `puedeUsarBulto` no cambiaron (`bultos.js:13-48` y `:97-140`).
- **AC-BUL-2:**
  - `sumarBultoRenglon` (`bultos.js:76-81`) reemplaza solo si `cantidadPorDefecto === true` **y** la cantidad es 1. En cualquier otro caso delega en `sumarBulto`, así que siguen valiendo S-BUL-02 y `MAX_CANTIDAD`.
  - Los renglones sembrados desde un borrador o un pedido guardado no tienen marca y suman como antes: 0 → 36 y 5 → 41.
  - El reemplazo de la unidad inicial es la excepción explícita que pidió el dueño en AC-BUL-9.
- **AC-BUL-3:** "− Bulto" mantiene el piso de 1. Si no cambia la cantidad, no toca el renglón y la marca queda, lo cual es correcto porque nadie cambió la cantidad.
- **AC-BUL-6:** los avisos se recalculan en el render con la cantidad resultante. El test previo 1 → 13 → 25 → 37 sigue verde porque el renglón sembrado no es un alta.
- **AC-BUL-7:** el stock sigue yendo solo por diferencia en `guardarPedidoOnlineFirst`, y `cambiosDeCantidad` recibe `itemsFinal` sin la marca.
- **Tests:** no se ajustó ninguno de los existentes y todos siguen verdes.

## Verificación manual de AC-BUL-9 en las tres pantallas

**1. Nuevo Pedido** — Cumple.
- Tests: `bultos.pedido.test.js:182-221` (alta y "+ Bulto" da 12; tres toques dan 36; 1 escrito a mano da 13; "+"/"−" o "− Bulto" quitan la marca).
- Código:
  - `NuevoPedido.js:288-297` (`aplicarBulto` con updater funcional);
  - `NuevoPedido.js:278-283` (`setCantidad` quita la marca);
  - `ItemRow` (`NuevoPedido.js:47-63`): el blur sin cambios no llama a `onSetCantidad`, así que no quita la marca.

**2. Facturación** — Cumple.
- Tests: `bultos.facturacion.test.js:275-330`.
- Código: `Facturacion.js:454-472`. `aplicarBulto` calcula con `itemsEditRef` y actualiza `draftRef` y `draftByPid`, así que lo guardado es 12 y no el "1" del borrador de texto.
- `draftCantidad` (`Facturacion.js:490-504`) quita la marca solo si el texto cambia. Un blur que reescribe el mismo texto la conserva, y hay test para eso.

**3. Armado** — Cumple.
- Tests: `bultos.armado.test.js:256-300`.
- Código:
  - `Armado.js:451-460` (`aplicarBultoArmado`);
  - `Armado.js:462-467` (escribir quita la marca);
  - `Armado.js:436` (al fusionar con un tachado restaurado se quita la marca);
  - `Armado.js:495` (se quita al guardar).

## Cambios requeridos (bloqueantes)
Ninguno.

## Sugerencias (no bloqueantes)
1. **`src/pages/Facturacion.js:474` (`setCantidad`, único llamador en `:503`):** no quita la marca por sí mismo; depende de que `draftCantidad` lo haga antes. Hoy es correcto, pero es frágil si alguien agrega otro llamador. Conviene usar `quitarMarcasRenglon` adentro de `setCantidad`, como en NuevoPedido y Armado.
2. **Límite de React, para avisarle al dueño:** si el usuario selecciona el "1" y vuelve a tipear "1", el valor no cambia y React no dispara `onChange`, así que la marca queda y "+ Bulto" da 12. Para el usuario es indistinguible de "no lo toqué" y no viola la intención de AC-BUL-9. Si borra el campo y después escribe 1, sí suma (13), y hay test para eso.
3. **`src/pages/Armado.js:462-467`:** vaciar el campo (texto no numérico) quita la marca aunque la cantidad no cambie. Es coherente con "lo cambió a mano" y no hace falta cambiarlo.
4. **Este mismo veredicto, punto 3(b) de "Pasos manuales" de REQ-BUL:** queda **superado** por AC-BUL-9. Sobre un renglón recién agregado, "+ Bulto" deja ahora `bultoX` (12) y no 1 + `bultoX` (13).

## Pasos manuales para el dueño (AC-BUL-9)
1. **Migración SQL:** no hace falta. No hay cambios de esquema local ni remoto.
2. **Deploy:** sale junto con el build de la corrida 20261007-2022, siguiendo el orden de `harness/reports/20261007-2022/veredicto.md`. Que todos recarguen la PWA.
3. **Prueba de humo** con un producto con bulto x12, en Pedido, Facturación (editar) y Armado:
   - agregar el producto y tocar "+ Bulto": tiene que quedar 12;
   - tocarlo dos veces más: 36;
   - en otro renglón, escribir 1 a mano y tocar "+ Bulto": 13.
   
   Guardar y verificar que el pedido queda con esas cantidades. En un pedido facturado, el movimiento de stock tiene que ser solo por la diferencia.
