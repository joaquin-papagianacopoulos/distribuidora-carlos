// REQ-DIR (AC-DIR-2) y REQ-CON (AC-CON-1): migración 019 (estática) y paridad con direccionExacta.
import fs from 'fs';
import path from 'path';
import { direccionExacta, FIXTURES_DIRECCION } from '../direccion';

const DIR = path.join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const sql019 = fs.readFileSync(path.join(DIR, '019_ajustes_contacto_direccion.sql'), 'utf8').split(String.fromCharCode(13)).join('');
const sql010 = fs.readFileSync(path.join(DIR, '010_lote_operacion_precios.sql'), 'utf8').split(String.fromCharCode(13)).join('');

const cuerpo = (sql, desde) => {
  const i = sql.indexOf(desde);
  const fin = sql.indexOf('\nend $$;', i);
  return sql.slice(i, fin).split('\n');
};

describe('AC-DIR-2 AC-CON-1 migración 019', () => {
  it('AC-CON-1 agrega clientes.contacto de forma idempotente', () => {
    expect(sql019).toMatch(/alter table public\.clientes add column if not exists contacto text;/);
  });

  it('AC-DIR-2 no borra nada y re-emite revoke/grant de tienda_crear_pedido', () => {
    expect(sql019).not.toMatch(/\bdrop\b/i);
    expect(sql019).toMatch(/revoke all on function public\.tienda_crear_pedido\(jsonb\) from public;/);
    expect(sql019).toMatch(/grant execute on function public\.tienda_crear_pedido\(jsonb\) to anon, authenticated;/);
  });

  it('AC-DIR-2 tienda_crear_pedido = 010 + una sola condición de dirección exacta', () => {
    const ini = 'create or replace function public.tienda_crear_pedido(p jsonb)';
    const a = cuerpo(sql010, ini);
    const b = cuerpo(sql019, ini);
    const extra = b.filter(l => !a.includes(l));
    expect(extra).toHaveLength(1);
    expect(extra[0]).toMatch(/not public\.direccion_exacta\(v_contacto->>'direccion'\)/);
    expect(b.length).toBe(a.length + 1);
  });

  it('AC-DIR-2 paridad: las regex del SQL, evaluadas en JS, coinciden con direccionExacta', () => {
    const alpha = /v ~ '(\[\[:alpha:\]\])'/.exec(sql019)[1];
    const num = /v ~ '(\(\^\|\[\^\[:alnum:\]\]\)\[0-9\]\+)'/.exec(sql019)[1];
    const sn = /v ~\* '([^']+)'/.exec(sql019)[1];
    const js = (re) => new RegExp(re.replace(/\[\[:alpha:\]\]/g, '\\p{L}').replace(/\[:alnum:\]/g, '\\p{L}\\d'), 'u');
    const reAlpha = js(alpha); const reNum = js(num); const reSn = new RegExp(sn, 'i');
    const enSql = (t) => {
      const v = String(t).trim().replace(/\s+/g, ' ');
      return v.length >= 5 && reAlpha.test(v) && (reNum.test(v) || reSn.test(v));
    };
    for (const [texto, ok] of FIXTURES_DIRECCION) {
      expect(enSql(texto)).toBe(ok);
      expect(direccionExacta(texto).ok).toBe(ok);
    }
  });
});
