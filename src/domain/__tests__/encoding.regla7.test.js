// Regla dura 7 (CLAUDE.md): textos en español rioplatense sin tildes rotas.
// Recorre todos los .js de src (incluidos los tests) y las migraciones SQL y
// falla si encuentra mojibake típico de UTF-8 leído como Latin-1/Windows-1252
// (una "A con tilde" o una "A circunfleja" seguida de un byte de continuación,
// la secuencia de comillas/guiones rotos, o el carácter de reemplazo U+FFFD).
// Este archivo escribe esos caracteres SOLO como escapes \u, para no
// contener mojibake él mismo.
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
// BUG-ENC-01: detector unico, compartido con qa.encoding.test.js (cubre los
// bytes 0x80-0x9F de Windows-1252: mayusculas acentuadas rotas).
import { MOJIBAKE, ARCHIVOS_CON_FIXTURES } from '../../testUtils/mojibake';

const RAIZ = path.resolve(__dirname, '..', '..', '..');

const listar = (dir, ext) => {
  const out = [];
  for (const nombre of readdirSync(dir)) {
    if (nombre === 'node_modules' || nombre.startsWith('.')) continue;
    const p = path.join(dir, nombre);
    if (statSync(p).isDirectory()) out.push(...listar(p, ext));
    else if (nombre.endsWith(ext)) out.push(p);
  }
  return out;
};

const hallazgos = (archivos) => {
  const malos = [];
  for (const f of archivos) {
    // Los archivos que escriben los patrones como fixtures se saltean.
    if (ARCHIVOS_CON_FIXTURES.test(f)) continue;
    const lineas = readFileSync(f, 'utf8').split(/\r?\n/);
    lineas.forEach((l, i) => {
      if (MOJIBAKE.test(l)) malos.push(`${path.relative(RAIZ, f)}:${i + 1}: ${l.trim().slice(0, 120)}`);
    });
  }
  return malos;
};

describe('REGLA-7 codificación UTF-8 sin mojibake', () => {
  it('REGLA-7 AC-SEC-4 ningún .js de src tiene mojibake', () => {
    const archivos = listar(path.join(RAIZ, 'src'), '.js');
    expect(archivos.length).toBeGreaterThan(50);
    expect(hallazgos(archivos)).toEqual([]);
  });

  it('REGLA-7 AC-SEC-5 las migraciones SQL no tienen mojibake', () => {
    const archivos = listar(path.join(RAIZ, 'supabase', 'migrations'), '.sql');
    expect(archivos.length).toBeGreaterThan(0);
    expect(hallazgos(archivos)).toEqual([]);
  });

  it('REGLA-7 el detector reconoce los casos típicos (y no marca texto correcto)', () => {
    const roto = (s) => MOJIBAKE.test(s);
    expect(roto('Configuraci\u00C3\u00B3n')).toBe(true);
    expect(roto('No ten\u00C3\u00A9s permisos')).toBe(true);
    expect(roto('\u00C2\u00BFSeguro?')).toBe(true);
    expect(roto('\u00E2\u20AC\u201D guion')).toBe(true);
    expect(roto('caf\uFFFD')).toBe(true);
    // BUG-ENC-01: mayusculas acentuadas rotas (bytes 0x80-0x9F en Windows-1252).
    expect(roto('A\u00C3\u2018O')).toBe(true);
    expect(roto('CAF\u00C3\u2030')).toBe(true);
    expect(roto('CONFIGURACI\u00C3\u201C')).toBe(true);
    expect(roto('\u00C3\u0161LTIMO')).toBe(true);
    expect(roto('Configuración, inválido, ¿Seguro? ¡Listo! año, Córdoba, Ñandú')).toBe(false);
  });
});
