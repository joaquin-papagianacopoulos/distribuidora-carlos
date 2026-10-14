# QA REQ-COMR - run 20261014-1449

## Resultado
`CI=true npx react-scripts test --watchAll=false`: 88 suites, 1 falla (a proposito, test de BUG QA-1). Resto verde (1718 passed, 1 skipped preexistente, 3 todo preexistentes).

## AC -> archivo de test -> resultado (todos con el ID en el it)
| AC | Archivos principales | Resultado |
|---|---|---|
| AC-COMR-1 | components/ClienteForm.test, domain/clientes.test, services/syncTolerante.test (4 casos de sync sin `comision`), db/migracionV7 | OK |
| AC-COMR-2 | services/plantillaExcel.test, domain/plantillas.test, pages/qa.plantillas.import.page.test | OK |
| AC-COMR-3 | domain/rubros.test, components/SelectorRubro.test, pages/comisionesRubro.config.page.test, ProductoForm.test | OK |
| AC-COMR-4 | domain/rubros.test, SelectorRubro.test, plantillas (import) ; qa.rubros.borde.test | OK salvo QA-1 (falla) |
| AC-COMR-5 | rubros.test, pages/rubro.renglones.test, comisiones.rubro.test | OK |
| AC-COMR-6 | rubros.test (0, 100, 100.01, -1, "5,5", "", null, texto, 3 decimales), ComisionRubroGrid.test, comisionesRubro.config.page.test, comisionesRubroService.test | OK |
| AC-COMR-7 | db/migracionV7, services/comisionesRubroService.test (solo ids subidos, 005 faltante, edicion durante subida), domain/migracion005 | OK |
| AC-COMR-8 | rubros.test, comisiones.rubro.test, comisionesRubroService.test | OK |
| AC-COMR-9 | comisiones.rubro.redondeo.test (medio centavo, 3x$0,10), comisiones.rubro.test | OK |
| AC-COMR-10 | comisiones.rubro.test ($25/$15, 50/50, 70/30, modos cargador/otro/sin_comision), comisiones.rubro.page.test | OK |
| AC-COMR-11 | comisiones.rubro.test (c1, c2), comisiones.rubro.page.test | OK |
| AC-COMR-12 | comisiones.rubro.test, comisiones.rubro.page.test | OK |
| AC-COMR-13 | comisiones.rubro.cierre.test, comisiones.rubro.page.test | OK |
| AC-COMR-14 | comisiones.rubro.ajustes.test | OK |
| AC-COMR-15 | comisiones.rubro.pureza.test | OK |

Casos minimos de dominio, migracion v6->v7 (no borra stores, clientes conservan comision), sync, UI (16 campos, selector con "Agregar rubro nuevo...", grilla, dashboard c1/c2, vendedor/armador sin grilla ni dashboard) y plantillas: todos presentes.

## Integridad de tests existentes
- Ningun it/test eliminado sin reemplazo: las 12 lineas `-it(...)` del diff son renombres/ajustes de casos de comision/17 campos (ej. "17 campos" -> "16 campos ... AC-COMR-1"). Los `it` de comision del cliente se reescribieron para afirmar que ya no se valida.
- Sin `skip/only` nuevos: el unico `it.skip` (useAppContext AC-SEC-4) y los `todo` (security.*) son preexistentes y sin modificar.

## Tests agregados por QA
- `src/domain/__tests__/qa.rubros.borde.test.js` (NFD, tabs/saltos, basura en listarRubros, resolverRubro, % invalidos).

## Bugs
- **QA-1 (baja/media)**: `claveRubro`/`normalizarRubro` (src/domain/rubros.js) no normaliza a NFC/NFD. "Lácteos" (tilde combinante, tipico de Excel/Mac) no iguala a "Lácteos" => rubros duplicados y dos tablas de % distintas. Repro: `claveRubro('Lácteos') === claveRubro('Lácteos')` da false ('lácteos' vs 'lacteos'). Fix sugerido: `.normalize('NFC')` antes del mapeo (o NFD + quitar ̀-ͯ). El test queda fallando con `// BUG:`.

## Iteración 2
- Suite completa: 91 suites verdes, 1794 passed, 1 skipped (preexistente), 5 todo (preexistentes + security). 
- QA-1 resuelto: `qa.rubros.borde.test.js` pasa sin modificarse (el `// BUG:` queda como comentario historico).
- Agregado `src/domain/__tests__/qa.comisiones.desborde.test.js` (S-COMR-05: precio/cantidad desbordados, 1e300, 400 digitos, 30 decimales, base 10^11 al 100 %): verde.
- Sin skip/only nuevos (unico `it.skip`: useAppContext, preexistente).
- Limitacion: los tests del implementador estan sin trackear en git, asi que no se puede probar por diff que solo cambio `migracion005.test.js`; lo que afirma implementacion.md es consistente con que las suites de QA/seguridad pasan sin cambios, pero no esta verificado por diff.
- Pendiente (no testeable aca): la 005 sigue sin probarse en Postgres real.
