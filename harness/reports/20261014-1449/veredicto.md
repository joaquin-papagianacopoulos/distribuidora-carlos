# Veredicto - RUN 20261014-1449 - REQ-COMR

VEREDICTO: APROBADO

Suite corrida por el revisor: 91 suites OK, 1805 passed, 1 skipped, 5 todo (igual que gates.json, todos los gates PASS, 89/89 AC trazados).

## Tabla AC -> test -> resultado (todos con el ID en el it)
| AC | Archivos principales | Res. |
|---|---|---|
| 1 | ClienteForm.test, clientes.test, syncTolerante.test, migracionV7 | OK |
| 2 | plantillaExcel.test, plantillas.test, qa.plantillas.import.page.test | OK |
| 3 | rubros.test, SelectorRubro.test, ProductoForm.test | OK |
| 4 | rubros.test, SelectorRubro.test, qa.rubros.borde.test | OK |
| 5 | rubros.test, rubro.renglones.test, comisiones.rubro.test | OK |
| 6 | ComisionRubroGrid.test, comisionesRubro.config.page.test, rubros.test | OK |
| 7 | migracionV7, comisionesRubroService.test, migracion005.test | OK |
| 8 | comisiones.rubro.test, comisionesRubroService.test | OK |
| 9 | comisiones.rubro.redondeo.test, comisiones.rubro.test | OK |
| 10 | comisiones.rubro.test ($25/$15), comisiones.rubro.page.test | OK |
| 11 | comisiones.rubro.test, comisiones.rubro.page.test | OK |
| 12 | comisiones.rubro.test, comisiones.rubro.page.test | OK |
| 13 | comisiones.rubro.cierre.test, comisiones.rubro.page.test | OK |
| 14 | comisiones.rubro.ajustes.test | OK |
| 15 | comisiones.rubro.pureza.test | OK |

## Los 9 puntos obligatorios
1 Tabla: ok. 2 Dominio: cubierto (redondeo, 25/15, normalizacion, ajustes, validacion %). 3 migracionV7: solo crea comisionesRubro, no borra stores, clientes conservan comision. 4 Sync: ok (syncTolerante, comisionesRubroService). 5 UI: ok. 6 Plantillas: ok. 7 Regresion: ver abajo. 8 Seguridad: security.comisionesRubro.* + reporte del auditor. 9 Gates: PASS.

## Tests existentes modificados (no borrados)
ClienteForm, clientes, ConfiguracionAltas, plantillas(.page/.test/Excel/import), security.plantillas, security.validacion: 17 -> 16 campos, comision ya no se valida ni se mapea.
migracionV5/V6: DB_VERSION 7 ya no es la ultima. security.comisiones.iter2, comisionesService.test: modelo por rubro / `modelo` en cierres.
ProductoForm, bultos.cantidadPorDefecto: Rubro pasa a selector y el renglon guarda rubro. syncTolerante: casos nuevos sin comision.
Verificado con grep: sin `.only`; el unico `it.skip` (useAppContext AC-SEC-4) existe en HEAD (preexistente).

## Verificaciones puntuales
- 003_comisiones.sql: git diff = +4 lineas, solo comentario. Sin cambio de logica. OK.
- 005 es nueva (no existia): redefine cerrar_comisiones y triggers de inmutabilidad de la 003 con create or replace; agrega columnas `modelo` (default 'cliente') y `desglose` con add column if not exists, sin tocar filas viejas. Tabla nueva sin grants, RLS y acceso solo por RPC con PIN de admin, trigger anti-delete.
- db/index.js: DB_VERSION 7 solo agrega comisionesRubro (id UUID, indices no unicos). OK.
- clientes: comision no viaja en el upsert (no se pisa en Supabase) y el pull hace spread de local, asi que se conserva en IndexedDB. OK.
- Reglas CLAUDE.md: UUID, stock intacto, sin secretos, logica en src/domain. OK.

## Cambios requeridos
Ninguno.

## Observaciones no bloqueantes
- Si en el futuro se vuelve a correr la 003, hay que re-correr la 005 (ya anotado en la 003).
- Pendientes del dueño (SPEC): renombrar rubros masivo y % por defecto: por ahora no.

## Pasos manuales para el dueño
1. Hacer backup/export de Supabase (la 005 redefine funciones de cierres).
2. Pegar y correr `supabase/migrations/005_comisiones_rubro.sql` en el SQL editor (despues de 001-004).
3. Deploy de la app (la PWA migra IndexedDB a v7 sola; no se pierde nada).
4. Como admin: Configuracion -> Vendedores, cargar el % por rubro de cada vendedor (sin eso comisiona 0 con aviso).
5. Revisar el dashboard de Comisiones; los cierres viejos se muestran con su formato original.
