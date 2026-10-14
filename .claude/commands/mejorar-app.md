---
description: Corre el pipeline completo del harness (arquitecto → implementador → QA + seguridad → gates → revisor) sobre harness/SPEC.md
argument-hint: "REQ-ID [REQ-ID...] [— instrucciones extra]  (ej. REQ-VTA)"
---
Sos el **orquestador** del harness. Alcance: $ARGUMENTS (si está vacío, preguntá qué REQ correr: no corras todo el SPEC).

## Reglas de ahorro (obligatorias)
- **Vos no leés código ni reportes completos.** Pasale a cada subagente rutas y el alcance; de lo que devuelven, quedate solo con el resumen. De `gates.json` leé solo los gates que fallan (`pass: false`) y su `detail`.
- A cada subagente pasale: `RUN_ID`, los REQ del alcance y las rutas de entrada. Nunca pegues el contenido de un reporte en el prompt.
- Los subagentes leen del SPEC **solo** "Decisiones de negocio ya tomadas" y las secciones de los REQ del alcance (con Grep de `^## REQ-` para ubicar las líneas y Read con offset/limit), no el SPEC entero.

## Pasos
0. Si $ARGUMENTS pide incorporar un archivo de `harness/pedidos/` al SPEC, hacelo vos primero, copiando **solo** los REQ del alcance.
1. `RUN_ID` = `YYYYMMDD-HHMM`; creá `harness/reports/<RUN_ID>/`.
2. **arquitecto** → `plan.md`. Mostrame un resumen de 5 líneas.
3. **implementador** con el plan.
4. **qa-tester**. Lanzá **auditor-seguridad en paralelo solo si** el diff (`git diff --stat`) toca `supabase/`, `src/sync/`, `src/services/sesion*`, `src/lib/supabase*`, `public/_headers`, autenticación/permisos o una superficie pública nueva. Si no, saltealo y dejalo anotado en el resumen final.
5. Corré **una sola vez** `node harness/gates/run-gates.mjs --out harness/reports/<RUN_ID>/gates.json`.
6. Si falla algún gate o hay hallazgos Crítico/Alto corregibles: volvé al paso 3 pasándole al implementador **solo** la lista de gates fallidos con su `detail` (y los ids de hallazgos a corregir), no los reportes enteros. En la vuelta 3, invocá al implementador con `model: "opus"`. Máximo 3 iteraciones; si se agotan, frená y reportá. En las vueltas de corrección, QA solo vuelve a correr si se tocaron tests o hay AC sin cubrir; el auditor solo si su hallazgo era Crítico/Alto.
7. **revisor**. Si dice CAMBIOS REQUERIDOS y quedan iteraciones, volvé al paso 3 con su lista numerada.
8. Resumen final (máx. 15 líneas): AC cubiertos, gates, hallazgos abiertos, si se salteó el auditor y pasos manuales (migración SQL).

Nunca marques un paso como exitoso sin la salida del gate correspondiente.
