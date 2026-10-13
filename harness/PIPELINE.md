# Pipeline del harness

```
          ┌──────────────┐
 SPEC ──▶ │ 1. arquitecto│──▶ harness/reports/<run>/plan.md
          └──────┬───────┘
                 ▼
          ┌──────────────────┐   gates fallan (máx N iteraciones)
          │ 2. implementador │◀──────────────────────────────┐
          └──────┬───────────┘                               │
                 ▼                                           │
          ┌──────────────┐   ┌────────────────────┐          │
          │ 3a. qa-tester│   │ 3b. auditor-       │  (en paralelo)
          │  tests + AC  │   │  seguridad         │          │
          └──────┬───────┘   └─────────┬──────────┘          │
                 └──────────┬──────────┘                     │
                            ▼                                │
                 ┌────────────────────┐   FAIL / hallazgos   │
                 │ 4. QUALITY GATES   │──────────────────────┘
                 │ (deterministicos)  │
                 └─────────┬──────────┘
                           ▼ PASS
                 ┌────────────────────┐
                 │ 5. revisor         │──▶ veredicto APROBADO / CAMBIOS
                 └────────────────────┘
```

## Principios de diseño
- **Gates deterministas, no "opiniones"**: un agente nunca decide solo que algo pasó; lo deciden `harness/gates/run-gates.mjs` (tests, build, cobertura de dominio, matriz de trazabilidad AC→test, escaneo de secretos, reglas estáticas de seguridad, `npm audit`).
- **Separación de roles y de permisos**: el auditor y el revisor son *read-only* sobre `src/` (solo pueden escribir reportes y tests de seguridad). El implementador no puede tocar `harness/gates/`.
- **Trazabilidad**: cada test nombra el AC que cubre (`AC-XXX-N` en el título del `it`/`describe`). El gate `traceability` falla si un AC del SPEC no aparece en ningún test.
- **Bucle acotado**: máx. `MAX_ITERATIONS` (default 3) vueltas implementador⇄gates; presupuesto por corrida (`MAX_BUDGET_USD`).
- **Artefactos**: todo queda en `harness/reports/<timestamp>/` (plan, salida de gates en JSON, reporte de seguridad, veredicto).

## Gates (todos obligatorios)
| Gate | Qué verifica | Falla si |
|---|---|---|
| `unit-tests` | Jest (react-scripts) | algún test falla |
| `coverage-domain` | Cobertura de `src/domain/**` | líneas < 90 % |
| `traceability` | Todos los `AC-*` del SPEC aparecen en tests | falta alguno |
| `build` | `react-scripts build` (warnings = error en CI) | no compila |
| `secret-scan` | Claves/JWT/tokens en `src/`, `public/`, `supabase/` | encuentra alguno |
| `security-rules` | `eval`, `new Function`, `dangerouslySetInnerHTML`, `innerHTML=`, log de claves, `http://` | encuentra alguno |
| `npm-audit` | Dependencias de producción | vulnerabilidad *critical* nueva (se compara con `harness/gates/audit-baseline.json`) |

## Cómo correrlo
- **Desde Claude Code** (en la carpeta del proyecto): `/mejorar-app` — o `/auditar-seguridad` solo para la auditoría.
- **Por terminal / CI** (Agent SDK): `cd harness/runner && npm install && ANTHROPIC_API_KEY=... node run.mjs` (ver `harness/README.md`).
- **Solo los gates** (sin IA): `node harness/gates/run-gates.mjs`.
