// S-COM-13 (iteracion 3): la pantalla de ingreso valida el PIN SOLO con el
// servidor (rpc verificar_pin) y sin conexion no deja entrar.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../db', () => ({ addVendedor: jest.fn(() => Promise.resolve(10)), markVendedorSynced: jest.fn(), updateVendedor: jest.fn() }));
jest.mock('../../sync/syncService', () => ({ syncVendedor: jest.fn(() => Promise.resolve(55)), downloadVendedores: jest.fn(() => Promise.resolve()) }));
const mockSb = { rpc: [], rpcRespuestas: [], selectRespuestas: [] };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (fn, args) => { mockSb.rpc.push({ fn, args }); return Promise.resolve(mockSb.rpcRespuestas.shift() || { data: false, error: null }); },
    from: () => {
      const api = { select: () => api, eq: () => api, maybeSingle: () => Promise.resolve(mockSb.selectRespuestas.shift() || { data: null, error: null }) };
      return api;
    },
  },
}));

// eslint-disable-next-line import/first
import SelectorVendedor from '../SelectorVendedor';
// eslint-disable-next-line import/first
import { addVendedor } from '../../db';
// eslint-disable-next-line import/first
import { syncVendedor } from '../../sync/syncService';

const ADMIN = { id: 1, remoteId: 7, nombre: 'Jorge', permiso: 1, tienePin: true };
const VEND = { id: 2, remoteId: 8, nombre: 'Carlos', permiso: 2, tienePin: false };

let container;
let root;
const setApp = (over = {}) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, { vendedores: [ADMIN, VEND], seleccionarVendedor: jest.fn(), recargar: jest.fn(() => Promise.resolve()), online: true, ...over });
};
const render = async () => { await act(async () => { root.render(<SelectorVendedor />); }); };
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await flush(); };
const opcion = (nombre) => [...container.querySelectorAll('.vendedor-option')].find(b => b.textContent.includes(nombre));
const boton = (txt) => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === txt);
const tipear = async (el, valor) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, valor);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockSb, { rpc: [], rpcRespuestas: [], selectRespuestas: [] });
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('AC-SEC-4 S-COM-13 ingreso 100 % online', () => {
  it('AC-SEC-4 S-COM-13 sin conexion: mensaje claro y no se entra (ni con PIN ni sin PIN)', async () => {
    setApp({ online: false });
    await render();
    expect(container.querySelector('[data-testid="ingreso-offline"]').textContent).toMatch(/Necesitás conexión para ingresar/);
    await click(opcion('Carlos'));
    await click(opcion('Jorge'));
    expect(mockApp.seleccionarVendedor).not.toHaveBeenCalled();
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(mockSb.rpc).toEqual([]);
  });

  it('AC-SEC-4 S-COM-13 con PIN: el PIN se valida con rpc verificar_pin y recien ahi entra', async () => {
    setApp();
    await render();
    await click(opcion('Jorge'));
    const input = container.querySelector('input[type="password"]');
    expect(input.getAttribute('autocomplete')).toBe('off');
    await tipear(input, '4821');
    mockSb.rpcRespuestas = [{ data: true, error: null }];
    await click(boton('Entrar'));
    expect(mockSb.rpc).toEqual([{ fn: 'verificar_pin', args: { p_vendedor_id: '7', p_pin: '4821' } }]);
    expect(mockApp.seleccionarVendedor).toHaveBeenCalledWith(ADMIN);
    expect(JSON.stringify({ ...localStorage })).not.toContain('4821');
  });

  it('AC-SEC-4 S-COM-13 PIN incorrecto o bloqueado: no entra y el campo se vacia', async () => {
    setApp();
    await render();
    await click(opcion('Jorge'));
    await tipear(container.querySelector('input[type="password"]'), '0000');
    mockSb.rpcRespuestas = [{ data: false, error: null }];
    await click(boton('Entrar'));
    expect(container.textContent).toMatch(/PIN incorrecto/);
    expect(container.querySelector('input[type="password"]').value).toBe('');
    await tipear(container.querySelector('input[type="password"]'), '1111');
    mockSb.rpcRespuestas = [{ data: null, error: { code: 'P0001', message: 'Demasiados intentos. Proba de nuevo en 15 minutos.' } }];
    await click(boton('Entrar'));
    expect(container.textContent).toMatch(/Demasiados intentos/);
    expect(mockApp.seleccionarVendedor).not.toHaveBeenCalled();
  });

  it('AC-SEC-4 S-COM-13 un pin legacy guardado localmente no se usa para entrar', async () => {
    const legacy = { id: 3, remoteId: 9, nombre: 'Viejo', permiso: 1, pin: '1234' };
    setApp({ vendedores: [legacy] });
    await render();
    await click(opcion('Viejo'));
    await tipear(container.querySelector('input[type="password"]'), '1234');
    mockSb.rpcRespuestas = [{ data: false, error: null }];
    await click(boton('Entrar'));
    expect(mockApp.seleccionarVendedor).not.toHaveBeenCalled();
  });

  it('AC-SEC-4 S-COM-13 PIN vacio no llama al servidor; cancelar cierra el modal', async () => {
    setApp();
    await render();
    await click(opcion('Jorge'));
    await click(boton('Entrar'));
    expect(container.textContent).toMatch(/Ingresá tu PIN/);
    expect(mockSb.rpc).toEqual([]);
    await click(boton('Cancelar'));
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });

  it('AC-SEC-4 S-COM-13 sin PIN: se confirma con el servidor; si el servidor dice que tiene PIN, se pide', async () => {
    setApp();
    await render();
    mockSb.selectRespuestas = [{ data: { id: 8, tiene_pin: false, permiso: 2 }, error: null }];
    await click(opcion('Carlos'));
    expect(mockApp.seleccionarVendedor).toHaveBeenCalledWith(VEND);
    mockApp.seleccionarVendedor.mockClear();
    mockSb.selectRespuestas = [{ data: { id: 8, tiene_pin: true, permiso: 2 }, error: null }];
    await click(opcion('Carlos'));
    expect(mockApp.seleccionarVendedor).not.toHaveBeenCalled();
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('AC-SEC-4 S-COM-13 errores del servidor al consultar se muestran y no se entra', async () => {
    setApp();
    await render();
    mockSb.selectRespuestas = [{ data: null, error: null }];
    await click(opcion('Carlos'));
    expect(container.querySelector('[data-testid="ingreso-error"]').textContent).toMatch(/ya no existe/);
    expect(mockApp.seleccionarVendedor).not.toHaveBeenCalled();
  });

  it('AC-SEC-4 S-COM-13 el candado sale de tienePin', async () => {
    setApp();
    await render();
    expect(opcion('Jorge').textContent).toContain('\u{1F512}');
    expect(opcion('Carlos').textContent).not.toContain('\u{1F512}');
  });

  it('AC-SEC-4 S-COM-13 auto-alta: vendedor comun sin PIN (no manda pin)', async () => {
    setApp();
    await render();
    await click(boton('+ Agregar vendedor'));
    await tipear(container.querySelector('input[placeholder="Ej: Carlos Rodriguez"]'), 'Nuevo');
    await click(boton('Guardar'));
    expect(addVendedor).toHaveBeenCalledWith({ nombre: 'Nuevo', zona: '', permiso: 2, tienePin: false });
    expect(syncVendedor).toHaveBeenCalledWith({ nombre: 'Nuevo', zona: '' });
  });

  it('AC-VEN-3 un vendedor dado de baja no aparece en la pantalla de ingreso', async () => {
    setApp({ vendedores: [ADMIN, { ...VEND, activo: false }] });
    await render();
    expect(opcion('Jorge')).toBeTruthy();
    expect(opcion('Carlos')).toBeUndefined();
  });

  it('AC-VEN-2 si el servidor dice que esta dado de baja (este dispositivo no sincronizo), no entra', async () => {
    setApp();
    await render();
    mockSb.selectRespuestas = [{ data: { id: 8, tiene_pin: false, permiso: 2, activo: false }, error: null }];
    await click(opcion('Carlos'));
    expect(mockApp.seleccionarVendedor).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="ingreso-error"]').textContent).toMatch(/dado de baja/);
  });
});
