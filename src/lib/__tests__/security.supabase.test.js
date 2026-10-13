// AC-SEC-1: el cliente de Supabase no debe loguear la URL ni la anon key.
// Se mockea createClient (no hay red) y se espia toda la consola.
/* eslint-disable no-console */
import { readFileSync } from 'fs';
import path from 'path';

const FAKE_URL = 'https://proyecto-falso-auditoria.supabase.co';
const FAKE_KEY = 'FAKE-ANON-KEY-auditoria-0123456789abcdef';

const METODOS = ['log', 'info', 'debug', 'warn', 'error', 'trace', 'table', 'dir'];

const cargarModulo = (env) => {
  const salidas = [];
  const espias = METODOS.map(m => jest.spyOn(console, m).mockImplementation((...args) => {
    salidas.push(args.map(a => {
      try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); }
    }).join(' '));
  }));
  const prev = { url: process.env.REACT_APP_SUPABASE_URL, key: process.env.REACT_APP_SUPABASE_ANON_KEY };
  if (env.url === undefined) delete process.env.REACT_APP_SUPABASE_URL; else process.env.REACT_APP_SUPABASE_URL = env.url;
  if (env.key === undefined) delete process.env.REACT_APP_SUPABASE_ANON_KEY; else process.env.REACT_APP_SUPABASE_ANON_KEY = env.key;
  const createClient = jest.fn(() => ({ from: jest.fn() }));
  let mod;
  try {
    jest.isolateModules(() => {
      jest.doMock('@supabase/supabase-js', () => ({ createClient }));
      // eslint-disable-next-line global-require
      mod = require('../supabase');
    });
  } finally {
    if (prev.url === undefined) delete process.env.REACT_APP_SUPABASE_URL; else process.env.REACT_APP_SUPABASE_URL = prev.url;
    if (prev.key === undefined) delete process.env.REACT_APP_SUPABASE_ANON_KEY; else process.env.REACT_APP_SUPABASE_ANON_KEY = prev.key;
    espias.forEach(s => s.mockRestore());
  }
  return { mod, salidas, createClient };
};

describe('AC-SEC-1 src/lib/supabase.js no expone secretos en logs', () => {
  test('AC-SEC-1 con configuracion completa no escribe nada en consola', () => {
    const { mod, salidas, createClient } = cargarModulo({ url: FAKE_URL, key: FAKE_KEY });
    expect(createClient).toHaveBeenCalledWith(FAKE_URL, FAKE_KEY);
    expect(mod.supabase).toBeDefined();
    expect(salidas).toEqual([]);
  });

  test('AC-SEC-1 ninguna salida de consola contiene la key ni la URL', () => {
    const { salidas } = cargarModulo({ url: FAKE_URL, key: FAKE_KEY });
    const todo = salidas.join('\n');
    expect(todo).not.toContain(FAKE_KEY);
    expect(todo).not.toContain(FAKE_URL);
    expect(todo).not.toContain(FAKE_KEY.slice(0, 12));
  });

  test('AC-SEC-1 si falta la key solo avisa, sin imprimir el valor de la URL', () => {
    const { salidas } = cargarModulo({ url: FAKE_URL, key: undefined });
    expect(salidas.length).toBeGreaterThan(0);
    expect(salidas.join('\n')).not.toContain(FAKE_URL);
  });

  test('AC-SEC-1 si falta la URL solo avisa, sin imprimir el valor de la key', () => {
    const { salidas } = cargarModulo({ url: undefined, key: FAKE_KEY });
    expect(salidas.length).toBeGreaterThan(0);
    expect(salidas.join('\n')).not.toContain(FAKE_KEY);
  });

  test('AC-SEC-1 el codigo fuente no pasa url/key a console.*', () => {
    const src = readFileSync(path.join(__dirname, '..', 'supabase.js'), 'utf8');
    expect(src).not.toMatch(/console\.\w+\([^)]*\b(url|key)\b/);
  });
});
