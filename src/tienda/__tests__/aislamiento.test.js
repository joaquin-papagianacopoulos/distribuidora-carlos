// AC-TIE-1: el bundle de la tienda no importa IndexedDB, sync, sesión ni pantallas
// internas. Se recorre el grafo de imports estáticos desde TiendaApp.js.
import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..');
const PROHIBIDOS = ['db', 'sync', path.join('services', 'sesion.js'), 'pages', 'hooks', 'App.js', path.join('utils', 'pdfGen.js'), 'components'];

const IMPORT_RE = /(?:import\s+(?:[^'"]*?\s+from\s+)?|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g;

const resolver = (desde, spec) => {
  if (!spec.startsWith('.')) return null; // paquetes npm: no son código interno
  const base = path.resolve(path.dirname(desde), spec);
  for (const c of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
};

const recorrer = (entrada, { soloEstaticos = true } = {}) => {
  const vistos = new Set();
  const pila = [entrada];
  while (pila.length) {
    const f = pila.pop();
    if (vistos.has(f) || !f.endsWith('.js')) continue;
    vistos.add(f);
    let src = fs.readFileSync(f, 'utf8');
    if (soloEstaticos) src = src.replace(/import\(\s*['"][^'"]+['"]\s*\)/g, '');
    for (const m of src.matchAll(IMPORT_RE)) {
      const r = resolver(f, m[1]);
      if (r) pila.push(r);
    }
  }
  return [...vistos];
};

const relativo = (f) => path.relative(SRC, f);
const esProhibido = (f) => PROHIBIDOS.some(p => relativo(f) === p || relativo(f).startsWith(p + path.sep));

describe('AC-TIE-1 aislamiento del bundle de la tienda', () => {
  it('AC-TIE-1 TiendaApp no alcanza db, sync, sesion, pages, hooks, App, pdfGen ni components', () => {
    const grafo = recorrer(path.join(SRC, 'tienda', 'TiendaApp.js'));
    expect(grafo.length).toBeGreaterThan(8);
    expect(grafo.map(relativo).filter((r, i) => esProhibido(grafo[i]))).toEqual([]);
  });

  it('AC-TIE-1 el dominio que usa la tienda tampoco alcanza capas con efectos', () => {
    const grafo = recorrer(path.join(SRC, 'tienda', 'TiendaApp.js')).map(relativo);
    expect(grafo).toContain(path.join('domain', 'tienda.js'));
    expect(grafo.some(r => r.startsWith('db') || r.startsWith('sync') || r.startsWith('services'))).toBe(false);
  });

  it('AC-TIE-1 la tienda solo toca Supabase desde tiendaApi.js y con rpc (nunca .from())', () => {
    const dir = path.join(SRC, 'tienda');
    const archivos = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
    for (const f of archivos) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(src).not.toMatch(/\.from\(\s*['"]/);
      expect(src).not.toMatch(/indexedDB/);
      if (f !== 'tiendaApi.js') expect(src).not.toMatch(/lib\/supabase/);
    }
    expect(fs.readFileSync(path.join(dir, 'tiendaApi.js'), 'utf8')).toMatch(/\.rpc\(/);
  });

  it('AC-TIE-1 index.js no importa ./App ni la tienda de forma estática (solo import() lazy)', () => {
    const src = fs.readFileSync(path.join(SRC, 'index.js'), 'utf8');
    const estaticos = [...src.matchAll(/^\s*import\s[^;]*from\s+['"]([^'"]+)['"]/gm)].map(m => m[1]);
    expect(estaticos).not.toContain('./App');
    expect(estaticos).not.toContain('./tienda/TiendaApp');
    expect(estaticos.filter(s => s.startsWith('.'))).toEqual(['./domain/tienda']);
    expect(src).toMatch(/import\('\.\/tienda\/TiendaApp'\)/);
    expect(src).toMatch(/import\('\.\/App'\)/);
  });

  it('AC-TIE-1 el recorrido detecta una violación (control del propio test)', () => {
    const grafo = recorrer(path.join(SRC, 'App.js'));
    expect(grafo.some(esProhibido)).toBe(true);
  });
});
