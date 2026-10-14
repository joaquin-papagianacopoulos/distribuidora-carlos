// REQ-COMR (RUN 20261014-1449): grilla Rubro -> % del vendedor (AC-COMR-6, 8, 11).
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../services/comisionesRubroService', () => ({
  cargarTablaRubros: jest.fn(),
  guardarPctsVendedor: jest.fn(),
}));

// eslint-disable-next-line import/first
import ComisionRubroGrid from '../ComisionRubroGrid';
// eslint-disable-next-line import/first
import { cargarTablaRubros, guardarPctsVendedor } from '../../services/comisionesRubroService';

let container;
let root;
let tabla;
beforeEach(() => {
  tabla = [
    { id: 'f1', vendedorId: 'u-ana', rubro: 'Golosinas', rubroClave: 'golosinas', pct: 5.5 },
    { id: 'f2', vendedorId: 'u-ana', rubro: 'Bebidas', rubroClave: 'bebidas', pct: 10, pendingSync: true },
    { id: 'f3', vendedorId: 'u-ana', rubro: 'Kiosco', rubroClave: 'kiosco', pct: 1, syncRechazo: 'vendedor_inactivo' },
    { id: 'f4', vendedorId: 'u-beto', rubro: 'Golosinas', rubroClave: 'golosinas', pct: 3 },
  ];
  cargarTablaRubros.mockImplementation(async () => tabla.map(f => ({ ...f })));
  guardarPctsVendedor.mockImplementation(async () => ({ ok: true, guardados: 1, mensaje: 'Guardado y sincronizado.' }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  jest.clearAllMocks();
});

const ANA = { id: 2, remoteId: 'u-ana', nombre: 'Ana', permiso: 2 };
const RUBROS = ['Almacén', 'Bebidas', 'Golosinas'];
const render = async (props = {}) => {
  await act(async () => { root.render(<ComisionRubroGrid vendedor={ANA} rubros={RUBROS} {...props} />); });
  await act(async () => { await Promise.resolve(); });
};
const $ = (sel) => container.querySelector(sel);
const setValue = async (el, value) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value);
  await act(async () => { el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const botonGuardar = () => [...container.querySelectorAll('button')].find(b => b.textContent.startsWith('Guardar'));

describe('AC-COMR-6 grilla de % por rubro del vendedor', () => {
  it('AC-COMR-6 muestra TODOS los rubros existentes + los de su tabla, con su % (coma decimal), pendientes y rechazos', async () => {
    await render();
    const filas = [...container.querySelectorAll('[data-testid^="fila-rubro-"]')].map(d => d.getAttribute('data-testid'));
    expect(filas).toEqual(['fila-rubro-almacen', 'fila-rubro-bebidas', 'fila-rubro-golosinas', 'fila-rubro-kiosco']);
    expect($('#pct-golosinas').value).toBe('5,5');
    expect($('#pct-almacen').value).toBe('');
    expect($('[data-testid="pendiente-bebidas"]')).not.toBeNull();
    expect($('[data-testid="rechazo-kiosco"]').textContent).toMatch(/dado de baja/);
    expect($('#pct-golosinas').getAttribute('inputmode')).toBe('decimal');
    expect(botonGuardar().disabled).toBe(true); // sin cambios
  });

  it.each([['100,01'], ['-1'], ['5,555'], ['abc']])('AC-COMR-6 "%s" muestra error en la fila y no deja guardar', async (v) => {
    await render();
    await setValue($('#pct-almacen'), v);
    expect($('[data-error-for="pct-almacen"]').textContent).toMatch(/entre 0 y 100/);
    expect(botonGuardar().disabled).toBe(true);
    await click(botonGuardar());
    expect(guardarPctsVendedor).not.toHaveBeenCalled();
  });

  it('AC-COMR-6 guardar manda SOLO los cambios (vaciar = "") con el PIN tipeado; el PIN se borra del campo', async () => {
    await render({ online: true });
    await setValue($('#pct-almacen'), '2,5');
    await setValue($('#pct-golosinas'), '');
    await setValue($('#pin-rubro-u-ana'), '4815');
    await click(botonGuardar());
    expect(guardarPctsVendedor).toHaveBeenCalledWith({
      vendedor: ANA,
      cambios: [{ rubro: 'Almacén', pct: '2,5' }, { rubro: 'Golosinas', pct: '' }],
      pin: '4815',
      online: true,
    });
    expect($('#pin-rubro-u-ana').value).toBe('');
    expect($('[data-testid="grid-mensaje"]').textContent).toBe('Guardado y sincronizado.');
    expect(cargarTablaRubros).toHaveBeenCalledTimes(2); // recarga después de guardar
  });

  it('AC-COMR-6 errores del servicio se muestran (por fila y general)', async () => {
    guardarPctsVendedor.mockImplementationOnce(async () => ({ ok: false, motivo: 'validacion', errores: { Almacén: 'mal' }, mensaje: 'Revisá los % marcados.' }));
    await render();
    await setValue($('#pct-almacen'), '3');
    await click(botonGuardar());
    expect($('[data-testid="grid-mensaje"]').textContent).toBe('Revisá los % marcados.');
    expect($('[data-error-for="pct-almacen"]').textContent).toBe('mal');
    guardarPctsVendedor.mockImplementationOnce(async () => { throw new Error('IndexedDB caída'); });
    await setValue($('#pct-almacen'), '4');
    await click(botonGuardar());
    expect($('[data-testid="grid-mensaje"]').textContent).toMatch(/IndexedDB caída/);
  });

  it('AC-COMR-8 sin remoteId la grilla queda deshabilitada con "Sincronizá el vendedor primero"', async () => {
    await render({ vendedor: { id: 9, nombre: 'Nuevo', permiso: 2 } });
    expect($('[data-testid="grid-sin-id"]').textContent).toMatch(/Sincronizá el vendedor primero/);
    expect([...container.querySelectorAll('input[id^="pct-"]')].every(i => i.disabled)).toBe(true);
    expect(botonGuardar().disabled).toBe(true);
  });

  it('AC-COMR-11 rubroFoco enfoca la fila del rubro que falta cargar', async () => {
    await render({ rubroFoco: 'ALMACÉN' });
    expect(document.activeElement).toBe($('#pct-almacen'));
  });

  it('AC-COMR-6 si no se puede leer la tabla avisa; sin rubros muestra el texto vacío', async () => {
    cargarTablaRubros.mockImplementationOnce(async () => { throw new Error('sin IndexedDB'); });
    await render({ rubros: [] });
    expect($('[data-testid="grid-mensaje"]').textContent).toMatch(/sin IndexedDB/);
    expect(container.textContent).toMatch(/Todavía no hay rubros/);
  });
});
