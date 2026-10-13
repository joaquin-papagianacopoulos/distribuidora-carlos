// QA RUN 20261012-2106 — AC-COM-12: bordes de la UX de anulacion en la pantalla.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }) } }));
jest.mock('../../services/comisionesService', () => ({
  cargarDatosComisiones: jest.fn(), guardarBorrador: jest.fn(), confirmarCierre: jest.fn(), anularCierre: jest.fn(), syncComisiones: jest.fn(),
}));
jest.mock('../../utils/pdfGen', () => ({ generarCierreComisionesFile: jest.fn() }));

// eslint-disable-next-line import/first
import Comisiones from '../Comisiones';
// eslint-disable-next-line import/first
import { cargarDatosComisiones, anularCierre } from '../../services/comisionesService';
// eslint-disable-next-line import/first
import { periodoPorDefecto, claveBorrador } from '../../domain/comisiones';

const PERIODO = periodoPorDefecto();
const CIERRES = [
  { id: 'c-vig', estado: 'vigente', desde: '2020-01-01', hasta: '2020-01-31', cerradoAt: Date.UTC(2020, 1, 1), cerradoPor: 'Jorge', totales: { pedidos: 0, totalVendido: 0, totalComision: 0, porVendedor: [] }, lineas: [] },
  { id: 'c-vig2', estado: 'vigente', desde: '2020-02-01', hasta: '2020-02-29', cerradoAt: Date.UTC(2020, 2, 1), cerradoPor: 'Jorge', totales: { pedidos: 0, totalVendido: 0, totalComision: 0, porVendedor: [] }, lineas: [] },
];
const datos = () => ({ pedidos: [], clientes: [], vendedores: [{ id: 1, nombre: 'Jorge', permiso: 1 }], cierres: CIERRES, borrador: { id: claveBorrador(PERIODO), asignaciones: {} }, incompleto: false, faltaMigracion: false, avisos: [] });
const ADMIN = { id: 1, nombre: 'Jorge', permiso: 1 };

let container;
let root;
const render = async () => { await act(async () => { root.render(<Comisiones />); }); await act(async () => { await Promise.resolve(); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const boton = (t, scope = container) => [...scope.querySelectorAll('button')].find(b => b.textContent.includes(t));
const cambiar = async (el, valor) => {
  await act(async () => {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, valor);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const esperar = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };

const abrir = async (id = 'c-vig') => {
  await render();
  await click(q(`cierre-${id}`).querySelector('button.btn-danger'));
};
const llenar = async (id = 'c-vig', motivo = 'Error de carga', pin = '4321') => {
  await cambiar(q(`cierre-${id}`).querySelector('textarea'), motivo);
  await cambiar(q(`cierre-${id}`).querySelector('input[aria-label="PIN de admin"]'), pin);
};

let unhandled;
const onUnhandled = (e) => { unhandled.push(e?.reason || e); };
beforeEach(() => {
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, { vendedorActual: ADMIN, online: true });
  cargarDatosComisiones.mockImplementation(async () => datos());
  anularCierre.mockImplementation(async () => ({ ok: true }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  process.removeListener('unhandledRejection', onUnhandled);
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('AC-COM-12 bordes de la UX de anulacion', () => {
  it('AC-COM-12 el formulario de un cierre no pisa al otro: abrir el segundo cierra el estado del primero y arranca limpio', async () => {
    await abrir('c-vig');
    await llenar('c-vig', 'Motivo uno', '1111');
    await click(q('cierre-c-vig2').querySelector('button.btn-danger'));
    expect(q('cierre-c-vig').querySelector('textarea')).toBeNull();
    const ta = q('cierre-c-vig2').querySelector('textarea');
    expect(ta.value).toBe('');
    expect(q('cierre-c-vig2').querySelector('input[aria-label="PIN de admin"]').value).toBe('');
    expect(q('ayuda-anular-c-vig2').textContent).toBe('Escribí el motivo (mínimo 3 letras)');
    expect(q('ayuda-anular-c-vig')).toBeNull();
  });

  it('AC-COM-12 el error inline de un intento fallido no aparece en el formulario del otro cierre ni sobrevive a reabrirlo', async () => {
    anularCierre.mockImplementation(async () => ({ ok: false, mensaje: 'PIN de admin incorrecto.' }));
    await abrir('c-vig');
    await llenar();
    await click(boton('Confirmar anulación'));
    expect(q('error-anular-c-vig').textContent).toBe('PIN de admin incorrecto.');
    expect(q('error-anular-c-vig2')).toBeNull();
    await click(boton('Volver'));
    await click(q('cierre-c-vig').querySelector('button.btn-danger'));
    expect(q('error-anular-c-vig')).toBeNull();
  });

  it('AC-COM-12 el PIN se manda UNA vez y el motivo se manda tal cual lo tipeo el usuario (el servicio lo normaliza)', async () => {
    await abrir();
    await llenar('c-vig', '  Mal   cargado  ', '4321');
    await click(boton('Confirmar anulación'));
    expect(anularCierre).toHaveBeenCalledTimes(1);
    expect(anularCierre.mock.calls[0][2]).toBe('4321');
    expect(anularCierre.mock.calls[0][1]).toBe('  Mal   cargado  ');
  });

  it('AC-COM-12 tras una anulacion exitosa el formulario se cierra y no queda el PIN en el DOM', async () => {
    await abrir();
    await llenar('c-vig', 'Mal cargado', '987654');
    await click(boton('Confirmar anulación'));
    expect(q('cierre-c-vig').querySelector('textarea')).toBeNull();
    expect(container.innerHTML).not.toContain('987654');
  });

  it('AC-COM-12 mientras se anula (procesando) el boton esta deshabilitado: un doble click no llama dos veces al servicio', async () => {
    let liberar;
    anularCierre.mockImplementation(() => new Promise((res) => { liberar = () => res({ ok: true }); }));
    await abrir();
    await llenar();
    const b = boton('Confirmar anulación');
    // Dos clicks de usuario = dos tareas distintas (React vuelve a renderizar entre ambos).
    await click(b);
    await click(b);
    expect(anularCierre).toHaveBeenCalledTimes(1);
    expect(boton('Confirmar anulación').disabled).toBe(true);
    await act(async () => { liberar(); });
    await esperar();
    expect(anularCierre).toHaveBeenCalledTimes(1);
  });

  // BUG: BUG-COM-01 (ver qa-report.md). Si anularCierre LANZA (en vez de devolver
  // { ok:false }) por ejemplo un error de IndexedDB, Comisiones.anular usa
  // try/finally sin catch: la promesa del onClick se rechaza sin manejar, el
  // formulario queda abierto con el PIN ya borrado y SIN ningun mensaje.
  it('AC-COM-12 BUG si el servicio lanza una excepcion, el formulario muestra el error inline (no se pierde en silencio)', async () => {
    anularCierre.mockImplementation(async () => { throw new Error('QuotaExceededError'); });
    await abrir();
    await llenar();
    await click(boton('Confirmar anulación'));
    await esperar();
    expect(unhandled).toEqual([]);
    expect(q('error-anular-c-vig')).not.toBeNull();
  });
});
