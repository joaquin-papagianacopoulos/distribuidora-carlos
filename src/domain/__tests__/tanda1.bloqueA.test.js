// Tanda 1, bloque A: funciones puras de REQ-EDP / MUL / CBU / SST2 / MIN2 / ASV / PEN.
import { puedeEditarPedido, puedeAsignarVendedor } from '../permisos';
import { pasoMinimo, cantidadConPasoMinimo, esCantidadValidaMinimo, ajustarAMultiploMinimo, validarMultiplosMinimoItems } from '../minimos';
import { partirBultos, juntarBultos } from '../bultos';
import { cambiarCasillero, botonesProductoLista, agregarBultoDesdeLista, precioVigenteRenglon } from '../casilleros';
import { etiquetaSinStock } from '../stock';
import { armadoEmpezado, renglonesCambiados, aplicarEdicion, confirmarModificacion, hayConflictoVersion, modificadoToRemote, modificadoFromRemote } from '../edicionPedido';
import { vendedorDelPedido, esSinVendedor, datosVendedorAlCrear, vendedorToRemote, vendedorFromRemote, sinColumnas024, nombraColumna024 } from '../vendedorPedido';
import { pedidosPendientesVisibles } from '../pedidosPendientes';
import { asignacionPorDefecto, calcularAvisos, calcularAjustesPendientes } from '../comisiones';

const ADMIN = { nombre: 'Jorge', permiso: 1 };
const VEND = { nombre: 'Carlos', permiso: 2 };
const ARM = { nombre: 'Ana', permiso: 3 };

describe('AC-EDP-1 / AC-EDP-3 puedeEditarPedido', () => {
  const p = { estado: 'pendiente', vendedor: 'Carlos' };
  it('vendedor edita sus pedidos no facturados', () => {
    expect(puedeEditarPedido(VEND, p)).toMatchObject({ ok: true, pantalla: 'pedido' });
    expect(puedeEditarPedido(VEND, { ...p, vendedor: 'Otro', cargadoPor: 'carlos' }).ok).toBe(true);
  });
  it('no edita ajenos, facturados, borrados ni web sin aceptar', () => {
    expect(puedeEditarPedido(VEND, { ...p, vendedor: 'Otro' }).ok).toBe(false);
    expect(puedeEditarPedido(VEND, { ...p, estado: 'facturado' }).ok).toBe(false);
    expect(puedeEditarPedido(VEND, { ...p, borrado: true }).ok).toBe(false);
    expect(puedeEditarPedido(ADMIN, { ...p, origen: 'web', webEstado: 'por_revisar' }).ok).toBe(false);
  });
  it('admin: pedido o facturacion; armador y permiso invalido no', () => {
    expect(puedeEditarPedido(ADMIN, p).pantalla).toBe('pedido');
    expect(puedeEditarPedido(ADMIN, { ...p, estado: 'facturado' }).pantalla).toBe('facturacion');
    expect(puedeEditarPedido(ARM, p).ok).toBe(false);
    expect(puedeEditarPedido({ nombre: 'Carlos', permiso: '2' }, p).ok).toBe(false);
    expect(puedeEditarPedido(null, p).ok).toBe(false);
  });
});

describe('AC-ASV-1 / AC-ASV-2 permisos y datos', () => {
  it('AC-ASV-1 puedeAsignarVendedor: vendedor solo al crear, admin siempre', () => {
    expect(puedeAsignarVendedor(VEND, null, { alCrear: true })).toBe(true);
    expect(puedeAsignarVendedor(VEND, { estado: 'pendiente' })).toBe(false);
    expect(puedeAsignarVendedor(ADMIN, { estado: 'facturado' })).toBe(true);
    expect(puedeAsignarVendedor(ARM, null, { alCrear: true })).toBe(false);
  });
  it('AC-ASV-1 datosVendedorAlCrear guarda quien cargo y de quien es', () => {
    const vendedores = [{ id: 2, remoteId: 'r2', nombre: 'Carlos' }, { id: 3, nombre: 'Lu' }, { id: 4, nombre: 'Baja', activo: false }];
    const r = datosVendedorAlCrear({ vendedorActual: { id: 1, nombre: 'Jorge' }, elegido: 'r2', vendedores });
    expect(r.ok).toBe(true);
    expect(r.campos).toMatchObject({ vendedor: 'Carlos', vendedorId: 'r2', cargadoPor: 'Jorge', cargadoPorId: 1 });
    expect(datosVendedorAlCrear({ vendedorActual: { id: 1, nombre: 'Jorge' }, vendedores }).campos.vendedor).toBe('Jorge');
    expect(datosVendedorAlCrear({ vendedorActual: { id: 1, nombre: 'Jorge' }, elegido: 4, vendedores }).ok).toBe(false);
  });
  it('AC-ASV-2 sin vendedor: vacio o WEB', () => {
    expect(vendedorDelPedido({ vendedor: 'WEB' })).toBeNull();
    expect(esSinVendedor({ vendedor: '' })).toBe(true);
    expect(esSinVendedor({ vendedor: 'Ana' })).toBe(false);
  });
  it('AC-ASV-1 sync tolerante a la migracion 024', () => {
    expect(vendedorToRemote({ vendedorId: 'r2', cargadoPor: 'Jorge' })).toEqual({ vendedor_id: 'r2', cargado_por: 'Jorge' });
    expect(vendedorToRemote({})).toEqual({});
    expect(vendedorFromRemote({}, { vendedorId: 7, cargadoPor: 'X' })).toMatchObject({ vendedorId: 7, cargadoPor: 'X' });
    expect(sinColumnas024({ a: 1, cargado_por: 'x', vendedor_id: 'y', modificado_tras_armado: {} })).toEqual({ a: 1 });
    expect(nombraColumna024({ message: 'column "cargado_por" does not exist' })).toBe(true);
  });
});

describe('AC-ASV-1/2 comisiones', () => {
  const vendedores = [{ nombre: 'Carlos', permiso: 2 }, { nombre: 'Jorge', permiso: 1 }];
  it('AC-ASV-1 la comision va al dueno elegido', () => {
    const a = asignacionPorDefecto({ vendedor: 'Carlos', cargadoPor: 'Jorge' }, { vendedor: 'Otro' }, vendedores);
    expect(a).toEqual({ modo: 'cargador', partes: [{ vendedor: 'Carlos', pct: 100 }] });
  });
  it('AC-ASV-2 web sin vendedor: sin comision y aviso (e)', () => {
    const a = asignacionPorDefecto({ origen: 'web', vendedor: 'WEB' }, { vendedor: 'Carlos' }, vendedores);
    expect(a.modo).toBe('sin_comision');
    const av = calcularAvisos([{ sinVendedorWeb: true, clienteNombre: 'X' }]);
    expect(av.contadores.e).toBe(1);
    expect(calcularAvisos([]).contadores.e).toBeUndefined();
  });
  it('AC-ASV-2 / AC-COM-13 asignar despues del cierre genera ajuste vendedor_asignado', () => {
    const cierre = { id: 'c1', estado: 'vigente', lineas: [{ tipo: 'pedido', pedidoId: '9', fecha: '2026-11-01', clienteNombre: 'X', sinVendedorWeb: true, total: 1000, pct: 10, comision: 100, asignacion: { modo: 'sin_comision', partes: [] }, partes: [] }] };
    const pedido = { remoteId: '9', id: 1, vendedor: 'Carlos', origen: 'web', webEstado: 'aceptado', estado: 'facturado', total: 1000, entregado: true };
    const aj = calcularAjustesPendientes([pedido], [cierre]);
    expect(Array.isArray(aj)).toBe(true);
    expect(aj).toHaveLength(1);
    expect(aj[0].motivo).toBe('vendedor_asignado');
    expect(calcularAjustesPendientes([{ ...pedido, vendedor: 'WEB' }], [cierre])).toEqual([]);
  });
});

describe('AC-MUL-1 / AC-MUL-2 multiplos del minimo', () => {
  const p5 = { id: 1, minimoVenta: 5 };
  it('AC-MUL-1 de a minimo: 3 -> 6 -> 9', () => {
    const p = { minimoVenta: 3 };
    expect(cantidadConPasoMinimo(3, p, 'sumar')).toBe(6);
    expect(cantidadConPasoMinimo(6, p, 'sumar')).toBe(9);
    expect(cantidadConPasoMinimo(9, p, 'restar')).toBe(6);
    expect(cantidadConPasoMinimo(3, p, 'restar')).toBe(3);
    expect(cantidadConPasoMinimo(7, p5, 'sumar')).toBe(10);
  });
  it('AC-MUL-1 minimo vacio, 0 o 1 va de a 1', () => {
    for (const m of [undefined, '', 0, 1, 'x']) {
      expect(pasoMinimo({ minimoVenta: m })).toBe(1);
      expect(cantidadConPasoMinimo(4, { minimoVenta: m }, 'sumar')).toBe(5);
    }
  });
  it('AC-MUL-1 tipear no multiplo sube al multiplo con aviso', () => {
    expect(ajustarAMultiploMinimo(7, p5)).toMatchObject({ cantidad: 10, ajustado: true });
    expect(ajustarAMultiploMinimo(10, p5)).toMatchObject({ cantidad: 10, ajustado: false, aviso: null });
  });
  it('AC-MUL-2 convive con el bulto (AC-FRB-4)', () => {
    const p = { minimoVenta: 3, bultoX: 12, ventaPor: 'ambos' };
    expect(cantidadConPasoMinimo(12, p, 'sumar')).toBe(24);
    expect(cantidadConPasoMinimo(9, p, 'sumar')).toBe(12);
    expect(esCantidadValidaMinimo(15, p)).toBe(true);
    expect(esCantidadValidaMinimo(14, p)).toBe(false);
  });
  it('AC-MUL-2 validarMultiplosMinimoItems: vendedor bloquea, admin en armado confirma, viejo se saltea', () => {
    const byId = new Map([['1', p5]]);
    const items = [{ productoId: 1, cantidad: 7 }];
    expect(validarMultiplosMinimoItems(items, byId, { permiso: 2, pantalla: 'pedido' }).bloquea).toBe(true);
    expect(validarMultiplosMinimoItems(items, byId, { permiso: 1, pantalla: 'armado' })).toMatchObject({ bloquea: false, requiereConfirmacion: true });
    expect(validarMultiplosMinimoItems(items, byId, { permiso: 2, pantalla: 'pedido', previos: [{ productoId: 1, cantidad: 7 }] }).errores).toEqual([]);
  });
});

describe('AC-CBU-1/2/3 casilleros', () => {
  const prod = { id: 'a', nombre: 'A', precio: 10, precioBulto: 8, bultoX: 12, ventaPor: 'ambos' };
  it('AC-CBU-2 partir y juntar bultos', () => {
    expect(partirBultos(30, 12)).toEqual({ bultos: 2, sueltas: 6 });
    expect(partirBultos(5, 1)).toBeNull();
    expect(partirBultos(1.5, 12)).toBeNull();
    expect(juntarBultos(2, 6, 12)).toBe(30);
    expect(juntarBultos(-1, 0, 12)).toBeNull();
  });
  it('AC-CBU-2 sumar un bulto no suma el minimo', () => {
    expect(cambiarCasillero(5, { ...prod, minimoVenta: 5 }, 'bultos', 'sumar')).toBe(17);
    expect(cambiarCasillero(24, prod, 'bultos', 'restar')).toBe(12);
  });
  it('AC-CBU-1 botones Unidad / Bulto', () => {
    const b = botonesProductoLista(prod);
    expect(b.unidad.texto).toMatch(/^Unidad \$/);
    expect(b.bulto).toMatchObject({ bultoX: 12, precio: 96 });
    expect(b.bulto.texto).toMatch(/^Bulto x12 \$/);
    expect(botonesProductoLista({ precio: 5 }).bulto).toBeNull();
    expect(botonesProductoLista({ precio: 5, bultoX: 6 }).bulto.precio).toBe(30);
  });
  it('AC-CBU-1 tocar Bulto agrega 1 bulto', () => {
    const it1 = agregarBultoDesdeLista([], prod);
    expect(it1[0].cantidad).toBe(12);
    expect(agregarBultoDesdeLista(it1, prod)[0].cantidad).toBe(24);
  });
  it('AC-CBU-3 precio vigente', () => {
    expect(precioVigenteRenglon({ precio: 8, precioPorBulto: true }).tipo).toBe('bulto');
    expect(precioVigenteRenglon({ precio: 10 }).texto).toMatch(/^Precio unidad/);
  });
});

describe('AC-SST2-1 etiqueta sin stock', () => {
  it('stock 0 o negativo muestra la etiqueta; el resto no', () => {
    expect(etiquetaSinStock(0)).toBe('Sin stock — por recibir');
    expect(etiquetaSinStock(-3)).toBe('Sin stock — por recibir');
    expect(etiquetaSinStock(4)).toBeNull();
    expect(etiquetaSinStock(undefined)).toBeNull();
  });
});

describe('AC-EDP-2 / AC-EDP-3 edicionPedido', () => {
  const orig = { id: 1, remoteId: 'r1', clientUuid: 'u1', estado: 'pendiente', vendedor: 'Carlos', remoteUpdatedAt: '2026-11-10T10:00:00+00:00', armado: true, items: [{ productoId: 1, nombre: 'A', cantidad: 2, precio: 10 }] };
  it('AC-EDP-2 armadoEmpezado', () => {
    expect(armadoEmpezado(orig)).toBe(true);
    expect(armadoEmpezado({ armadoLog: { confirmados: [1] } })).toBe(true);
    expect(armadoEmpezado({ armado: false })).toBe(false);
  });
  it('AC-EDP-2 aplicarEdicion marca Modificado y conserva ids', () => {
    const r = aplicarEdicion(orig, { items: [{ productoId: 1, nombre: 'A', cantidad: 3, precio: 10 }, { productoId: 2, nombre: 'B', cantidad: 1, precio: 5 }], observaciones: 'x' }, { usuario: VEND, now: 5 });
    expect(r).toMatchObject({ id: 1, remoteId: 'r1', clientUuid: 'u1', vendedor: 'Carlos', total: 35, baseRemoteUpdatedAt: orig.remoteUpdatedAt });
    expect(r.modificadoTrasArmado).toMatchObject({ at: 5, por: 'Carlos' });
    expect(r.modificadoTrasArmado.productoIds.sort()).toEqual(['1', '2']);
    expect(confirmarModificacion(r, ARM).modificadoTrasArmado).toBeNull();
    expect(renglonesCambiados(orig.items, r.items)).toMatchObject({ agregados: ['2'], cambiados: ['1'] });
  });
  it('AC-EDP-2 sin armado no hay marca', () => {
    const r = aplicarEdicion({ ...orig, armado: false }, { items: [{ productoId: 1, nombre: 'A', cantidad: 9, precio: 10 }] }, { usuario: VEND });
    expect(r.modificadoTrasArmado).toBeUndefined();
  });
  it('AC-EDP-3 hayConflictoVersion', () => {
    expect(hayConflictoVersion('2026-11-10T10:00:00+00:00', '2026-11-10T10:00:00.000Z')).toBe(false);
    expect(hayConflictoVersion('2026-11-10T10:00:00Z', '2026-11-10T10:00:01Z')).toBe(true);
    expect(hayConflictoVersion(null, '2026-11-10T10:00:01Z')).toBe(false);
  });
  it('AC-EDP-2 modificado remoto se sanea', () => {
    expect(modificadoToRemote({ modificadoTrasArmado: null })).toEqual({ modificado_tras_armado: null });
    expect(modificadoToRemote({})).toEqual({});
    expect(modificadoFromRemote({}, { modificadoTrasArmado: 'local' })).toBe('local');
    expect(modificadoFromRemote({ modificado_tras_armado: { at: 1, por: 'x', productoIds: new Array(600).fill('a') } }).productoIds).toHaveLength(500);
  });
});

describe('AC-PEN-1 pedidosPendientesVisibles', () => {
  const hoy = '2026-11-10';
  const lista = [
    { id: 1, fecha: '2026-11-05', estado: 'pendiente' },
    { id: 2, fecha: '2026-11-15', estado: 'pendiente' },
    { id: 3, fecha: '2026-11-10', estado: 'pendiente' },
    { id: 4, fecha: '2026-11-01', estado: 'facturado' },
    { id: 5, fecha: '2026-11-02', estado: 'pendiente', borrado: true },
    { id: 6, fecha: '2026-11-03', estado: 'pendiente', origen: 'web', webEstado: 'por_revisar' },
    { id: 7, remoteId: 'x', fecha: '2026-11-07', estado: 'pendiente' },
    { id: 8, remoteId: 'x', fecha: '2026-11-07', estado: 'pendiente' },
    { id: 9, estado: 'pendiente' },
  ];
  it('vencidos, futuros, sin fecha, sin hoy/facturados/borrados/web, sin duplicados y ordenados', () => {
    const r = pedidosPendientesVisibles(lista, hoy);
    expect(r.map(x => x.pedido.id)).toEqual([1, 7, 2, 9]);
    expect(r[0]).toMatchObject({ dias: -5, etiqueta: 'Hace 5 días' });
    expect(r[2]).toMatchObject({ dias: 5, etiqueta: 'Faltan 5 días' });
    expect(r[3].etiqueta).toBe('Sin fecha');
    expect(pedidosPendientesVisibles(null, hoy)).toEqual([]);
  });
});
