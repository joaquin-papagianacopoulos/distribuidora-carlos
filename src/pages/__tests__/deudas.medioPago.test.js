// REQ-DMP (AC-DMP-1): cobro de deudas con medio de pago obligatorio, historial y totales por medio.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }) } }));
jest.mock('../../services/deudaRepository', () => ({
  cobrarDeuda: jest.fn(() => Promise.resolve()),
  cobrarTodoDelCliente: jest.fn(() => Promise.resolve()),
  deshacerCobros: jest.fn(() => Promise.resolve()),
  crearDeudaManual: jest.fn(() => Promise.resolve()),
  borrarDeuda: jest.fn(() => Promise.resolve()),
}));

// eslint-disable-next-line import/first
import Deudas from '../Deudas';
// eslint-disable-next-line import/first
import { cobrarDeuda, cobrarTodoDelCliente } from '../../services/deudaRepository';

const D = (id, extra = {}) => ({ id, clienteId: 1, clienteNombre: 'Ana', monto: 1000, montoPagado: 0, pagada: false, fecha: '2026-11-01', concepto: `Deuda ${id}`, ...extra });

let container;
let root;
const setApp = (deudas) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, { deudas, clientes: [], vendedorActual: { id: 1, nombre: 'Admin', permiso: 1 }, recargar: jest.fn(() => Promise.resolve()) });
};
const render = async () => { await act(async () => { root.render(<Deudas />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const boton = (t) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(t));
const botonModal = (t) => [...container.querySelectorAll('[data-testid="modal-cobro"] button')].find(b => b.textContent.includes(t));
const escribir = async (el, valor) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  await act(async () => { set.call(el, valor); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const abrirCliente = async () => { await click([...container.querySelectorAll('.card')].find(c => /boleta/.test(c.textContent))); };

beforeEach(() => {
  jest.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  jest.spyOn(window, 'alert').mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  jest.restoreAllMocks();
});

describe('AC-DMP-1 el medio de pago es obligatorio al cobrar', () => {
  it('AC-DMP-1 cobrar total abre el modal y no cobra hasta elegir medio', async () => {
    setApp([D('a')]);
    await render();
    await abrirCliente();
    await click(boton('Cobrar total'));
    expect(container.querySelector('[data-testid="modal-cobro"]')).not.toBeNull();
    expect(cobrarDeuda).not.toHaveBeenCalled();
    // sin medio elegido, "Confirmar cobro" esta deshabilitado y ninguno de los dos botones esta marcado
    expect(botonModal('Confirmar cobro').disabled).toBe(true);
    expect(botonModal('Efectivo').getAttribute('aria-pressed')).toBe('false');
    expect(botonModal('Transferencia').getAttribute('aria-pressed')).toBe('false');
    await click(botonModal('Confirmar cobro'));
    expect(cobrarDeuda).not.toHaveBeenCalled();
  });

  it('AC-DMP-1 con Transferencia y referencia cobra el total con ese medio', async () => {
    setApp([D('a')]);
    await render();
    await abrirCliente();
    await click(boton('Cobrar total'));
    await click(botonModal('Transferencia'));
    await escribir(container.querySelector('#cobro-referencia'), '  Op 123  ');
    await click(botonModal('Confirmar cobro'));
    expect(cobrarDeuda).toHaveBeenCalledTimes(1);
    const [deuda, monto, por, opciones] = cobrarDeuda.mock.calls[0];
    expect(deuda.id).toBe('a');
    expect(monto).toBeNull();
    expect(por).toBe('Admin');
    expect(opciones).toEqual({ medio: 'transferencia', referencia: 'Op 123' });
    expect(mockApp.recargar).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="modal-cobro"]')).toBeNull();
  });

  it('AC-DMP-1 la referencia es opcional (Efectivo sin referencia)', async () => {
    setApp([D('a')]);
    await render();
    await abrirCliente();
    await click(boton('Cobrar total'));
    await click(botonModal('Efectivo'));
    await click(botonModal('Confirmar cobro'));
    expect(cobrarDeuda.mock.calls[0][3]).toEqual({ medio: 'efectivo', referencia: '' });
  });

  it('AC-DMP-1 cobro parcial: pasa el monto y el medio', async () => {
    setApp([D('a')]);
    await render();
    await abrirCliente();
    await click(boton('Cobro parcial'));
    await escribir(container.querySelector('input[type="number"]'), '300');
    await click([...container.querySelectorAll('button')].find(b => b.textContent.trim() === 'Cobrar'));
    expect(cobrarDeuda).not.toHaveBeenCalled();
    await click(botonModal('Efectivo'));
    await click(botonModal('Confirmar cobro'));
    expect(cobrarDeuda).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), 300, 'Admin', { medio: 'efectivo', referencia: '' });
  });

  it('AC-DMP-1 "Todo" del cliente tambien exige medio y lo aplica a todas sus deudas', async () => {
    setApp([D('a'), D('b')]);
    await render();
    await click(boton('Todo'));
    expect(cobrarTodoDelCliente).not.toHaveBeenCalled();
    expect(botonModal('Confirmar cobro').disabled).toBe(true);
    await click(botonModal('Transferencia'));
    await click(botonModal('Confirmar cobro'));
    expect(cobrarTodoDelCliente).toHaveBeenCalledTimes(1);
    const [lista, por, opciones] = cobrarTodoDelCliente.mock.calls[0];
    expect(lista.map(d => d.id).sort()).toEqual(['a', 'b']);
    expect(por).toBe('Admin');
    expect(opciones).toEqual({ medio: 'transferencia', referencia: '' });
  });

  it('AC-DMP-1 cancelar el modal no cobra nada', async () => {
    setApp([D('a')]);
    await render();
    await abrirCliente();
    await click(boton('Cobrar total'));
    await click(botonModal('Cancelar'));
    expect(container.querySelector('[data-testid="modal-cobro"]')).toBeNull();
    expect(cobrarDeuda).not.toHaveBeenCalled();
  });
});

describe('AC-DMP-1 historial con medio y totales por medio', () => {
  const cobro = (id, medio, montoCents, referencia = '') => ({ id, medio, montoCents, referencia, at: Date.UTC(2026, 10, 5, 15), por: 'Admin' });
  const DEUDAS = [
    D('a', { montoPagado: 400, cobros: [cobro('c1', 'efectivo', 15000), cobro('c2', 'transferencia', 25000, 'Op 9')] }),
    D('b', { montoPagado: 200 }), // pago viejo, sin historial
    D('c', { montoPagado: 100, cobros: [cobro('c3', 'rendicion', 10000)] }),
  ];

  it('AC-DMP-1 el historial muestra el medio de cada cobro y "Sin dato" para los pagos viejos', async () => {
    setApp(DEUDAS);
    await render();
    await abrirCliente();
    const a = container.querySelector('[data-testid="historial-a"]').textContent;
    expect(a).toMatch(/Efectivo/);
    expect(a).toMatch(/Transferencia/);
    expect(a).toMatch(/Ref: Op 9/);
    expect(container.querySelector('[data-testid="historial-b"]').textContent).toMatch(/Sin dato/);
    expect(container.querySelector('[data-testid="historial-c"]').textContent).toMatch(/Rendición/);
  });

  it('AC-DMP-1 los totales por medio suman cada cobro y separan "Sin dato"', async () => {
    setApp(DEUDAS);
    await render();
    const t = container.querySelector('[data-testid="totales-por-medio"]').textContent;
    expect(t).toMatch(/Efectivo: \$150/);
    expect(t).toMatch(/Transferencia: \$250/);
    expect(t).toMatch(/Rendición: \$100/);
    expect(t).toMatch(/Sin dato: \$200/);
  });

  it('AC-DMP-1 sin cobros no se muestra el panel de totales', async () => {
    setApp([D('a')]);
    await render();
    expect(container.querySelector('[data-testid="totales-por-medio"]')).toBeNull();
  });
});
