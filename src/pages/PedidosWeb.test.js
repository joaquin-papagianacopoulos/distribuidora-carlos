// REQ-WEB UI: bandeja "Pedidos web" (AC-WEB-1..5).
import React from 'react';
import { montar, flush, click, escribir, porTexto } from '../testUtils/ui';

const mockApp = {};
jest.mock('../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../db', () => ({ addCliente: jest.fn() }));
jest.mock('../services/pedidosWebService', () => ({
  encolarAccion: jest.fn(),
  sincronizarAcciones: jest.fn(),
  cargarAcciones: jest.fn(),
  hayPinEnMemoria: jest.fn(),
  cargarContactos: jest.fn(),
}));

import { addCliente } from '../db';
import { encolarAccion, sincronizarAcciones, cargarAcciones, hayPinEnMemoria, cargarContactos } from '../services/pedidosWebService';
import PedidosWeb from './PedidosWeb';

const ITEM = { productoId: 1, nombre: 'Dos Corazones', cantidad: 48, precio: 900, subtotal: 43200, bultos: 3, bultoX: 16, bultoNombre: 'Display' };
const PEDIDO = {
  id: 1, remoteId: 50, origen: 'web', webEstado: 'por_revisar', fecha: '2026-10-14', vendedor: '', clienteNombre: 'Kiosco El Sol', total: 43200,
  webContacto: { nombre: 'Kiosco El Sol', telefono: '341 555 1234', direccion: 'Calle 1', ciudad: 'Rosario', cp: '2000', provincia: 'Santa Fe', cuit: '20-12345678-6', observaciones: 'Tocar timbre' },
  items: [ITEM],
};
const CLIENTES = [
  { id: 7, nombre: 'Kiosco El Sol', cuit: '20-12345678-6', telefono: '3415551234', vendedor: 'Juan', zona: 'Z1' },
  { id: 8, nombre: 'Otro Cliente', cuit: '', telefono: '1111111111', vendedor: '' },
];
const PRODUCTOS = [{ id: 1, nombre: 'Dos Corazones', precio: 900, ventaPor: 'bulto', bultoX: 16, bultoNombre: 'Display' }];
const VENDEDORES = [{ id: 1, nombre: 'Juan', permiso: 2, activo: true }, { id: 2, nombre: 'Ana', permiso: 2, activo: true }];

let m;
const abrir = async (extra = {}) => {
  Object.assign(mockApp, {
    pedidos: [PEDIDO, { ...PEDIDO, id: 2, remoteId: 51, webEstado: 'aceptado', webRevisadoPor: 'Jorge', webRevisadoAt: 1760000000000, clienteNombre: 'Kiosco El Sol' },
      { ...PEDIDO, id: 3, remoteId: 52, webEstado: 'rechazado', webRevisadoPor: 'Jorge', webRevisadoAt: 1760000000000, webMotivoRechazo: 'Fuera de zona' },
      { id: 4, estado: 'pendiente', fecha: '2026-10-14', clienteNombre: 'Interno', items: [], total: 1 }],
    clientes: CLIENTES, vendedores: VENDEDORES, productos: PRODUCTOS, online: true,
    vendedorActual: { id: 1, nombre: 'Jorge', permiso: 1 }, recargar: jest.fn(async () => undefined), ...extra,
  });
  m = await montar(<PedidosWeb />);
  await flush();
};
const abrirDetalle = async () => { await click(m.cont.querySelector('[data-testid="pedido-web"]')); };

beforeEach(() => {
  cargarAcciones.mockResolvedValue([]);
  encolarAccion.mockResolvedValue({ ok: true, accion: { id: 'acc-1' } });
  sincronizarAcciones.mockResolvedValue({ ok: true });
  hayPinEnMemoria.mockReturnValue(false);
  cargarContactos.mockResolvedValue({ ok: true, count: 0 });
  addCliente.mockResolvedValue(99);
});
afterEach(async () => { if (m) { await m.desmontar(); m = null; } });

describe('bandeja Pedidos web', () => {
  it('AC-WEB-3 S-WEB-01 si la RPC de contactos falla, el detalle muestra un mensaje claro y ningun dato de contacto', async () => {
    cargarContactos.mockResolvedValue({ ok: false, motivo: 'red', mensaje: 'No se pudieron traer los datos de contacto.' });
    await abrir({ pedidos: [{ ...PEDIDO, webContacto: null }] });
    await abrirDetalle();
    const t = m.cont.textContent;
    expect(m.cont.querySelector('[data-testid="contacto-no-disponible"]').textContent).toContain('No se pudieron traer');
    expect(t).not.toContain('341 555 1234');
    expect(t).not.toContain('Calle 1');
    expect(m.cont.querySelectorAll('[data-testid="renglon-web"]').length).toBe(1);
  });

  it('AC-WEB-3 S-WEB-01 sin PIN en memoria: "Datos de contacto no disponibles", sin datos, con renglones y total', async () => {
    cargarContactos.mockResolvedValue({ ok: false, motivo: 'sin_pin' });
    await abrir({ pedidos: [{ ...PEDIDO, webContacto: null }] });
    await abrirDetalle();
    expect(cargarContactos).toHaveBeenCalled();
    expect(m.cont.querySelector('[data-testid="contacto-no-disponible"]').textContent).toContain('Datos de contacto no disponibles');
    const t = m.cont.textContent;
    expect(t).not.toContain('Calle 1');
    expect(t).not.toContain('20-12345678-6');
    expect(t).not.toContain('Tocar timbre');
    expect(m.cont.querySelectorAll('[data-testid="renglon-web"]').length).toBe(1);
    expect(m.cont.querySelector('[data-testid="total-web"]').textContent).toContain('43.200');
  });

  it('AC-WEB-2 AC-WEB-3 S-WEB-01 con PIN válido se traen los contactos y se precarga el cliente nuevo', async () => {
    const recargar = jest.fn(async () => { mockApp.pedidos = [PEDIDO]; });
    cargarContactos.mockImplementation(async ({ pin } = {}) => (pin === '1234' ? { ok: true, count: 1 } : { ok: false, motivo: 'sin_pin', mensaje: 'Falta el PIN.' }));
    await abrir({ pedidos: [{ ...PEDIDO, webContacto: null }], recargar });
    await abrirDetalle();
    expect(m.cont.querySelector('[data-testid="contacto-no-disponible"]')).toBeTruthy();
    await escribir(m.cont.querySelector('[data-testid="pin-web"]'), '1234');
    await click(m.cont.querySelector('[data-testid="traer-contactos"]'));
    await flush();
    expect(cargarContactos).toHaveBeenLastCalledWith({ pin: '1234' });
    expect(recargar).toHaveBeenCalled();
    expect(m.cont.querySelector('[data-testid="contacto-no-disponible"]')).toBeNull();
    const c = m.cont.querySelector('[data-testid="contacto-web"]').textContent;
    expect(c).toContain('Calle 1, Rosario');
    expect(c).toContain('CUIT 20-12345678-6');
    await click(m.cont.querySelector('[data-testid="crear-cliente"]'));
    const valores = Array.from(m.cont.querySelector('[data-testid="cliente-form"]').querySelectorAll('input, select')).map(i => i.value);
    expect(valores).toContain('Calle 1');
    expect(valores).toContain('3415551234');
  });

  it('AC-WEB-1 muestra el contador de por revisar y solo lista pedidos web (no los internos)', async () => {
    await abrir();
    expect(m.cont.querySelector('[data-testid="contador-web"]').textContent).toBe('(1)');
    expect(m.cont.querySelectorAll('[data-testid="pedido-web"]').length).toBe(1);
    expect(m.cont.textContent).not.toContain('Interno');
  });

  it('AC-WEB-5 historial filtrable: por revisar / aceptados / rechazados / todos', async () => {
    await abrir();
    await click(m.cont.querySelector('[data-testid="filtro-aceptado"]'));
    expect(m.cont.querySelectorAll('[data-testid="pedido-web"]').length).toBe(1);
    expect(m.cont.textContent).toContain('Aceptado');
    await click(m.cont.querySelector('[data-testid="filtro-rechazado"]'));
    expect(m.cont.textContent).toContain('Rechazado');
    await click(m.cont.querySelector('[data-testid="filtro-todos"]'));
    expect(m.cont.querySelectorAll('[data-testid="pedido-web"]').length).toBe(3);
  });

  it('AC-WEB-2 detalle: contacto, fecha, vendedor del link, renglones con bultos y total', async () => {
    await abrir();
    await abrirDetalle();
    const c = m.cont.querySelector('[data-testid="contacto-web"]').textContent;
    expect(c).toContain('Fecha 2026-10-14');
    expect(c).toContain('sin vendedor (link general)');
    expect(c).toContain('Calle 1, Rosario');
    expect(c).toContain('CUIT 20-12345678-6');
    expect(c).toContain('Tocar timbre');
    expect(m.cont.querySelector('[data-testid="renglon-web"]').textContent).toContain('3 Display (48 u.)');
    expect(m.cont.querySelector('[data-testid="total-web"]').textContent).toContain('43.200');
  });

  it('AC-WEB-2 editar renglones: aviso de múltiplo sin bloquear al admin y total recalculado', async () => {
    await abrir();
    await abrirDetalle();
    await escribir(m.cont.querySelector('input[aria-label="Cantidad de Dos Corazones"]'), '20');
    expect(m.cont.querySelector('[data-testid="aviso-multiplo"]').textContent).toContain('no es múltiplo de 16');
    expect(m.cont.querySelector('[data-testid="total-web"]').textContent).toContain('18.000');
    await click(porTexto(m.cont, 'button', 'Vincular'));
    await click(m.cont.querySelector('[data-testid="aceptar-web"]'));
    await flush();
    expect(encolarAccion).toHaveBeenCalledTimes(1);
    expect(encolarAccion.mock.calls[0][2].items[0].cantidad).toBe(20);
    expect(encolarAccion.mock.calls[0][2].total).toBe(18000);
  });

  it('AC-WEB-3 sugiere clientes por CUIT/teléfono/nombre, el mejor primero', async () => {
    await abrir();
    await abrirDetalle();
    const sug = m.cont.querySelectorAll('[data-testid="sugerencia"]');
    expect(sug.length).toBe(1);
    expect(sug[0].textContent).toContain('Kiosco El Sol');
    expect(sug[0].textContent).toContain('CUIT');
  });

  it('AC-WEB-3 crear cliente nuevo con el formulario precargado con los datos del pedido', async () => {
    await abrir();
    await abrirDetalle();
    await click(m.cont.querySelector('[data-testid="crear-cliente"]'));
    const form = m.cont.querySelector('[data-testid="cliente-form"]');
    expect(form).toBeTruthy();
    const valores = Array.from(form.querySelectorAll('input, select')).map(i => i.value);
    expect(valores).toContain('Kiosco El Sol');
    expect(valores).toContain('Calle 1');
    expect(valores).toContain('Rosario');
    expect(valores).toContain('3415551234');
    await click(porTexto(form, 'button', 'Guardar'));
    await flush();
    expect(addCliente).toHaveBeenCalledTimes(1);
    expect(addCliente.mock.calls[0][0]).toMatchObject({ nombre: 'Kiosco El Sol', direccion: 'Calle 1', ciudad: 'Rosario', extrasDirty: true });
    expect(addCliente.mock.calls[0][0].codigo).toBeTruthy();
  });

  it('AC-WEB-4 aceptar: usa el vendedor de la ficha cuando el link no trae, encola y sube', async () => {
    await abrir();
    await abrirDetalle();
    await click(porTexto(m.cont, 'button', 'Vincular'));
    expect(m.cont.querySelector('[data-testid="cliente-vinculado"]').textContent).toContain('zona Z1');
    await click(m.cont.querySelector('[data-testid="aceptar-web"]'));
    await flush();
    const [pedido, tipo, datos] = encolarAccion.mock.calls[0];
    expect(pedido.remoteId).toBe(50);
    expect(tipo).toBe('aceptar');
    expect(datos).toMatchObject({ clienteId: 7, clienteNombre: 'Kiosco El Sol', zona: 'Z1', vendedor: 'Juan', total: 43200 });
    expect(sincronizarAcciones).toHaveBeenCalledTimes(1);
  });

  it('AC-WEB-4 sin vendedor en el link ni en la ficha, el admin lo elige antes de aceptar', async () => {
    await abrir();
    await abrirDetalle();
    await escribir(m.cont.querySelector('select[aria-label="Elegir otro cliente"]'), '8');
    expect(m.cont.querySelector('select[aria-label="Vendedor"]')).toBeTruthy();
    expect(m.cont.querySelector('[data-testid="aceptar-web"]').disabled).toBe(true);
    await escribir(m.cont.querySelector('select[aria-label="Vendedor"]'), 'Ana');
    expect(m.cont.querySelector('[data-testid="aceptar-web"]').disabled).toBe(false);
    await click(m.cont.querySelector('[data-testid="aceptar-web"]'));
    await flush();
    expect(encolarAccion.mock.calls[0][2]).toMatchObject({ clienteId: 8, vendedor: 'Ana' });
  });

  it('AC-WEB-4 el vendedor del link tiene prioridad sobre la ficha', async () => {
    mockApp.pedidos = null;
    await abrir();
    mockApp.pedidos = [{ ...PEDIDO, vendedor: 'Ana' }];
    await m.desmontar();
    m = await montar(<PedidosWeb />);
    await flush();
    await abrirDetalle();
    await click(porTexto(m.cont, 'button', 'Vincular'));
    await click(m.cont.querySelector('[data-testid="aceptar-web"]'));
    await flush();
    expect(encolarAccion.mock.calls[0][2].vendedor).toBe('Ana');
  });

  it('AC-WEB-5 rechazar exige motivo; con motivo queda encolado y no se borra', async () => {
    await abrir();
    await abrirDetalle();
    await click(m.cont.querySelector('[data-testid="rechazar-web"]'));
    await click(m.cont.querySelector('[data-testid="confirmar-rechazo"]'));
    expect(m.cont.querySelector('[data-testid="error-web"]').textContent).toMatch(/motivo/i);
    expect(encolarAccion).not.toHaveBeenCalled();
    await escribir(m.cont.querySelector('[data-testid="motivo-rechazo"]'), 'Fuera de la zona de reparto');
    await click(m.cont.querySelector('[data-testid="confirmar-rechazo"]'));
    await flush();
    expect(encolarAccion.mock.calls[0][1]).toBe('rechazar');
    expect(encolarAccion.mock.calls[0][2]).toEqual({ motivo: 'Fuera de la zona de reparto' });
  });

  it('AC-WEB-5 los aceptados y rechazados muestran quién, cuándo y el motivo', async () => {
    await abrir();
    await click(m.cont.querySelector('[data-testid="filtro-rechazado"]'));
    await abrirDetalle();
    expect(m.cont.querySelector('[data-testid="info-rechazado"]').textContent).toContain('Jorge');
    expect(m.cont.querySelector('[data-testid="info-rechazado"]').textContent).toContain('Fuera de zona');
    await click(m.cont.querySelector('[data-testid="filtro-aceptado"]'));
    await abrirDetalle();
    expect(m.cont.querySelector('[data-testid="info-aceptado"]').textContent).toContain('Aceptado por Jorge');
  });

  it('AC-WEB-6 acción sin subir: el pedido queda "pendiente de subir" y se ofrece subir con el PIN', async () => {
    cargarAcciones.mockResolvedValue([{ id: 'a1', pedidoRemoteId: 50, tipo: 'rechazar', pendingSync: true, resultado: null }]);
    await abrir();
    expect(m.cont.textContent).toContain('Pendiente de subir');
    expect(m.cont.querySelector('[data-testid="subir-web"]')).toBeTruthy();
    await escribir(m.cont.querySelector('[data-testid="pin-web"]'), '1234');
    await click(m.cont.querySelector('[data-testid="subir-web"]'));
    await flush();
    expect(sincronizarAcciones).toHaveBeenCalledWith({ pin: '1234' });
  });

  it('AC-WEB-6 si otro admin ya lo resolvió, se avisa quién y no se aplica nuestra acción', async () => {
    cargarAcciones.mockResolvedValue([{ id: 'a1', pedidoRemoteId: 50, tipo: 'aceptar', pendingSync: false, resultado: 'ya_resuelto', detalle: { revisadoPor: 'Maria', estado: 'aceptado' } }]);
    await abrir();
    await abrirDetalle();
    expect(m.cont.querySelector('[data-testid="ya-resuelto"]').textContent).toContain('Maria');
  });

  it('AC-WEB-1 un no admin no ve la bandeja', async () => {
    await abrir({ vendedorActual: { id: 2, nombre: 'Juan', permiso: 2 } });
    expect(m.cont.textContent).toContain('Solo el admin');
    expect(m.cont.querySelector('[data-testid="pedido-web"]')).toBeNull();
  });

  it('AC-WEB-8 la fecha arranca en la del pedido; si se cambia viaja al aceptar y se avisa que no es hoy', async () => {
    await abrir();
    await abrirDetalle();
    const input = m.cont.querySelector('[data-testid="fecha-web"]');
    expect(input.value).toBe('2026-10-14');
    await click(porTexto(m.cont, 'button', 'Vincular'));
    // Sin tocar la fecha no se manda (el servidor deja la que tenía).
    await click(m.cont.querySelector('[data-testid="aceptar-web"]'));
    await flush();
    expect(encolarAccion.mock.calls[0][2].fecha).toBeNull();
    const hoy = new Date();
    const manana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1);
    const iso = `${manana.getFullYear()}-${String(manana.getMonth() + 1).padStart(2, '0')}-${String(manana.getDate()).padStart(2, '0')}`;
    await escribir(m.cont.querySelector('[data-testid="fecha-web"]'), iso);
    expect(m.cont.querySelector('[data-testid="aviso-fecha-web"]').textContent).toContain(iso.split('-').reverse().join('/'));
    await click(m.cont.querySelector('[data-testid="aceptar-web"]'));
    await flush();
    expect(encolarAccion.mock.calls[1][2].fecha).toBe(iso);
  });

  it('AC-WEB-8 una fecha fuera de rango no se acepta (error claro, no se encola)', async () => {
    await abrir();
    await abrirDetalle();
    await click(porTexto(m.cont, 'button', 'Vincular'));
    await escribir(m.cont.querySelector('[data-testid="fecha-web"]'), '2020-01-01');
    await click(m.cont.querySelector('[data-testid="aceptar-web"]'));
    await flush();
    expect(encolarAccion).not.toHaveBeenCalled();
    expect(m.cont.querySelector('[data-testid="error-web"]').textContent).toMatch(/más de 60 días/);
  });
});
