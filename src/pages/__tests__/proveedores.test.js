// REQ-CPR (AC-CPR-1..5): pantalla Proveedores (cuenta corriente, comprobantes, pedidos al proveedor).
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));
jest.mock('../../services/comprasLocalService', () => ({
  guardarMovimientoCuenta: jest.fn(),
  anularMovimientoCuenta: jest.fn(),
  guardarPedidoProveedor: jest.fn(),
  marcarPedidoEnviado: jest.fn(),
  recibirPedidoProveedor: jest.fn(),
}));
jest.mock('../../services/comprasService', () => ({
  verComprobante: jest.fn(),
  verComprobanteLocal: jest.fn(),
  contarComprasPendientes: jest.fn(),
  subirCompras: jest.fn(),
  subirComprobantes: jest.fn(),
  bajarCompras: jest.fn(),
  sondearMigracion012: jest.fn(),
}));
jest.mock('../../services/productosAdminService', () => ({ credencialesAdminProductos: jest.fn() }));
jest.mock('../../db', () => ({ getComprobantesPendientes: jest.fn() }));
jest.mock('../../utils/pdfGen', () => ({ generarEstadoCuentaFile: jest.fn(), generarPedidoProveedorFile: jest.fn() }));
jest.mock('../../utils/descargarArchivo', () => ({ descargarArchivo: jest.fn() }));

import Proveedores from '../Proveedores';
import * as local from '../../services/comprasLocalService';
import * as remoto from '../../services/comprasService';
import { credencialesAdminProductos } from '../../services/productosAdminService';
import { getComprobantesPendientes } from '../../db';
import { generarEstadoCuentaFile } from '../../utils/pdfGen';
import { descargarArchivo } from '../../utils/descargarArchivo';

let container;
let root;

const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const boton = (txt) => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === txt);
const setValue = async (el, value) => {
  const isSelect = el.tagName === 'SELECT';
  const proto = isSelect ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event(isSelect ? 'change' : 'input', { bubbles: true }));
  });
};
const porLabel = (txt) => container.querySelector(`[aria-label="${txt}"]`);

const PROVEEDORES = [{ id: 'p1', codigo: 'ARC', descripcion: 'Arcor' }, { id: 'p2', codigo: 'UNI', descripcion: 'Unilever' }];
const PRODUCTOS = [
  { id: 1, codigo: 'DET-1', nombre: 'Detergente', proveedorId: 'p1', minimoVenta: 4, bultoX: 12 },
  { id: 2, codigo: 'JAB-2', nombre: 'Jabón', proveedorId: 'p1', minimoVenta: 2 },
  { id: 3, codigo: 'ALF-3', nombre: 'Alfajor', proveedorId: 'p2', minimoVenta: 1 },
];
// Compra de 100,00 a p1 (10 u. x $10) y 5,00 a p2.
const COSTOS = [
  { id: 'i1', proveedorId: 'p1', fecha: '2026-10-01T15:00:00.000Z', tipoCabecera: 'A', renglones: [{ productoId: '1', costoUnitario: 10, tipoFactura: 'A', unidades: 10 }] },
  { id: 'i2', proveedorId: 'p2', fecha: '2026-10-02T15:00:00.000Z', tipoCabecera: 'B', renglones: [{ productoId: '3', costoUnitario: 5, tipoFactura: 'B', unidades: 1 }] },
];
const CUENTA = [
  { id: 'm1', proveedorId: 'p1', tipo: 'pago', fecha: '2026-10-05', montoCentavos: 3000, medio: 'efectivo', referencia: 'recibo 1', creadoAt: 2, updatedAt: 2, anulado: null, comprobantePath: null },
  { id: 'm2', proveedorId: 'p1', tipo: 'pago', fecha: '2026-10-06', montoCentavos: 2000, medio: 'transferencia', referencia: '', creadoAt: 3, updatedAt: 3, anulado: null, comprobantePath: 'pagos/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.pdf' },
  { id: 'm3', proveedorId: 'p1', tipo: 'pago', fecha: '2026-10-07', montoCentavos: 1000, medio: 'directa', referencia: 'error', creadoAt: 4, updatedAt: 4, anulado: { motivo: 'duplicado', usuario: 'ana', at: 'z' }, comprobantePath: null },
];

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockApp, {
    vendedorActual: { id: 1, nombre: 'Admin', permiso: 1 },
    proveedores: PROVEEDORES, clientes: [{ id: 'c1', nombre: 'Kiosco Pepe' }], productos: PRODUCTOS,
    stockMap: new Map([['1', 1], ['2', 50], ['3', 50]]),
    ingresosCostos: COSTOS, cuentaProveedores: CUENTA, pedidosProveedor: [],
    recargar: jest.fn(() => Promise.resolve()),
  });
  getComprobantesPendientes.mockResolvedValue([]);
  remoto.contarComprasPendientes.mockResolvedValue({ total: 2 });
  remoto.sondearMigracion012.mockResolvedValue({ faltaMigracion: false });
  local.guardarMovimientoCuenta.mockResolvedValue({ ok: true });
  local.anularMovimientoCuenta.mockResolvedValue({ ok: true });
  local.guardarPedidoProveedor.mockResolvedValue({ ok: true });
  generarEstadoCuentaFile.mockResolvedValue({ name: 'estado.pdf' });
  window.open = jest.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => { act(() => { root.unmount(); }); container.remove(); });

const render = async (props = {}) => { await act(async () => { root.render(<Proveedores {...props} />); }); await flush(); };
const abrirProveedor = async (nombre = 'Arcor') => {
  const fila = [...container.querySelectorAll('[data-testid="fila-proveedor"]')].find(f => f.textContent.includes(nombre));
  await click(fila);
};

describe('AC-SEC-4 solo admin', () => {
  it.each([[2], [3], [undefined]])('rol %s no ve la pantalla ni la cuenta', async (permiso) => {
    mockApp.vendedorActual = { id: 9, nombre: 'X', permiso };
    await render();
    expect(container.textContent).toContain('solo para administradores');
    expect(container.querySelectorAll('[data-testid="fila-proveedor"]')).toHaveLength(0);
    expect(container.querySelector('[data-testid="compras-sync"]')).toBeNull();
  });
});

describe('AC-CPR-1 saldo por proveedor', () => {
  it('AC-CPR-1 la lista muestra compras (ingresos con costo) - pagos, sin anulados', async () => {
    await render();
    const filas = [...container.querySelectorAll('[data-testid="fila-proveedor"]')].map(f => f.textContent);
    expect(filas[0]).toContain('Arcor');
    expect(filas[0]).toContain('$50,00'); // 100 - 30 - 20 (el anulado de 10 no cuenta)
    expect(filas[1]).toContain('$5,00');
  });
  it('AC-CPR-1 saldo negativo = a favor', async () => {
    mockApp.cuentaProveedores = [...CUENTA, { id: 'm9', proveedorId: 'p2', tipo: 'pago', fecha: '2026-10-08', montoCentavos: 2000, medio: 'efectivo', creadoAt: 9, updatedAt: 9, anulado: null }];
    await render();
    await abrirProveedor('Unilever');
    expect(container.querySelector('[data-testid="saldo-proveedor"]').textContent).toBe('-$15,00');
    expect(container.textContent).toContain('Saldo a favor');
  });
  it('AC-CPR-1 sin proveedores pide cargarlos', async () => {
    mockApp.proveedores = [];
    await render();
    expect(container.textContent).toContain('Primero cargá al menos un proveedor');
  });
});

describe('AC-CPR-3 / AC-CPR-5 cuenta corriente', () => {
  it('AC-CPR-3 movimientos en orden con saldo acumulado, anulados marcados y totales por medio', async () => {
    await render();
    await abrirProveedor();
    const filas = [...container.querySelectorAll('[data-testid="fila-cuenta"]')];
    expect(filas).toHaveLength(4);
    expect(filas[0].textContent).toContain('Compra (ingreso)');
    expect(filas[0].textContent).toContain('$100,00');
    expect(filas[1].textContent).toContain('-$30,00');
    expect(filas[1].textContent).toContain('$70,00');
    expect(filas[3].textContent).toContain('ANULADO (duplicado, ana)');
    const t = container.querySelector('[data-testid="totales-medio"]').textContent;
    expect(t).toContain('efectivo: $30,00');
    expect(t).toContain('transferencia: $20,00');
    expect(t).toContain('Total pagado: $50,00 · 1 anulado(s)');
  });
  it('AC-CPR-3 filtra por medio y por fechas', async () => {
    await render();
    await abrirProveedor();
    await setValue(porLabel('Filtrar por medio'), 'transferencia');
    expect([...container.querySelectorAll('[data-testid="fila-cuenta"]')]).toHaveLength(1);
    await setValue(porLabel('Filtrar por medio'), '');
    await setValue(porLabel('Cuenta desde'), '2026-10-06');
    expect([...container.querySelectorAll('[data-testid="fila-cuenta"]')]).toHaveLength(2);
    expect(container.textContent).toContain('Saldo inicial: $70,00');
  });
  it('AC-CPR-3 baja el PDF del estado de cuenta', async () => {
    await render();
    await abrirProveedor();
    await click(boton('Estado de cuenta (PDF)'));
    expect(generarEstadoCuentaFile).toHaveBeenCalledTimes(1);
    expect(generarEstadoCuentaFile.mock.calls[0][1]).toMatchObject({ proveedor: 'Arcor' });
    expect(descargarArchivo).toHaveBeenCalled();
  });
  it('AC-CPR-5 anular exige motivo y llama al servicio; no hay botón en anulados ni compras', async () => {
    await render();
    await abrirProveedor();
    expect(container.querySelectorAll('[data-testid="fila-cuenta"]')[0].textContent).not.toContain('Anular');
    expect(container.querySelectorAll('[data-testid="fila-cuenta"]')[3].textContent).not.toContain('Anular');
    await click([...container.querySelectorAll('[data-testid="fila-cuenta"]')[1].querySelectorAll('button')].find(b => b.textContent === 'Anular'));
    await setValue(porLabel('Motivo de la anulación'), '  se cargó dos veces ');
    await click(boton('Confirmar anulación'));
    expect(local.anularMovimientoCuenta).toHaveBeenCalledWith('m1', { motivo: '  se cargó dos veces ', usuario: 'Admin' });
    expect(container.textContent).toContain('Movimiento anulado');
    expect(mockApp.recargar).toHaveBeenCalled();
  });
  it('AC-CPR-5 sin motivo el servicio rechaza y se muestra el error', async () => {
    local.anularMovimientoCuenta.mockResolvedValueOnce({ ok: false, error: 'Escribí el motivo de la anulación' });
    await render();
    await abrirProveedor();
    await click([...container.querySelectorAll('[data-testid="fila-cuenta"]')[1].querySelectorAll('button')].find(b => b.textContent === 'Anular'));
    await click(boton('Confirmar anulación'));
    expect(container.textContent).toContain('Escribí el motivo de la anulación');
  });
});

describe('AC-CPR-2 cargar pagos y cargos', () => {
  const irAPago = async () => { await render(); await abrirProveedor(); await click(boton('Cargar pago')); };

  it('AC-CPR-2 pago válido: arma el movimiento en centavos y lo guarda local', async () => {
    await irAPago();
    await setValue(container.querySelector('#mov-fecha'), '2026-10-14');
    await setValue(container.querySelector('#mov-monto'), '1.234,56');
    await setValue(container.querySelector('#mov-medio'), 'transferencia');
    await setValue(container.querySelector('#mov-ref'), 'comprobante 77');
    await click(boton('Guardar'));
    expect(local.guardarMovimientoCuenta).toHaveBeenCalledTimes(1);
    const [mov, archivo] = local.guardarMovimientoCuenta.mock.calls[0];
    expect(mov).toMatchObject({ proveedorId: 'p1', tipo: 'pago', fecha: '2026-10-14', montoCentavos: 123456, medio: 'transferencia', referencia: 'comprobante 77', usuario: 'Admin', pendingSync: true });
    expect(archivo).toBeNull();
    expect(container.querySelector('[data-testid="form-movimiento"]')).toBeNull();
    expect(mockApp.recargar).toHaveBeenCalled();
  });
  it('AC-CPR-2 monto 0 o vacío muestra error y no guarda', async () => {
    await irAPago();
    await click(boton('Guardar'));
    expect(container.querySelector('[role="alert"]').textContent).toContain('mayor a 0');
    expect(local.guardarMovimientoCuenta).not.toHaveBeenCalled();
  });
  it('AC-CPR-2 "directa" pide cliente y pedido opcionales; con otro medio no aparecen', async () => {
    await irAPago();
    expect(container.querySelector('#mov-cliente')).toBeNull();
    await setValue(container.querySelector('#mov-medio'), 'directa');
    expect(container.querySelector('#mov-cliente')).not.toBeNull();
    await setValue(container.querySelector('#mov-monto'), '50');
    await setValue(container.querySelector('#mov-cliente'), 'c1');
    await setValue(container.querySelector('#mov-pedido'), '88');
    await click(boton('Guardar'));
    expect(local.guardarMovimientoCuenta.mock.calls[0][0]).toMatchObject({ medio: 'directa', clienteId: 'c1', pedidoId: '88', montoCentavos: 5000 });
  });
  it('AC-CPR-2 un adjunto rechazado por el servicio local se muestra y el formulario sigue abierto', async () => {
    local.guardarMovimientoCuenta.mockResolvedValueOnce({ ok: false, mensaje: 'El archivo supera los 5 MB' });
    await irAPago();
    await setValue(container.querySelector('#mov-monto'), '10');
    await click(boton('Guardar'));
    expect(container.textContent).toContain('El archivo supera los 5 MB');
    expect(container.querySelector('[data-testid="form-movimiento"]')).not.toBeNull();
  });
  it('AC-CPR-1 un cargo manual no pide medio ni adjunto', async () => {
    await render();
    await abrirProveedor();
    await click(boton('Cargar cargo'));
    expect(container.querySelector('#mov-medio')).toBeNull();
    expect(container.querySelector('#mov-archivo')).toBeNull();
    await setValue(container.querySelector('#mov-monto'), '200');
    await click(boton('Guardar'));
    expect(local.guardarMovimientoCuenta.mock.calls[0][0]).toMatchObject({ tipo: 'cargo', medio: null, montoCentavos: 20000 });
  });
});

describe('AC-CPR-2 comprobantes', () => {
  it('AC-CPR-2 ver un comprobante subido pide el PIN, habilita la lectura y lo abre', async () => {
    credencialesAdminProductos.mockResolvedValue({ ok: true, cred: { p_admin_id: '1', p_admin_pin: '1234' } });
    remoto.verComprobante.mockResolvedValue({ ok: true, url: 'blob:x' });
    global.URL.revokeObjectURL = jest.fn();
    await render();
    await abrirProveedor();
    await click(boton('Ver comprobante'));
    await setValue(porLabel('PIN para ver el comprobante'), '1234');
    await click(boton('Abrir'));
    expect(credencialesAdminProductos).toHaveBeenCalledWith('1234');
    expect(remoto.verComprobante).toHaveBeenCalledWith({ p_admin_id: '1', p_admin_pin: '1234' }, CUENTA[1].comprobantePath);
    expect(window.open).toHaveBeenCalledWith('blob:x', '_blank', 'noopener');
    expect(porLabel('PIN para ver el comprobante')).toBeNull();
  });
  it('AC-CPR-2 sin PIN no descarga nada', async () => {
    credencialesAdminProductos.mockResolvedValue({ ok: false, mensaje: 'Ingresá tu PIN' });
    await render();
    await abrirProveedor();
    await click(boton('Ver comprobante'));
    await click(boton('Abrir'));
    expect(remoto.verComprobante).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Ingresá tu PIN');
  });
  it('AC-CPR-2 un adjunto todavía sin subir se ve desde el dispositivo', async () => {
    getComprobantesPendientes.mockResolvedValue([{ id: 'm1' }]);
    remoto.verComprobanteLocal.mockResolvedValue({ ok: true, url: 'blob:local' });
    global.URL.revokeObjectURL = jest.fn();
    await render();
    await abrirProveedor();
    await click(boton('Ver comprobante (sin subir)'));
    expect(remoto.verComprobanteLocal).toHaveBeenCalledWith('m1');
    expect(window.open).toHaveBeenCalledWith('blob:local', '_blank', 'noopener');
  });
});

describe('AC-CPR-4 pedidos al proveedor', () => {
  const irAPedidos = async () => { await render(); await abrirProveedor(); await click(boton('Pedidos')); };
  const pedidoBase = (extra = {}) => ({ id: 'ped-1', proveedorId: 'p1', estado: 'borrador', items: [{ productoId: '1', cantidad: 2, unidad: 'bulto', bultoX: 12 }], ingresoId: null, usuario: 'Admin', creadoAt: 1, updatedAt: 5, pendingSync: true, ...extra });

  it('AC-CPR-4 nuevo pedido: se guarda como borrador y se abre el editor', async () => {
    await irAPedidos();
    await click(boton('Nuevo pedido al proveedor'));
    expect(local.guardarPedidoProveedor).toHaveBeenCalledTimes(1);
    expect(local.guardarPedidoProveedor.mock.calls[0][0]).toMatchObject({ proveedorId: 'p1', estado: 'borrador', items: [], usuario: 'Admin' });
  });
  it('AC-CPR-4 lista los pedidos del proveedor con su estado', async () => {
    mockApp.pedidosProveedor = [pedidoBase(), pedidoBase({ id: 'x', proveedorId: 'p2' })];
    await irAPedidos();
    const filas = [...container.querySelectorAll('[data-testid="pedido-proveedor"]')];
    expect(filas).toHaveLength(1);
    expect(filas[0].textContent).toContain('Borrador · 1 producto(s)');
  });
  it('AC-CPR-4 editor: muestra unidades de los bultos, cambia cantidad y quita renglones', async () => {
    mockApp.pedidosProveedor = [pedidoBase()];
    await irAPedidos();
    await click(container.querySelector('[data-testid="pedido-proveedor"]'));
    const r = container.querySelector('[data-testid="renglon-pedido-proveedor"]');
    expect(r.textContent).toContain('24 u.');
    await setValue(porLabel('Cantidad Detergente'), '3');
    expect(local.guardarPedidoProveedor.mock.calls[0][0].items[0]).toMatchObject({ productoId: '1', cantidad: 3, unidad: 'bulto' });
    await setValue(porLabel('Cantidad Detergente'), '0');
    expect(local.guardarPedidoProveedor).toHaveBeenCalledTimes(1); // 0 no se guarda
    await click(container.querySelector('button[aria-label="Quitar"]'));
    expect(local.guardarPedidoProveedor.mock.calls[1][0].items).toEqual([]);
  });
  it('AC-CPR-4 "Agregar los de stock bajo" suma solo los del proveedor con la cantidad sugerida', async () => {
    mockApp.pedidosProveedor = [pedidoBase({ items: [] })];
    await irAPedidos();
    await click(container.querySelector('[data-testid="pedido-proveedor"]'));
    await click(boton('Agregar los de stock bajo'));
    const guardado = local.guardarPedidoProveedor.mock.calls.pop()[0];
    expect(guardado.items).toEqual([{ productoId: '1', cantidad: 12, unidad: 'u', bultoX: 12 }]);
    expect(container.textContent).toContain('Se agregaron 1 producto(s) con stock bajo');
  });
  it('AC-CPR-4 agrega un producto buscando por nombre', async () => {
    mockApp.pedidosProveedor = [pedidoBase({ items: [] })];
    await irAPedidos();
    await click(container.querySelector('[data-testid="pedido-proveedor"]'));
    await setValue(porLabel('Buscar producto para el pedido'), 'jabon');
    await click(container.querySelector('[data-testid="sugerido-pedido"]'));
    expect(local.guardarPedidoProveedor.mock.calls.pop()[0].items).toEqual([{ productoId: '2', cantidad: 1, unidad: 'u', bultoX: null }]);
  });
  it('AC-CPR-4 marcar recibido abre el Ingreso precargado con esas cantidades', async () => {
    mockApp.pedidosProveedor = [pedidoBase()];
    const formIngreso = { proveedorId: 'p1', pedidoProveedorId: 'ped-1', items: [{ productoId: '1', ingreso: 24 }] };
    local.recibirPedidoProveedor.mockResolvedValue({ ok: true, formIngreso });
    const onAbrirIngreso = jest.fn();
    await render({ onAbrirIngreso });
    await abrirProveedor();
    await click(boton('Pedidos'));
    await click(container.querySelector('[data-testid="pedido-proveedor"]'));
    await click(boton('Marcar recibido'));
    expect(local.recibirPedidoProveedor).toHaveBeenCalledWith('ped-1');
    expect(onAbrirIngreso).toHaveBeenCalledWith(formIngreso);
  });
  it('AC-CPR-4 un pedido recibido es de solo lectura y deja reabrir el ingreso', async () => {
    mockApp.pedidosProveedor = [pedidoBase({ estado: 'recibido' })];
    await irAPedidos();
    await click(container.querySelector('[data-testid="pedido-proveedor"]'));
    expect(container.querySelector('input[aria-label="Cantidad Detergente"]')).toBeNull();
    expect(container.querySelector('input[aria-label="Buscar producto para el pedido"]')).toBeNull();
    expect(boton('Abrir ingreso precargado')).toBeDefined();
    expect(boton('Marcar enviado')).toBeUndefined();
  });
  it('AC-CPR-4 marcar enviado desde borrador', async () => {
    mockApp.pedidosProveedor = [pedidoBase()];
    local.marcarPedidoEnviado.mockResolvedValue({ ok: true });
    await irAPedidos();
    await click(container.querySelector('[data-testid="pedido-proveedor"]'));
    await click(boton('Marcar enviado'));
    expect(local.marcarPedidoEnviado).toHaveBeenCalledWith('ped-1');
  });
});

describe('AC-CPR-1 subir y bajar datos de compras', () => {
  it('AC-CPR-1 muestra los pendientes y sube con el PIN (borrándolo del campo)', async () => {
    credencialesAdminProductos.mockResolvedValue({ ok: true, cred: { p_admin_id: '1', p_admin_pin: '4321' } });
    remoto.subirComprobantes.mockResolvedValue({ ok: true, subidos: 1, fallidos: [] });
    remoto.subirCompras.mockResolvedValue({ ok: true, subidos: { costos: 1, cuenta: 2, pedidos: 0 }, rechazados: [{ id: 'x', motivo: 'ingreso_inexistente' }] });
    await render();
    const subir = boton('Subir datos de compras (2 pendientes)');
    expect(subir).toBeDefined();
    await setValue(porLabel('PIN de administrador'), '4321');
    await click(subir);
    await flush();
    expect(remoto.subirComprobantes).toHaveBeenCalledWith({ p_admin_id: '1', p_admin_pin: '4321' });
    expect(remoto.subirCompras).toHaveBeenCalledWith({ p_admin_id: '1', p_admin_pin: '4321' });
    expect(container.querySelector('[data-testid="compras-sync"] [role="status"]').textContent).toContain('Subido: 3 registro(s), 1 comprobante(s). 1 quedaron pendientes');
    expect(porLabel('PIN de administrador').value).toBe('');
    expect(mockApp.recargar).toHaveBeenCalled();
  });
  it('AC-CPR-1 sin PIN no llama al servidor', async () => {
    credencialesAdminProductos.mockResolvedValue({ ok: false, mensaje: 'Ingresá tu PIN de administrador.' });
    await render();
    await click(boton('Subir datos de compras (2 pendientes)'));
    expect(remoto.subirCompras).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Ingresá tu PIN de administrador.');
  });
  it('AC-CPR-1 falta la migración 012: aviso visible y los datos siguen locales', async () => {
    remoto.sondearMigracion012.mockResolvedValue({ faltaMigracion: true });
    await render();
    expect(container.querySelector('[data-testid="compras-sync"] [role="alert"]').textContent).toContain('Falta la migración 012');
  });
  it('AC-CPR-1 baja lo de otros dispositivos con el PIN', async () => {
    credencialesAdminProductos.mockResolvedValue({ ok: true, cred: { p_admin_id: '1', p_admin_pin: '4321' } });
    remoto.bajarCompras.mockResolvedValue({ ok: true, bajados: { costos: 1, cuenta: 1, pedidos: 1 } });
    await render();
    await click(boton('Bajar de otros dispositivos'));
    await flush();
    expect(remoto.bajarCompras).toHaveBeenCalledWith({ p_admin_id: '1', p_admin_pin: '4321' });
    expect(container.textContent).toContain('Actualizado desde otros dispositivos: 3 registro(s)');
  });
});
