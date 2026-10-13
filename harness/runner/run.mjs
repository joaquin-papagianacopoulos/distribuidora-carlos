#!/usr/bin/env node
// Orquestador del harness con Claude Agent SDK (para terminal / CI).
//
//   cd harness/runner && npm install
//   ANTHROPIC_API_KEY=sk-ant-... node run.mjs [--scope REQ-STK] [--max-iter 3] [--budget 25]
//
// Fases: arquitecto → implementador → (qa-tester ‖ auditor-seguridad) → gates → revisor
// con bucle de corrección acotado. Las definiciones de los agentes se leen de
// .claude/agents/*.md (una sola fuente de verdad, compartida con Claude Code).
import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const SCOPE = opt('--scope', 'todo el SPEC');
const MAX_ITER = Number(opt('--max-iter', process.env.MAX_ITERATIONS || 3));
const BUDGET = Number(opt('--budget', process.env.MAX_BUDGET_USD || 25));

if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
  console.error('Falta ANTHROPIC_API_KEY (o CLAUDE_CODE_OAUTH_TOKEN).');
  process.exit(2);
}

const now = new Date();
const RUN_ID = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
const RUN_DIR = join('harness', 'reports', RUN_ID);
mkdirSync(join(ROOT, RUN_DIR), { recursive: true });
const LOG = join(ROOT, RUN_DIR, 'run.log');
const log = (...a) => { const s = a.join(' '); console.log(s); appendFileSync(LOG, `${s}\n`); };

// ---- Cargar agentes desde .claude/agents/*.md ----
const parseAgent = (txt) => {
  const m = txt.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('frontmatter inválido');
  const fm = Object.fromEntries(m[1].split('\n').map(l => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map(x => [x[1], x[2].trim()]));
  return {
    name: fm.name,
    def: {
      description: fm.description,
      prompt: m[2].replaceAll('<RUN_ID>', RUN_ID),
      tools: fm.tools ? fm.tools.split(',').map(s => s.trim()) : undefined,
      model: fm.model || 'inherit',
    },
  };
};
// Fuente: .claude/agents (instalado con `node harness/instalar.mjs`); si no está, la copia versionada.
const agentsDir = existsSync(join(ROOT, '.claude', 'agents')) ? join(ROOT, '.claude', 'agents') : join(ROOT, 'harness', 'claude-config', 'agents');
const AGENTS = Object.fromEntries(readdirSync(agentsDir).filter(f => f.endsWith('.md'))
  .map(f => parseAgent(readFileSync(join(agentsDir, f), 'utf8').replace(/\r\n/g, '\n'))).map(a => [a.name, a.def]));
log(`RUN ${RUN_ID} | agentes: ${Object.keys(AGENTS).join(', ')} | scope: ${SCOPE} | max-iter ${MAX_ITER} | budget USD ${BUDGET}`);

let spent = 0;

// Ejecuta UN agente como hilo principal (systemPrompt = prompt del agente),
// con sus herramientas restringidas. Devuelve el texto final.
const runAgent = async (name, task) => {
  const a = AGENTS[name];
  if (!a) throw new Error(`agente desconocido: ${name}`);
  const remaining = BUDGET - spent;
  if (remaining <= 0) throw new Error('Presupuesto agotado');
  log(`\n━━ ${name} ━━`);
  let final = '';
  for await (const msg of query({
    prompt: `RUN_ID=${RUN_ID}. Directorio de reportes: ${RUN_DIR}/.\nAlcance: ${SCOPE}.\n\n${task}`,
    options: {
      cwd: ROOT,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: a.prompt },
      allowedTools: a.tools,
      model: a.model === 'inherit' ? undefined : a.model,
      permissionMode: 'acceptEdits',
      settingSources: ['project'],          // respeta .claude/settings.json (deny .env, git push, gates)
      maxTurns: 80,
      maxBudgetUsd: remaining,
    },
  })) {
    if (msg.type === 'assistant') {
      for (const c of msg.message?.content || []) {
        if (c.type === 'tool_use') log(`  · ${c.name} ${JSON.stringify(c.input).slice(0, 140)}`);
      }
    }
    if (msg.type === 'result') {
      spent += msg.total_cost_usd || 0;
      final = msg.subtype === 'success' ? msg.result : `[${msg.subtype}]`;
      log(`  ✓ ${name} terminó (${msg.subtype}) — gastado acumulado USD ${spent.toFixed(2)}`);
    }
  }
  writeFileSync(join(ROOT, RUN_DIR, `${name}.out.md`), final || '');
  return final;
};

const runGates = () => {
  const out = `${RUN_DIR}/gates.json`;
  const r = spawnSync(`node harness/gates/run-gates.mjs --out ${out}`, { cwd: ROOT, shell: true, encoding: 'utf8' });
  log(r.stdout.split('\n').filter(l => /^(▶|✅|❌)/.test(l)).join('\n'));
  return { pass: r.status === 0, json: JSON.parse(readFileSync(join(ROOT, out), 'utf8')) };
};

const hayHallazgosBloqueantes = () => {
  const f = join(ROOT, RUN_DIR, 'security-report.md');
  if (!existsSync(f)) return false;
  const t = readFileSync(f, 'utf8');
  // Bloquea si hay Crítico/Alto marcados como "corregible en código" y no corregidos
  return /\|\s*(Cr[ií]tico|Alto)\s*\|[^\n]*\|\s*ABIERTO\s*\|[^\n]*\|\s*c[oó]digo\s*\|/i.test(t);
};

(async () => {
  await runAgent('arquitecto', 'Generá el plan técnico (plan.md) para el alcance indicado.');

  let ok = false;
  for (let iter = 1; iter <= MAX_ITER; iter++) {
    log(`\n=== Iteración ${iter}/${MAX_ITER} ===`);
    await runAgent('implementador', iter === 1
      ? 'Implementá el plan.'
      : `Corregí las fallas de ${RUN_DIR}/gates.json, los hallazgos ABIERTOS de ${RUN_DIR}/security-report.md y los cambios de ${RUN_DIR}/veredicto.md (si existe).`);

    // QA y seguridad en paralelo (no se pisan: QA escribe tests funcionales,
    // el auditor solo tests security*.test.js y su reporte).
    await Promise.all([
      runAgent('qa-tester', 'Cubrí todos los AC con tests, corré la suite y escribí qa-report.md.'),
      runAgent('auditor-seguridad', 'Auditá el código y el esquema, escribí tests de seguridad y security-report.md. En la tabla usá columnas: Severidad | Hallazgo | Evidencia | Estado (ABIERTO/CORREGIDO) | Dónde se corrige (código/Supabase/infra).'),
    ]);

    const g = runGates();
    if (!g.pass || hayHallazgosBloqueantes()) { log('Gates en rojo o hallazgos bloqueantes → otra vuelta'); continue; }

    const v = await runAgent('revisor', 'Revisá y emití veredicto.md.');
    const ver = existsSync(join(ROOT, RUN_DIR, 'veredicto.md')) ? readFileSync(join(ROOT, RUN_DIR, 'veredicto.md'), 'utf8') : v;
    if (/VEREDICTO:\s*APROBADO/i.test(ver)) { ok = true; break; }
    log('Revisor pidió cambios → otra vuelta');
  }

  log(`\n${ok ? '✅ APROBADO' : '❌ NO APROBADO'} — reportes en ${RUN_DIR} — USD ${spent.toFixed(2)}`);
  process.exit(ok ? 0 : 1);
})().catch(e => { log(`ERROR: ${e?.stack || e}`); process.exit(1); });
