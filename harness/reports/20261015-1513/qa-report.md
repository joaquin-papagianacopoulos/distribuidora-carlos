# QA report 20261015-1513 — REQ-FAB, REQ-AGR, REQ-TRQ, REQ-ZON

Los 4 REQ ya tenian cobertura amplia del implementador (233 menciones de AC en 24 archivos).
Sume solo bordes en `src/domain/__tests__/qaLote011.bordes.test.js` (18 tests).

| AC | Tests QA (bordes nuevos) |
|---|---|
| AC-FAB-1 | IVA con mayusculas/espacios/vacio/null; "ninguna" guardado manda; ids mixtos y tipo invalido |
| AC-FAB-2 | CUIT undefined/null/vacio/letras/corto/DV malo avisa; B no avisa; cliente null |
| AC-FAB-3 | excluye borrados, no facturados, "ninguna"; subtotales A/B y total (redondeo); rango inclusivo/invertido; filtro invalido; entradas null |
| AC-AGR-1 | crear grupo con nombre vacio y renglon ya agrupado vacia el grupo viejo |
| AC-AGR-2 | total igual con y sin grupos en modos detalle y solo_grupos |
| AC-AGR-3 | bultos mixtos, sin bultoX, no multiplo, decimal, 1 bulto, lista vacia |
| AC-AGR-4 | renglon eliminado: grupo con los restantes; grupo vacio se descarta |
| AC-TRQ-1 | boleta larga + descuento + deuda + obs (12 valores de finalY); pageH 210; finalY NaN; obs de 30 lineas |
| AC-ZON-1 | renumeracion sin huecos con duplicados/huecos previos; puesto fuera de rango/NaN/id inexistente |
| AC-ZON-2 | Sin zona al final; grafias distintas juntas; filtro por zona con tildes; pedidos null/sin cliente |
| AC-ZON-3 | orden legacy dia->orden, dia en mayusculas, sin dia al final |
| AC-ZON-4 | cubierto por los de arriba y por zonas.test.js |

Resultado: 17/18 verdes; 1 falla a proposito (BUG 3). Solo corri este archivo; suite completa y cobertura las corre el gate.

## Bugs / riesgos (ninguno bloqueante)
1. Migracion SQL 011 (lineas 52): `lower(dia_entrega)` no hace btrim ni quita tildes. Un `dia_entrega`
   como 'Miércoles' o 'sabado ' cae en 99 (al final) en la inicializacion remota, mientras que el JS
   (`ordenLegacy`) tampoco normaliza tildes pero si hace lower. Solo afecta si hay datos con tilde/espacios.
   Reproducir: cliente con dia_entrega='miércoles' y otro 'viernes' en la misma zona; el de miércoles queda despues.
2. Layout del troquel: si las observaciones superan ~50 lineas no hay corte ni pagina extra (limite aceptado).
3. BUG (test fallando a proposito): `calcularOrdenPorZona(pedidos)` con un pedido `null` en la lista lanza
   TypeError (`zonas.js` ~l.104, `a.clienteId` sobre null en el sort). Repro: `calcularOrdenPorZona([null, {}], clientes)`.
   Test: "AC-ZON-2 filtrar por zona ... pedidos null". Severidad baja (la DB no devuelve null); fix: filtrar `p` falsy al agrupar.
