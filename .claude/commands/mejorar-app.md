---
description: Corre el pipeline completo del harness (arquitecto → implementador → QA + seguridad → gates → revisor) sobre harness/SPEC.md
argument-hint: "[REQ-ID opcional para acotar, ej. REQ-STK]"
---
Sos el **orquestador** del harness. Alcance: $ARGUMENTS (si está vacío, todo el SPEC).

1. Definí `RUN_ID` = fecha-hora actual (`YYYYMMDD-HHMM`) y creá `harness/reports/<RUN_ID>/`.
2. Delegá al subagente **arquitecto** → `plan.md`. Mostrame un resumen de 5 líneas.
3. Delegá al subagente **implementador** con el plan.
4. Lanzá **en paralelo** a **qa-tester** y **auditor-seguridad**.
5. Corré `node harness/gates/run-gates.mjs --out harness/reports/<RUN_ID>/gates.json`.
6. Si algún gate falla o hay hallazgos Crítico/Alto corregibles en código: volvé al paso 3 pasándole al implementador `gates.json` + `security-report.md`. Máximo 3 iteraciones; si se agotan, frená y reportá.
7. Delegá al **revisor**. Si dice CAMBIOS REQUERIDOS y quedan iteraciones, volvé al paso 3.
8. Resumen final: AC cubiertos, gates, hallazgos de seguridad abiertos y pasos manuales (migración SQL).

Nunca marques un paso como exitoso sin la salida del gate correspondiente.
