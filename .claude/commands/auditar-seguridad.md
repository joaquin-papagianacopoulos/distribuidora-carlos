---
description: Solo auditoría de seguridad + gates de seguridad, sin implementar cambios
---
1. Creá `harness/reports/<YYYYMMDD-HHMM>-sec/`.
2. Delegá al subagente **auditor-seguridad**.
3. Corré `node harness/gates/run-gates.mjs --only secret-scan,security-rules,npm-audit`.
4. Mostrá la tabla de hallazgos priorizada y qué requiere acción manual en Supabase.
