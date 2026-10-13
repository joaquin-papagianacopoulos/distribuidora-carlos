#!/usr/bin/env node
// Quality gates deterministas del harness. Los agentes NO deciden si algo
// "pasó": lo decide este script. Multiplataforma (Windows / Linux / macOS).
//
// Uso:
//   node harness/gates/run-gates.mjs                 # todos los gates
//   node harness/gates/run-gates.mjs --fast          # sin build ni npm-audit
//   node harness/gates/run-gates.mjs --only a,b      # solo algunos
//   node harness/gates/run-gates.mjs --out x.json    # guarda el resultado
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

const COVERAGE_MIN_LINES = 90;
const ALL = ['unit-tests', 'coverage-domain', 'traceability', 'build', 'secret-scan', 'security-rules', 'npm-audit'];
let selected = opt('--only') ? opt('--only').split(',') : ALL;
if (flag('--fast')) selected = selected.filter(g => g !== 'build' && g !== 'npm-audit');

const run = (cmd, extraEnv = {}) => {
  const r = spawnSync(cmd, { cwd: ROOT, shell: true, encoding: 'utf8', env: { ...process.env, ...extraEnv }, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout || ''}\n${r.stderr || ''}` };
};
const tail = (s, n = 40) => s.split('\n').filter(Boolean).slice(-n).join('\n');

const walk = (dir, filter, acc = []) => {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'build', 'coverage', '.git', 'reports'].includes(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, filter, acc);
    else if (filter(p)) acc.push(p);
  }
  return acc;
};
const rel = (p) => relative(ROOT, p).split(sep).join('/');
const isTest = (p) => /\.test\.js$/.test(p) || p.includes(`${sep}__tests__${sep}`);

const results = {};
const gate = (name, fn) => {
  if (!selected.includes(name)) return;
  const t0 = Date.now();
  process.stdout.write(`▶ ${name} ... `);
  let r;
  try { r = fn(); } catch (e) { r = { pass: false, detail: String(e?.stack || e) }; }
  r.ms = Date.now() - t0;
  results[name] = r;
  console.log(r.pass ? `PASS (${r.ms} ms)` : 'FAIL');
  if (!r.pass) console.log(`  ${String(r.detail || '').split('\n').join('\n  ')}`);
};

// ---------- 1+2. Tests + cobertura del dominio (una sola corrida de Jest) ----------
let jestRun = null;
const runJest = () => {
  if (jestRun) return jestRun;
  const covDir = join(tmpdir(), `harness-cov-${process.pid}`);
  jestRun = run(
    `npx react-scripts test --watchAll=false --coverage --coverageDirectory="${covDir}" ` +
    `--collectCoverageFrom="src/domain/**/*.js" --collectCoverageFrom="!src/domain/**/__tests__/**" ` +
    `--coverageReporters=json-summary --coverageReporters=text-summary`,
    { CI: 'true' },
  );
  jestRun.covFile = join(covDir, 'coverage-summary.json');
  return jestRun;
};

gate('unit-tests', () => {
  const r = runJest();
  const m = r.out.match(/Tests:\s+(.*)/);
  return { pass: r.code === 0, summary: m ? m[1] : null, detail: r.code === 0 ? m?.[1] : tail(r.out, 80) };
});

gate('coverage-domain', () => {
  const r = runJest();
  if (!existsSync(r.covFile)) return { pass: false, detail: 'No se generó coverage-summary.json (¿existe src/domain/?)' };
  const sum = JSON.parse(readFileSync(r.covFile, 'utf8'));
  const pct = sum.total.lines.pct;
  const bajos = Object.entries(sum).filter(([k, v]) => k !== 'total' && v.lines.pct < COVERAGE_MIN_LINES)
    .map(([k, v]) => `${rel(k)}: ${v.lines.pct}%`);
  return { pass: pct >= COVERAGE_MIN_LINES, linesPct: pct, detail: `líneas ${pct}% (mín ${COVERAGE_MIN_LINES}%)${bajos.length ? `\nbajo umbral: ${bajos.join(', ')}` : ''}` };
});

// ---------- 3. Trazabilidad SPEC → tests ----------
gate('traceability', () => {
  const spec = readFileSync(join(ROOT, 'harness', 'SPEC.md'), 'utf8');
  const acs = [...new Set(spec.match(/AC-[A-Z]+-\d+/g) || [])];
  const tests = walk(join(ROOT, 'src'), p => isTest(p) && p.endsWith('.js')).map(p => readFileSync(p, 'utf8')).join('\n');
  const faltan = acs.filter(ac => !new RegExp(`${ac}(?!\\d)`).test(tests));
  return { pass: faltan.length === 0, total: acs.length, cubiertos: acs.length - faltan.length, faltan, detail: faltan.length ? `Sin test: ${faltan.join(', ')}` : `${acs.length}/${acs.length} AC con test` };
});

// ---------- 4. Build de producción (warnings = error) ----------
gate('build', () => {
  const out = join(tmpdir(), `harness-build-${process.pid}`);
  const r = run('npx react-scripts build', { CI: 'true', BUILD_PATH: out, GENERATE_SOURCEMAP: 'false' });
  try { rmSync(out, { recursive: true, force: true }); } catch { /* noop */ }
  return { pass: r.code === 0, detail: r.code === 0 ? 'ok' : tail(r.out, 60) };
});

// ---------- 5. Escaneo de secretos ----------
gate('secret-scan', () => {
  const patterns = [
    [/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT (posible anon/service key)'],
    [/sk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic API key'],
    [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
    [/AIza[0-9A-Za-z_-]{35}/, 'Google API key'],
    [/-----BEGIN (RSA |EC )?PRIVATE KEY-----/, 'Clave privada'],
    [/service_role/i, 'Referencia a service_role key'],
  ];
  const files = [
    ...walk(join(ROOT, 'src'), p => /\.(js|jsx|ts|json)$/.test(p)),
    ...walk(join(ROOT, 'public'), () => true),
    ...walk(join(ROOT, 'supabase'), p => p.endsWith('.sql')),
  ];
  const hits = [];
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => {
      for (const [re, what] of patterns) {
        if (re.test(l) && !/harness-allow-secret/.test(l)) hits.push(`${rel(f)}:${i + 1} ${what}`);
      }
    });
  }
  return { pass: hits.length === 0, hits, detail: hits.join('\n') || 'sin secretos' };
});

// ---------- 6. Reglas estáticas de seguridad ----------
gate('security-rules', () => {
  const rules = [
    [/\beval\s*\(/, 'eval()'],
    [/new\s+Function\s*\(/, 'new Function()'],
    [/dangerouslySetInnerHTML/, 'dangerouslySetInnerHTML'],
    [/\.innerHTML\s*=/, 'asignación a innerHTML'],
    [/console\.(log|info|debug|warn)\([^)]*(KEY|key\b|anon|token|password|pin\b)/i, 'log de credenciales'],
    [/['"`]http:\/\/(?!localhost|127\.0\.0\.1)/, 'URL http:// sin TLS'],
    [/href=\{?['"`]?javascript:/i, 'URL javascript:'],
  ];
  const files = walk(join(ROOT, 'src'), p => p.endsWith('.js') && !isTest(p));
  const hits = [];
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/harness-allow-rule/.test(l)) return;
      for (const [re, what] of rules) if (re.test(l)) hits.push(`${rel(f)}:${i + 1} ${what}`);
    });
  }
  return { pass: hits.length === 0, hits, detail: hits.join('\n') || 'sin hallazgos' };
});

// ---------- 7. npm audit (prod) contra baseline ----------
gate('npm-audit', () => {
  const r = run('npm audit --omit=dev --json');
  let json;
  try { json = JSON.parse(r.out.slice(r.out.indexOf('{'))); } catch { return { pass: false, detail: 'No se pudo parsear npm audit (¿sin red?)' }; }
  // Solo cuentan los paquetes que terminan en el bundle del navegador:
  // clausura transitiva de "dependencies" SIN react-scripts (que es tooling de
  // build/dev-server y en CRA vive en dependencies por convención).
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const pkgJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const TOOLING = new Set(['react-scripts']);
  const runtime = new Set();
  const resolve = (fromPath, name) => {
    let base = fromPath;
    while (true) {
      const cand = `${base ? `${base}/` : ''}node_modules/${name}`;
      if (lock.packages[cand]) return cand;
      if (!base) return null;
      const idx = base.lastIndexOf('/node_modules/');
      base = idx >= 0 ? base.slice(0, idx) : '';
    }
  };
  const visit = (path) => {
    if (!path || runtime.has(path)) return;
    runtime.add(path);
    const p = lock.packages[path] || {};
    for (const dep of Object.keys({ ...(p.dependencies || {}), ...(p.optionalDependencies || {}) })) visit(resolve(path, dep));
  };
  for (const dep of Object.keys(pkgJson.dependencies || {})) if (!TOOLING.has(dep)) visit(resolve('', dep));
  const runtimeNames = new Set([...runtime].map(p => p.slice(p.lastIndexOf('node_modules/') + 13)));

  const vulns = json.vulnerabilities || {};
  const sev = (s) => Object.entries(vulns).filter(([k, v]) => v.severity === s && runtimeNames.has(k)).map(([k]) => k).sort();
  const critical = sev('critical');
  const high = sev('high');
  const toolingOnly = Object.entries(vulns).filter(([k, v]) => ['critical', 'high'].includes(v.severity) && !runtimeNames.has(k)).length;
  const basePath = join(ROOT, 'harness', 'gates', 'audit-baseline.json');
  const base = existsSync(basePath) ? JSON.parse(readFileSync(basePath, 'utf8')) : { critical: [], high: [] };
  const nuevosCrit = critical.filter(k => !base.critical.includes(k));
  const nuevosHigh = high.filter(k => !base.high.includes(k));
  return {
    pass: nuevosCrit.length === 0,
    critical, high, nuevosCrit, nuevosHigh,
    toolingOnly,
    detail: `runtime critical: [${critical.join(', ')}] high: [${high.join(', ')}] | tooling de build (no se publica): ${toolingOnly}` +
      (nuevosCrit.length ? `\nNUEVAS críticas fuera de baseline: ${nuevosCrit.join(', ')}` : '') +
      (nuevosHigh.length ? `\n(aviso) nuevas high: ${nuevosHigh.join(', ')}` : ''),
  };
});

const pass = Object.values(results).every(r => r.pass);
const report = { at: new Date().toISOString(), pass, gates: results };
const outFile = opt('--out');
if (outFile) {
  mkdirSync(dirname(join(ROOT, outFile)), { recursive: true });
  writeFileSync(join(ROOT, outFile), JSON.stringify(report, null, 2));
}
console.log(`\n${pass ? '✅ TODOS LOS GATES PASARON' : '❌ HAY GATES EN ROJO'}`);
process.exit(pass ? 0 : 1);
