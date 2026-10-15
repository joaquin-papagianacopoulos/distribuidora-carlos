// REQ-HPR (AC-HPR-2/4, S5): pantalla "Cambios de precio", solo admin.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../db', () => ({ getCambiosPrecio: jest.fn() }));
jest.mock('../../services/cambiosPrecioService', () => ({
  bajarCambiosPrecio: jest.fn(() => Promise.resolve({ ok: true })),
  consultarCambiosPrecioOnline: jest.fn(() => Promise.resolve({ ok: true, cambios: [] })),
  DIAS_HISTORIAL_LOCAL: 90,
}));
jest.mock('../../utils/pdfGen', () => ({ generarCambiosPrecioFile: jest.fn(() => Promise.resolve(new File(['x'], 'a.pdf'))) }));

// eslint-disable-next-line import/first
import CambiosPrecio from '../CambiosPrecio';
// eslint-disable-next-line import/first
import { getCambiosPrecio } from '../../db';
// eslint-disable-next-line import/first
import { fechaArgentina } from '../../domain/precios';

let container;
let root;
const hoy = fechaArgentina(new Date());

const cambio = (id, productoId, nombre, ant, nue) => ({
  id, productoId, codigo: `C${productoId}`, nombre, rubro: 'Golosinas', precioAnterior: ant, precioNuevo: nue,
  precioBultoAnterior: 0, precioBultoNuevo: 0, fecha: hoy, creadoEn: `${hoy}T12:00:00Z`,
});

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, { productos: [], online: true, vendedorActual: { id: 1, nombre: 'Admin', permiso: 1 } });
  getCambiosPrecio.mockResolvedValue([cambio('a', 1, 'Alfajor', 100, 120)]);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

const render = async () => { await act(async () => { root.render(<CambiosPrecio />); }); };

describe('AC-HPR-2 / AC-HPR-4 pantalla de cambios de precio', () => {
  test('AC-HPR-4 aclara que el historial se registra desde esta versión', async () => {
    await render();
    expect(container.querySelector('[data-testid="cambios-precio-leyenda"]').textContent).toMatch(/Se registra desde esta versión/);
  });

  test('AC-HPR-2 lista los cambios de hoy con anterior, nuevo y variación', async () => {
    await render();
    const fila = container.querySelector('[data-testid="cambios-fila"]');
    expect(fila.textContent).toContain('Alfajor');
    expect(fila.textContent).toContain('+20%');
    expect(container.querySelector('[data-testid="cambios-pdf"]').disabled).toBe(false);
  });

  test('AC-HPR-2 sin cambios en el rango muestra el vacío y no deja bajar el PDF', async () => {
    getCambiosPrecio.mockResolvedValue([]);
    await render();
    expect(container.querySelector('[data-testid="cambios-vacio"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="cambios-pdf"]').disabled).toBe(true);
  });

  test('S5 un vendedor no ve nada de los cambios de precio', async () => {
    mockApp.vendedorActual = { id: 2, nombre: 'Vend', permiso: 2 };
    await render();
    expect(container.querySelector('[data-testid="cambios-precio-solo-admin"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="cambios-fila"]')).toBeNull();
    expect(getCambiosPrecio).not.toHaveBeenCalled();
  });
});
