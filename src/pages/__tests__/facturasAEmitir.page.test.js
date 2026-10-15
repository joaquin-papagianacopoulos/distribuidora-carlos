// REQ-FAB (AC-FAB-3): pantalla "Facturas a emitir" (solo admin, con PIN, sin loguear datos).
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../services/facturacionService', () => ({ consultarFacturasAEmitir: jest.fn(), aplicarTiposRemotos: jest.fn() }));
jest.mock('../../services/productosAdminService', () => ({ credencialesAdminProductos: jest.fn() }));
jest.mock('../../utils/pdfGen', () => ({ generarFacturasAEmitirFile: jest.fn() }));

// eslint-disable-next-line import/first
import FacturasAEmitir from '../FacturasAEmitir';
// eslint-disable-next-line import/first
import { consultarFacturasAEmitir, aplicarTiposRemotos } from '../../services/facturacionService';
// eslint-disable-next-line import/first
import { credencialesAdminProductos } from '../../services/productosAdminService';
// eslint-disable-next-line import/first
import { generarFacturasAEmitirFile } from '../../utils/pdfGen';

let container;
let root;
const FILAS = [
  { pedidoId: '1', fecha: '2026-10-01', clienteNombre: 'Kiosco Uno', cuit: '20123456786', tipoIva: 'Responsable Inscripto', tipoFactura: 'A', total: 150 },
  { pedidoId: '2', fecha: '2026-10-02', clienteNombre: 'Pepe Dos', cuit: '', tipoIva: 'Monotributo', tipoFactura: 'B', total: 300 },
  { pedidoId: '3', fecha: '2026-10-03', clienteNombre: 'Sin Factura', cuit: '', tipoIva: '', tipoFactura: 'ninguna', total: 999 },
];
const setApp = (permiso = 1, over = {}) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, { vendedorActual: { id: 1, nombre: 'X', permiso }, pedidos: [], recargar: jest.fn(() => Promise.resolve()), ...over });
};
const render = async () => { await act(async () => { root.render(<FacturasAEmitir />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const boton = (t) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(t));
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const escribir = async (el, valor) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  await act(async () => { set.call(el, valor); el.dispatchEvent(new Event('input', { bubbles: true })); });
};

let consola;
beforeEach(() => {
  jest.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  consola = ['log', 'warn', 'error', 'info'].map(k => jest.spyOn(console, k).mockImplementation(() => {}));
  credencialesAdminProductos.mockResolvedValue({ ok: true, cred: { p_admin_id: '1', p_admin_pin: '1234' } });
  consultarFacturasAEmitir.mockResolvedValue({ ok: true, filas: FILAS });
  aplicarTiposRemotos.mockResolvedValue({ ok: true, count: 0 });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  jest.restoreAllMocks();
});

describe('AC-FAB-3 acceso solo admin', () => {
  it.each([[2], [3]])('AC-FAB-3 permiso %p ve el bloqueo y nada del reporte', async (permiso) => {
    setApp(permiso);
    await render();
    expect(container.textContent).toMatch(/solo para administradores/);
    expect(boton('Armar reporte')).toBeUndefined();
    expect(consultarFacturasAEmitir).not.toHaveBeenCalled();
  });
});

describe('AC-FAB-3 reporte', () => {
  const armar = async () => {
    await escribir(container.querySelector('[aria-label="PIN de administrador"]'), '1234');
    await click(boton('Armar reporte'));
  };

  it('AC-FAB-3 pide el PIN, consulta con el rango y muestra A y B con subtotales y total (sin los "ninguna")', async () => {
    setApp(1);
    await render();
    await escribir(container.querySelector('#fe-desde'), '2026-10-01');
    await escribir(container.querySelector('#fe-hasta'), '2026-10-31');
    await armar();
    expect(credencialesAdminProductos).toHaveBeenCalledWith('1234');
    expect(consultarFacturasAEmitir).toHaveBeenCalledWith({ p_admin_id: '1', p_admin_pin: '1234' }, '2026-10-01', '2026-10-31');
    expect(q('grupo-A').textContent).toMatch(/Kiosco Uno/);
    expect(q('grupo-A').textContent).toMatch(/20-12345678-6/);
    expect(q('grupo-B').textContent).toMatch(/Pepe Dos/);
    expect(container.textContent).not.toMatch(/Sin Factura/);
    expect(q('total-general').textContent).toMatch(/450/);
    expect(container.querySelector('[aria-label="PIN de administrador"]').value).toBe('');
  });

  it('AC-FAB-3 el filtro Solo B deja solo las B', async () => {
    setApp(1);
    await render();
    await armar();
    await click(boton('Solo B'));
    expect(q('grupo-A')).toBeNull();
    expect(q('grupo-B')).not.toBeNull();
  });

  it('AC-FAB-3 lo marcado local sin subir manda sobre el servidor', async () => {
    setApp(1, { pedidos: [{ id: 9, remoteId: 1, tipoFactura: 'B', tipoFacturaPendiente: true }] });
    await render();
    await armar();
    expect(q('grupo-A')).toBeNull();
    expect(q('grupo-B').textContent).toMatch(/Kiosco Uno/);
    expect(q('aviso-sin-subir')).not.toBeNull();
  });

  it('AC-FAB-3 descarga el PDF con el reporte armado', async () => {
    setApp(1);
    generarFacturasAEmitirFile.mockResolvedValue(new File(['%PDF'], 'facturas_a_emitir.pdf', { type: 'application/pdf' }));
    global.URL.createObjectURL = jest.fn(() => 'blob:x');
    global.URL.revokeObjectURL = jest.fn();
    await render();
    await armar();
    await click(boton('Descargar PDF'));
    expect(generarFacturasAEmitirFile).toHaveBeenCalledTimes(1);
    const [reporte, opts] = generarFacturasAEmitirFile.mock.calls[0];
    expect(reporte.total).toBe(450);
    expect(opts).toMatchObject({ filtro: 'todas' });
  });

  it('AC-FAB-3 PIN incorrecto: avisa y no muestra reporte', async () => {
    setApp(1);
    consultarFacturasAEmitir.mockResolvedValue({ ok: false, motivo: 'pin_incorrecto', mensaje: 'PIN incorrecto o sin permiso de administrador.', filas: [] });
    await render();
    await armar();
    expect(container.textContent).toMatch(/PIN incorrecto/);
    expect(q('grupo-A')).toBeNull();
  });

  it('AC-FAB-3 sin PIN valido no consulta', async () => {
    setApp(1);
    credencialesAdminProductos.mockResolvedValue({ ok: false, mensaje: 'Ingresá tu PIN' });
    await render();
    await click(boton('Armar reporte'));
    expect(consultarFacturasAEmitir).not.toHaveBeenCalled();
    expect(container.textContent).toMatch(/Ingresá tu PIN/);
  });

  it('AC-FAB-3 falta la migración: muestra el mensaje', async () => {
    setApp(1);
    consultarFacturasAEmitir.mockResolvedValue({ ok: false, motivo: 'falta_migracion', mensaje: 'Falta la migración 011 en Supabase', filas: [] });
    await render();
    await armar();
    expect(container.textContent).toMatch(/Falta la migración 011/);
  });

  it('AC-FAB-3 sin conexión no consulta', async () => {
    setApp(1);
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
    await render();
    await armar();
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
    expect(consultarFacturasAEmitir).not.toHaveBeenCalled();
    expect(container.textContent).toMatch(/conexión/);
  });

  it('AC-FAB-3 no escribe CUIT, PIN ni filas en la consola', async () => {
    setApp(1);
    await render();
    await armar();
    const todo = JSON.stringify(consola.flatMap(s => s.mock.calls));
    expect(todo).not.toMatch(/20123456786|20-12345678-6|1234|Kiosco Uno/);
  });
});
