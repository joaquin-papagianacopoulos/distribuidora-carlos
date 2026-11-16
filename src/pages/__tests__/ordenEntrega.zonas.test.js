// REQ-RUT (Lote 2026-11-16): tablero de entrega. Se elige qué pedidos pendientes salen y en qué orden.
// (Reemplaza a los tests de AC-ZON-1/2 de la pantalla por zona: el orden ahora lo elige el cliente en el momento;
// la lógica de zonas sigue en src/domain/zonas.js y se usa en el atajo "Ordenar por zona".)
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no deberia llamar a Supabase'); }) } }));
jest.mock('../../db', () => ({ updateCliente: jest.fn(), getPedidos: jest.fn(() => Promise.resolve([])) }));
jest.mock('../../sync/syncService', () => ({ syncClientes: jest.fn() }));
jest.mock('../../utils/pdfGen', () => ({ generarFacturaFile: jest.fn(), generarHojaRutaFile: jest.fn() }));
jest.mock('../../utils/share', () => ({ shareFiles: jest.fn(), canShareFiles: jest.fn() }));
jest.mock('../../utils/pdfMerge', () => ({ mergePdfFilesToSingleFile: jest.fn() }));
jest.mock('../../services/pedidoRepository', () => ({ marcarEntregadoOnlineFirst: jest.fn() }));

// eslint-disable-next-line import/first
import OrdenEntrega from '../OrdenEntrega';
// eslint-disable-next-line import/first
import { generarFacturaFile, generarHojaRutaFile } from '../../utils/pdfGen';
// eslint-disable-next-line import/first
import { mergePdfFilesToSingleFile } from '../../utils/pdfMerge';
// eslint-disable-next-line import/first
import { shareFiles, canShareFiles } from '../../utils/share';
// eslint-disable-next-line import/first
import { marcarEntregadoOnlineFirst } from '../../services/pedidoRepository';
// eslint-disable-next-line import/first
import { sumarDias } from '../../utils/diasSemana';

const C = (id, nombre, zona, extra = {}) => ({ id, nombre, zona, direccion: `Calle ${id}00`, ...extra });
const CLIENTES = [
  C(1, 'Ana', 'Norte', { ordenZona: 2 }),
  C(2, 'Beto', 'norte ', { ordenZona: 1 }),
  C(3, 'Cami', 'Sur', { ordenZona: 1 }),
  C(4, 'Dani', '', {}),
];
const HOY = sumarDias(null, 0);
const P = (id, clienteId, clienteNombre, extra = {}) => ({
  id, clienteId, clienteNombre, fecha: sumarDias(null, -1), estado: 'pendiente', vendedorNombre: 'V', items: [], total: 1000 + id, ...extra,
});

let container;
let root;
const setApp = (over = {}) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, {
    clientes: CLIENTES, deudas: [], pedidos: [], recargar: jest.fn(() => Promise.resolve()),
    traerPedidosSinEntregar: jest.fn(() => Promise.resolve()),
    vendedorActual: { id: 2, nombre: 'V', permiso: 2 }, comisionesCierres: [],
    ...over,
  });
};
const render = async () => { await act(async () => { root.render(<OrdenEntrega />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const porAria = (l) => container.querySelector(`[aria-label="${l}"]`);
const boton = (t) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(t));
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const escribir = async (el, valor) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, 'value').set;
  await act(async () => { set.call(el, valor); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
};
const salir = async (el) => { await act(async () => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); el.blur(); }); };
const agregar = async (nombre) => click(porAria(`Agregar a la ruta el pedido de ${nombre}`));
const pendientes = () => [...container.querySelectorAll('[data-testid="oe-lista-pendientes"] .oe-nombre')].map(n => n.textContent);
const ruta = () => [...container.querySelectorAll('[data-testid^="oe-parada-"] .oe-nombre')].map(n => n.textContent);

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  jest.spyOn(window, 'alert').mockImplementation(() => {});
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  jest.spyOn(window, 'open').mockReturnValue(null);
  global.URL.createObjectURL = jest.fn(() => 'blob:x');
  global.URL.revokeObjectURL = jest.fn();
  canShareFiles.mockReturnValue(true);
  shareFiles.mockResolvedValue(undefined);
  generarFacturaFile.mockResolvedValue(new File(['x'], 'f.pdf'));
  generarHojaRutaFile.mockResolvedValue(new File(['x'], 'h.pdf'));
  mergePdfFilesToSingleFile.mockResolvedValue(new File(['x'], 'm.pdf'));
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  jest.restoreAllMocks();
});

describe('AC-RUT-1 pendientes de entrega de cualquier fecha', () => {
  it('lista todos los pendientes (sin entregados ni borrados) y los pide al servidor', async () => {
    setApp({ pedidos: [
      P(10, 3, 'Cami', { fecha: sumarDias(null, -6) }),
      P(11, 1, 'Ana', { fecha: HOY }),
      P(12, 4, 'Dani', { estado: 'facturado', entregado: true }),
      P(13, 2, 'Beto', { borrado: true }),
    ] });
    await render();
    expect(mockApp.traerPedidosSinEntregar).toHaveBeenCalled();
    expect(pendientes()).toEqual(['Cami', 'Ana']);
    expect(q('oe-stat-pendientes').textContent).toContain('2');
    expect(q('oe-stat-ruta').textContent).toContain('0');
  });

  it('cada pedido muestra la dirección del cliente y su nota', async () => {
    setApp({ pedidos: [P(10, 3, 'Cami', { observaciones: 'Timbre roto' })] });
    await render();
    const c = q('oe-pend-10').textContent;
    expect(c).toContain('Calle 300');
    expect(c).toContain('Timbre roto');
  });

  it('sin pedidos pendientes lo dice', async () => {
    setApp();
    await render();
    expect(q('oe-lista-pendientes').textContent).toMatch(/No hay pedidos pendientes de entrega/);
  });

  it('se puede buscar por cliente o por dirección y filtrar por zona', async () => {
    setApp({ pedidos: [P(10, 3, 'Cami'), P(11, 1, 'Ana'), P(12, 2, 'Beto'), P(13, 4, 'Dani')] });
    await render();
    await escribir(porAria('Buscar cliente o dirección'), 'calle 1');
    expect(pendientes()).toEqual(['Ana']);
    await escribir(porAria('Buscar cliente o dirección'), '');
    await escribir(porAria('Filtrar por zona'), 'norte');
    expect(pendientes().sort()).toEqual(['Ana', 'Beto']);
  });
});

describe('AC-RUT-2 armar la ruta y cambiar el orden', () => {
  const DATOS = () => setApp({ pedidos: [P(10, 3, 'Cami'), P(11, 1, 'Ana'), P(12, 2, 'Beto')] });

  it('tocar un pedido lo pasa a Mi ruta, en el orden en que se agregan', async () => {
    DATOS();
    await render();
    await agregar('Beto');
    await agregar('Cami');
    expect(ruta()).toEqual(['Beto', 'Cami']);
    expect(pendientes()).toEqual(['Ana']); // los que ya están en la ruta no se repiten en pendientes
    expect(q('oe-stat-ruta').textContent).toContain('2');
    expect(q('oe-stat-pendientes').textContent).toContain('3');
  });

  it('las flechas suben y bajan; en los extremos están deshabilitadas', async () => {
    DATOS();
    await render();
    await agregar('Beto'); await agregar('Cami'); await agregar('Ana');
    expect(porAria('Subir a Beto').disabled).toBe(true);
    expect(porAria('Bajar a Ana').disabled).toBe(true);
    await click(porAria('Subir a Ana'));
    expect(ruta()).toEqual(['Beto', 'Ana', 'Cami']);
    await click(porAria('Bajar a Beto'));
    expect(ruta()).toEqual(['Ana', 'Beto', 'Cami']);
  });

  it('escribir el puesto manda el pedido a ese lugar', async () => {
    DATOS();
    await render();
    await agregar('Beto'); await agregar('Cami'); await agregar('Ana');
    const campo = porAria('Puesto de Ana');
    await escribir(campo, '1');
    await salir(campo);
    expect(ruta()).toEqual(['Ana', 'Beto', 'Cami']);
    expect(porAria('Puesto de Ana').value).toBe('1');
  });

  it('sacar un pedido de la ruta lo devuelve a pendientes', async () => {
    DATOS();
    await render();
    await agregar('Beto'); await agregar('Cami');
    await click(porAria('Sacar de la ruta a Beto'));
    expect(ruta()).toEqual(['Cami']);
    expect(pendientes()).toContain('Beto');
  });

  it('"Agregar todos" suma los que se ven (respeta los filtros) y "Vaciar ruta" los devuelve', async () => {
    DATOS();
    await render();
    await escribir(porAria('Filtrar por zona'), 'norte');
    await click(boton('Agregar todos los que se ven'));
    expect(ruta().sort()).toEqual(['Ana', 'Beto']);
    await click(boton('Vaciar ruta'));
    expect(window.confirm).toHaveBeenCalled();
    expect(ruta()).toEqual([]);
  });

  it('"Invertir orden" y "Ordenar por zona" cambian toda la ruta', async () => {
    DATOS();
    await render();
    await agregar('Cami'); await agregar('Ana'); await agregar('Beto');
    await click(boton('Invertir orden'));
    expect(ruta()).toEqual(['Beto', 'Ana', 'Cami']);
    await click(boton('Invertir orden'));
    await click(boton('Ordenar por zona'));
    // Norte primero (Beto puesto 1, Ana puesto 2), después Sur (Cami).
    expect(ruta()).toEqual(['Beto', 'Ana', 'Cami']);
  });

  it('la ruta vacía explica cómo se usa y deshabilita los botones de imprimir', async () => {
    DATOS();
    await render();
    expect(q('oe-ruta-vacia').textContent).toMatch(/Tu ruta está vacía/);
    expect(boton('Imprimir remitos').disabled).toBe(true);
    expect(boton('Hoja de ruta').disabled).toBe(true);
  });

  it('arrastrar un pedido sobre otro cambia el orden', async () => {
    DATOS();
    await render();
    await agregar('Beto'); await agregar('Cami'); await agregar('Ana');
    const ev = (tipo) => { const e = new Event(tipo, { bubbles: true, cancelable: true }); e.dataTransfer = { setData: jest.fn(), effectAllowed: '' }; return e; };
    const ana = q('oe-parada-11');
    const beto = q('oe-parada-12');
    await act(async () => { ana.dispatchEvent(ev('dragstart')); });
    await act(async () => { beto.dispatchEvent(ev('dragover')); });
    await act(async () => { beto.dispatchEvent(ev('drop')); });
    expect(ruta()).toEqual(['Ana', 'Beto', 'Cami']);
  });
});

describe('AC-RUT-3 la ruta se mantiene y se limpia sola', () => {
  it('se guarda en el dispositivo y vuelve al reabrir la pantalla', async () => {
    setApp({ pedidos: [P(10, 3, 'Cami'), P(11, 1, 'Ana')] });
    await render();
    await agregar('Cami'); await agregar('Ana');
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    await render();
    expect(ruta()).toEqual(['Cami', 'Ana']);
  });

  it('un pedido que se entrega (o se borra) sale solo de la ruta', async () => {
    const pedidos = [P(10, 3, 'Cami'), P(11, 1, 'Ana')];
    setApp({ pedidos });
    await render();
    await agregar('Cami'); await agregar('Ana');
    setApp({ pedidos: [{ ...pedidos[0], estado: 'facturado', entregado: true }, pedidos[1]] });
    await render();
    expect(ruta()).toEqual(['Ana']);
    expect(q('oe-stat-ruta').textContent).toContain('1');
  });

  it('AC-REP-3 "Entregado" desde la ruta marca el pedido facturado (admin) y recarga', async () => {
    marcarEntregadoOnlineFirst.mockResolvedValue({ mode: 'online' });
    const fact = P(30, 1, 'Ana', { estado: 'facturado' });
    setApp({ pedidos: [fact, P(31, 3, 'Cami')], vendedorActual: { id: 1, nombre: 'Admin', permiso: 1 } });
    await render();
    await agregar('Ana'); await agregar('Cami');
    const botones = [...container.querySelectorAll('[data-testid^="oe-parada-"] .oe-entregado')];
    expect(botones).toHaveLength(1); // solo el facturado
    await click(botones[0]);
    expect(marcarEntregadoOnlineFirst).toHaveBeenCalledWith(fact, true, { cerradoEn: null });
    expect(mockApp.recargar).toHaveBeenCalled();
  });
});

describe('AC-RUT-5 remitos y hoja de ruta salen con la ruta, en su orden', () => {
  const DEUDA_ANA = { id: 'd1', clienteId: 1, clienteNombre: 'Ana', monto: 800, montoPagado: 0, pagada: false, pedidoId: 'viejo' };

  it('los remitos se numeran 1..n según la ruta (no según zona ni fecha) y solo salen los elegidos', async () => {
    setApp({ pedidos: [P(10, 3, 'Cami'), P(11, 1, 'Ana'), P(12, 4, 'Dani')], deudas: [DEUDA_ANA] });
    await render();
    await agregar('Dani'); await agregar('Ana');
    await click(boton('Imprimir remitos'));
    expect(generarFacturaFile.mock.calls.map(c => [c[0].clienteNombre, c[4]])).toEqual([['Dani', 1], ['Ana', 2]]);
    // REQ-RTO-5: el saldo anterior de Ana llega al remito.
    expect(generarFacturaFile.mock.calls.map(c => c[3])).toEqual([0, 800]);
    expect(mergePdfFilesToSingleFile).toHaveBeenCalledTimes(1);
    expect(shareFiles).toHaveBeenCalled();
  });

  it('la hoja de ruta lleva orden, cliente, dirección, importe, saldo anterior y total a cobrar de la ruta', async () => {
    setApp({ pedidos: [P(10, 3, 'Cami'), P(11, 1, 'Ana'), P(12, 2, 'Beto')], deudas: [DEUDA_ANA] });
    await render();
    await agregar('Ana'); await agregar('Cami');
    await click(boton('Hoja de ruta'));
    expect(generarHojaRutaFile).toHaveBeenCalledTimes(1);
    const [resultado, opciones] = generarHojaRutaFile.mock.calls[0];
    expect(opciones).toEqual({ fechas: [HOY], zonas: [], ruta: true });
    expect(resultado.filas.map(f => [f.orden, f.clienteNombre, f.direccion])).toEqual([[1, 'Ana', 'Calle 100'], [2, 'Cami', 'Calle 300']]);
    expect(resultado.filas[0]).toMatchObject({ importe: 1011, saldoAnterior: 800, totalACobrar: 1811 });
    expect(resultado.filas[1]).toMatchObject({ importe: 1010, saldoAnterior: 0, totalACobrar: 1010 });
    expect(resultado.totales).toMatchObject({ pedidos: 2, importe: 2021, saldoAnterior: 800, totalACobrar: 2821 });
    expect(generarFacturaFile).not.toHaveBeenCalled();
  });

  it('el saldo anterior de un cliente con dos pedidos en la ruta se cuenta una sola vez', async () => {
    setApp({ pedidos: [P(11, 1, 'Ana'), P(13, 1, 'Ana')], deudas: [DEUDA_ANA] });
    await render();
    await click(boton('Agregar todos los que se ven'));
    await click(boton('Imprimir remitos'));
    expect(generarFacturaFile.mock.calls.map(c => c[3])).toEqual([800, 0]);
  });

  it('un error al generar el PDF avisa y deja la ruta como estaba', async () => {
    generarFacturaFile.mockRejectedValueOnce(new Error('falló jsPDF'));
    setApp({ pedidos: [P(10, 3, 'Cami')] });
    await render();
    await agregar('Cami');
    await click(boton('Imprimir remitos'));
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('falló jsPDF'));
    expect(ruta()).toEqual(['Cami']);
  });
});

describe('AC-RUT-7 celular: un panel a la vez', () => {
  it('las pestañas Pendientes / Mi ruta muestran un solo panel', async () => {
    setApp({ pedidos: [P(10, 3, 'Cami')] });
    await render();
    expect(q('oe-pendientes').className).not.toContain('oe-oculto-movil');
    expect(q('oe-ruta').className).toContain('oe-oculto-movil');
    await click(boton('Mi ruta ('));
    expect(q('oe-pendientes').className).toContain('oe-oculto-movil');
    expect(q('oe-ruta').className).not.toContain('oe-oculto-movil');
  });
});
