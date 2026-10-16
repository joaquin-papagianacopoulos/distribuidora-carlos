// Chequeo estático de todas las migraciones: en PL/pgSQL la condición de un
// IF/ELSIF termina en el PRIMER "then" fuera de paréntesis, así que un
// "case when ... then" suelto en la condición corta el IF y da
// "syntax error at end of input" al aplicar la migración en Supabase.
// Un CASE dentro de la condición tiene que ir entre paréntesis.
import fs from 'fs';
import path from 'path';

const DIR = path.join(__dirname, '..', '..', '..', 'supabase', 'migrations');

// Devuelve las líneas (1-based) de IF/ELSIF cuya condición tiene un CASE fuera de paréntesis.
export const casesSueltosEnIf = (sql) => {
  const malas = [];
  const lineas = sql.split(/\r?\n/);
  lineas.forEach((l, i) => {
    if (!/^\s*(if|elsif)\b/i.test(l)) return;
    let depth = 0;
    let enString = false;
    // Se lee desde el IF hasta el THEN de nivel 0 (puede ocupar varias líneas).
    for (let j = i; j < lineas.length; j++) {
      const txt = lineas[j];
      let k = j === i ? txt.search(/\b(if|elsif)\b/i) + 2 : 0;
      for (; k < txt.length; k++) {
        const c = txt[k];
        if (enString) { if (c === "'") enString = false; continue; }
        if (c === "'") { enString = true; continue; }
        if (c === '-' && txt[k + 1] === '-') break; // comentario
        if (c === '(') { depth++; continue; }
        if (c === ')') { depth--; continue; }
        if (depth === 0 && /[a-z]/i.test(c) && (k === 0 || !/[a-z0-9_]/i.test(txt[k - 1]))) {
          const palabra = txt.slice(k).match(/^[a-z_]+/i)[0].toLowerCase();
          if (palabra === 'case') { malas.push(j + 1); return; }
          if (palabra === 'then') return;
          k += palabra.length - 1;
        }
      }
    }
  });
  return malas;
};

describe('migraciones: condiciones de IF en PL/pgSQL', () => {
  const archivos = fs.readdirSync(DIR).filter(f => f.endsWith('.sql'));

  it.each(archivos)('%s no tiene CASE suelto en la condición de un IF', (f) => {
    expect(casesSueltosEnIf(fs.readFileSync(path.join(DIR, f), 'utf8'))).toEqual([]);
  });

  it('el chequeo detecta el error (control del propio test)', () => {
    const mal = "  if a is null\n     or case when x = 'y' then true else false end then\n    return 1;\n  end if;";
    const bien = "  if a is null\n     or (case when x = 'y' then true else false end) then\n    return 1;\n  end if;";
    expect(casesSueltosEnIf(mal)).toEqual([2]);
    expect(casesSueltosEnIf(bien)).toEqual([]);
    expect(casesSueltosEnIf("  if exists (select 1 where case when a then b end) then")).toEqual([]);
  });
});
