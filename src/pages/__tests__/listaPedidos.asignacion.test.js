// REQ-ASV (AC-ASV-2), REQ-EDP (AC-EDP-1/3) y REQ-PEN (AC-PEN-1) en la lista de pedidos.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { getTodayStr } from '../../utils/fuzzy';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }) } }));
jest.mock('../../utils/pdfGen', () => ({ generarFacturaFile: jest.fn() }));
jest.mock('../../utils/share', () => ({ shareFiles: jest.fn() }));
jest.mock('../../utils/pdfMerge', () => ({ mergePdfFilesToSingleFile: jest.fn() }));
jest.mock('../../services/pedidoRepository', () => ({
  borrarPedidoOnlineFirst: jest.fn(() => Promise.resolve()),
  guardarPedidoOnlineFirst: jest.fn(() => Promise.resolve()),
  asignarVendedorOnlineFirst: jest.fn(() => Promise.resolve()),
  reasignarVendedorAdmin: jest.fn(() => Promise.resolve()),
  resolverConflictoEdicion: jest.fn(() => Promise.resolve({ mode: 'servidor' })),
}));
jest.mock('../../services/deudaRepository', () => ({ quitarDeudaDePedido: jest.fn(() => Promise.resolve()) }));

// eslint-disable-next-line import/first
import ListaPedidos from '../ListaPedidos';
// eslint-disable-next-line import/first
import { reasignarVendedorAdmin, resolverConflictoEdicion } from '../../services/pedidoRepository';

const ADMIN = { id: 1, nombre: 'Jorge', permiso: 1 };
const CARLOS = { id: 2, nombre: 'Carlos', permiso: 2, zona: 'Norte' };
const VENDEDORES = [ADMIN, CARLOS, { id: 4, nombre: 'Lucía', permiso: 2 }];
const hoy = getTodayStr();
const base = { zona: 'Norte', fecha: hoy, estado: 'pendiente', items: [], total: 10, createdAt: 1, synced: true };

let container;
let root;
let onEditar;
const render = async () => { await act(async () => { root.render(<ListaPedidos onEditar={onEditar} />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const elegir = async (el, valor) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  await act(async () => { setter.call(el, valor); el.dispatchEvent(new Event('change', { bubbles: true })); });
};
const setApp = (over = {}) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    pedidos: [], clientes: [], vendedores: VENDEDORES, deudas: [], vendedorActual: ADMIN, zonaActiva: '',
    setZona: jest.fn(), recargar: jest.fn(() => Promise.resolve()), syncNow: jest.fn(), syncPedidosFecha: jest.fn(),
    syncPedidosCliente: jest.fn(), traerPedidosPendientes: jest.fn(), ...over,
  });
};

beforeEach(() => {
  resolverConflictoEdicion.mockImplementation(() => Promise.resolve({ mode: 'servidor' }));
  onEditar = jest.fn();
  setApp();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('AC-ASV-2 asignar vendedor desde la lista de pedidos', () => {
  it('AC-ASV-2 pedido web sin vendedor: badge "Sin vendedor" y el admin lo asigna con su PIN (RPC)', async () => {
    jest.spyOn(window, 'prompt').mockReturnValue('1234');
    setApp({ pedidos: [{ ...base, id: 50, remoteId: 'R50', clienteNombre: 'Cliente Web', origen: 'web', webEstado: 'aceptado', vendedor: 'WEB', vendedorNombre: 'WEB' }] });
    await render();
    expect(container.querySelector('[data-testid="badge-sin-vendedor"]')).not.toBeNull();
    await click(container.querySelector('.pedido-card'));
    const select = [...container.querySelectorAll('select')].find(s => s.textContent.includes('Seleccionar vendedor'));
    await elegir(select, 'Carlos');
    const asignar = [...container.querySelectorAll('button')].find(b => b.textContent === 'Asignar');
    await click(asignar);
    expect(reasignarVendedorAdmin).toHaveBeenCalledWith(expect.objectContaining({ pin: '1234', vendedor: expect.objectContaining({ nombre: 'Carlos' }) }));
    window.prompt.mockRestore();
  });

  it('AC-ASV-2 sin PIN no se reasigna', async () => {
    jest.spyOn(window, 'prompt').mockReturnValue(null);
    setApp({ pedidos: [{ ...base, id: 51, remoteId: 'R51', clienteNombre: 'X', vendedor: 'Carlos', vendedorNombre: 'Carlos' }] });
    await render();
    await click(container.querySelector('.pedido-card'));
    const select = [...container.querySelectorAll('select')].find(s => s.textContent.includes('Seleccionar vendedor'));
    await elegir(select, 'Lucía');
    await click([...container.querySelectorAll('button')].find(b => b.textContent === 'Asignar'));
    expect(reasignarVendedorAdmin).not.toHaveBeenCalled();
    window.prompt.mockRestore();
  });

  it('AC-ASV-2 el vendedor no ve el selector de asignacion', async () => {
    setApp({ vendedorActual: CARLOS, pedidos: [{ ...base, id: 52, clienteNombre: 'X', vendedor: 'Carlos', vendedorNombre: 'Carlos' }] });
    await render();
    await click(container.querySelector('.pedido-card'));
    expect([...container.querySelectorAll('select')].some(s => s.textContent.includes('Seleccionar vendedor'))).toBe(false);
  });
});

describe('AC-EDP-1 / AC-EDP-3 lista', () => {
  it('AC-EDP-1 el vendedor ve "Editar" en sus pedidos (dueño o cargados por el) y no en ajenos, entregados ni facturados', async () => {
    setApp({
      vendedorActual: CARLOS,
      pedidos: [
        { ...base, id: 1, clienteNombre: 'Propio', vendedor: 'Carlos', vendedorNombre: 'Carlos' },
        { ...base, id: 2, clienteNombre: 'Cargado', vendedor: 'Lucía', vendedorNombre: 'Lucía', cargadoPor: 'Carlos' },
        { ...base, id: 3, clienteNombre: 'Ajeno', vendedor: 'Lucía', vendedorNombre: 'Lucía' },
        { ...base, id: 4, clienteNombre: 'Entregado', vendedor: 'Carlos', vendedorNombre: 'Carlos', entregado: true },
        { ...base, id: 5, clienteNombre: 'Facturado', vendedor: 'Carlos', vendedorNombre: 'Carlos', estado: 'facturado' },
      ],
    });
    await render();
    const cards = [...container.querySelectorAll('.pedido-card')];
    expect(cards.map(c => c.textContent).join('|')).not.toContain('Ajeno');
    // Un solo detalle abierto a la vez: se abre cada tarjeta y se cuenta el boton.
    const conEditar = [];
    for (const c of cards) {
      await click(c);
      if (container.querySelector('[data-testid="btn-editar-pedido"]')) conEditar.push(c.textContent);
    }
    expect(conEditar.some(t => t.includes('Propio'))).toBe(true);
    expect(conEditar.some(t => t.includes('Cargado'))).toBe(true);
    expect(conEditar).toHaveLength(2);
    await click(cards.find(x => x.textContent.includes('Propio')));
    await click(container.querySelector('[data-testid="btn-editar-pedido"]'));
    expect(onEditar).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('AC-EDP-3 pedido en conflicto: avisa y ofrece usar el del servidor o subir el propio', async () => {
    setApp({ pedidos: [{ ...base, id: 7, remoteId: 'R7', clienteNombre: 'C', vendedor: 'Carlos', vendedorNombre: 'Carlos', synced: false, conflictoEdicion: { at: 1, remoteUpdatedAt: 'x' } }] });
    await render();
    expect(container.querySelector('[data-testid="badge-conflicto"]')).not.toBeNull();
    await click(container.querySelector('.pedido-card'));
    expect(container.querySelector('[data-testid="aviso-conflicto"]')).not.toBeNull();
    await click([...container.querySelectorAll('button')].find(b => b.textContent === 'Usar la del servidor'));
    expect(resolverConflictoEdicion).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 'servidor');
  });
});

describe('AC-PEN-1 bloque Pendientes', () => {
  it('AC-PEN-1 en la fecha de hoy muestra los no facturados de otras fechas con los dias, y pide bajarlos', async () => {
    setApp({
      pedidos: [
        { ...base, id: 1, clienteNombre: 'Vencido', fecha: '2020-01-01', vendedor: 'X', vendedorNombre: 'X' },
        { ...base, id: 2, clienteNombre: 'Futuro', fecha: '2099-01-01', vendedor: 'X', vendedorNombre: 'X' },
        { ...base, id: 3, clienteNombre: 'Facturado viejo', fecha: '2020-01-02', estado: 'facturado', vendedor: 'X', vendedorNombre: 'X' },
      ],
    });
    await render();
    expect(mockApp.traerPedidosPendientes).toHaveBeenCalled();
    const bloque = container.querySelector('[data-testid="bloque-pendientes"]');
    expect(bloque).not.toBeNull();
    expect(bloque.textContent).toContain('Vencido');
    expect(bloque.textContent).toContain('Hace');
    expect(bloque.textContent).toContain('Futuro');
    expect(bloque.textContent).toContain('Faltan');
    expect(bloque.textContent).not.toContain('Facturado viejo');
  });
});
