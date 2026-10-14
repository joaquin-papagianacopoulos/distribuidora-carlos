// Auditoria de seguridad RUN 20261007-2022, verificacion de la iteracion 2.
// Guardas de regresion sobre la autorizacion por PIN de las RPC de la 003 y
// sobre el manejo del PIN en el cliente. Los hallazgos nuevos que quedan
// abiertos van como it.todo con su ID
// (ver harness/reports/20261007-2022/security-report.md).
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const leer = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const limpiarSql = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

const SQL_003 = limpiarSql(leer('supabase', 'migrations', '003_comisiones.sql'));
const SQL_002 = limpiarSql(leer('supabase', 'migrations', '002_seguridad_recomendada.sql'));
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
const SERVICIO = sinComentarios(leer('src', 'services', 'comisionesService.js'));
const PAGINA = sinComentarios(leer('src', 'pages', 'Comisiones.js'));

const cuerpoFn = (sql, nombre) => {
  const m = sql.match(new RegExp(`create or replace function public\\.${nombre}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)end \\$\\$`));
  return m ? m[1] : null;
};
const RPCS = ['cerrar_comisiones', 'anular_cierre_comisiones'];

describe('AC-SEC-4 S-COM-01 fuerza bruta del PIN via las RPC de la 003', () => {
  // Iteracion 3 (S-COM-16): 'pin_incorrecto' y 'no_admin' se unificaron en 'no_autorizado'.
  it.each(RPCS)('AC-SEC-4 S-COM-01 %s: ningun raise ni bloque exception antes de devolver no_autorizado (el intento fallido queda grabado)', (fn) => {
    const b = cuerpoFn(SQL_003, fn);
    const corte = b.indexOf("'no_autorizado'");
    expect(corte).toBeGreaterThan(-1);
    const antes = b.slice(0, corte);
    expect(antes).not.toMatch(/\braise\b/);
    expect(antes).not.toMatch(/\bexception\b/);
  });

  it.each(RPCS)('AC-SEC-4 S-COM-01 %s: el id que se verifica es exactamente el del admin encontrado (no se esquiva el contador con variantes del id)', (fn) => {
    const b = cuerpoFn(SQL_003, fn);
    expect(b).toMatch(/v_admin_id text := trim\(coalesce\(p_admin_id, ''\)\)/);
    expect(b).toMatch(/where ve\.id::text = v_admin_id and ve\.permiso = 1/);
    expect(b).toMatch(/public\.verificar_pin\(v_admin_id, p_admin_pin\)/);
  });

  it('AC-SEC-4 S-COM-01 verificar_pin (002 paso 1) graba cada intento con el mismo id que cuenta para el bloqueo', () => {
    const v = cuerpoFn(SQL_002, 'verificar_pin');
    expect(v).toMatch(/where vendedor_id = p_vendedor_id and not ok and intento_en > now\(\) - interval '15 minutes'/);
    expect(v).toMatch(/insert into public\.vendedores_pin_intentos \(vendedor_id, ok\) values \(p_vendedor_id, v_ok\)/);
    expect(v).toMatch(/where id::text = p_vendedor_id/);
  });

  it('AC-SEC-4 S-COM-01 la anulacion verifica el PIN antes de leer o bloquear el cierre (no es oraculo de ids)', () => {
    const b = cuerpoFn(SQL_003, 'anular_cierre_comisiones');
    expect(b.indexOf("'no_autorizado'")).toBeLessThan(b.indexOf("'no_existe'"));
    expect(b.indexOf("'no_autorizado'")).toBeLessThan(b.indexOf('for update'));
  });
});

describe('AC-SEC-2 S-COM-01 el PIN no se persiste ni se loguea en el cliente', () => {
  it('AC-SEC-2 S-COM-01 comisionesService: ninguna escritura local lleva el PIN o las credenciales', () => {
    const escrituras = SERVICIO.split('\n').filter(l => /guardarLocal\(|putComision|putComisionesCierresRemotos\(/.test(l));
    expect(escrituras.length).toBeGreaterThan(0);
    for (const l of escrituras) {
      expect(l).not.toMatch(/\bpin\b|p_admin_pin|\bcred\b|cr\.cred/);
    }
    expect(SERVICIO).not.toMatch(/console\.[a-z]+\([^)]*\b(pin|cred)\b/);
    expect(SERVICIO).not.toMatch(/localStorage|sessionStorage/);
  });

  it('AC-SEC-2 S-COM-01 Comisiones.js: el PIN es un input password sin autocompletar y no va al borrador ni al storage', () => {
    expect(PAGINA).toMatch(/type="password"/);
    expect(PAGINA).toMatch(/autoComplete="off"/);
    expect(PAGINA).not.toMatch(/localStorage|sessionStorage/);
    expect(PAGINA).not.toMatch(/guardarBorrador\([^)]*pin/i);
    expect(PAGINA).not.toMatch(/console\.[a-z]+\([^)]*\bpin/i);
  });
});

// ---------------------------------------------------------------------------
// Iteracion 3 del implementador: S-COM-13, S-COM-15 y S-COM-16 pasan de it.todo
// a tests reales. S-COM-14 sigue abierto (SQL de la 002 / dueño).
// ---------------------------------------------------------------------------
const SELECTOR = sinComentarios(leer('src', 'components', 'SelectorVendedor.js'));
const SYNC = sinComentarios(leer('src', 'sync', 'syncService.js'));
const DB = sinComentarios(leer('src', 'db', 'index.js'));
const CONFIG = sinComentarios(leer('src', 'pages', 'Configuracion.js'));
const CTX = sinComentarios(leer('src', 'hooks', 'useAppContext.js'));
const VSERV = sinComentarios(leer('src', 'services', 'vendedoresService.js'));

describe('AC-SEC-4 S-COM-13 cliente del PASO 2 de la 002 (login 100 % online)', () => {
  it('AC-SEC-4 S-COM-13 el login no compara contra un PIN local: valida con rpc verificar_pin', () => {
    expect(SELECTOR).not.toMatch(/\.pin\b/);
    expect(SELECTOR).not.toMatch(/expected|pinClean\s*!==/);
    // MOD (RUN 20261012-2106, C5 / S-COM-18): el selector usa ingresarConPin,
    // que verifica con verificarPinIngreso (rpc verificar_pin) y recién después
    // lee la fila del servidor. La garantía (el PIN lo valida el servidor) se mantiene.
    expect(SELECTOR).toMatch(/ingresarConPin\(/);
    const ingresar = VSERV.slice(VSERV.indexOf('export const ingresarConPin'));
    expect(ingresar).toMatch(/await verificarPinIngreso\(vendedor, pin/);
    expect(ingresar.indexOf('verificarPinIngreso(')).toBeLessThan(ingresar.indexOf('leerFilaVendedor('));
    expect(VSERV).toMatch(/supabase\.rpc\('verificar_pin', \{ p_vendedor_id: String\(rid\), p_pin:/);
  });

  it('AC-SEC-4 S-COM-13 el pull de vendedores usa select explicito sin pin y no guarda pin', () => {
    const bloque = SYNC.slice(SYNC.indexOf('const fetchVendedoresRemotos'), SYNC.indexOf('export const uploadSeedToSupabase'));
    expect(bloque).toMatch(/\.select\(cols\)/);
    expect(bloque).not.toMatch(/select\('\*'\)/);
    expect(SYNC).not.toMatch(/fetchAll\('vendedores'\)/);
    expect(SYNC).not.toMatch(/r\.pin\b|local\?\.pin\b/);
    expect(SYNC).toMatch(/vendedorDesdeRemoto\(r, local\)/);
  });

  it('AC-SEC-4 S-COM-13 ninguna alta/edicion manda pin en texto plano por insert/upsert', () => {
    const sync = SYNC.slice(SYNC.indexOf('export const syncVendedor'), SYNC.indexOf('const fetchVendedoresRemotos'));
    expect(sync).not.toMatch(/\bpin\b/);
    expect(sync).toMatch(/permiso: 2,/);
    expect(CONFIG).not.toMatch(/syncVendedor\(/);
    expect(CONFIG).toMatch(/guardarVendedorAdmin\(/);
    expect(VSERV).toMatch(/supabase\.rpc\('admin_guardar_vendedor'/);
  });

  // MOD (RUN 20261014-1449, AC-COMR-7): antes DB_VERSION = 6; ahora 7 (REQ-COMR
  // solo agrega el store comisionesRubro). El paso v5 -> v6 sigue igual (oldVersion < 6).
  it('AC-SEC-4 S-COM-13 AC-COMR-7 IndexedDB: el paso a v6 borra SOLO la propiedad pin (sin borrar registros ni stores); versión actual 7', () => {
    expect(DB).toMatch(/const DB_VERSION = 7;/);
    expect(DB).toMatch(/\(e\.oldVersion \?\? 0\) < 6/);
    expect(DB).toMatch(/cursor\.update\(sinPinLocal\(cursor\.value\)\)/);
    expect(DB).not.toMatch(/deleteObjectStore|cursor\.delete\(/);
    // toda escritura de vendedores pasa por sinPinLocal
    expect(DB).toMatch(/store\.put\(sinPinLocal\(row\)\)/);
    expect(DB).toMatch(/store\.add\(sinPinLocal\(/);
    expect(DB).toMatch(/store\.put\(sinPinLocal\(v\)\)/);
    expect(DB).toMatch(/backup\.vendedores : \[\]\)\.map\(sinPinLocal\)/);
  });

  it('AC-SEC-2 S-COM-13 ningun PIN en logs, localStorage ni estado persistido', () => {
    for (const src of [SELECTOR, VSERV, CONFIG, CTX]) {
      expect(src).not.toMatch(/console\.[a-z]+\([^)]*\b(pin|adminPin|pinTipeado)\b/i);
    }
    expect(SELECTOR).not.toMatch(/localStorage|sessionStorage/);
    expect(VSERV).not.toMatch(/localStorage|sessionStorage/);
    expect(CTX).toMatch(/!tienePin\(found\) \|\| sesionValidada\(found\.id\)/);
    expect(CTX).not.toMatch(/found\.pin/);
  });

  it('AC-SEC-4 S-COM-13 la 002 (alta/edicion) responde lo mismo para "no admin" y "PIN incorrecto" (S-COM-16)', () => {
    const f = cuerpoFn(SQL_002, 'admin_guardar_vendedor');
    expect(f).not.toMatch(/solo un admin con pin/);
    expect(f).toMatch(/if not coalesce\(public\.verificar_pin\(p_admin_id, p_admin_pin\), false\) or not exists/);
    const corte = f.indexOf('return null;');
    expect(f.slice(0, corte)).not.toMatch(/\braise\b/);
  });
});

describe('AC-COM-16 S-COM-15 ajustes serializados por pedido', () => {
  const C = () => cuerpoFn(SQL_003, 'cerrar_comisiones');
  const A = () => cuerpoFn(SQL_003, 'anular_cierre_comisiones');

  // MOD (RUN 20261012-2106, C7 / S-COM-21): antes fijaba un lock por pedido
  // (hasta 5000 por transacción). Ahora es UN lock global; las aserciones de
  // orden se conservan y se aplican al lock global, más "un solo lock" y "no
  // quedan locks por pedido".
  it('AC-COM-16 S-COM-21 cerrar_comisiones toma UN lock global después de autorizar y antes de idempotencia/validaciones/insert; no quedan locks por pedido', () => {
    const c = C();
    const lock = c.indexOf("perform pg_advisory_xact_lock(hashtext('comisiones_global'))");
    expect(lock).toBeGreaterThan(-1);
    expect(c.match(/pg_advisory_xact_lock/g)).toHaveLength(1);
    expect(c).not.toContain('comisiones_pedido:');
    expect(c).not.toContain('comisiones_cierre:');
    expect(c).not.toMatch(/for v_pid in/);
    expect(lock).toBeGreaterThan(c.indexOf('public.verificar_pin('));
    expect(lock).toBeGreaterThan(c.indexOf("'no_autorizado'"));
    expect(lock).toBeLessThan(c.indexOf("'ya_existia', true"));
    expect(lock).toBeLessThan(c.indexOf("'pedido_invalido'"));
    expect(lock).toBeLessThan(c.indexOf("'ajuste_invalido'"));
    expect(lock).toBeLessThan(c.indexOf("'montos_inconsistentes'"));
    expect(lock).toBeLessThan(c.indexOf('insert into public.comisiones_cierre_pedidos'));
  });

  it('AC-COM-16 S-COM-15 ajuste_seq lo asigna el servidor (max + 1), no el cliente', () => {
    const c = C();
    const ins = c.slice(c.indexOf('insert into public.comisiones_cierre_pedidos'));
    expect(ins).toMatch(/coalesce\(\(select max\(cp\.ajuste_seq\) from public\.comisiones_cierre_pedidos cp where cp\.pedido_id = r->>'pedido_id' and cp\.tipo = 'ajuste'\), 0\) \+ 1/);
    expect(ins).not.toMatch(/\(r->>'ajuste_seq'\)::int/);
  });

  // MOD (RUN 20261012-2106, C7 / S-COM-21): el lock por pedido pasa a ser el
  // lock global, tomado después de autorizar y ANTES del for update.
  it('AC-COM-12 S-COM-21 anular toma el lock global después de autorizar y antes del for update y de tiene_ajustes_vigentes (S-COM-15: se BLOQUEA)', () => {
    const a = A();
    const lock = a.indexOf("perform pg_advisory_xact_lock(hashtext('comisiones_global'))");
    const rechazo = a.indexOf("'tiene_ajustes_vigentes'");
    expect(lock).toBeGreaterThan(-1);
    expect(a.match(/pg_advisory_xact_lock/g)).toHaveLength(1);
    expect(a).not.toContain('comisiones_pedido:');
    expect(a).not.toMatch(/for v_pid in/);
    expect(lock).toBeGreaterThan(a.indexOf('public.verificar_pin('));
    expect(lock).toBeLessThan(a.indexOf('for update'));
    expect(lock).toBeGreaterThan(a.indexOf("'no_autorizado'"));
    expect(rechazo).toBeGreaterThan(lock);
    expect(rechazo).toBeLessThan(a.indexOf('update public.comisiones_cierres'));
    expect(a).toMatch(/aj\.tipo = 'ajuste' and aj\.vigente and aj\.cierre_id <> p_id where base\.cierre_id = p_id and base\.tipo = 'pedido' and base\.vigente/);
  });

  it('AC-COM-12 S-COM-15 el cliente tambien lo chequea antes de llamar (cierresConAjustesDependientes)', () => {
    const { cierresConAjustesDependientes } = require('../comisiones');
    const base = { id: 'c1', estado: 'vigente', lineas: [{ tipo: 'pedido', pedidoId: 'R1' }, { tipo: 'pedido', pedidoId: 'R2' }] };
    const conAjuste = { id: 'c2', estado: 'vigente', lineas: [{ tipo: 'ajuste', pedidoId: 'R1', ajusteSeq: 1 }] };
    const pendiente = { id: 'c3', estado: 'pendiente', lineas: [{ tipo: 'ajuste', pedidoId: 'R2' }] };
    const anulado = { id: 'c4', estado: 'anulado', lineas: [{ tipo: 'ajuste', pedidoId: 'R1' }] };
    const otroPedido = { id: 'c5', estado: 'vigente', lineas: [{ tipo: 'ajuste', pedidoId: 'R9' }, { tipo: 'pedido', pedidoId: 'R1' }] };
    expect(cierresConAjustesDependientes(base, [base, conAjuste, pendiente, anulado, otroPedido, null])).toEqual(['c2', 'c3']);
    // un cierre que solo tiene ajustes no bloquea nada
    expect(cierresConAjustesDependientes(conAjuste, [base, conAjuste, pendiente])).toEqual([]);
    expect(cierresConAjustesDependientes(null, [base])).toEqual([]);
    expect(cierresConAjustesDependientes(base, null)).toEqual([]);
  });
});

describe('AC-SEC-4 S-COM-16 respuesta unica y la idempotencia compara por id', () => {
  it.each(RPCS)('AC-SEC-4 S-COM-16 %s: verificar_pin se llama siempre y no hay no_admin / pin_incorrecto', (fn) => {
    const b = cuerpoFn(SQL_003, fn);
    expect(b).not.toContain("'no_admin'");
    expect(b).not.toContain("'pin_incorrecto'");
    // la verificacion del PIN no depende de que el id sea admin
    const pin = b.indexOf('v_pin_ok := coalesce(public.verificar_pin(v_admin_id, p_admin_pin), false)');
    expect(pin).toBeGreaterThan(b.indexOf('from public.vendedores ve'));
    expect(b.slice(b.indexOf('from public.vendedores ve'), pin)).not.toMatch(/return/);
  });

  it('AC-SEC-4 S-COM-16 cerrado_por_id se graba, es inmutable y decide ya_existia', () => {
    expect(SQL_003).toMatch(/alter table public\.comisiones_cierres add column if not exists cerrado_por_id text/);
    expect(cuerpoFn(SQL_003, 'tg_cierre_inmutable')).toContain('new.cerrado_por_id is distinct from old.cerrado_por_id');
    expect(cuerpoFn(SQL_003, 'cerrar_comisiones')).toMatch(/if v_existente = v_admin_id then/);
  });
});

describe('Hallazgos que siguen abiertos', () => {
  it.todo('S-COM-14 cualquiera puede bloquear al admin 15 minutos (5 PIN malos via verificar_pin o las RPC): DoS del cierre/anulacion');
});
