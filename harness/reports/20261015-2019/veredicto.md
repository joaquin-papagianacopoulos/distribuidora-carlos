# Veredicto RUN 20261015-2019 (REQ-PAN)

VEREDICTO: APROBADO

## Base
- gates.json: todos PASS (3102 tests, cobertura dominio 99.85 %, 177/177 AC con test, build ok, sin secretos). No se re-corrió la suite.
- QA: 2 bugs bajos (margen con ventas netas <= 0, fecha ISO con hora) corregidos en vuelta 2: `panel.js:191` (`ventas <= 0 ? null`) y `panel.js:77-87` (ISO con zona -> día Argentina UTC-3).
- Seguridad: 0 Crítico/Alto. SEC-PAN-01 (captura solo en transición a facturado, 015) y SEC-PAN-03 (limpieza de errores > 90 días) corregidos y confirmados en el SQL. SEC-PAN-02 corregido. Queda SEC-PAN-04 (costo = el vigente al llegar al servidor), aceptado.

## Revisión del diff (producción)
- Costos nunca viajan en `pedidos.items`: `itemsSinCostos` en `pedidoRepository.js:26` y `syncService.js:162` (los dos caminos de subida).
- Costo capturado por el servidor (trigger security definer, tabla privada sin grants, RPC con PIN admin). El cliente no puede fijar el valor. Trigger no bloquea el guardado del pedido.
- IndexedDB 11 -> 12: solo agrega `costosVenta` con `contains` (`db/index.js:177-181`); no toca datos. Tests migracionV5..V12 actualizados solo por número de versión.
- Offline / 015 sin aplicar: la pantalla avisa y muestra "costo estimado"; sin backfill. Sin código muerto relevante.
- Pestaña `panel` solo con `isAdmin` (`App.js:241`); el control real es el PIN en el servidor.
- Dominio puro (`panel.js`), centavos enteros, 20.000 renglones < 1 s.

## AC verificados a mano
1. AC-PAN-2 (margen/NC): `margen()` devuelve null con ventas <= 0; test en panel.bordes (ex-BUG) satisface. OK.
2. AC-PAN-1 (costo en servidor): 015 línea del trigger toma `productos.costo_final/descuento1/2` y `itemsSinCostos` limpia el cliente; test estático security.panel.run2019. OK.
3. AC-PAN-6 (rendimiento/centavos): panel.test.js 20.000 renglones y cálculo en `panel.js` con centavos enteros. OK.

## Cambios requeridos
Ninguno bloqueante. Seguimientos:
1. 015 no probada contra Postgres real (extracción de `productoId` y `on conflict ... where`): correr las pruebas manuales.
2. Redondeo SQL vs JS puede diferir 1 centavo en casos límite.
3. Pedidos editados después de facturar con productos nuevos: esos renglones quedan "costo estimado".
4. `pedidos` escribible con la clave pública (heredado): puede inflar ventas del Panel; migrar a Supabase Auth.

## Pasos manuales para el dueño
1. Backup de Supabase.
2. Aplicar 010 -> 011 -> 012 -> 013 -> 014 -> 015 en orden (015 requiere 011 y 012; ver manual consolidado).
3. Verificar: `select has_table_privilege('anon','public.pedidos_costos','select');` debe dar false.
4. Publicar la app; en cada dispositivo admin: Panel > "Actualizar costos (PIN)".
5. Revisar de vez en cuando `select * from pedidos_costos_errores order by id desc limit 50;`.
