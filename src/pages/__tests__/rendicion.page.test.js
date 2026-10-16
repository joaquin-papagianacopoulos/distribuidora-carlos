// REQ-REN (AC-REN-1/4): pantalla Rendición (solo admin) con servicios mockeados.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
const mockLoc = { rendiciones: [], cuenta: [] };
const mockLlamadas = { registrar: [], subir: [], bajar: [], anular: [], pdf: [] };
const mockResp = { registrar: null };
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../services/rendicionService', () => ({
  cargarRendicionesLocales: async () => mockLoc,
  contarPendientesRendicion: async () => ({ total: 1 }),
  registrarRendicion: async (f, ctx) => { mockLlamadas.registrar.push([f, ctx]); return mockResp.registrar || { ok: true }; },
  subirRendiciones: async (c) => { mockLlamadas.subir.push(c); return { ok: true, subidos: 1, rechazados: [{ id: 'abcdefgh-1', mensaje: 'otro dispositivo' }] }; },
  bajarRendiciones: async (c) => { mockLlamadas.bajar.push(c); return { ok: true, bajados: { rendiciones: 0 } }; },
  anularRendicion: async (c, id, motivo) => { mockLlamadas.anular.push([c, id, motivo]); return { ok: true, mensaje: 'Rendición anulada.' }; },
}));
jest.mock('../../services/productosAdminService', () => ({
  credencialesAdminProductos: async (pin) => (pin ? { ok: true, cred: { p_admin_id: 'u', p_admin_pin: pin } } : { ok: false, mensaje: 'Ingresá tu PIN' }),
}));
jest.mock('../../utils/pdfGen', () => ({ generarRendicionDiaFile: async (r, o) => { mockLlamadas.pdf.push([r, o]); return new File(['x'], 'rendicion.pdf'); } }));

// eslint-disable-next-line import/first
import Rendicion from '../Rendicion';
// eslint-disable-next-line import/first
import { hoyISO } from '../../domain/validacion';

const PED = { id: 7, remoteId: 70, clienteId: 5, clienteNombre: 'Kiosco Pepe', estado: 'facturado', fecha: hoyISO(), total: 1000, items: [{ productoId: 1, nombre: 'Alfajor', cantidad: 10, precio: 100 }] };
let container;
let root;
const render = async () => { await act(async () => { root.render(<Rendicion />); }); await act(async () => {}); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const boton = (t) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(t));
const tipear = async (el, v) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
  await act(async () => { setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const setApp = (over = {}) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    vendedorActual: { id: 1, nombre: 'Admin', permiso: 1 },
    pedidos: [PED, { ...PED, id: 8, estado: 'pendiente', clienteNombre: 'Otro' }],
    productos: [{ id: 1, nombre: 'Alfajor', precio: 100 }, { id: 3, nombre: 'Coca', precio: 300 }],
    recargar: async () => {},
    ...over,
  });
};

beforeEach(() => {
  mockLoc.rendiciones = [];
  Object.keys(mockLlamadas).forEach(k => { mockLlamadas[k] = []; });
  mockResp.registrar = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  global.URL.createObjectURL = jest.fn(() => 'blob:x');
  global.URL.revokeObjectURL = jest.fn();
});
afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); });

describe('AC-REN-1 pantalla Rendición', () => {
  it('AC-REN-1 solo admin', async () => {
    setApp({ vendedorActual: { id: 2, nombre: 'Vend', permiso: 2 } });
    await render();
    expect(container.textContent).toMatch(/solo para administradores/);
    expect(container.querySelector('[data-testid="pedido-7"]')).toBeNull();
  });

  it('AC-REN-1 busca pedidos facturados y registra una devolución con merma', async () => {
    setApp();
    await render();
    expect(container.querySelector('[data-testid="pedido-8"]')).toBeNull();
    await tipear(container.querySelector('[aria-label="Buscar pedido"]'), 'kiosco');
    await click(container.querySelector('[data-testid="pedido-7"]'));
    expect(container.textContent).toMatch(/hasta 10/);
    await tipear(container.querySelector('[aria-label="Cantidad Alfajor"]'), '2');
    await click(container.querySelector('input[type="checkbox"]'));
    await tipear(container.querySelector('#ren-motivo'), 'Vencido');
    await click(boton('Registrar rendición'));
    const [f, ctx] = mockLlamadas.registrar[0];
    expect(f).toMatchObject({ tipo: 'devolucion', motivo: 'Vencido', renglones: [{ productoId: '1', cantidad: '2', vuelveAlStock: false }] });
    expect(ctx.pedido.id).toBe(7);
    expect(container.textContent).toMatch(/Rendición registrada/);
  });

  it('AC-REN-1 cambio: muestra la diferencia; NC: monto y factura; errores visibles', async () => {
    setApp();
    await render();
    await click(container.querySelector('[data-testid="pedido-7"]'));
    await click(boton('Cambio'));
    await tipear(container.querySelector('[aria-label="Cantidad Alfajor"]'), '1');
    await tipear(container.querySelector('[aria-label="Buscar producto que sale"]'), 'coc');
    await click(boton('Coca'));
    expect(container.querySelector('[data-testid="diferencia-cambio"]').textContent).toMatch(/El cliente paga: \$200/);
    await click(boton('Nota de crédito'));
    await tipear(container.querySelector('#ren-monto'), '150');
    mockResp.registrar = { ok: false, errores: { motivo: 'Escribí el motivo' } };
    await click(boton('Registrar rendición'));
    expect(mockLlamadas.registrar[0][0]).toMatchObject({ tipo: 'nc', montoNc: '150', renglones: [], sale: [] });
    expect(container.textContent).toMatch(/Escribí el motivo/);
  });

  it('AC-REN-1 subir pide PIN de admin', async () => {
    setApp();
    await render();
    await click(boton('Subir y bajar'));
    expect(mockLlamadas.subir).toEqual([]);
    expect(container.textContent).toMatch(/PIN/);
    await tipear(container.querySelector('[aria-label="PIN de administrador"]'), '1234');
    await click(boton('Subir y bajar'));
    expect(mockLlamadas.subir[0]).toEqual({ p_admin_id: 'u', p_admin_pin: '1234' });
    expect(mockLlamadas.bajar).toHaveLength(1);
    expect(container.textContent).toMatch(/Rechazadas/);
  });
});

describe('AC-REN-4 rendición del día', () => {
  it('AC-REN-4 lista, totales, PDF y anular con motivo y PIN', async () => {
    mockLoc.rendiciones = [
      { id: 'aaaaaaaa-1', fecha: hoyISO(), tipo: 'nc', estado: 'vigente', syncEstado: 'confirmada', creditoCents: 15000, clienteNombre: 'Kiosco Pepe', motivo: 'Bonif' },
      { id: 'bbbbbbbb-2', fecha: hoyISO(), tipo: 'devolucion', estado: 'anulada', syncEstado: 'confirmada', creditoCents: 500, motivoAnulacion: 'error', renglones: [] },
    ];
    setApp();
    await render();
    expect(container.querySelector('[data-testid="totales-rendicion"]').textContent).toMatch(/NC \$150,00/);
    expect(container.querySelector('[data-testid="fila-bbbbbbbb-2"]').textContent).toMatch(/ANULADA: error/);
    await click(boton('Descargar PDF'));
    expect(mockLlamadas.pdf[0][1]).toEqual({ fecha: hoyISO() });
    const prompt = jest.spyOn(window, 'prompt').mockReturnValue('Cargada por error');
    await tipear(container.querySelector('[aria-label="PIN de administrador"]'), '1234');
    await click(boton('Anular'));
    expect(mockLlamadas.anular[0]).toEqual([{ p_admin_id: 'u', p_admin_pin: '1234' }, 'aaaaaaaa-1', 'Cargada por error']);
    expect(container.textContent).toMatch(/Rendición anulada/);
    prompt.mockReturnValue(null);
    await click(boton('Anular'));
    expect(mockLlamadas.anular).toHaveLength(1);
    prompt.mockRestore();
  });
});

describe('AC-REN-1 búsqueda de pedidos por fecha (por defecto, hoy)', () => {
  const VIEJO = { ...PED, id: 9, remoteId: 90, clienteNombre: 'Almacén Viejo', fecha: '2026-01-02' };

  it('AC-REN-1 arranca en hoy y muestra solo los facturados de ese día', async () => {
    setApp({ pedidos: [PED, VIEJO] });
    await render();
    expect(container.querySelector('[aria-label="Fecha del pedido"]').value).toBe(hoyISO());
    expect(container.querySelector('[data-testid="pedido-7"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pedido-9"]')).toBeNull();
  });

  it('AC-REN-1 al cambiar la fecha aparecen los pedidos de ese día; sin fecha pide elegir una', async () => {
    setApp({ pedidos: [PED, VIEJO] });
    await render();
    await tipear(container.querySelector('[aria-label="Fecha del pedido"]'), '2026-01-02');
    expect(container.querySelector('[data-testid="pedido-9"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pedido-7"]')).toBeNull();
    await tipear(container.querySelector('[aria-label="Fecha del pedido"]'), '');
    expect(container.querySelector('[data-testid="pedido-7"]')).toBeNull();
    expect(container.querySelector('[data-testid="sin-pedidos-fecha"]').textContent).toMatch(/Elegí la fecha/);
  });
});
