// REQ-RED (AC-RED-1): tarjeta "Redondeo del total" en Configuracion (solo admin, con PIN, online).
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../services/ajustesService', () => ({
  guardarRedondeo: jest.fn(),
  leerRedondeoLocal: jest.fn(() => 500),
}));

// eslint-disable-next-line import/first
import ConfigRedondeo from '../ConfigRedondeo';
// eslint-disable-next-line import/first
import { guardarRedondeo } from '../../services/ajustesService';

let container;
let root;
const setApp = (over = {}) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, { vendedorActual: { id: 1, nombre: 'Admin', permiso: 1 }, redondeoTotal: undefined, setRedondeoTotal: jest.fn(), ...over });
};
const render = async (props = {}) => { await act(async () => { root.render(<ConfigRedondeo online {...props} />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const radios = () => [...container.querySelectorAll('input[type="radio"]')];
const guardar = () => [...container.querySelectorAll('button')].find(b => /Guardar redondeo/.test(b.textContent));
const escribirPin = async (v) => {
  const el = container.querySelector('[data-testid="pin-redondeo"]');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  await act(async () => { set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); });
};

beforeEach(() => {
  jest.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('AC-RED-1 ConfigRedondeo', () => {
  it('AC-RED-1 ofrece Sin redondeo / $500 / $1000 y el default vigente es $500', async () => {
    setApp();
    await render();
    expect(container.textContent).toMatch(/Sin redondeo/);
    expect(container.textContent).toMatch(/\$500 \(vigente\)/);
    expect(container.textContent).toMatch(/\$1000/);
    expect(radios().map(r => r.checked)).toEqual([false, true, false]);
  });

  it('AC-RED-1 solo el admin la ve', async () => {
    for (const permiso of [2, 3]) {
      setApp({ vendedorActual: { id: 2, nombre: 'V', permiso } });
      await render();
      expect(container.querySelector('[data-testid="config-redondeo"]')).toBeNull();
    }
  });

  it('AC-RED-1 sin cambios o sin PIN no se puede guardar', async () => {
    setApp();
    await render();
    expect(guardar().disabled).toBe(true);
    await click(radios()[2]);
    expect(guardar().disabled).toBe(true); // falta el PIN
    await escribirPin('1234');
    expect(guardar().disabled).toBe(false);
  });

  it('AC-RED-1 guarda con el PIN, avisa y actualiza el valor vigente', async () => {
    setApp();
    guardarRedondeo.mockResolvedValue({ ok: true, redondeoTotal: 1000 });
    await render();
    await click(radios()[2]);
    await escribirPin('1234');
    await click(guardar());
    expect(guardarRedondeo).toHaveBeenCalledWith('1234', 1000);
    expect(mockApp.setRedondeoTotal).toHaveBeenCalledWith(1000);
    expect(container.querySelector('[role="status"]').textContent).toMatch(/Redondeo guardado/);
    expect(container.querySelector('[data-testid="pin-redondeo"]').value).toBe('');
  });

  it('AC-RED-1 PIN incorrecto: muestra el error y no cambia el vigente', async () => {
    setApp();
    guardarRedondeo.mockResolvedValue({ ok: false, motivo: 'no_autorizado', mensaje: 'PIN incorrecto o sin permiso de administrador.' });
    await render();
    await click(radios()[0]);
    await escribirPin('9999');
    await click(guardar());
    expect(container.querySelector('[role="status"]').textContent).toMatch(/PIN incorrecto/);
    expect(mockApp.setRedondeoTotal).not.toHaveBeenCalled();
  });

  it('AC-RED-1 sin conexion avisa y no deja guardar', async () => {
    setApp();
    await render({ online: false });
    await click(radios()[2]);
    await escribirPin('1234');
    expect(container.textContent).toMatch(/necesitás conexión/);
    expect(guardar().disabled).toBe(true);
  });
});
