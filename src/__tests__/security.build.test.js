// S-08 (sourcemaps) y S-09 (headers HTTP) del security-report 20261007-run1.
// Lee archivos de configuracion de build/hosting desde la raiz del repo.
// No lee .env (solo .env.production, que esta versionado y no debe tener claves).
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const leer = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

// Variables de un archivo dotenv (sin comentarios). Solo se devuelven nombres
// y valores de las que se piden, nunca el archivo entero en un mensaje de error.
const dotenv = (txt) => Object.fromEntries(
  txt.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);

describe('S-08 build de produccion sin sourcemaps', () => {
  test('S-08 existe .env.production con GENERATE_SOURCEMAP=false', () => {
    expect(existsSync(path.join(ROOT, '.env.production'))).toBe(true);
    const env = dotenv(leer('.env.production'));
    expect(env.GENERATE_SOURCEMAP).toBe('false');
  });

  test('S-08/S-09 INLINE_RUNTIME_CHUNK=false (permite script-src self sin unsafe-inline)', () => {
    expect(dotenv(leer('.env.production')).INLINE_RUNTIME_CHUNK).toBe('false');
  });

  test('S-08 .env.production no contiene claves ni JWT', () => {
    const txt = leer('.env.production');
    const nombres = Object.keys(dotenv(txt));
    expect(nombres.filter(n => /KEY|SECRET|TOKEN|PASSWORD/i.test(n))).toEqual([]);
    expect(/eyJ[A-Za-z0-9_-]{10,}\.eyJ/.test(txt)).toBe(false);
  });

  test('S-08 el script de build no reactiva los sourcemaps', () => {
    const pkg = JSON.parse(leer('package.json'));
    expect(pkg.scripts.build).not.toMatch(/GENERATE_SOURCEMAP\s*=\s*true/);
  });
});

// Devuelve { header: valor } del bloque de una ruta de public/_headers (formato Netlify/Cloudflare Pages).
const bloque = (txt, ruta) => {
  const out = {};
  let dentro = false;
  for (const linea of txt.split('\n')) {
    if (!linea.trim()) continue;
    if (!/^\s/.test(linea)) { dentro = linea.trim() === ruta; continue; }
    if (dentro) {
      const i = linea.indexOf(':');
      if (i > 0) out[linea.slice(0, i).trim().toLowerCase()] = linea.slice(i + 1).trim();
    }
  }
  return out;
};

describe('S-09 public/_headers', () => {
  const h = bloque(leer('public/_headers'), '/*');

  test('S-09 headers basicos en todas las rutas', () => {
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toMatch(/^(DENY|SAMEORIGIN)$/i);
    expect(h['referrer-policy']).toMatch(/strict-origin|no-referrer|same-origin/);
    expect(h['permissions-policy']).toMatch(/camera=\(\)/);
    expect(h['strict-transport-security']).toMatch(/max-age=\d{7,}/);
  });

  test('S-09 hay CSP (enforced o Report-Only) estricta', () => {
    const csp = h['content-security-policy'] || h['content-security-policy-report-only'];
    expect(csp).toBeTruthy();
    const dir = Object.fromEntries(csp.split(';').map(s => s.trim()).filter(Boolean)
      .map(s => { const [k, ...v] = s.split(/\s+/); return [k.toLowerCase(), v.join(' ')]; }));
    expect(dir['default-src']).toBe("'self'");
    expect(dir['script-src']).toBeDefined();
    expect(dir['script-src']).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
    expect(dir['object-src']).toBe("'none'");
    expect(dir['frame-ancestors']).toBe("'none'");
    expect(dir['base-uri']).toBe("'self'");
    expect(dir['connect-src']).toMatch(/https:\/\/\*\.supabase\.co/);
  });
});
