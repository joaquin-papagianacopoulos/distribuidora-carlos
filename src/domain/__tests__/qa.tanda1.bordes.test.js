// QA tanda 1 (RUN 20261110-t1): bordes de EDP / MUL / CBU / MIN2 / ASV / PEN y GAP de AC-CBU-2.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { puedeEditarPedido } from '../permisos';
import { cantidadConPasoMinimo, ajustarAMultiploMinimo, esCantidadValidaMinimo, puedeGuardarBajoMinimo, validarMultiplosMinimoItems } from '../minimos';
import { cambiarCasillero } from '../casilleros';
import { partirBultos } from '../bultos';
import { aplicarEdicion, hayConflictoVersion, renglonesCambiados } from '../edicionPedido';
import { pedidosPendientesVisibles } from '../pedidosPendientes';
import { vendedorDelPedido, esSinVendedor, datosVendedorAlCrear } from '../vendedorPedido';
import BultoControl from '../../components/BultoControl';

global.IS_REACT_ACT_ENVIRONMENT = true;

const VEND = { nombre: 'Carlos', permiso: 2 };
const ARM = { nombre: 'Ana', permiso: 3 };
const ADMIN = { nombre: 'Jorge', permiso: 1 };

describe('AC-EDP-1 bordes de puedeEditarPedido', () => {
  const p = { estado: 'pendiente', vendedor: 'Carlos' };
  it('AC-EDP-1 nombre con espacios/mayusculas/unicode igual es el mismo vendedor; prefijo no', () => {
    expect(puedeEditarPedido({ nombre: '  CARLOS ', permiso: 2 }, p).ok).toBe(true);
    expect(puedeEditarPedido({ nombre: 'Carlos Perez', permiso: 2 }, p).ok).toBe(false);
    expect(puedeEditarPedido({ nombre: 'Jose', permiso: 2 }, { ...p, vendedor: 'JOSÉ' }).ok).toBe(true);
  });
  it('AC-EDP-1 estado Facturado en otra capitalizacion tambien bloquea al vendedor', () => {
    expect(puedeEditarPedido(VEND, { ...p, estado: 'Facturado' }).ok).toBe(false);
    expect(puedeEditarPedido(VEND, { ...p, estado: 'FACTURADO' }).ok).toBe(false);
  });
  it('AC-EDP-1 vendedor sin nombre, pedido sin vendedor o armador en pedido propio: no', () => {
    expect(puedeEditarPedido({ nombre: '', permiso: 2 }, { ...p, vendedor: '' }).ok).toBe(false);
    expect(puedeEditarPedido(VEND, { estado: 'pendiente' }).ok).toBe(false);
    expect(puedeEditarPedido(VEND, { estado: 'pendiente', vendedor: 'WEB' }).ok).toBe(false);
    expect(puedeEditarPedido({ nombre: 'Carlos', permiso: 3 }, p).ok).toBe(false);
  });
});

describe('AC-EDP-2 / AC-EDP-3 bordes de aplicarEdicion', () => {
  const base = { id: 1, remoteId: 'r1', clientUuid: 'u1', estado: 'pendiente', vendedor: 'Carlos', armado: true, items: [{ productoId: 1, nombre: 'A', cantidad: 2, precio: 10 }] };
  it('AC-EDP-2 guardar sin cambios en un pedido armado NO lo marca Modificado', () => {
    const r = aplicarEdicion(base, { items: base.items.map(i => ({ ...i })) }, { usuario: VEND });
    expect(r.modificadoTrasArmado).toBeUndefined();
  });
  it('AC-EDP-2 sacar un renglon de un pedido armado lo marca con el id quitado', () => {
    const r = aplicarEdicion({ ...base, items: [...base.items, { productoId: 2, cantidad: 1, precio: 5 }] }, { items: base.items }, { usuario: VEND, now: 9 });
    expect(r.modificadoTrasArmado.productoIds).toEqual(['2']);
  });
  it('AC-EDP-2 dos ediciones seguidas acumulan los ids hasta que el armador confirma', () => {
    const r1 = aplicarEdicion(base, { items: [{ productoId: 1, cantidad: 3, precio: 10 }] }, { usuario: VEND, now: 1 });
    const r2 = aplicarEdicion(r1, { items: [{ productoId: 1, cantidad: 3, precio: 10 }, { productoId: 7, cantidad: 1, precio: 1 }] }, { usuario: VEND, now: 2 });
    expect(r2.modificadoTrasArmado.productoIds.sort()).toEqual(['1', '7']);
  });
  it('AC-EDP-2 armado empezado solo por armadoLog.confirmados tambien marca', () => {
    const r = aplicarEdicion({ ...base, armado: false, armadoLog: { confirmados: [1] } }, { items: [{ productoId: 1, cantidad: 5, precio: 10 }] }, { usuario: VEND });
    expect(r.modificadoTrasArmado).toBeTruthy();
  });
  it('AC-EDP-1 el vendedor no puede cambiar vendedor/estado/fecha ni el precio congelado (precio manual nuevo)', () => {
    const r = aplicarEdicion(base, { items: [{ productoId: 1, cantidad: 2, precio: 1, precioManual: true }] }, { usuario: VEND });
    expect(r.items[0].precio).toBe(10);
    expect(r).toMatchObject({ vendedor: 'Carlos', estado: 'pendiente', id: 1, remoteId: 'r1', clientUuid: 'u1' });
  });
  it('pedido viejo sin items/remoteUpdatedAt/campos nuevos sigue funcionando', () => {
    const viejo = { id: 5, cliente: 'X', estado: 'pendiente', vendedor: 'Carlos' };
    const r = aplicarEdicion(viejo, { items: [{ productoId: 1, cantidad: 1, precio: 3 }] }, { usuario: VEND });
    expect(r.total).toBe(3);
    expect(r.baseRemoteUpdatedAt).toBeNull();
    expect(aplicarEdicion(null, {}, {})).toBeNull();
    expect(renglonesCambiados(undefined, undefined)).toEqual({ agregados: [], quitados: [], cambiados: [] });
  });
  it('AC-EDP-3 conflicto: version invalida o distinta no pisa; vacia no conflicta', () => {
    expect(hayConflictoVersion('abc', 'abd')).toBe(true);
    expect(hayConflictoVersion('abc', 'abc')).toBe(false);
    expect(hayConflictoVersion('2026-11-10T10:00:00Z', '')).toBe(false);
    expect(hayConflictoVersion('2026-11-10T10:00:00Z', null)).toBe(false);
  });
});

describe('AC-MUL-1 / AC-MUL-2 bordes', () => {
  const p3 = { id: 1, minimoVenta: 3 };
  it('AC-MUL-1 minimo 3: 0 sube a 3, no multiplo (7) sube a 9, restar no baja de 3', () => {
    expect(cantidadConPasoMinimo(0, p3, 'sumar')).toBe(3);
    expect(cantidadConPasoMinimo(7, p3, 'sumar')).toBe(9);
    expect(cantidadConPasoMinimo(7, p3, 'restar')).toBe(6);
    expect(cantidadConPasoMinimo(3, p3, 'restar')).toBe(3);
    expect(ajustarAMultiploMinimo(7, p3)).toMatchObject({ cantidad: 9, ajustado: true });
  });
  it('AC-MUL-1 tipeado 1 con minimo 3 sube a 3; 0/negativo/NaN/null/decimal no explotan', () => {
    expect(ajustarAMultiploMinimo(1, p3).cantidad).toBe(3);
    for (const v of [0, -5, NaN, null, undefined, '', 'abc', 2.5]) {
      expect(() => ajustarAMultiploMinimo(v, p3)).not.toThrow();
    }
    expect(esCantidadValidaMinimo(2.5, p3)).toBe(false);
    expect(esCantidadValidaMinimo(null, p3)).toBe(false);
  });
  it('AC-MUL-1 producto null/undefined o minimo string va de a 1', () => {
    expect(cantidadConPasoMinimo(4, null, 'sumar')).toBe(5);
    expect(cantidadConPasoMinimo(4, undefined, 'restar')).toBe(3);
    expect(cantidadConPasoMinimo(4, { minimoVenta: '3' }, 'sumar')).toBe(6);
  });
  it('AC-MUL-2 mínimo + bulto conviven (AC-FRB-4): 9 -> 12 (bulto) -> 24; 24 -> 12 -> 9', () => {
    const p = { minimoVenta: 3, bultoX: 12, ventaPor: 'ambos' };
    expect(cantidadConPasoMinimo(9, p, 'sumar')).toBe(12);
    expect(cantidadConPasoMinimo(12, p, 'sumar')).toBe(24);
    expect(cantidadConPasoMinimo(24, p, 'restar')).toBe(12);
    expect(cantidadConPasoMinimo(12, p, 'restar')).toBe(9);
    expect(esCantidadValidaMinimo(27, p)).toBe(true); // 2 bultos + 3 sueltas
    expect(esCantidadValidaMinimo(25, p)).toBe(false);
  });
  it('AC-MUL-2 pedido viejo con cantidad fuera de multiplo no se bloquea si no la toco; si la cambio a otra mala, si', () => {
    const byId = new Map([['1', p3]]);
    const previos = [{ productoId: 1, cantidad: 4 }];
    expect(validarMultiplosMinimoItems([{ productoId: 1, cantidad: 4 }], byId, { permiso: 2, pantalla: 'pedido', previos }).bloquea).toBe(false);
    expect(validarMultiplosMinimoItems([{ productoId: 1, cantidad: 5 }], byId, { permiso: 2, pantalla: 'pedido', previos }).bloquea).toBe(true);
    expect(validarMultiplosMinimoItems([{ productoId: 1, cantidad: 5, eliminado: true }], byId, { permiso: 2, pantalla: 'pedido' }).errores).toEqual([]);
    expect(validarMultiplosMinimoItems(null, null, {}).bloquea).toBe(false);
  });
});

describe('AC-MIN2-1 por rol', () => {
  it('AC-MIN2-1 solo admin en armado/facturacion; vendedor, armador, string y pantalla rara no', () => {
    expect(puedeGuardarBajoMinimo(1, 'armado')).toBe('confirmar');
    expect(puedeGuardarBajoMinimo(1, 'pedido')).toBe('no');
    expect(puedeGuardarBajoMinimo(2, 'armado')).toBe('no');
    expect(puedeGuardarBajoMinimo(3, 'armado')).toBe('no');
    expect(puedeGuardarBajoMinimo(undefined, 'armado')).toBe('no');
    expect(puedeGuardarBajoMinimo(null, 'armado')).toBe('no');
  });
  it('AC-MIN2-1 armador en Armado queda bloqueado por multiplo; admin pide confirmacion', () => {
    const byId = new Map([['1', { minimoVenta: 6 }]]);
    const items = [{ productoId: 1, cantidad: 8 }];
    expect(validarMultiplosMinimoItems(items, byId, { permiso: 3, pantalla: 'armado' }).bloquea).toBe(true);
    expect(validarMultiplosMinimoItems(items, byId, { permiso: 2, pantalla: 'armado' }).bloquea).toBe(true);
    expect(validarMultiplosMinimoItems(items, byId, { permiso: 1, pantalla: 'armado' })).toMatchObject({ bloquea: false, requiereConfirmacion: true });
  });
});

describe('AC-ASV-1 / AC-ASV-2 bordes', () => {
  it('AC-ASV-2 sin vendedor: WEB con espacios/minusculas, vacio, null, objeto nulo', () => {
    for (const v of [' web ', 'Web', '', null, undefined, '   ']) expect(esSinVendedor({ vendedor: v })).toBe(true);
    expect(esSinVendedor(null)).toBe(true);
    expect(vendedorDelPedido({ vendedor: 'Carlos' })).toBe('Carlos');
  });
  it('AC-ASV-1 vendedor elegido inactivo o inexistente no se guarda; vacio = el mismo que carga', () => {
    const vendedores = [{ id: 1, nombre: 'Carlos', activo: true }, { id: 2, nombre: 'Luis', activo: false }];
    expect(datosVendedorAlCrear({ vendedorActual: ADMIN, elegido: 'Luis', vendedores }).ok).toBe(false);
    expect(datosVendedorAlCrear({ vendedorActual: ADMIN, elegido: 'Nadie', vendedores }).ok).toBe(false);
    const ok = datosVendedorAlCrear({ vendedorActual: ADMIN, elegido: '', vendedores });
    expect(ok.campos).toMatchObject({ vendedor: 'Jorge' });
    expect(datosVendedorAlCrear({ vendedorActual: VEND, elegido: 'Carlos', vendedores }).ok).toBe(true);
    expect(datosVendedorAlCrear().ok).toBe(false);
  });
});

describe('AC-PEN-1 bordes', () => {
  const hoy = '2026-11-10';
  it('AC-PEN-1 ayer y manana aparecen (-1 / +1 dia singular); hoy con hora no; fecha con hora de otro dia si', () => {
    const r = pedidosPendientesVisibles([
      { id: 1, fecha: '2026-11-09', estado: 'pendiente' },
      { id: 2, fecha: '2026-11-11', estado: 'pendiente' },
      { id: 3, fecha: '2026-11-10T15:00:00', estado: 'pendiente' },
      { id: 4, fecha: '2026-12-31', estado: 'pendiente' },
    ], hoy);
    expect(r.map(x => x.pedido.id)).toEqual([1, 2, 4]);
    expect(r[0].etiqueta).toBe('Hace 1 día');
    expect(r[1].etiqueta).toBe('Faltan 1 día');
  });
  it('AC-PEN-1 entradas basura no explotan; hoy invalido no rompe', () => {
    expect(pedidosPendientesVisibles([null, undefined, 5, 'x', {}], hoy)).toHaveLength(1); // {} sin fecha = sin fecha
    expect(() => pedidosPendientesVisibles([{ id: 1, fecha: '2026-11-01', estado: 'pendiente' }], 'basura')).not.toThrow();
    expect(pedidosPendientesVisibles(undefined, undefined)).toEqual([]);
  });
});

describe('AC-CBU-2 desvio: dos casilleros con su +/− (GAP)', () => {
  const prod = { id: 'a', bultoX: 12, ventaPor: 'ambos' };

  // GAP: el casillero "Unidades sueltas" es solo lectura. El AC pide "+" y "−" propios.
  it('AC-CBU-2 GAP el casillero Unidades sueltas tiene su + y su − (data-testid sueltas-mas / sueltas-menos)', () => {
    const cont = document.createElement('div');
    document.body.appendChild(cont);
    const root = createRoot(cont);
    act(() => { root.render(<BultoControl bultoX={12} cantidad={30} onSumar={() => {}} onRestar={() => {}} />); });
    expect(cont.querySelector('[data-testid="sueltas-casillero-valor"]').textContent).toBe('6');
    // GAP: no existen.
    expect(cont.querySelector('[data-testid="sueltas-mas"]')).not.toBeNull();
    expect(cont.querySelector('[data-testid="sueltas-menos"]')).not.toBeNull();
    act(() => root.unmount());
    cont.remove();
  });

  // GAP: "−" de sueltas con 0 sueltas rompe un bulto entero (24 -> 12 en 'ambos' con minimo) o lo
  // convierte en 11 sueltas (sin minimo): el vendedor termina "restando a mano".
  it('AC-CBU-2 GAP restar sueltas con 0 sueltas no toca los bultos (24 u. = 2 bultos + 0 sueltas)', () => {
    expect(cambiarCasillero(24, prod, 'sueltas', 'restar')).toBe(24);
    expect(cambiarCasillero(24, { ...prod, minimoVenta: 3 }, 'sueltas', 'restar')).toBe(24);
  });
  it('AC-CBU-2 GAP restar sueltas solo baja las sueltas (30 = 2 bultos + 6 -> 2 bultos + 5 / 3 con minimo 3)', () => {
    expect(partirBultos(cambiarCasillero(30, prod, 'sueltas', 'restar'), 12)).toEqual({ bultos: 2, sueltas: 5 });
    expect(partirBultos(cambiarCasillero(30, { ...prod, minimoVenta: 3 }, 'sueltas', 'restar'), 12)).toEqual({ bultos: 2, sueltas: 3 });
  });
  it('AC-CBU-2 GAP sumar sueltas no cruza solo a otro bulto: 35 (2b + 11) + 1 queda en 2b + 12?', () => {
    // La cuenta total es la misma (36 = 3 bultos); se acepta que parta solo en 3b + 0. Debe seguir siendo 36.
    expect(cambiarCasillero(35, prod, 'sueltas', 'sumar')).toBe(36);
  });
  // BUG: "− Bulto" con 0 bultos (5 sueltas) borra las sueltas (queda en el piso) en vez de no hacer nada.
  it('AC-CBU-2 BUG restar bulto con 0 bultos no toca las sueltas (5 u. con bultoX 12 queda en 5)', () => {
    expect(cambiarCasillero(5, prod, 'bultos', 'restar')).toBe(5);
  });
  it('AC-CBU-2 restar bulto conserva las sueltas (30 -> 18) y sumar bulto tambien (30 -> 42)', () => {
    expect(cambiarCasillero(30, prod, 'bultos', 'restar')).toBe(18);
    expect(cambiarCasillero(30, prod, 'bultos', 'sumar')).toBe(42);
  });
});
