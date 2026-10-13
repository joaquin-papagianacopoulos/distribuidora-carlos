// QA RUN 20261012-2106 — regla dura 7, segunda red.
// encoding.regla7.test.js detecta mojibake con una clase [\u0080-¿] despues
// de la "A con tilde". Pero cuando UTF-8 se lee como Windows-1252, los bytes
// 0x80-0x9F salen como OTROS caracteres (e con "\u2030", "“", "\u0160", etc.), asi que
// las mayusculas acentuadas rotas (Ñ, É, Ó, Ú) no las ve ese detector.
// Este test (a) prueba el hueco, (b) usa un detector completo para recorrer
// src, supabase/migrations, public y harness/SPEC.md y (c) exige UTF-8 valido
// byte a byte (TextDecoder fatal).
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import path from 'path';
import { TextDecoder as NodeTextDecoder } from 'util';
import { MOJIBAKE as MOJIBAKE_REPO, ARCHIVOS_CON_FIXTURES } from '../../testUtils/mojibake';

const RAIZ = path.resolve(__dirname, '..', '..', '..');

// Caracteres que produce Windows-1252 para los bytes 0x80-0x9F.
const CP1252_ALTOS = '\u20AC\u201A\u0192\u201E…\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019“”\u2022–—\u02DC\u2122\u0161\u203A\u0153\u017E\u0178';
const MOJIBAKE_COMPLETO = new RegExp(`[\\u00C2\\u00C3][\\u0080-\\u00BF${CP1252_ALTOS}]|\\u00E2[\\u0080-\\u00BF${CP1252_ALTOS}]|\\uFFFD`);
// BUG-ENC-01 (iteracion 2): el detector del repo ya no es una copia: es el
// mismo modulo que importa encoding.regla7.test.js.
const MOJIBAKE_ACTUAL = MOJIBAKE_REPO;

const listar = (dir, exts) => {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const nombre of readdirSync(dir)) {
    if (nombre === 'node_modules' || nombre === '.git' || nombre === 'build' || nombre === 'coverage') continue;
    const p = path.join(dir, nombre);
    if (statSync(p).isDirectory()) out.push(...listar(p, exts));
    else if (exts.some(e => nombre.endsWith(e))) out.push(p);
  }
  return out;
};

const utf8Estricto = (f) => {
  const buf = readFileSync(f);
  try { new NodeTextDecoder('utf-8', { fatal: true }).decode(buf); return null; } catch (e) { return 'UTF-8 invalido'; }
};

describe('REGLA-7 (QA) detector completo de mojibake', () => {
  // Rotas a proposito, escritas con escapes para que este archivo no tenga mojibake.
  const rotas = {
    'Ñ (C3 91 leido como cp1252)': 'A\u00C3\u2018O',
    'É (C3 89)': 'CAF\u00C3\u2030',
    'Ó (C3 93)': 'CONFIGURACI\u00C3“',
    'Ú (C3 9A)': '\u00C3\u0161LTIMO',
    'ü (C3 BC)': 'ping\u00C3\u00BCino',
    'comilla curva (E2 80 9C)': '\u00E2\u20AC\u0153hola\u00E2\u20AC\u009D',
    '¿ (C2 BF)': '\u00C2¿Seguro?',
  };
  it.each(Object.entries(rotas))('REGLA-7 el detector completo marca %s', (_n, s) => {
    expect(MOJIBAKE_COMPLETO.test(s)).toBe(true);
  });

  it('REGLA-7 el detector completo no marca texto correcto (mayusculas acentuadas, comillas curvas, ¿¡)', () => {
    expect(MOJIBAKE_COMPLETO.test('AÑO CAFÉ CONFIGURACIÓN ÚLTIMO PINGÜINO “hola” ¿Seguro? ¡Listo! — … ✓ \u00C3 sola')).toBe(false);
  });

  // Documenta el hueco del detector actual (para que se amplie la regex en encoding.regla7.test.js).
  // BUG: BUG-ENC-01 (ver qa-report.md): el detector de encoding.regla7.test.js no ve las mayusculas rotas.
  it('REGLA-7 BUG el detector de encoding.regla7.test.js también marca Ñ/É/Ó/Ú rotas', () => {
    const faltantes = Object.entries(rotas).filter(([, s]) => MOJIBAKE_COMPLETO.test(s) && !MOJIBAKE_ACTUAL.test(s)).map(([n]) => n);
    expect(faltantes).toEqual([]);
  });
});

describe('REGLA-7 (QA) recorrido del repo con el detector completo', () => {
  const grupos = {
    'src (.js)': () => listar(path.join(RAIZ, 'src'), ['.js', '.css', '.html', '.json']),
    'supabase/migrations (.sql)': () => listar(path.join(RAIZ, 'supabase'), ['.sql']),
    'public': () => listar(path.join(RAIZ, 'public'), ['.html', '.json', '.js', '.webmanifest']),
    'harness (SPEC/plan)': () => [path.join(RAIZ, 'harness', 'SPEC.md'), path.join(RAIZ, 'CLAUDE.md')].filter(existsSync),
  };
  it.each(Object.keys(grupos))('REGLA-7 %s: UTF-8 valido y sin mojibake (detector completo)', (g) => {
    const archivos = grupos[g]();
    expect(archivos.length).toBeGreaterThan(0);
    const malos = [];
    for (const f of archivos) {
      const rel = path.relative(RAIZ, f);
      // Este archivo y el de la regla 7 escriben los patrones como regex/escapes; se saltean.
      if (ARCHIVOS_CON_FIXTURES.test(rel)) continue;
      const inv = utf8Estricto(f);
      if (inv) malos.push(`${rel}: ${inv}`);
      readFileSync(f, 'utf8').split(/\r?\n/).forEach((l, i) => {
        if (MOJIBAKE_COMPLETO.test(l)) malos.push(`${rel}:${i + 1}: ${l.trim().slice(0, 100)}`);
      });
    }
    expect(malos).toEqual([]);
  });

  it('REGLA-7 ningun archivo de src empieza con BOM dentro de un modulo JS (rompe imports/"use strict" en algunos bundlers)', () => {
    const conBom = listar(path.join(RAIZ, 'src'), ['.js']).filter(f => {
      const b = readFileSync(f);
      return b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;
    }).map(f => path.relative(RAIZ, f));
    expect(conBom).toEqual([]);
  });
});
