// Auditoria de seguridad RUN 20261007-2022 (REQ-COM). Guardas de regresion
// sobre lo que la auditoria verifico como correcto y sobre los hallazgos
// corregidos en la iteracion 2 (S-COM-01, 02, 04, 07, 08, 09, 10, 12).
// Lo que queda para el dueño sigue como it.todo con su ID
// (ver harness/reports/20261007-2022/security-report.md).
import { readFileSync } from 'fs';
import path from 'path';
import {
  filasPdfCierre, mezclarCierres, cierreToRemote, puedeVerComisiones, armarDashboard, construirCierre,
  CONFIG_COMISIONES, pctCongelado,
} from '../comisiones';

const SQL_RAW = readFileSync(path.resolve(__dirname, '..', '..', '..', 'supabase', 'migrations', '003_comisiones.sql'), 'utf8');
const SQL = SQL_RAW
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

const cuerpoFn = (nombre) => {
  const m = SQL.match(new RegExp(`create or replace function public\\.${nombre}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)end \\$\\$`));
  return m ? m[1] : null;
};
const RPCS = ['cerrar_comisiones', 'anular_cierre_comisiones'];

describe('AC-COM-16 AC-SEC-5 auditoria de la migracion 003', () => {
  it.each(RPCS)('AC-COM-16 S-COM-12 %s: security definer con search_path = public, pg_temp', (fn) => {
    expect(SQL).toMatch(new RegExp(`create or replace function public\\.${fn}\\([^)]*\\) returns jsonb language plpgsql security definer set search_path = public, pg_temp as \\$\\$`));
  });

  it.each(RPCS)('AC-COM-16 %s: toda tabla se referencia con esquema (sin hijack por search_path)', (fn) => {
    const body = cuerpoFn(fn);
    expect(body).not.toBeNull();
    const refs = [...body.matchAll(/\b(?:from|into|update|join)\s+([a-z_][a-z0-9_.]*)/g)].map(m => m[1])
      .filter(t => !t.startsWith('jsonb_') && !t.startsWith('v_') && t !== 'public'); // v_*: variables de select ... into
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.filter(t => !t.startsWith('public.'))).toEqual([]);
  });

  it('AC-COM-16 la RPC de cierre valida admin ANTES de insertar y la de anular antes de actualizar', () => {
    // Iteracion 3 (S-COM-16): 'no_admin' y 'pin_incorrecto' se unificaron en 'no_autorizado'.
    const c = cuerpoFn('cerrar_comisiones');
    expect(c.indexOf("'no_autorizado'")).toBeGreaterThan(-1);
    expect(c.indexOf("'no_autorizado'")).toBeLessThan(c.indexOf('insert into public.comisiones_cierres'));
    const a = cuerpoFn('anular_cierre_comisiones');
    expect(a.indexOf("'no_autorizado'")).toBeLessThan(a.indexOf('update public.comisiones_cierres'));
  });

  it('AC-SEC-5 las RPC no quedan ejecutables por PUBLIC (revoke antes del grant)', () => {
    for (const sig of ['cerrar_comisiones\\(jsonb, jsonb, text, text\\)', 'anular_cierre_comisiones\\(text, text, text, text\\)']) {
      const rev = SQL.search(new RegExp(`revoke all on function public\\.${sig} from public`));
      const gra = SQL.search(new RegExp(`grant execute on function public\\.${sig} to anon, authenticated`));
      expect(rev).toBeGreaterThan(-1);
      expect(rev).toBeLessThan(gra);
    }
  });

  it('AC-SEC-5 anon/authenticated no pueden escribir las tablas de cierres', () => {
    for (const t of ['comisiones_cierres', 'comisiones_cierre_pedidos']) {
      expect(SQL).toContain(`revoke insert, update, delete, truncate on public.${t} from anon, authenticated`);
      expect(SQL).not.toMatch(new RegExp(`grant [^;]*\\b(insert|update|delete|all)\\b[^;]* on (table )?public\\.${t}\\b`));
    }
  });

  it('AC-COM-11 el renglon no puede volver de no vigente a vigente (no se "resucita" un cierre anulado)', () => {
    const tg = cuerpoFn('tg_cierre_renglon_inmutable');
    expect(tg).toMatch(/new\.vigente and not old\.vigente/);
    // el % y la marca "sin comision" congelados tampoco se pueden editar
    expect(tg).toContain('new.pct is distinct from old.pct');
    expect(tg).toContain('new.sin_comision is distinct from old.sin_comision');
    expect(cuerpoFn('tg_cierre_inmutable')).toMatch(/old\.estado = 'anulado'/);
  });

  it('AC-COM-16 el pedido se valida por igualdad exacta de id (variantes " 12" / "012" no esquivan el indice unico)', () => {
    expect(cuerpoFn('cerrar_comisiones')).toMatch(/p\.id::text = r->>'pedido_id'/);
  });

  // ---------------- S-COM-01: PIN del admin verificado en el servidor ----------------
  it('AC-SEC-4 S-COM-01 la 003 aborta al principio si falta verificar_pin (aplicar antes 002 paso 1)', () => {
    const chk = SQL.search(/if to_regprocedure\('public\.verificar_pin\(text, text\)'\) is null then raise exception '[^']*aplicar antes 002[^']*paso 1/);
    expect(chk).toBeGreaterThan(-1);
    expect(SQL.trim().startsWith('begin;')).toBe(true);
    // antes de cualquier alter/create
    expect(chk).toBeLessThan(SQL.indexOf('alter table public.pedidos'));
    expect(chk).toBeLessThan(SQL.indexOf('create table'));
  });

  it.each(RPCS)('AC-SEC-4 S-COM-01 %s recibe p_admin_id + p_admin_pin y los valida con verificar_pin y permiso = 1', (fn) => {
    expect(SQL).toMatch(new RegExp(`create or replace function public\\.${fn}\\([^)]*p_admin_id text, p_admin_pin text[^)]*\\)`));
    const b = cuerpoFn(fn);
    expect(b).toMatch(/from public\.vendedores ve where ve\.id::text = v_admin_id and ve\.permiso = 1/);
    // Iteracion 3 (S-COM-16): verificar_pin se llama siempre y la respuesta es unica.
    expect(b).toMatch(/v_pin_ok := coalesce\(public\.verificar_pin\(v_admin_id, p_admin_pin\), false\); if not v_pin_ok or v_por is null or length\(v_por\) = 0 then return jsonb_build_object\('ok', false, 'motivo', 'no_autorizado'\)/);
    // ya no autoriza por nombre mandado por el cliente
    expect(b).not.toMatch(/trim\(nombre\) = v_por/);
    expect(b).not.toContain('p_por');
    const escritura = fn === 'cerrar_comisiones' ? 'insert into public.comisiones_cierres' : 'update public.comisiones_cierres';
    expect(b.indexOf("'no_autorizado'")).toBeLessThan(b.indexOf(escritura));
    expect(b).not.toContain("'pin_incorrecto'");
    expect(b).not.toContain("'no_admin'");
  });

  it('AC-SEC-4 S-COM-01 cerrado_por / anulado_por los fija el servidor (admin autenticado), no el cliente', () => {
    const c = cuerpoFn('cerrar_comisiones');
    expect(c).not.toContain("p_cierre->>'cerrado_por'");
    // Iteracion 3 (S-COM-16): ademas se graba el id del admin (cerrado_por_id).
    expect(c).toMatch(/values \(v_id, v_desde, v_hasta, now\(\), v_por, v_admin_id, 'vigente'/);
    expect(cuerpoFn('anular_cierre_comisiones')).toContain('anulado_por = v_por');
  });

  it('AC-SEC-4 S-COM-01 se eliminan las firmas viejas (autorizadas por nombre) y se otorgan solo las nuevas', () => {
    expect(SQL).toContain('drop function if exists public.cerrar_comisiones(jsonb, jsonb);');
    expect(SQL).toContain('drop function if exists public.anular_cierre_comisiones(text, text, text);');
    expect(SQL).not.toMatch(/grant execute on function public\.cerrar_comisiones\(jsonb, jsonb\)/);
    expect(SQL).not.toMatch(/grant execute on function public\.anular_cierre_comisiones\(text, text, text\) /);
  });

  // ---------------- S-COM-09 / S-COM-10: idempotencia despues de autorizar ----------------
  it('AC-COM-16 S-COM-10 la idempotencia por UUID se resuelve DESPUES del PIN y solo para el mismo admin', () => {
    const c = cuerpoFn('cerrar_comisiones');
    const pin = c.indexOf('public.verificar_pin(');
    const idem = c.indexOf("'ya_existia', true");
    expect(pin).toBeGreaterThan(-1);
    expect(idem).toBeGreaterThan(pin);
    // Iteracion 3 (S-COM-16): se compara por ID del admin, no por nombre.
    expect(c).toMatch(/select coalesce\(c\.cerrado_por_id, ''\) into v_existente/);
    expect(c).toMatch(/if v_existente = v_admin_id then return jsonb_build_object\('ok', true, 'ya_existia', true\)/);
    expect(c).not.toMatch(/v_existente = v_por/);
    expect(c).toContain("'id_en_uso'");
  });

  it('AC-COM-16 S-COM-09 lock por id antes del chequeo de idempotencia y rechazo de renglones duplicados', () => {
    const c = cuerpoFn('cerrar_comisiones');
    const lock = c.indexOf("perform pg_advisory_xact_lock(hashtext('comisiones_cierre:' || v_id))");
    expect(lock).toBeGreaterThan(c.indexOf('public.verificar_pin('));
    expect(lock).toBeLessThan(c.indexOf("'ya_existia', true"));
    expect(c).toContain("'renglones_duplicados'");
  });

  // ---------------- S-COM-02 / S-COM-04 / S-COM-07: el servidor recalcula ----------------
  it('AC-COM-10 S-COM-02 el total de cada pedido sale de public.pedidos y la comision del % enviado validado 0..100', () => {
    const c = cuerpoFn('cerrar_comisiones');
    expect(c).toMatch(/greatest\(round\(coalesce\(p\.total, 0\)::numeric, 2\), 0\) from public\.pedidos p where p\.id::text = r->>'pedido_id'/);
    expect(c).toMatch(/x\.total_env <> x\.total_srv or x\.com_env <> round\(x\.total_srv \* x\.pct \/ 100, 2\)/);
    expect(c).toMatch(/then \(r->>'pct'\)::numeric < 0 or \(r->>'pct'\)::numeric > 100/);
    expect(c).toContain("'montos_inconsistentes'");
    // ajustes: % congelado del SERVIDOR y diferencia contra lo ya cerrado
    expect(c).toMatch(/a\.com_env <> round\(a\.tot_actual \* a\.pct_base \/ 100, 2\) - a\.com_cerrada/);
    expect(c).toContain("'ajuste_invalido'");
    expect(SQL).toMatch(/add column if not exists pct numeric\(5,2\) check \(pct is null or \(pct >= 0 and pct <= 100\)\)/);
  });

  it('AC-COM-10 S-COM-02 totales del cierre recalculados (rechaza si no coinciden) y cerrado_at = now() del servidor', () => {
    const c = cuerpoFn('cerrar_comisiones');
    for (const campo of ["p_cierre->>'total_vendido'", "p_cierre->>'total_comision'", "p_cierre->'totales'->>'totalvendido'", "p_cierre->'totales'->>'totalcomision'"]) {
      expect(c).toContain(campo);
    }
    expect(c).toContain("'totales_inconsistentes'");
    expect(c).toContain("filter (where coalesce(r->>'sin_comision', 'false') <> 'true')");
    // se graban los totales recalculados, no los enviados
    expect(c).toMatch(/now\(\), v_por, v_admin_id, 'vigente', v_tot_vend, v_tot_com,/);
    expect(c).not.toContain("p_cierre->>'cerrado_at'");
  });

  it('AC-COM-3 S-COM-04 la RPC exige facturado + entregado + fecha dentro del periodo (mismo criterio que CONFIG_COMISIONES)', () => {
    const c = cuerpoFn('cerrar_comisiones');
    const campo = CONFIG_COMISIONES.criterioEntregado === 'aReparto' ? 'a_reparto' : 'entregado';
    // Si se cambia el criterio en el dominio sin cambiar la RPC (o al reves), falla.
    expect(c).toContain(`and coalesce(p.${campo}, false)`);
    expect(c).toContain("lower(coalesce(p.estado, '')) = 'facturado'");
    expect(c).toMatch(/left\(coalesce\(p\.fecha::text, ''\), 10\) between \(p_cierre->>'desde'\) and \(p_cierre->>'hasta'\)/);
    expect(c).toContain("'periodo_invalido'");
  });

  it('AC-COM-16 S-COM-07 lineas y p_renglones tienen que ser el mismo set (con los mismos montos)', () => {
    const c = cuerpoFn('cerrar_comisiones');
    expect(c).toContain("jsonb_array_length(p_cierre->'lineas') <> jsonb_array_length(p_renglones)");
    expect((c.match(/ except /g) || []).length).toBeGreaterThanOrEqual(2);
    expect(c).toContain("'lineas_inconsistentes'");
  });

  it.todo('S-COM-03 comisiones_cierres no es legible con la anon key (queda para el dueño: RPC de lectura con PIN o Supabase Auth)');
});

// Réplica en JS de las reglas que verifica cerrar_comisiones, para asegurar que
// lo que arma el cliente NO lo rechaza el servidor (falsos rechazos).
const centsRedondeo = (totalCents, pct) => {
  const base = Math.round(pct * 100);
  const n = totalCents * base;
  const q = Math.floor(n / 10000);
  return (n - q * 10000) * 2 >= 10000 ? q + 1 : q;
};
const c2 = (x) => Math.round(Number(x) * 100);

describe('AC-COM-10 S-COM-02 lo que arma el cliente cumple las reglas del servidor', () => {
  const VEND = [{ id: 1, nombre: 'Jorge', permiso: 1 }, { id: 2, nombre: 'Carlos', permiso: 2 }, { id: 3, nombre: 'Lucía', permiso: 2 }];
  const CLI = [
    { id: 10, nombre: 'Kiosco', vendedor: 'Carlos', comision: 10.125 }, // % con 3 decimales
    { id: 11, nombre: 'Almacén', vendedor: 'Lucía', comision: 7 },
    { id: 12, nombre: 'SinPct', vendedor: 'Lucía', comision: '' },
  ];
  const P = { desde: '2026-10-01', hasta: '2026-10-31' };
  const ped = (o) => ({ estado: 'facturado', entregado: true, fecha: '2026-10-05', vendedor: 'Carlos', ...o });
  const PEDIDOS = [
    ped({ id: 1, remoteId: 'A', clienteId: 10, clienteNombre: 'Kiosco', total: 333.33 }),
    ped({ id: 2, remoteId: 'B', clienteId: 11, clienteNombre: 'Almacén', total: 100.01, vendedor: 'Carlos' }), // cargó otro => dividir
    ped({ id: 3, remoteId: 'C', clienteId: 11, clienteNombre: 'Almacén', total: 50 }),
    ped({ id: 4, remoteId: 'D', clienteId: 12, clienteNombre: 'SinPct', total: 80 }),
    ped({ id: 5, remoteId: 'E', clienteId: 10, clienteNombre: 'Kiosco', total: 120, fecha: '2026-09-10' }), // cerrado antes y editado => ajuste
  ];
  const CIERRES = [{
    id: 'prev', estado: 'vigente', desde: '2026-09-01', hasta: '2026-09-30',
    lineas: [{ tipo: 'pedido', pedidoId: 'E', fecha: '2026-09-10', clienteId: 10, clienteNombre: 'Kiosco', total: 100, pct: 10.125, comision: 10.13, asignacion: { modo: 'ficha', partes: [{ vendedor: 'Carlos', pct: 100 }] } }],
  }];
  const BORRADOR = { id: 'b', asignaciones: { B: { modo: 'dividir', pctFicha: '33.33', pctCargador: '66.67' }, C: { modo: 'sin_comision' } } };

  it('AC-COM-10 S-COM-02 renglones, ajustes y totales coinciden con el recalculo del servidor', () => {
    const d = armarDashboard({ pedidos: PEDIDOS, clientes: CLI, vendedores: VEND, cierres: CIERRES, borrador: BORRADOR, periodo: P });
    const cierre = construirCierre(d, { admin: 'Jorge', genId: () => 'u1' });
    const { p_cierre: pc, p_renglones: rs } = cierreToRemote(cierre);
    const porId = new Map(PEDIDOS.map(p => [p.remoteId, p]));

    for (const r of rs.filter(x => x.tipo === 'pedido')) {
      expect(r.pct === null || (r.pct >= 0 && r.pct <= 100)).toBe(true);
      const totalSrv = Math.max(0, c2(porId.get(r.pedido_id).total));
      expect(c2(r.total)).toBe(totalSrv);
      expect(c2(r.comision)).toBe(centsRedondeo(totalSrv, r.pct ?? 0));
    }
    // ajuste: % congelado del servidor (el de la base) y diferencia contra lo cerrado
    const aj = rs.find(x => x.tipo === 'ajuste');
    expect(aj).toMatchObject({ pedido_id: 'E', ajuste_seq: 1 });
    expect(c2(aj.total)).toBe(12000 - 10000);
    expect(c2(aj.comision)).toBe(centsRedondeo(12000, pctCongelado(10.125)) - 1013);

    const totVend = rs.filter(x => x.tipo === 'pedido').reduce((a, x) => a + c2(x.total), 0);
    const totCom = rs.filter(x => !x.sin_comision).reduce((a, x) => a + c2(x.comision), 0);
    expect(c2(pc.total_vendido)).toBe(totVend);
    expect(c2(pc.total_comision)).toBe(totCom);
    expect(c2(pc.totales.totalVendido)).toBe(totVend);
    expect(c2(pc.totales.totalComision)).toBe(totCom);
    expect(pc.totales.porVendedor.reduce((a, v) => a + c2(v.totalComision), 0)).toBe(totCom);
    expect(rs.find(x => x.pedido_id === 'C').sin_comision).toBe(true);
    expect(rs.find(x => x.pedido_id === 'D').pct).toBeNull();
    // S-COM-07: mismo set y mismos montos en lineas y renglones
    expect(pc.lineas.map(l => [l.pedidoId, l.tipo, c2(l.total), c2(l.comision)]))
      .toEqual(rs.map(r => [r.pedido_id, r.tipo, c2(r.total), c2(r.comision)]));
  });

  it('AC-COM-10 S-COM-02 pctCongelado: el % viaja con 2 decimales, igual que el calculo; invalido => null', () => {
    expect(pctCongelado(10.125)).toBe(10.13);
    expect(pctCongelado('7,5')).toBe(7.5);
    expect(pctCongelado(0)).toBe(0);
    for (const v of [null, undefined, '', -1, 101, NaN, {}, 'x']) expect(pctCongelado(v)).toBeNull();
  });
});

describe('AC-COM-14 AC-SEC-2 PDF del cierre con datos hostiles', () => {
  const hostil = {
    id: '<img src=x onerror=alert(1)>',
    desde: '2026-09-01', hasta: '2026-09-30', estado: 'vigente',
    cerradoAt: Date.UTC(2026, 9, 1), cerradoPor: '<script>alert(1)</script>',
    totales: { pedidos: 1, clientes: 1, totalVendido: 100, totalComision: 10, porVendedor: [{ vendedor: '=HYPERLINK("http://x")', pedidos: 1, clientes: 1, totalVendido: 100, totalComision: 10 }] },
    detalle: [{ vendedor: 'javascript:alert(1)', clientes: [{ clienteNombre: '"><svg onload=alert(1)>', pedidos: [{ pedidoId: '1', tipo: 'pedido', fecha: '2026-09-02', total: 100, pct: 10, asignacion: 'ficha', comision: 10 }] }] }],
  };

  it('AC-COM-14 las filas son texto plano (jsPDF no interpreta HTML ni crea links) y el nombre de archivo no lleva datos libres', () => {
    const f = filasPdfCierre(hostil);
    expect(typeof f.subtitulo).toBe('string');
    expect(f.filename).toBe('comisiones_2026-09-01_2026-09-30.pdf');
    for (const fila of [...f.resumen, ...f.detalle]) for (const celda of fila) expect(typeof celda).toBe('string');
  });

  it('AC-COM-14 AC-SEC-2 S-COM-08 filasPdfCierre fuerza string en TODAS las celdas (un objeto {content, styles} del jsonb remoto no llega a autotable)', () => {
    const celda = { content: 'FALSO', styles: { fontSize: 40, textColor: [255, 255, 255] }, colSpan: 8 };
    const f = filasPdfCierre({
      ...hostil,
      estado: 'anulado', anuladoPor: celda, motivoAnulacion: celda, cerradoPor: celda,
      totales: { pedidos: celda, clientes: celda, totalVendido: celda, totalComision: celda, porVendedor: [{ vendedor: celda, pedidos: celda, clientes: celda, totalVendido: celda, totalComision: celda }] },
      detalle: [
        { vendedor: celda, clientes: [{ clienteNombre: celda, pedidos: [{ pedidoId: celda, tipo: 'pedido', fecha: celda, total: celda, pct: celda, asignacion: 'dividir', division: celda, comision: celda }] }] },
        { vendedor: 'X', clientes: 'no es lista' },
        { vendedor: 'Y', clientes: [{ clienteNombre: 'Z', pedidos: [{ pedidoId: 2, asignacion: { modo: 'ficha' }, total: 5 }] }] },
      ],
    });
    const celdas = [...f.resumen, ...f.detalle].flat();
    expect(celdas.length).toBeGreaterThan(0);
    for (const c of celdas) expect(typeof c).toBe('string');
    expect(celdas.some(c => c.includes('[object Object]'))).toBe(true);
    expect(celdas.some(c => c.includes('NaN'))).toBe(false);
    expect(typeof f.anulado).toBe('string');
    expect(f.detalle).toHaveLength(2);
    expect(f.detalle[1][6]).toBe('-'); // asignacion que no es string no se interpreta
  });
});

describe('AC-COM-10 AC-COM-16 integridad del cliente', () => {
  it('AC-COM-16 el pull no pisa un cierre local pendiente ni una anulacion en curso', () => {
    const locales = [
      { id: 'a', estado: 'pendiente', pendingSync: true, lineas: [] },
      { id: 'b', estado: 'vigente', pendingSync: false, anulacionPendiente: { por: 'Jorge', motivo: 'error' } },
    ];
    const remotos = [{ id: 'a', estado: 'anulado' }, { id: 'b', estado: 'vigente' }];
    expect(mezclarCierres(locales, remotos)).toEqual([]);
  });

  it('AC-COM-16 un local rechazado (sin pendingSync) se corrige con el remoto si el servidor si lo tiene', () => {
    const out = mezclarCierres([{ id: 'c', estado: 'rechazado', pendingSync: false }], [{ id: 'c', estado: 'vigente', lineas: [] }]);
    expect(out).toHaveLength(1);
    expect(out[0].estado).toBe('vigente');
  });

  it('AC-COM-10 los renglones enviados a la RPC salen de las lineas congeladas (mismo set de pedidos)', () => {
    const r = cierreToRemote({ id: 'x', desde: '2026-09-01', hasta: '2026-09-30', cerradoAt: 0, cerradoPor: 'Jorge', totales: {}, detalle: [], lineas: [{ tipo: 'pedido', pedidoId: 7, total: 10, comision: 1 }, { tipo: 'ajuste', pedidoId: 7, ajusteSeq: 1, total: 2, comision: 0.2 }] });
    expect(r.p_renglones.map(x => [x.pedido_id, x.tipo, x.ajuste_seq])).toEqual([['7', 'pedido', 0], ['7', 'ajuste', 1]]);
  });

  it('AC-COM-2 AC-SEC-4 puedeVerComisiones es estricto con el tipo', () => {
    expect(puedeVerComisiones(1)).toBe(true);
    for (const p of ['1', 1.0001, true, [1], null, undefined, 2, 3]) expect(puedeVerComisiones(p)).toBe(false);
  });
});
