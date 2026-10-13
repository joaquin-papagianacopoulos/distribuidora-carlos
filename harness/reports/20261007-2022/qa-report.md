# QA report — RUN 20261007-2022 — REQ-COM

## Números reales
- `CI=true npx react-scripts test --watchAll=false --coverage`: 39 suites OK, 721 passed, 1 skipped (722). Antes de QA: 37 suites, 697 passed.
- Tests nuevos de QA (+24): `src/domain/__tests__/qa.comisiones.test.js` (22), `src/db/__tests__/migracionV5.test.js` (2).
- Cobertura: `comisiones.js` 100 % líneas / 96,15 % ramas; `comisionesService.js` 99,15 % líneas / 84,96 % ramas.
- Gates `--fast`: unit-tests, coverage-domain, traceability, secret-scan y security-rules PASS.
- Bugs que rompan tests: 0. Hay 3 hallazgos de riesgo (ver abajo).

## Matriz AC -> tests (todos los AC-COM-1..16 tienen tests que los ejercitan)
| AC | Tests principales | Bordes agregados por QA |
|---|---|---|
| 1 | `comisiones.test` (marcar, permisos, mapeo remoto), `entregadoSync`, `entregado.facturacion`, `entregado.ordenEntrega` | marcar/desmarcar en cadena no toca estado, items, total ni `stockAplicado`, y no muta el original |
| 2 | `puedeVerComisiones` (1 sí; 2, 3, '1', null, NaN no), `security.comisiones.roles` (pestaña y guard) | - |
| 3 | `periodoPorDefecto`, `validarPeriodo`, `clasificarPedidos`, `enRango`, `pullPedidosByRango` | bordes 30/09, 01/10, 31/10, 01/11; cancelado, eliminado y borrado ni cuentan ni son aviso (d); estados del cierre (vigente y pendiente ocupan; anulado y rechazado liberan); cierre vigente excluye y anular reincorpora |
| 4 | tabla `calcularComision` (18 casos) | 0 % sin aviso; 50 pedidos sin deriva de centavos entre suma por pedido y total |
| 5 | `resumirPorVendedor`, detalle en página | - |
| 6 | `calcularAvisos` (a)(b)(c)(d) | (a)+(b) simultáneos; admin, "WEB" y mayúsculas no disparan (a); no entregado es informativo y no suma |
| 7 | `repartirComision`, `validarAsignacion` | 0,01 / 0,03 / 1,01 / 333,33 / 99,99 / 0,05 al 50/50 y 33,33/66,67 de 100,01 suman exacto; vendedor con espacios, tildes y mayúsculas |
| 8 | `puedeCerrar`, botón deshabilitado | cliente sin vendedor bloquea; `sin_comision` y `otro` lo destraban; `otro` inexistente y `dividir` sin ficha bloquean |
| 9 | borrador (dominio, servicio, página) | - |
| 10 | `construirCierre`, `confirmarCierre` | congelado: cambiar ficha, % o total del pedido, o mutar el dashboard, no altera el cierre |
| 11 | `pedidosEnCierresVigentes`, badge, trigger SQL | pedido en cierre vigente no vuelve a contar |
| 12 | `validarAnulacion`, `anularCierre`, historial | anulado libera pedidos |
| 13 | `calcularAjustesPendientes` (9 tests) | editar total (+10 / -25), desmarcar, revertir y borrar (-50); no se repite un ajuste ya cerrado; segundo cambio da `ajusteSeq` 2; el cambio de % de la ficha no genera ajuste porque se usa el % congelado; cierre anulado no genera ajustes |
| 14 | `filasPdfCierre`, `pdfComisiones` (PDF real) | - |
| 15 | `security.comisiones`, tablas | null/undefined/basura en pedidos, clientes, vendedores y cierres no lanza; "１０００" full-width da `total_invalido` |
| 16 | `migracion003` (SQL por regex), `comisionesService` (`ya_existia`, `ya_cerrado`, red caída) | **v4 -> v5 con el `onupgradeneeded` real**: crea solo `comisionesCierres` y `comisionesBorradores` (keyPath id, sin autoIncrement), 0 `deleteObjectStore`, 0 `clear`, idempotente |

AC-CLI-5 (tolerancia a columnas faltantes): `entregadoSync.test` cubre PGRST204 -> reintento sin columnas -> `entregaPendiente`, sin tocar stock. No se agregó nada.

## Desvío: la RPC `cerrar_comisiones` no exige `entregado`
Verificado leyendo `003_comisiones.sql` y el cliente.
- **El cliente sí garantiza que solo viajen pedidos entregados en el flujo normal.** `confirmarCierre` sincroniza pendientes, vuelve a bajar el rango (`pullPedidosByRango`), recalcula con `armarDashboard` y `clasificarPedidos` (facturado + entregado + no oculto + no cerrado), y los renglones salen solo de `lineas`.
- Test que lo prueba: AC-COM-3 / AC-COM-6, el facturado no entregado va a `noEntregados` y queda fuera de `lineas` (y por lo tanto de `p_renglones`).
- **Riesgo residual, no es un bug de la app:** el servidor valida solo "existe y estado facturado". No valida entregado, ni `borrado`, ni fecha dentro del período, ni que el total/comisión coincidan con el pedido. Un cliente alterado, o una carrera (otro dispositivo desmarca entre el pull y la RPC), puede cerrar un pedido no entregado o con total viejo. Ese caso se corrige después como ajuste negativo (AC-COM-13). Se acepta porque la RPC ya está protegida por nombre de admin (sin Auth real, como la migración 002).
- Sugerencia: si se define "A reparto" o "Entregado" como criterio definitivo, agregar `and coalesce(p.entregado,false)` en la RPC. Hoy no se hace a propósito, porque `criterioEntregado` es configurable en el cliente.

## Hallazgos (ninguno rompe tests)
1. **MEDIO — `aCentavos` suma 1e-7 antes de redondear** (`comisiones.js:159`). Valores con 9 o más decimales, por ejemplo `1.004999999`, se redondean hacia arriba (101 en vez de 100). Repro: `aCentavos(1.004999999)` da 101 (verificado con node). Es teórico, porque los totales de la app tienen 2 decimales. Queda como nota.
2. **BAJO — Zona horaria.** `enRango` toma el día literal (`slice(0,10)`) sin convertir. Una fecha ISO con `Z` como `2026-11-01T01:00:00Z` (31/10 22:00 en Argentina) cuenta como noviembre. No afecta hoy, porque `pedidos.fecha` se guarda como `YYYY-MM-DD` local (`getLocalTodayStr`). Queda documentado en un test. Si algún día `fecha` pasa a timestamptz, habría que convertir.
3. **BAJO — Las pruebas de la migración SQL son por regex.** No hay Postgres en CI, así que no se prueba la concurrencia real de dos admins (AC-COM-16). Hay que hacer el QA manual de dos dispositivos que ya figura en `implementacion.md`.

## No cubierto automáticamente
- Concurrencia real contra Postgres (índice único parcial, RPC).
- Upgrade real de IndexedDB en navegador. Se simuló `indexedDB` y se ejecutó el `onupgradeneeded` de verdad, pero no es un IDB real (no hay `fake-indexeddb` instalado).
- Nombre del admin en Supabase idéntico al de la app (paso manual de `implementacion.md`).

## Producción
No se modificó código de producción. Solo se agregaron los 2 archivos de test y este reporte.
