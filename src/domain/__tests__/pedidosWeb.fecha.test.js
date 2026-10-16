// REQ-WEB AC-WEB-8: cambiar la fecha del pedido web al aceptarlo (dominio + migración 018).
import fs from 'fs';
import path from 'path';
import { validarFechaWeb, validarAccionWeb, accionWebToRpc } from '../pedidosWeb';

const NOW = new Date(2026, 9, 16, 10, 0, 0); // 16/10/2026

describe('AC-WEB-8 fecha del pedido web', () => {
  it('AC-WEB-8 vacía = no se cambia; válida dentro de -60/+90 días; fuera de rango o inválida, error', () => {
    expect(validarFechaWeb(null, NOW)).toEqual({ ok: true, fecha: null });
    expect(validarFechaWeb('', NOW)).toEqual({ ok: true, fecha: null });
    expect(validarFechaWeb('2026-10-20', NOW)).toEqual({ ok: true, fecha: '2026-10-20' });
    expect(validarFechaWeb('2026-08-17', NOW).ok).toBe(true); // justo 60 días antes
    expect(validarFechaWeb('2026-08-16', NOW).error).toMatch(/60 días/);
    expect(validarFechaWeb('2027-01-14', NOW).ok).toBe(true); // justo 90 días después
    expect(validarFechaWeb('2027-01-15', NOW).error).toMatch(/90 días/);
    expect(validarFechaWeb('2026-02-30', NOW).error).toBe('Fecha inválida');
    expect(validarFechaWeb('16/10/2026', NOW).error).toBe('Fecha inválida');
  });

  it('AC-WEB-8 validarAccionWeb rechaza aceptar con fecha fuera de rango y la RPC recibe la fecha', () => {
    const datos = { clienteId: 3, vendedor: 'Ana' };
    expect(validarAccionWeb('aceptar', { ...datos, fecha: '2026-10-18' }, { now: NOW }).ok).toBe(true);
    expect(validarAccionWeb('aceptar', { ...datos, fecha: '2020-01-01' }, { now: NOW }).errores.fecha).toBeTruthy();
    expect(accionWebToRpc({ id: 'a', tipo: 'aceptar', pedidoRemoteId: 5, fecha: '2026-10-18' }, { adminId: '1', pin: '1234' }).p_datos.fecha).toBe('2026-10-18');
    expect(accionWebToRpc({ id: 'a', tipo: 'aceptar', pedidoRemoteId: 5 }, { adminId: '1', pin: '1234' }).p_datos.fecha).toBeNull();
    expect(accionWebToRpc({ id: 'a', tipo: 'rechazar', pedidoRemoteId: 5, motivo: 'xxx' }, {}).p_datos.fecha).toBeUndefined();
  });
});

describe('AC-WEB-8 migración 018', () => {
  const MIG = path.join(__dirname, '..', '..', '..', 'supabase', 'migrations');
  const sql = fs.readFileSync(path.join(MIG, '018_pedidos_web_fecha.sql'), 'utf8').replace(/\r\n/g, '\n');
  const codigo = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

  it('AC-WEB-8 misma firma, PIN antes de todo, rango de fecha validado en el servidor y grants de la 008', () => {
    expect(codigo).toMatch(/create or replace function public\.admin_resolver_pedido_web\(\s*p_admin_id text, p_admin_pin text, p_pedido_id text, p_accion_id uuid, p_tipo text, p_datos jsonb\)/);
    expect(codigo).toMatch(/security definer set search_path = public, extensions, pg_temp/);
    const auth = codigo.indexOf('tienda_admin_ok(p_admin_id, p_admin_pin)');
    expect(auth).toBeGreaterThan(0);
    expect(codigo.indexOf('update public.pedidos')).toBeGreaterThan(auth);
    expect(codigo).toMatch(/v_fecha < v_hoy - 60 or v_fecha > v_hoy \+ 90/);
    expect(codigo).toMatch(/America\/Argentina\/Buenos_Aires/);
    expect(codigo).toMatch(/if v_fecha is not null then\s+update public\.pedidos set fecha = v_fecha where id::text = p_pedido_id;/);
    expect(codigo).toMatch(/grant execute on function public\.admin_resolver_pedido_web\(text, text, text, uuid, text, jsonb\) to anon, authenticated/);
    expect(codigo).not.toMatch(/drop table|drop column|truncate|delete from/i);
  });
});
