# Agent Harness — Distribuidora App

Harness multi-agente para evolucionar la app con calidad controlada: un equipo de agentes especializados trabaja sobre `SPEC.md`, y **gates deterministas** deciden si el trabajo está terminado.

## Estructura
```
CLAUDE.md                      contexto y reglas duras para cualquier agente
.claude/
  agents/                      definición de cada rol (fuente única: la usan Claude Code y el runner SDK)
    arquitecto.md              plan técnico (read-only sobre src)
    implementador.md           único con escritura en src/
    qa-tester.md               tests por criterio de aceptación
    auditor-seguridad.md       AppSec, tests de seguridad, reporte
    revisor.md                 veredicto final
  commands/
    mejorar-app.md             /mejorar-app  → pipeline completo
    auditar-seguridad.md       /auditar-seguridad → solo seguridad
  settings.json                permisos: bloquea .env, git push, rm -rf y edición de los gates
harness/
  SPEC.md                      requerimientos del cliente → REQ / AC verificables
  PIPELINE.md                  fases, bucle de corrección y gates
  gates/run-gates.mjs          tests, cobertura, trazabilidad AC→test, build, secretos, reglas, npm audit
  gates/audit-baseline.json    vulnerabilidades aceptadas (vacío = tolerancia cero en runtime)
  runner/run.mjs               orquestador con Claude Agent SDK (terminal / CI)
  reports/<RUN_ID>/            artefactos de cada corrida
supabase/migrations/           SQL a aplicar en Supabase
```

## Instalación (una vez)
La carpeta `.claude/` y `.env.production` no se pueden escribir de forma remota, así que viajan en `harness/claude-config/`. Desde la carpeta del proyecto:
```bash
node harness/instalar.mjs     # copia agentes/comandos/permisos a .claude/ y crea .env.production
npm install                   # instala jspdf 4 / jspdf-autotable 5 / fflate 0.8.3 actualizados
```

## Uso

### 1. Desde Claude Code (recomendado para trabajo interactivo)
Abrí Claude Code en la carpeta del proyecto y escribí:
```
/mejorar-app              # todo el SPEC
/mejorar-app REQ-STK      # solo control de stock
/auditar-seguridad        # solo auditoría
```

### 2. Por terminal / CI (Agent SDK)
```bash
cd harness/runner
npm install
# Windows PowerShell:  $env:ANTHROPIC_API_KEY="sk-ant-..."
export ANTHROPIC_API_KEY=sk-ant-...
node run.mjs --scope REQ-STK --max-iter 3 --budget 25
```
Sale con código 0 solo si los gates pasan **y** el revisor aprueba.

### 3. Solo gates (sin IA, gratis)
```bash
node harness/gates/run-gates.mjs          # todo
node harness/gates/run-gates.mjs --fast   # sin build ni npm audit
```

## Cómo agregar un pedido nuevo del cliente
1. Agregá un `REQ-XXX` con sus `AC-XXX-N` en `SPEC.md`.
2. Corré `/mejorar-app REQ-XXX`. El gate `traceability` no deja cerrar hasta que cada AC tenga test.
