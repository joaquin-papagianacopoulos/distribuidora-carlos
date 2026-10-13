// REQ-COM: pantalla Comisiones (AC-COM-2, 5, 6, 7, 8, 9, 10, 12, 13, 14).
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
import { cargarDatosComisiones, guardarBorrador, confirmarCierre, anularCierre, syncComisiones } from '../../services/comisionesService';
// eslint-disable-next-line import/first
import { generarCierreComisionesFile } from '../../utils/pdfGen';
// eslint-disable-next-line import/first
import { periodoPorDefecto, claveBorrador, firmaDashboard, armarDashboard } from '../../domain/comisiones';

const PERIODO = periodoPorDefecto();
const F = `${PERIODO.desde.slice(0, 8)}10`; // día 10 del mes en curso
const VENDEDORES = [{ id: 1, nombre: 'Jorge', permiso: 1 }, { id: 2, nombre: 'Carlos', permiso: 2 }, { id: 3, nombre: 'Lucía', permiso: 2 }];
const CLIENTES = [{ id: 10, nombre: 'Kiosco', vendedor: 'Carlos', comision: 5 }, { id: 12, nombre: 'SinVend', vendedor: '', comision: 10 }];
const ped = (o) => ({ id: 1, remoteId: 'R1', clienteId: 10, clienteNombre: 'Kiosco', vendedor: 'Carlos', fecha: F, estado: 'facturado', entregado: true, total: 1000, ...o });
const PEDIDOS = [
  ped({}),
  ped({ id: 3, remoteId: 'R3', vendedor: 'Lucía' }), // (a)
  ped({ id: 4, remoteId: 'R4', clienteId: 12, clienteNombre: 'SinVend', total: 500 }), // (b)
  ped({ id: 6, remoteId: 'R6', entregado: false }), // (d)
  ped({ id: 9, remoteId: 'R9', fecha: '2020-01-10', total: 1200 }), // cerrado y editado => ajuste
];
const CIERRES = [
  {
    id: 'c-vig', estado: 'vigente', desde: '2020-01-01', hasta: '2020-01-31', cerradoAt: Date.UTC(2020, 1, 1), cerradoPor: 'Jorge',
    totales: { pedidos: 1, totalVendido: 1000, totalComision: 50, porVendedor: [{ vendedor: 'Carlos', totalComision: 50 }] },
    lineas: [{ tipo: 'pedido', pedidoId: 'R9', fecha: '2020-01-10', clienteId: 10, clienteNombre: 'Kiosco', total: 1000, pct: 5, comision: 50, asignacion: { modo: 'ficha', partes: [{ vendedor: 'Carlos', pct: 100 }] } }],
  },
  { id: 'c-anu', estado: 'anulado', desde: '2019-12-01', hasta: '2019-12-31', cerradoAt: 1, cerradoPor: 'Jorge', anuladoPor: 'Jorge', anuladoAt: 2, motivoAnulacion: 'Mal cargado', totales: {}, lineas: [] },
];
const datos = (over = {}) => ({ pedidos: PEDIDOS, clientes: CLIENTES, vendedores: VENDEDORES, cierres: CIERRES, borrador: { id: claveBorrador(PERIODO), asignaciones: {} }, incompleto: false, faltaMigracion: false, avisos: [], ...over });

let container;
let root;
const setApp = (vendedorActual, over = {}) => {
  Object.keys(mockApp).forEach(k => delete mockApp[k]);
  Object.assign(mockApp, { vendedorActual, online: true, ...over });
};
const render = async () => { await act(async () => { root.render(<Comisiones />); }); await act(async () => { await Promise.resolve(); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const boton = (t) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(t));
const cambiar = async (el, valor) => {
  await act(async () => {
    const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : (el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, valor);
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
};
const ADMIN = { id: 1, nombre: 'Jorge', permiso: 1 };

beforeEach(() => {
  cargarDatosComisiones.mockImplementation(async () => datos());
  guardarBorrador.mockImplementation(async () => undefined);
  confirmarCierre.mockImplementation(async () => ({ ok: true }));
  anularCierre.mockImplementation(async () => ({ ok: true }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('AC-COM-2 acceso', () => {
  it.each([
    ['vendedor', { id: 2, nombre: 'Carlos', permiso: 2 }],
    ['armador', { id: 4, nombre: 'Ana', permiso: 3 }],
    ['permiso string forjado', { id: 5, nombre: 'X', permiso: 'x' }],
    ['sin sesión', null],
  ])('AC-COM-2 AC-SEC-4 %s no puede entrar ni dispara la carga de datos', async (_l, v) => {
    setApp(v);
    await render();
    expect(container.textContent).toMatch(/No tenés permisos/);
    expect(cargarDatosComisiones).not.toHaveBeenCalled();
    expect(container.querySelector('input, select, button')).toBeNull();
  });

  it('AC-COM-2 el admin entra y se carga el mes en curso por defecto (AC-COM-3)', async () => {
    setApp(ADMIN);
    await render();
    expect(container.textContent).not.toMatch(/No tenés permisos/);
    expect(cargarDatosComisiones).toHaveBeenCalledWith(PERIODO, { online: true });
    expect(container.querySelector('input[aria-label="Desde"]').value).toBe(PERIODO.desde);
  });
});

describe('AC-COM-5 AC-COM-6 dashboard', () => {
  it('AC-COM-6 avisos arriba con contador', async () => {
    setApp(ADMIN);
    await render();
    expect(q('avisos').textContent).toMatch(/Avisos \(3\)/);
    expect(q('aviso-a').textContent).toMatch(/^1 pedido/);
    expect(q('aviso-b').textContent).toMatch(/SinVend/);
    expect(q('aviso-d').textContent).toMatch(/no se cuentan/);
  });

  it('AC-COM-5 tocar un vendedor muestra el detalle por cliente y pedido', async () => {
    setApp(ADMIN);
    await render();
    expect(q('detalle-Carlos')).toBeNull();
    await click(q('vendedor-Carlos'));
    expect(q('detalle-Carlos').textContent).toMatch(/Kiosco/);
    expect(q('detalle-Carlos').textContent).toMatch(/#R1/);
    expect(q('detalle-Carlos').textContent).toMatch(/Ajuste #R9/);
    await click(q('vendedor-Carlos'));
    expect(q('detalle-Carlos')).toBeNull();
  });

  it('AC-COM-13 muestra el ajuste pendiente con la diferencia', async () => {
    setApp(ADMIN);
    await render();
    expect(q('ajustes').textContent).toMatch(/#R9/);
    expect(q('ajustes').textContent).toMatch(/\+\$10,00/);
  });

  it('AC-COM-3 período inválido muestra el error y no recarga', async () => {
    setApp(ADMIN);
    await render();
    cargarDatosComisiones.mockClear();
    await cambiar(container.querySelector('input[aria-label="Hasta"]'), '2000-01-01');
    expect(container.textContent).toMatch(/anterior/);
    expect(cargarDatosComisiones).not.toHaveBeenCalled();
  });

  it('AC-COM-3 sin conexión avisa que los datos pueden estar incompletos y no deja cerrar', async () => {
    setApp(ADMIN, { online: false });
    cargarDatosComisiones.mockImplementation(async () => datos({ incompleto: true, pedidos: [ped({})] }));
    await render();
    expect(container.textContent).toMatch(/posiblemente incompletos/);
    expect(boton('Cerrar comisiones').disabled).toBe(true);
  });
});

describe('AC-COM-7 AC-COM-8 AC-COM-9 asignación', () => {
  it('AC-COM-7 pedido con aviso (a): elegir ficha / cargador / dividir (50/50 por defecto) y se guarda en el borrador', async () => {
    setApp(ADMIN);
    await render();
    const sel = q('asignacion-R3').querySelector('select');
    expect([...sel.options].map(o => o.value)).toEqual(['ficha', 'cargador', 'dividir', 'sin_comision']);
    expect(sel.value).toBe('ficha');
    await cambiar(sel, 'dividir');
    expect(guardarBorrador).toHaveBeenLastCalledWith(expect.objectContaining({ id: claveBorrador(PERIODO), asignaciones: { R3: { modo: 'dividir' } } }));
    expect(q('asignacion-R3').querySelector('input[aria-label="% ficha"]').value).toBe('50');
    expect(q('asignacion-R3').querySelector('input[aria-label="% cargador"]').value).toBe('50');
    await cambiar(q('asignacion-R3').querySelector('input[aria-label="% ficha"]'), '70');
    expect(q('asignacion-R3').querySelector('[role="alert"]').textContent).toMatch(/100 %/);
    await cambiar(q('asignacion-R3').querySelector('input[aria-label="% cargador"]'), '30');
    expect(q('asignacion-R3').querySelector('[role="alert"]')).toBeNull();
    expect(guardarBorrador).toHaveBeenLastCalledWith(expect.objectContaining({ asignaciones: { R3: { modo: 'dividir', pctFicha: '70', pctCargador: '30' } } }));
  });

  it('AC-COM-8 cliente sin vendedor bloquea el cierre hasta asignarlo (otro vendedor o sin comisión)', async () => {
    setApp(ADMIN);
    await render();
    expect(boton('Cerrar comisiones').disabled).toBe(true);
    expect(q('motivos-bloqueo').textContent).toMatch(/sin vendedor/);
    const sel = q('asignacion-R4').querySelector('select');
    await cambiar(sel, 'otro');
    await cambiar(q('asignacion-R4').querySelectorAll('select')[1], 'Lucía');
    expect(boton('Cerrar comisiones').disabled).toBe(false);
    await cambiar(q('asignacion-R4').querySelector('select'), 'sin_comision');
    expect(boton('Cerrar comisiones').disabled).toBe(false);
    await cambiar(q('asignacion-R4').querySelector('select'), '');
    expect(boton('Cerrar comisiones').disabled).toBe(true);
  });

  it('AC-COM-9 al volver a la pantalla, la asignación del borrador se restaura', async () => {
    cargarDatosComisiones.mockImplementation(async () => datos({ borrador: { id: claveBorrador(PERIODO), asignaciones: { R3: { modo: 'cargador' }, R4: { modo: 'sin_comision' } } } }));
    setApp(ADMIN);
    await render();
    expect(q('asignacion-R3').querySelector('select').value).toBe('cargador');
    expect(q('asignacion-R4').querySelector('select').value).toBe('sin_comision');
  });

  it('AC-COM-9 si falla guardar el borrador se avisa', async () => {
    guardarBorrador.mockImplementation(async () => { throw new Error('disco lleno'); });
    setApp(ADMIN);
    await render();
    await cambiar(q('asignacion-R3').querySelector('select'), 'cargador');
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toMatch(/disco lleno/);
  });
});

describe('AC-COM-10 cierre', () => {
  const sinBloqueos = () => datos({ borrador: { id: claveBorrador(PERIODO), asignaciones: { R4: { modo: 'otro', vendedor: 'Lucía' } } } });

  it('AC-COM-10 "Cerrar comisiones" pide confirmación con los totales por vendedor y confirma con la firma vista', async () => {
    cargarDatosComisiones.mockImplementation(async () => sinBloqueos());
    setApp(ADMIN);
    await render();
    await click(boton('Cerrar comisiones'));
    const dlg = q('confirmacion');
    expect(dlg.textContent).toMatch(/Carlos \(2 pedidos\)\$110,00/); // incluye el ajuste +10 de R9
    expect(dlg.textContent).toMatch(/Lucía \(1 pedidos\)\$50,00/);
    expect(confirmarCierre).not.toHaveBeenCalled();
    // S-COM-01: sin PIN no se puede confirmar
    expect(boton('Confirmar cierre').disabled).toBe(true);
    const pin = dlg.querySelector('input[aria-label="PIN de admin"]');
    expect(pin.type).toBe('password');
    expect(pin.getAttribute('autocomplete')).toBe('off');
    await cambiar(pin, '4321');
    await click(boton('Confirmar cierre'));
    const d = sinBloqueos();
    const firma = firmaDashboard(armarDashboard({ ...d, periodo: PERIODO }));
    expect(confirmarCierre).toHaveBeenCalledWith({ periodo: PERIODO, borrador: d.borrador, firmaVista: firma, pin: '4321' });
    expect(container.textContent).toMatch(/Cierre confirmado/);
    expect(q('confirmacion')).toBeNull();
    // el PIN no queda en la pantalla: al reabrir, el campo está vacío
    await click(boton('Cerrar comisiones'));
    expect(q('confirmacion').querySelector('input[aria-label="PIN de admin"]').value).toBe('');
  });

  it('AC-COM-10 AC-COM-16 si el servidor rechaza, se muestra el motivo; "Volver" cancela', async () => {
    cargarDatosComisiones.mockImplementation(async () => sinBloqueos());
    confirmarCierre.mockImplementation(async () => ({ ok: false, mensaje: 'Otro admin ya cerró 1 de estos pedidos.' }));
    setApp(ADMIN);
    await render();
    await click(boton('Cerrar comisiones'));
    await cambiar(q('confirmacion').querySelector('input[aria-label="PIN de admin"]'), '1111');
    await click(boton('Volver'));
    expect(q('confirmacion')).toBeNull();
    await click(boton('Cerrar comisiones'));
    expect(q('confirmacion').querySelector('input[aria-label="PIN de admin"]').value).toBe('');
    await cambiar(q('confirmacion').querySelector('input[aria-label="PIN de admin"]'), '1111');
    await click(boton('Confirmar cierre'));
    expect(container.textContent).toMatch(/Otro admin ya cerró/);
  });

  it('AC-COM-16 sin la migración no deja cerrar', async () => {
    cargarDatosComisiones.mockImplementation(async () => ({ ...sinBloqueos(), faltaMigracion: true }));
    setApp(ADMIN);
    await render();
    expect(container.textContent).toMatch(/migración 003/);
    expect(boton('Cerrar comisiones').disabled).toBe(true);
  });

  it('AC-COM-10 un error al cargar se muestra', async () => {
    cargarDatosComisiones.mockImplementation(async () => { throw new Error('IndexedDB rota'); });
    setApp(ADMIN);
    await render();
    expect(container.textContent).toMatch(/IndexedDB rota/);
  });
});

describe('AC-COM-12 AC-COM-14 historial', () => {
  it('AC-COM-12 el historial muestra vigentes y anulados (quién, motivo)', async () => {
    setApp(ADMIN);
    await render();
    expect(q('cierre-c-anu').textContent).toMatch(/Anulado por Jorge.*Mal cargado/);
    expect(q('cierre-c-vig').textContent).toMatch(/Vigente/);
    expect(q('cierre-c-anu').querySelector('button.btn-danger')).toBeNull();
  });

  it('AC-COM-12 anular exige motivo y llama al servicio', async () => {
    setApp(ADMIN);
    await render();
    await click(q('cierre-c-vig').querySelector('button.btn-danger'));
    const confirmar = boton('Confirmar anulación');
    expect(confirmar.disabled).toBe(true);
    await cambiar(q('cierre-c-vig').querySelector('textarea'), 'Error de %');
    // S-COM-01: también hace falta el PIN
    expect(boton('Confirmar anulación').disabled).toBe(true);
    await cambiar(q('cierre-c-vig').querySelector('input[aria-label="PIN de admin"]'), '4321');
    expect(boton('Confirmar anulación').disabled).toBe(false);
    await click(boton('Confirmar anulación'));
    expect(anularCierre).toHaveBeenCalledWith(expect.objectContaining({ id: 'c-vig' }), 'Error de %', '4321');
    expect(container.textContent).toMatch(/Cierre anulado/);
  });

  it('AC-COM-12 si la anulación falla queda abierto el formulario con el mensaje', async () => {
    anularCierre.mockImplementation(async () => ({ ok: false, mensaje: 'Sin respuesta del servidor' }));
    setApp(ADMIN);
    await render();
    await click(q('cierre-c-vig').querySelector('button.btn-danger'));
    await cambiar(q('cierre-c-vig').querySelector('textarea'), 'Error de %');
    await cambiar(q('cierre-c-vig').querySelector('input[aria-label="PIN de admin"]'), '4321');
    await click(boton('Confirmar anulación'));
    expect(container.textContent).toMatch(/Sin respuesta del servidor/);
    expect(q('cierre-c-vig').querySelector('textarea')).not.toBeNull();
    // el PIN se borra después de cada intento
    expect(q('cierre-c-vig').querySelector('input[aria-label="PIN de admin"]').value).toBe('');
    await click(boton('Volver'));
    expect(q('cierre-c-vig').querySelector('textarea')).toBeNull();
  });

  it('AC-COM-14 el botón PDF genera el PDF del cierre con pdfGen', async () => {
    const file = new Blob(['%PDF'], { type: 'application/pdf' });
    generarCierreComisionesFile.mockImplementation(async () => file);
    const w = { location: { href: '' }, close: jest.fn() };
    const openSpy = jest.spyOn(window, 'open').mockReturnValue(w);
    URL.createObjectURL = jest.fn(() => 'blob:x');
    URL.revokeObjectURL = jest.fn();
    setApp(ADMIN);
    await render();
    await click(q('cierre-c-anu').querySelector('button'));
    await act(async () => { await Promise.resolve(); });
    expect(generarCierreComisionesFile).toHaveBeenCalledWith(expect.objectContaining({ id: 'c-anu', estado: 'anulado' }));
    expect(w.location.href).toBe('blob:x');
    generarCierreComisionesFile.mockImplementation(async () => { throw new Error('jsPDF'); });
    await click(q('cierre-c-vig').querySelector('button'));
    await act(async () => { await Promise.resolve(); });
    expect(w.close).toHaveBeenCalled();
    expect(container.textContent).toMatch(/No se pudo generar el PDF/);
    openSpy.mockRestore();
  });
});

describe('AC-COM-16 S-COM-01 pendientes sin confirmar en el servidor', () => {
  const conPendientes = () => datos({
    cierres: [...CIERRES, { id: 'c-pend', estado: 'pendiente', pendingSync: true, desde: PERIODO.desde, hasta: PERIODO.hasta, cerradoAt: 3, cerradoPor: 'Jorge', totales: {}, lineas: [] }],
  });

  it('AC-COM-16 S-COM-01 sin pendientes no se muestra el aviso', async () => {
    setApp(ADMIN);
    await render();
    expect(q('pendientes-servidor')).toBeNull();
  });

  it('AC-COM-16 S-COM-01 se reintentan con el PIN (que se borra) y se recarga', async () => {
    cargarDatosComisiones.mockImplementation(async () => conPendientes());
    syncComisiones.mockImplementation(async () => ({ ok: true, reintentos: 1, pendientes: 0 }));
    setApp(ADMIN);
    await render();
    const card = q('pendientes-servidor');
    expect(card.textContent).toMatch(/1 cierre/);
    const btn = boton('Reintentar con el servidor');
    expect(btn.disabled).toBe(true);
    await cambiar(card.querySelector('input[aria-label="PIN de admin"]'), '9999');
    expect(boton('Reintentar con el servidor').disabled).toBe(false);
    cargarDatosComisiones.mockClear();
    await click(boton('Reintentar con el servidor'));
    expect(syncComisiones).toHaveBeenCalledWith({ pin: '9999' });
    expect(cargarDatosComisiones).toHaveBeenCalled();
    expect(container.textContent).toMatch(/Pendientes confirmados/);
    expect(q('pendientes-servidor').querySelector('input[aria-label="PIN de admin"]').value).toBe('');
  });

  it('AC-COM-16 S-COM-01 si el servidor rechaza el PIN o falla, se muestra el motivo', async () => {
    cargarDatosComisiones.mockImplementation(async () => conPendientes());
    syncComisiones.mockImplementation(async () => ({ ok: false, motivo: 'pin_incorrecto', mensaje: 'PIN incorrecto (o tu usuario no tiene PIN cargado en el servidor).' }));
    setApp(ADMIN);
    await render();
    await cambiar(q('pendientes-servidor').querySelector('input[aria-label="PIN de admin"]'), '0000');
    await click(boton('Reintentar con el servidor'));
    expect(container.textContent).toMatch(/PIN incorrecto/);
    syncComisiones.mockImplementation(async () => ({ ok: true, pendientes: 1 }));
    await cambiar(q('pendientes-servidor').querySelector('input[aria-label="PIN de admin"]'), '0000');
    await click(boton('Reintentar con el servidor'));
    expect(container.textContent).toMatch(/Quedan operaciones sin confirmar/);
    syncComisiones.mockImplementation(async () => { throw new Error('se cayó'); });
    await cambiar(q('pendientes-servidor').querySelector('input[aria-label="PIN de admin"]'), '0000');
    await click(boton('Reintentar con el servidor'));
    expect(container.textContent).toMatch(/No se pudo reintentar: se cayó/);
  });

  it('AC-COM-16 S-COM-01 sin conexión no deja reintentar', async () => {
    cargarDatosComisiones.mockImplementation(async () => conPendientes());
    setApp(ADMIN, { online: false });
    await render();
    await cambiar(q('pendientes-servidor').querySelector('input[aria-label="PIN de admin"]'), '0000');
    expect(boton('Reintentar con el servidor').disabled).toBe(true);
  });
});

describe('AC-COM-17 confirmar asignación', () => {
  const btnEn = (card, t) => [...card.querySelectorAll('button')].find(b => b.textContent.includes(t));

  it('AC-COM-17 "Confirmar asignación" está deshabilitado mientras la asignación no es válida', async () => {
    setApp(ADMIN);
    await render();
    expect(btnEn(q('asignacion-R4'), 'Confirmar asignación').disabled).toBe(true); // sin elegir
    await cambiar(q('asignacion-R4').querySelector('select'), 'otro');
    expect(btnEn(q('asignacion-R4'), 'Confirmar asignación').disabled).toBe(true); // sin vendedor
    await cambiar(q('asignacion-R3').querySelector('select'), 'dividir');
    await cambiar(q('asignacion-R3').querySelector('input[aria-label="% ficha"]'), '70');
    expect(btnEn(q('asignacion-R3'), 'Confirmar asignación').disabled).toBe(true); // no suma 100
    await cambiar(q('asignacion-R3').querySelector('input[aria-label="% cargador"]'), '30');
    expect(btnEn(q('asignacion-R3'), 'Confirmar asignación').disabled).toBe(false);
  });

  it('AC-COM-17 asignar + confirmar => sale del aviso (b), la tarjeta queda resumida y se guarda en el borrador', async () => {
    setApp(ADMIN);
    await render();
    expect(q('aviso-b')).not.toBeNull();
    await cambiar(q('asignacion-R4').querySelector('select'), 'otro');
    await cambiar(q('asignacion-R4').querySelectorAll('select')[1], 'Lucía');
    expect(q('aviso-b')).not.toBeNull(); // asignar solo no alcanza
    await click(btnEn(q('asignacion-R4'), 'Confirmar asignación'));
    expect(q('aviso-b')).toBeNull();
    expect(q('asignacion-R4').getAttribute('data-confirmada')).toBe('true');
    expect(q('asignacion-resumen-R4').textContent).toBe('Asignado a Lucía ✓');
    expect(q('asignacion-R4').querySelector('select')).toBeNull();
    expect(btnEn(q('asignacion-R4'), 'Editar')).toBeTruthy();
    expect(guardarBorrador).toHaveBeenLastCalledWith(expect.objectContaining({
      id: claveBorrador(PERIODO), asignaciones: { R4: { modo: 'otro', vendedor: 'Lucía', confirmada: true } },
    }));
    // AC-COM-8 sigue igual: con R4 asignado se puede cerrar
    expect(boton('Cerrar comisiones').disabled).toBe(false);
  });

  it('AC-COM-17 confirmar el pedido con aviso (a) lo saca del aviso; resumen de dividido y sin comisión', async () => {
    setApp(ADMIN);
    await render();
    expect(q('aviso-a')).not.toBeNull();
    await cambiar(q('asignacion-R3').querySelector('select'), 'dividir');
    await click(btnEn(q('asignacion-R3'), 'Confirmar asignación'));
    expect(q('aviso-a')).toBeNull();
    expect(q('asignacion-resumen-R3').textContent).toMatch(/^Dividido 50\/50 ✓/);
    await cambiar(q('asignacion-R4').querySelector('select'), 'sin_comision');
    await click(btnEn(q('asignacion-R4'), 'Confirmar asignación'));
    expect(q('asignacion-resumen-R4').textContent).toBe('Sin comisión ✓');
  });

  it('AC-COM-17 Editar + cambiar la asignación => vuelve a pendiente y vuelve el aviso', async () => {
    cargarDatosComisiones.mockImplementation(async () => datos({ borrador: { id: claveBorrador(PERIODO), asignaciones: { R4: { modo: 'otro', vendedor: 'Lucía', confirmada: true } } } }));
    setApp(ADMIN);
    await render();
    expect(q('aviso-b')).toBeNull();
    await click(btnEn(q('asignacion-R4'), 'Editar'));
    expect(q('asignacion-R4').querySelector('select').value).toBe('otro');
    expect(q('aviso-b')).toBeNull(); // abrir el editor no la desconfirma
    await cambiar(q('asignacion-R4').querySelectorAll('select')[1], 'Carlos');
    expect(q('aviso-b')).not.toBeNull();
    expect(q('asignacion-R4').getAttribute('data-confirmada')).toBeNull();
    expect(guardarBorrador).toHaveBeenLastCalledWith(expect.objectContaining({ asignaciones: { R4: { modo: 'otro', vendedor: 'Carlos' } } }));
    await click(btnEn(q('asignacion-R4'), 'Confirmar asignación'));
    expect(q('asignacion-resumen-R4').textContent).toBe('Asignado a Carlos ✓');
    expect(q('aviso-b')).toBeNull();
  });

  it('AC-COM-17 AC-COM-9 al recargar la pantalla la confirmación se mantiene', async () => {
    setApp(ADMIN);
    await render();
    await cambiar(q('asignacion-R4').querySelector('select'), 'sin_comision');
    await click(btnEn(q('asignacion-R4'), 'Confirmar asignación'));
    const guardado = guardarBorrador.mock.calls[guardarBorrador.mock.calls.length - 1][0];
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    cargarDatosComisiones.mockImplementation(async () => datos({ borrador: JSON.parse(JSON.stringify(guardado)) }));
    await render();
    expect(q('asignacion-resumen-R4').textContent).toBe('Sin comisión ✓');
    expect(q('aviso-b')).toBeNull();
    expect(q('aviso-a')).not.toBeNull(); // R3 no se confirmó
  });

  it('AC-COM-17 un borrador viejo sin la marca se muestra pendiente, con el selector', async () => {
    cargarDatosComisiones.mockImplementation(async () => datos({ borrador: { id: claveBorrador(PERIODO), asignaciones: { R4: { modo: 'sin_comision' } } } }));
    setApp(ADMIN);
    await render();
    expect(q('asignacion-R4').querySelector('select').value).toBe('sin_comision');
    expect(q('aviso-b')).not.toBeNull();
  });
});
