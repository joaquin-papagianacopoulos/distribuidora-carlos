// REQ-COM + REQ-SEC: entradas hostiles al dominio de comisiones (AC-COM-15,
// AC-SEC-2 validación en dominio, AC-SEC-4 permisos forjados).
import {
  puedeVerComisiones, puedeMarcarEntregado, calcularComision, repartirComision, validarAsignacion,
  validarAnulacion, marcarEntregado, setAsignacionBorrador, armarDashboard, MAX_MOTIVO,
} from '../comisiones';
import { setUsuarioSesion, getUsuarioSesion } from '../../services/sesion';

const VENDEDORES = [{ nombre: 'Carlos', permiso: 2 }, { nombre: 'Lucía', permiso: 2 }];
const CLIENTE = { id: 1, nombre: 'K', vendedor: 'Carlos', comision: 5 };
const PEDIDO = { id: 1, remoteId: 'R1', clienteId: 1, vendedor: 'Lucía', estado: 'facturado', entregado: true, fecha: '2026-10-10', total: 1000 };

describe('AC-SEC-4 AC-COM-2 permisos forjados', () => {
  it.each([['1'], [' 1'], [true], [1.0000001], [{}], [[1]], [undefined]])('AC-COM-2 AC-SEC-4 puedeVerComisiones(%p) es false', (p) => {
    expect(puedeVerComisiones(p)).toBe(false);
  });

  it('AC-COM-2 AC-SEC-4 la sesión normaliza el permiso a número: un "1" forjado en texto no da admin si no pasó por la base', () => {
    setUsuarioSesion({ id: 9, nombre: 'X', permiso: '2' });
    expect(puedeVerComisiones(getUsuarioSesion().permiso)).toBe(false);
    setUsuarioSesion(null);
  });

  it('AC-COM-1 AC-SEC-4 un vendedor (2) o un permiso string no puede marcar entregado', () => {
    expect(puedeMarcarEntregado(PEDIDO, 2).ok).toBe(false);
    expect(puedeMarcarEntregado(PEDIDO, '1').ok).toBe(false);
  });
});

describe('AC-COM-15 AC-SEC-2 montos y porcentajes hostiles', () => {
  it.each([
    ['1e400', 5], [{}, 5], [[1000], 5], ['  ', 5], ['=1+1', 5], [true, 5],
  ])('AC-COM-15 total %p no rompe y da comisión 0', (total, pct) => {
    const r = calcularComision(total, pct);
    expect(r.comision).toBe(0);
    expect(Number.isFinite(r.comision)).toBe(true);
  });

  it.each([['5%'], ['NaN'], [Infinity], [-0.01], [100.01], [{}], ['1e2x']])('AC-COM-15 pct %p => sin_pct', (pct) => {
    expect(calcularComision(1000, pct)).toEqual({ comision: 0, aviso: 'sin_pct' });
  });

  it('AC-COM-15 el reparto nunca genera NaN ni pierde centavos', () => {
    for (const c of [0.01, 0.03, 1, 99.99, 1234.57]) {
      for (const [a, b] of [[50, 50], [33.33, 66.67], [0, 100], [100, 0], [12.5, 87.5]]) {
        const partes = repartirComision(c, { modo: 'dividir', partes: [{ vendedor: 'A', pct: a }, { vendedor: 'B', pct: b }] });
        const suma = Math.round(partes.reduce((s, p) => s + p.monto * 100, 0));
        expect(suma).toBe(Math.round(c * 100));
        partes.forEach(p => expect(Number.isFinite(p.monto)).toBe(true));
      }
    }
  });

  it.each([
    [{ pctFicha: '50.001', pctCargador: '49.999' }],
    [{ pctFicha: '1e2', pctCargador: '0' }],
    [{ pctFicha: 'abc', pctCargador: '100' }],
    [{ pctFicha: '100', pctCargador: '0,01' }],
  ])('AC-COM-15 AC-COM-7 división hostil %o se rechaza', (pcts) => {
    expect(validarAsignacion({ modo: 'dividir', ...pcts }, { pedido: PEDIDO, cliente: CLIENTE, vendedores: VENDEDORES }).ok).toBe(false);
  });
});

describe('AC-SEC-2 textos saneados', () => {
  it('AC-COM-12 AC-SEC-2 el motivo de anulación se limpia de caracteres de control y se acota', () => {
    const r = validarAnulacion({ estado: 'vigente' }, 'mal\u0000 cargado\u0007\n\n', 'Jorge\u001b', 1);
    expect(r.patch.motivoAnulacion).toBe('mal cargado');
    expect(r.patch.anuladoPor).toBe('Jorge');
    expect(validarAnulacion({ estado: 'vigente' }, 'x'.repeat(MAX_MOTIVO), 'J').ok).toBe(true);
    expect(validarAnulacion({ estado: 'vigente' }, 'x'.repeat(MAX_MOTIVO + 1), 'J').ok).toBe(false);
    expect(validarAnulacion({ estado: 'vigente' }, '\u0000\u0001\u0002', 'J').ok).toBe(false);
  });

  it('AC-COM-1 AC-SEC-2 el usuario que marca entregado se acota a 80 caracteres', () => {
    expect(marcarEntregado(PEDIDO, true, 'A'.repeat(500), 1).entregadoPor).toHaveLength(80);
  });

  it('AC-COM-9 AC-SEC-2 el borrador no guarda modos ni claves inesperadas', () => {
    const b = setAsignacionBorrador(null, { desde: '2026-10-01', hasta: '2026-10-31' }, 'R1', { modo: '__proto__', vendedor: 'x'.repeat(500), pctFicha: '9'.repeat(50), constructor: 'x' }, 1);
    expect(b.asignaciones.R1).toEqual({ modo: null, vendedor: 'x'.repeat(80), pctFicha: '9'.repeat(10) });
  });

  it('AC-COM-15 un dashboard con datos basura no tira', () => {
    expect(() => armarDashboard({ pedidos: [null, {}, { estado: 'facturado' }, PEDIDO], clientes: [null, CLIENTE], vendedores: [null, ...VENDEDORES], cierres: [null, { estado: 'vigente' }], borrador: { asignaciones: { R1: { modo: 'dividir', pctFicha: 'x' } } }, periodo: { desde: '2026-10-01', hasta: '2026-10-31' } })).not.toThrow();
  });
});
