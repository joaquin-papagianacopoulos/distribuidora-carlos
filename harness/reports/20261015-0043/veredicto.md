# Veredicto RUN 20261015-0043 (REQ-PBU, REQ-MIN, REQ-SST, REQ-HPR)

VEREDICTO: APROBADO

## Base
- gates.json: todos PASS (2418 tests, cobertura dominio 99.82%, trazabilidad 139/139, build ok, sin secretos).
  npm-audit: solo `xlsx` (ya conocido, sin nuevos).
- QA: 0 bugs, 21 casos de borde nuevos. Seguridad: 0 criticos/altos; S-010-01..04 corregidos y
  verificados; queda abierto S-010-05 (`xlsx`, preexistente).

## Revision del diff
- Dominio puro y testeado: `src/domain/precios.js`, `minimos.js`. `precioAplicado` cobra siempre el menor,
  con centavos enteros. Sin codigo muerto relevante.
- IndexedDB: DB_VERSION 8 -> 9, solo agrega el store `cambiosPrecio` (`src/db/index.js:~116`); no toca
  productos ni pedidos. Retrocompatible. `updateProducto`/`addProductoLocal` leen el previo y escriben el
  cambio en la MISMA transaccion (atomico). Nuevo parametro `{usuario}` opcional: llamadores viejos siguen andando.
- Todos los caminos de edicion de precio (formulario y plantilla Excel) pasan el usuario
  (`Configuracion.js:72,75,245,248`). El pull del servidor no genera cambios falsos.
- Offline: cambios quedan `pendingSync` y se limpian solo los ids aceptados; rechazos se marcan `syncRechazo`.
- Items viejos sin `precioBultoOriginal` no se re-precian (compatibilidad con pedidos existentes).
- Stock: `STOCK_POLICY` sigue en `advertir`, stock solo por movimientos. La tienda mantiene su config (AC-SST-3).
- SQL 010: revoke/grant re-emitidos, search_path fijo, precio recalculado en servidor, 007/008/009 intactas.

## Verificacion manual de 3 AC
1. AC-PBU-5: `precios.test.js:33` (10 u. 9.000 / 16 u. 12.800 / 20 u. 16.000) vs `precioAplicado` (`precios.js:~33`). OK.
2. AC-MIN-3: `minimos.test.js` vs `minimoEfectivo` (ceil(m/bx)*bx solo si se vende por bulto). OK.
3. AC-HPR-1: `cambioDePrecio` compara en centavos (null si no cambia) y se invoca dentro de la transaccion
   de `updateProducto`. Hay test de tx atomica (`cambiosPrecio.tx.test.js`). OK.

## Cambios requeridos
Ninguno bloqueante.
Recomendaciones no bloqueantes:
1. No hay test contra Postgres real de `tienda_crear_pedido`; compensar con las pruebas manuales de manual.md.
2. Seguimiento: reemplazar `xlsx` (S-010-05) en una corrida aparte.

## Pasos manuales para el dueno
1. Backup de Supabase.
2. Aplicar `supabase/migrations/010_lote_operacion_precios.sql` en el SQL editor (despues de 007 y 009),
   ANTES de publicar la app.
3. Correr las verificaciones anon del security-report (seccion "Requiere accion del dueno").
4. Publicar la app (deploy) y probar los flujos de manual.md.
