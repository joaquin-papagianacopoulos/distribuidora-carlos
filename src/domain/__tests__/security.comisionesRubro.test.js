// Auditoría de seguridad REQ-COMR (RUN 20261014-1449, T11 del plan).
// Chequeos estáticos de supabase/migrations/005_comisiones_rubro.sql (se aplica
// a mano, no hay Postgres en CI) y del dominio puro: RLS solo-admin, security
// definer con search_path fijo, respuesta genérica de no autorizado, cierres
// inmutables, no doble conteo, idempotencia sin borrar datos, comision del
// cliente intacta, formula injection y % hostiles.
// Los hallazgos ABIERTOS quedan como it.todo (ver security-report.md).
import { readFileSync } from 'fs';
import path from 'path';
import { validarPctRubro, normalizarRubro, claveRubro, interpretarGuardarRubros, filaRubroToRemote } from '../rubros';
import { clienteExtraToRemote, clienteExtraFromRemote } from '../clientes';
import { baseRubrosPedido } from '../comisiones';
import { validarFilaProducto, filasInstrucciones } from '../plantillas';

const MIG = path.resolve(__dirname, '..', '..', '..', 'supabase', 'migrations');
const limpiar = (raw) => raw
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();
const SQL = limpiar(readFileSync(path.join(MIG, '005_comisiones_rubro.sql'), 'utf8'));
const SQL003 = limpiar(readFileSync(path.join(MIG, '003_comisiones.sql'), 'utf8'));

// Todos los bloques "create or replace function ... end $$" de la 005.
// Cuerpo = desde "create or replace function" hasta el "$$;" que cierra el "as $$".
const FUNCIONES = [...SQL.matchAll(/create or replace function public\.([a-z_0-9]+)\(/g)].map(m => {
  const abre = SQL.indexOf(' as $$', m.index);
  const cierra = SQL.indexOf('$$;', abre + 6);
  return { nombre: m[1], cuerpo: SQL.slice(m.index, cierra + 3) };
});
const fn = (nombre) => (FUNCIONES.find(f => f.nombre === nombre) || { cuerpo: '' }).cuerpo;
const LEER = fn('admin_leer_comisiones_rubro');
const GUARDAR = fn('admin_guardar_comisiones_rubro');
const CERRAR = fn('cerrar_comisiones');

describe('S-COMR seguridad de la migración 005 (AC-SEC-5, AC-COMR-7)', () => {
  it('AC-COMR-7 las tres RPC y la tabla existen en la migración', () => {
    expect(LEER.length).toBeGreaterThan(100);
    expect(GUARDAR.length).toBeGreaterThan(100);
    expect(CERRAR.length).toBeGreaterThan(100);
    expect(SQL).toContain('create table if not exists public.comisiones_rubro');
  });

  it('AC-SEC-5 comisiones_rubro: RLS habilitado, sin políticas y sin grants a anon/authenticated', () => {
    expect(SQL).toContain('alter table public.comisiones_rubro enable row level security');
    expect(SQL).toContain('revoke all on table public.comisiones_rubro from public, anon, authenticated');
    expect(SQL).not.toMatch(/create policy [a-z_0-9]+ on public\.comisiones_rubro/);
    expect(SQL).not.toMatch(/grant [a-z, ]+ on (table )?public\.comisiones_rubro\b/);
    // el revoke va DESPUÉS del create table (Supabase da grants por default privileges)
    expect(SQL.indexOf('revoke all on table public.comisiones_rubro')).toBeGreaterThan(SQL.indexOf('create table if not exists public.comisiones_rubro'));
  });

  it('AC-SEC-5 toda función security definer fija search_path = public, pg_temp (pg_temp al final)', () => {
    const definers = FUNCIONES.filter(f => /security definer/.test(f.cuerpo.slice(0, 400)));
    expect(definers.map(f => f.nombre).sort()).toEqual(['admin_guardar_comisiones_rubro', 'admin_leer_comisiones_rubro', 'cerrar_comisiones']);
    for (const f of definers) {
      expect(f.cuerpo.slice(0, 400)).toMatch(/security definer set search_path = public, pg_temp as \$\$/);
    }
  });

  it('AC-SEC-5 solo las 3 RPC tienen execute para anon; los helpers de cálculo y de clave no', () => {
    const grants = [...SQL.matchAll(/grant execute on function public\.([a-z_0-9]+)\(/g)].map(m => m[1]).sort();
    expect(grants).toEqual(['admin_guardar_comisiones_rubro', 'admin_leer_comisiones_rubro', 'cerrar_comisiones']);
    for (const h of ['rubro_normalizado(text)', 'rubro_clave(text)', 'comision_rubro_base(text)', 'comision_rubro_partes(text, jsonb, jsonb)', 'tg_comisiones_rubro_sin_borrado()']) {
      expect(SQL).toContain(`revoke all on function public.${h} from public, anon, authenticated`);
    }
    for (const r of ['cerrar_comisiones(jsonb, jsonb, text, text)', 'admin_leer_comisiones_rubro(text, text)', 'admin_guardar_comisiones_rubro(text, text, jsonb)']) {
      expect(SQL).toContain(`revoke all on function public.${r} from public`);
    }
    // los helpers invoker no son security definer (no se pueden usar para saltar la RLS)
    for (const h of ['comision_rubro_base', 'comision_rubro_partes', 'rubro_clave', 'rubro_normalizado']) {
      expect(fn(h)).not.toMatch(/security definer/);
    }
  });

  it.each([['leer', () => LEER], ['guardar', () => GUARDAR]])('AC-COMR-7 %s: verificar_pin y rol admin ANTES de tocar comisiones_rubro', (_n, get) => {
    const c = get();
    const pin = c.indexOf('public.verificar_pin(v_admin_id, p_admin_pin)');
    expect(pin).toBeGreaterThan(0);
    expect(c).toMatch(/ve\.permiso = 1 and public\.vendedor_habilitado\(ve\.id::text\)/);
    const primerUso = c.search(/(from|into|update) public\.comisiones_rubro/);
    expect(primerUso).toBeGreaterThan(pin);
  });

  it.each([['leer', () => LEER], ['guardar', () => GUARDAR]])('S-COMR %s: respuesta genérica, sin raise propio, no distingue "id vacío", "no admin" y "PIN malo"', (_n, get) => {
    const c = get();
    const antesDelPin = c.slice(0, c.indexOf('if not v_pin_ok'));
    // todo return previo a la autorización es exactamente no_autorizado
    const returns = [...antesDelPin.matchAll(/return jsonb_build_object\(([^;]*)\);/g)].map(m => m[1]);
    expect(returns.length).toBeGreaterThan(0);
    for (const r of returns) expect(r).toBe("'ok', false, 'motivo', 'no_autorizado'");
    expect(c).toMatch(/if not v_pin_ok or v_por is null or length\(v_por\) = 0 then return jsonb_build_object\('ok', false, 'motivo', 'no_autorizado'\)/);
    // sin raise: un raise haría rollback del intento fallido (fuerza bruta sin límite)
    expect(c).not.toMatch(/\braise\b/);
    // la sonda de la PWA (id vacío) sale ANTES de verificar_pin: no cuenta intentos ni filtra datos
    expect(antesDelPin.indexOf('length(v_admin_id) = 0')).toBeGreaterThan(0);
  });

  it('S-COMR la lectura no devuelve PIN, hash ni datos de vendedores', () => {
    const salida = LEER.slice(LEER.indexOf("'ok', true"));
    expect(salida).not.toMatch(/pin/);
    expect(salida).not.toMatch(/from public\.vendedores/);
    expect(salida).toMatch(/limit 20000/);
  });

  it('S-COMR guardar: lock global DESPUÉS de autorizar, lote acotado, clave calculada por el servidor, % 0..100 con 2 decimales, fecha futura acotada', () => {
    expect(GUARDAR.indexOf("pg_advisory_xact_lock(hashtext('comisiones_global'))")).toBeGreaterThan(GUARDAR.indexOf('if not v_pin_ok'));
    expect(GUARDAR).toContain('jsonb_array_length(p_filas) > 1000');
    expect(GUARDAR).toContain('v_clave := public.rubro_clave(v_rubro)');
    expect(GUARDAR).not.toMatch(/f->>'rubro_clave'/);
    expect(GUARDAR).toMatch(/< 0 or \(f->>'pct'\)::numeric > 100 or \(f->>'pct'\)::numeric <> round\(\(f->>'pct'\)::numeric, 2\)/);
    expect(GUARDAR).toContain('v_at := least(coalesce(v_at, now()), now())');
    // un id existente no se puede "mover" a otro vendedor/rubro
    expect(GUARDAR).toContain("'motivo', 'id_en_uso'");
    // editado_por lo pone el servidor (nombre del admin autenticado), no el cliente
    expect(GUARDAR).not.toMatch(/f->>'editado_por'/);
  });

  it('S-COMR las filas de % no se borran (trigger) y la tabla tiene constraint de rango', () => {
    expect(SQL).toContain('create trigger comisiones_rubro_sin_borrado before delete on public.comisiones_rubro');
    expect(SQL).toContain('check (pct is null or (pct >= 0 and pct <= 100))');
    expect(SQL).toContain('constraint comisiones_rubro_vendedor_rubro_uq unique (vendedor_id, rubro_clave)');
  });
});

describe('S-COMR cerrar_comisiones redefinida (AC-COMR-9, 13, 14)', () => {
  it('AC-COMR-13 misma firma; autoriza y toma el lock ANTES de la idempotencia y de leer cierres', () => {
    expect(CERRAR).toMatch(/^create or replace function public\.cerrar_comisiones\(p_cierre jsonb, p_renglones jsonb, p_admin_id text, p_admin_pin text\)/);
    const pin = CERRAR.indexOf('public.verificar_pin(v_admin_id, p_admin_pin)');
    const lock = CERRAR.indexOf("pg_advisory_xact_lock(hashtext('comisiones_global'))");
    const idem = CERRAR.indexOf('from public.comisiones_cierres c where c.id = v_id');
    expect(pin).toBeGreaterThan(0);
    expect(lock).toBeGreaterThan(pin);
    expect(idem).toBeGreaterThan(lock);
  });

  it('AC-COMR-13 una PWA vieja no puede cerrar pedidos con el % del cliente (modelo_obsoleto)', () => {
    expect(CERRAR).toMatch(/r->>'tipo' = 'pedido' and coalesce\(r->>'modelo', 'cliente'\) = 'cliente' \) then return jsonb_build_object\('ok', false, 'motivo', 'modelo_obsoleto'\)/);
    expect(CERRAR.indexOf("'modelo_obsoleto'")).toBeLessThan(CERRAR.indexOf('insert into public.comisiones_cierres'));
  });

  it('AC-COMR-9 cada parte se recalcula con la tabla del SERVIDOR y el desglose lo arma el servidor', () => {
    expect(CERRAR).toContain('v_calc := public.comision_rubro_partes(v_pid, r->\'partes\', null)');
    expect(CERRAR).toMatch(/v_desgloses -> \(r->>'pedido_id'\)/);
    // el desglose del cliente nunca se graba en los renglones
    expect(CERRAR).not.toMatch(/r->'desglose'/);
    // división entre partes: 1 o 2 vendedores, distintos, que sumen exactamente 100
    expect(CERRAR).toMatch(/not between 1 and 2/);
    expect(CERRAR).toMatch(/is distinct from 100 then return jsonb_build_object\('ok', false, 'motivo', 'renglones_invalidos'\)/);
  });

  it('AC-COM-16 un pedido no queda en dos cierres vigentes: los índices únicos de la 003 siguen y la 005 no los toca', () => {
    expect(SQL003).toContain('create unique index if not exists comisiones_pedido_vigente_uq on public.comisiones_cierre_pedidos (pedido_id) where vigente and tipo = \'pedido\'');
    expect(SQL003).toContain('create unique index if not exists comisiones_ajuste_vigente_uq');
    expect(SQL).not.toMatch(/drop index/);
    expect(SQL).not.toMatch(/alter index/);
    expect(CERRAR).toMatch(/exception when unique_violation then/);
    expect(CERRAR).toContain("'motivo', 'ya_cerrado'");
    // un pedido aparece a lo sumo una vez por tipo en el mismo cierre
    expect(CERRAR).toContain("'motivo', 'renglones_duplicados'");
    // ajuste sin base vigente => rechazado
    expect(CERRAR).toMatch(/where a\.hay_base = 0/);
  });

  it('AC-COM-11 los cierres confirmados siguen inmutables y ahora también modelo y desglose', () => {
    const cab = fn('tg_cierre_inmutable');
    const ren = fn('tg_cierre_renglon_inmutable');
    for (const col of ['id', 'desde', 'hasta', 'cerrado_at', 'cerrado_por', 'cerrado_por_id', 'total_vendido', 'total_comision', 'totales', 'detalle', 'lineas', 'modelo', 'created_at']) {
      expect(cab).toContain(`new.${col} is distinct from old.${col}`);
    }
    for (const col of ['cierre_id', 'pedido_id', 'tipo', 'ajuste_seq', 'total', 'comision', 'pct', 'sin_comision', 'modelo', 'desglose']) {
      expect(ren).toContain(`new.${col} is distinct from old.${col}`);
    }
    expect(ren).toContain('(new.vigente and not old.vigente)');
    expect(cab).toContain("if tg_op = 'delete' then raise exception");
    expect(ren).toContain("if tg_op = 'delete' then raise exception");
    // anon sigue sin insert/update/delete sobre los cierres (003)
    expect(SQL003).toContain('revoke insert, update, delete, truncate on public.comisiones_cierres from anon, authenticated');
    expect(SQL003).toContain('revoke insert, update, delete, truncate on public.comisiones_cierre_pedidos from anon, authenticated');
    expect(SQL).not.toMatch(/grant (insert|update|delete|all)[a-z, ]* on (table )?public\.comisiones_cierre/);
  });
});

describe('S-COMR idempotencia y "no borrar datos" (regla dura 6)', () => {
  it('AC-COMR-7 transacción única, sin DROP TABLE/COLUMN/FUNCTION, DELETE ni TRUNCATE', () => {
    expect(SQL.trim().startsWith('begin;')).toBe(true);
    expect(SQL.trim().endsWith('commit;')).toBe(true);
    for (const re of [/\bdrop table\b/, /\bdrop column\b/, /\bdrop function\b/, /\bdelete from\b/, /\btruncate\b/, /\bdrop policy\b/, /\bdrop schema\b/, /\balter column\b/]) {
      expect(SQL).not.toMatch(re);
    }
    // todo create/add es idempotente
    expect(SQL).not.toMatch(/create table (?!if not exists)/);
    expect(SQL).not.toMatch(/create index (?!if not exists)/);
    expect(SQL).not.toMatch(/add column (?!if not exists)/);
    const triggers = [...SQL.matchAll(/create trigger ([a-z_0-9]+) /g)].map(m => m[1]);
    for (const t of triggers) expect(SQL).toContain(`drop trigger if exists ${t} `);
  });

  it('AC-COMR-1 la columna comision de clientes queda: la 005 no toca la tabla clientes', () => {
    expect(SQL).not.toMatch(/public\.clientes\b/);
    expect(SQL).not.toMatch(/drop column[^;]*comision/);
    expect(SQL).not.toMatch(/rename column/);
  });

  it('AC-COMR-1 el upsert de clientes nunca manda la clave comision (no se pisa con null)', () => {
    const hostil = { comision: 99, codigo: 'C1', cuit: '20-12345678-6' };
    const remoto = clienteExtraToRemote(hostil);
    expect(Object.prototype.hasOwnProperty.call(remoto, 'comision')).toBe(false);
    expect(Object.keys(clienteExtraToRemote({}))).not.toContain('comision');
    // el pull no mapea comision (la local, si existe, se conserva por el spread de syncService)
    expect(Object.keys(clienteExtraFromRemote({ comision: 50 }, { comision: 7 }))).not.toContain('comision');
  });
});

describe('S-COMR entradas hostiles (dominio)', () => {
  it.each([
    [NaN], [Infinity], [-Infinity], [-1], [100.01], [1e3], ['1e2'], ['-5'], ['5.555'], ['5,5,5'], ['0x10'], [' 1 0 '],
    [{}], [[5]], [true], ['=1+1'], ['@SUM(A1)'], ['10%'],
  ])('AC-COMR-6 validarPctRubro rechaza %p', (v) => {
    expect(validarPctRubro(v).ok).toBe(false);
  });

  it.each([[0, 0], [100, 100], ['5,5', 5.5], ['12.25', 12.25], ['', null], [null, null]])('AC-COMR-6 validarPctRubro acepta %p', (v, esperado) => {
    expect(validarPctRubro(v)).toMatchObject({ ok: true, pct: esperado });
  });

  it('AC-COMR-3 normalizarRubro quita controles, acota a 60 e ignora no-escalares', () => {
    expect(normalizarRubro('Golo\u0000sinas\n\t ')).toBe('Golo sinas');
    expect(normalizarRubro('x'.repeat(500))).toHaveLength(60);
    expect(normalizarRubro({ toString: () => 'pwn' })).toBe('');
    expect(normalizarRubro(['a'])).toBe('');
    expect(claveRubro('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });

  it('AC-SEC-3 importación de productos: un Rubro con fórmula se guarda como texto (apóstrofo)', () => {
    for (const f of ['=HYPERLINK("http://evil","x")', '+cmd|\' /C calc\'!A0', '-2+3', '@SUM(A1:A9)']) {
      const r = validarFilaProducto({ codigo: 'P1', nombre: 'Prod', categoria: f, costoFinal: '10', precio: '20' }, { rubros: [] });
      expect(String(r.valor.producto.categoria).startsWith("'")).toBe(true);
    }
  });

  it('AC-SEC-3 la plantilla generada no tiene celdas que empiecen con = + - @', () => {
    const filas = filasInstrucciones('productos', { proveedores: [{ descripcion: '=cmd()' }] });
    for (const f of filas) for (const c of f) {
      if (typeof c === 'string') expect(c).not.toMatch(/^[=+\-@]/);
    }
  });

  it('S-COMR interpretarGuardarRubros: motivo desconocido o respuesta rara => no_autorizado (fail-closed)', () => {
    expect(interpretarGuardarRubros({ data: { ok: false, motivo: '__proto__' } })).toMatchObject({ ok: false, motivo: 'no_autorizado' });
    expect(interpretarGuardarRubros({ data: { ok: 'true' } })).toMatchObject({ ok: false, motivo: 'no_autorizado' });
    expect(interpretarGuardarRubros({ data: null })).toMatchObject({ ok: false });
    // mensaje genérico: no distingue "PIN malo" de "no es admin"
    expect(interpretarGuardarRubros({ data: { ok: false, motivo: 'no_autorizado' } }).mensaje).toMatch(/PIN incorrecto o .*no está autorizado/);
  });

  it('S-COMR filaRubroToRemote no manda PIN, flags locales ni la clave (la calcula el servidor)', () => {
    const r = filaRubroToRemote({ id: 'a', vendedorId: 'v', rubro: 'X', rubroClave: 'x', pct: 5, editadoAt: 1, pendingSync: true, pin: '1234', syncRechazo: 'x' });
    expect(JSON.stringify(r)).not.toMatch(/1234|pendingSync|syncRechazo|"pin"/);
  });

  it('S-COMR-02 (documenta, abierto) el rubro guardado en el renglón manda sobre el del producto y la base no se concilia con pedido.total', () => {
    const productos = new Map([['p1', { id: 'p1', categoria: 'Bebidas' }]]);
    // un renglón "relabelado" a un rubro de % alto
    const base = baseRubrosPedido({ total: 100, items: [{ productoId: 'p1', precio: 100, cantidad: 1, rubro: 'Premium' }] }, productos);
    expect(base.porRubro.map(r => r.clave)).toEqual(['premium']);
    // items que suman 10.000 en un pedido de total 100: no hay aviso de inconsistencia
    const inflado = baseRubrosPedido({ total: 100, items: [{ productoId: 'p1', precio: 10000, cantidad: 1 }] }, productos);
    expect(inflado.porRubro[0].subtotalCents).toBe(1000000);
    expect(inflado.invalidos).toBe(0);
  });

  it.todo('S-COMR-01 remediación: comisiones_cierre_pedidos.desglose y comisiones_cierres.lineas no legibles con la anon key');
  it.todo('S-COMR-02 remediación: cerrar_comisiones rechaza (o el dashboard avisa) si la suma de renglones difiere de pedidos.total o si el rubro del renglón no existe en productos');
});

// ---------------------------------------------------------------------------
// Re-auditoría iteración 2 (S-COMR-01 revoke, S-COMR-03, S-COMR-04, S-COMR-05)
// ---------------------------------------------------------------------------
describe('S-COMR re-auditoría iter 2', () => {
  const BASE = fn('comision_rubro_base');
  const NORM = fn('rubro_normalizado');

  it('S-COMR-01 la 005 quita el select de comisiones_cierre_pedidos a anon/authenticated, DESPUÉS de cualquier grant de la 003', () => {
    expect(SQL).toContain('revoke select on public.comisiones_cierre_pedidos from anon, authenticated');
    expect(SQL).not.toMatch(/grant select[^;]* on public\.comisiones_cierre_pedidos/);
  });

  it('S-COMR-01 (residual) la PWA nunca lee comisiones_cierre_pedidos; sí lee comisiones_cierres, que sigue legible por anon', () => {
    const fs = require('fs');
    const dir = path.resolve(__dirname, '..', '..');
    const archivos = [];
    const rec = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__') rec(p); } else if (/\.jsx?$/.test(e.name)) archivos.push(p);
    });
    rec(dir);
    expect(archivos.filter(p => fs.readFileSync(p, 'utf8').includes('comisiones_cierre_pedidos'))).toEqual([]);
    // abierto: comisiones_cierres conserva el select a anon (la 005 no lo revoca)
    expect(SQL).not.toMatch(/revoke select on public\.comisiones_cierres\b/);
  });

  it('S-COMR-03 el modelo del cierre lo decide el servidor (pedido o renglón rubro => rubro)', () => {
    expect(CERRAR).toMatch(/v_modelo := case when exists \(select 1 from jsonb_array_elements\(p_renglones\) r where r->>'tipo' = 'pedido' or r->>'modelo' = 'rubro'\) then 'rubro' else 'cliente' end/);
    expect(CERRAR).not.toMatch(/v_modelo := coalesce\(p_cierre->>'modelo'/);
    expect(CERRAR).toContain("'ok', false, 'motivo', 'modelo_obsoleto'");
  });

  it('S-COMR-03 la comparación de desglose es bidireccional (except en ambos sentidos), corre antes de grabar y antes de los ajustes', () => {
    const i = CERRAR.indexOf("'motivo', 'desglose_inconsistente'");
    expect(i).toBeGreaterThan(0);
    expect(CERRAR.match(/\bexcept\b/g).length).toBeGreaterThanOrEqual(4); // 2 de lineas + 2 del desglose
    expect(i).toBeLessThan(CERRAR.indexOf('insert into public.comisiones_cierres'));
    expect(CERRAR.slice(0, i)).toMatch(/union all/);
    // las líneas modelo rubro SIN desglose también fallan (la rama servidor-menos-cliente las detecta)
    expect(CERRAR).toMatch(/where s\.key not like '%\|ajuste'/);
  });

  it('S-COMR-03 (residual, Bajo) las líneas de ajuste y la comisión por rubro no se comparan', () => {
    expect(CERRAR).toMatch(/coalesce\(l->>'tipo', 'pedido'\) <> 'ajuste'/);
    expect(CERRAR).not.toMatch(/d->>'comision'/);
  });

  it('S-COMR-03 no rompe ajustes ni anulación: los ajustes siguen verificados contra el servidor y la anulación no se redefine', () => {
    expect(CERRAR).toContain("'motivo', 'ajuste_invalido'");
    expect(CERRAR).toContain("jsonb_build_object(v_pid || '|ajuste'");
    expect(SQL).not.toMatch(/create or replace function public\.anular_cierre_comisiones/);
  });

  it('S-COMR-04 JS: NFD y NFC dan la misma clave, y la clave es estable', () => {
    const nfd = 'La\u0301cteos'; const nfc = 'L\u00e1cteos';
    expect(claveRubro(nfd)).toBe('lacteos');
    expect(claveRubro(nfc)).toBe('lacteos');
    expect(normalizarRubro(nfd)).toBe(nfc);
    // letras sueltas con diacrítico combinante: queda compuesta
    expect(claveRubro('N\u0303andu\u0301')).toBe('nandu');
    // un diacrítico huérfano o un rubro de solo combinantes no explota
    expect(() => claveRubro('\u0301')).not.toThrow();
  });

  it('S-COMR-04 SQL: normalize NFC va PRIMERO en rubro_normalizado y los controles se reemplazan después', () => {
    expect(NORM).toMatch(/normalize\(coalesce\(p, ''\), nfc\), '\[\\x01-\\x1f\\x7f\]'/);
    expect(NORM).toMatch(/left\(btrim\(/);
    expect(fn('rubro_clave')).toContain('public.rubro_normalizado(p)');
  });

  it('S-COMR-04 (residual, Info) JS corta en unidades UTF-16 y SQL en code points: un rubro >60 con emojis puede dar claves distintas (falla segura)', () => {
    const r = normalizarRubro('😀'.repeat(40));
    expect([...r].length).toBe(30); // 60 unidades UTF-16 => 30 code points; SQL left(...,60) dejaría 40
  });

  it('S-COMR-05 SQL: largo acotado en precio y cantidad, igual que el dominio; desborde con motivo y conflictos', () => {
    expect(BASE).toContain("'^-?[0-9]{1,12}(\\.[0-9]{1,20})?$'");
    expect(BASE).toContain("'^[0-9]{1,9}(\\.[0-9]{1,6})?$'");
    expect(BASE).not.toContain("'^-?[0-9]+(\\.[0-9]+)?$'");
    expect(CERRAR).toMatch(/'motivo', 'monto_desbordado', 'conflictos'/);
    expect(CERRAR).toContain('>= 10000000000000');
    expect(CERRAR).toContain('> 100000000000');
  });

  it('S-COMR-05 el desborde se detecta DESPUÉS de autorizar (no es oráculo para anon)', () => {
    expect(CERRAR.indexOf("'motivo', 'monto_desbordado'")).toBeGreaterThan(CERRAR.indexOf('if not v_pin_ok'));
  });
});
