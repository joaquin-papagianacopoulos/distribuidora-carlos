// REQ-COMR (RUN 20261014-1449) AC-COMR-15: todo el cálculo vive en
// src/domain/. Las pantallas y la grilla solo muestran y llaman funciones.
import { readFileSync } from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '..', '..');
const leer = (rel) => readFileSync(path.join(SRC, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ');

describe('AC-COMR-15 sin aritmética de comisión fuera del dominio', () => {
  it.each([
    ['pages/Comisiones.js'],
    ['components/ComisionRubroGrid.js'],
    ['components/SelectorRubro.js'],
    ['services/comisionesRubroService.js'],
  ])('AC-COMR-15 %s no calcula comisiones (/ 100, * pct, BigInt, Math.round)', (rel) => {
    const src = leer(rel);
    expect(src).not.toMatch(/\/\s*100\b/);
    expect(src).not.toMatch(/\*\s*\(?\s*\w*pct/i);
    expect(src).not.toMatch(/BigInt/);
    expect(src).not.toMatch(/Math\.round/);
  });

  it('AC-COMR-15 Comisiones.js y la grilla importan el cálculo SOLO de src/domain', () => {
    const page = leer('pages/Comisiones.js');
    expect(page).toMatch(/from '\.\.\/domain\/comisiones'/);
    expect(page).toMatch(/from '\.\.\/domain\/rubros'/);
    const grid = leer('components/ComisionRubroGrid.js');
    expect(grid).toMatch(/from '\.\.\/domain\/rubros'/);
    expect(grid).toMatch(/validarPctRubro/);
  });

  it('AC-COMR-15 el dominio de rubros y comisiones es puro (sin React, IndexedDB ni Supabase)', () => {
    for (const rel of ['domain/rubros.js', 'domain/comisiones.js']) {
      const src = leer(rel);
      expect(src).not.toMatch(/from 'react'|indexedDB|from '\.\.\/db'|supabase/);
    }
    // sin literales BigInt (123n): no dependemos de Babel para eso
    expect(leer('domain/comisiones.js')).not.toMatch(/\b\d+n\b/);
  });
});
