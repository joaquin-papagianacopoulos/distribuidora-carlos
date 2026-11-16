// Lote 2026-11-16: REQ-REP, REQ-SAR, REQ-OBS, REQ-STV, REQ-INA2, AC-RTO-8/9, AC-ESC2-5, AC-CBU-4.
import { pedidosPendientesEntrega, pedidosSeleccionados, claveSeleccionPedido, estadoReparto } from '../reparto';
import { pedidosParaArmado } from '../armado';
import {
  normalizarObservaciones, notaDePedido, observacionesToRemote, observacionesFromRemote,
  sinColumnas028, nombraColumna028, MAX_OBSERVACIONES_PEDIDO,
} from '../observaciones';
import { textoStockDisponible } from '../stock';
import { referenciaIngreso } from '../compras';
import { renglonNuevo, renglonAlDia } from '../bultos';
import { precioAplicadoRenglon } from '../precios';
import { columnasRenglonBoleta, filasBoleta } from '../gruposFactura';
import { botonesProductoLista, precioVigenteRenglon } from '../casilleros';
import { ESTILO_TABLA_COMPACTA, COLOR_LINEA_TABLA } from '../boletaLayout';

const P = (id, extra = {}) => ({ id, clienteNombre: `Cliente ${id}`, fecha: '2026-11-10', estado: 'pendiente', items: [], total: 100, ...extra });

describe('REQ-REP lista única de pedidos pendientes de entrega', () => {
  it('AC-REP-1 trae los no entregados de cualquier fecha, ordenados por fecha y cliente', () => {
    const lista = pedidosPendientesEntrega([
      P(1, { fecha: '2026-11-14', clienteNombre: 'Zeta' }),
      P(2, { fecha: '2026-11-01', clienteNombre: 'Beto' }),
      P(3, { fecha: '2026-11-14', clienteNombre: 'Ana', estado: 'facturado' }),
    ]);
    expect(lista.map(p => p.id)).toEqual([2, 3, 1]);
  });

  it('AC-REP-1 deja afuera entregados, borrados, cancelados y pedidos web sin aceptar', () => {
    const lista = pedidosPendientesEntrega([
      P(1, { estado: 'facturado', entregado: true }),
      P(2, { borrado: true }),
      P(3, { estado: 'cancelado' }),
      P(4, { origen: 'web', webEstado: 'pendiente' }),
      P(5, { origen: 'web', webEstado: 'aceptado' }),
      P(6, { entregado: false }),
      null, 'x',
    ]);
    expect(lista.map(p => p.id)).toEqual([5, 6]);
  });

  it('AC-REP-1 "desde" recorta los pedidos más viejos; sin "desde" van todos', () => {
    const pedidos = [P(1, { fecha: '2026-09-01' }), P(2, { fecha: '2026-11-01' }), P(3, { fecha: '' })];
    expect(pedidosPendientesEntrega(pedidos, { desde: '2026-10-15' }).map(p => p.id)).toEqual([3, 2]);
    expect(pedidosPendientesEntrega(pedidos).map(p => p.id)).toEqual([3, 1, 2]);
  });

  it('AC-REP-1 sin duplicados: por remoteId gana el más nuevo', () => {
    const lista = pedidosPendientesEntrega([
      P(1, { remoteId: 9, updatedAt: 10, clienteNombre: 'Viejo' }),
      P(2, { remoteId: 9, updatedAt: 20, clienteNombre: 'Nuevo' }),
    ]);
    expect(lista).toHaveLength(1);
    expect(lista[0].clienteNombre).toBe('Nuevo');
  });

  it('AC-REP-2 pedidosSeleccionados devuelve solo los tildados, en el orden de la lista', () => {
    const lista = pedidosPendientesEntrega([P(1), P(2, { remoteId: 77 }), P(3)]);
    const sel = new Set([claveSeleccionPedido(lista[2]), claveSeleccionPedido(lista[0]), 'l:999']);
    expect(pedidosSeleccionados(lista, sel).map(p => p.id)).toEqual([lista[0].id, lista[2].id]);
    expect(pedidosSeleccionados(lista, new Set())).toEqual([]);
    expect(pedidosSeleccionados(null, null)).toEqual([]);
    expect(claveSeleccionPedido({ id: 5, remoteId: 77 })).toBe('r:77');
    expect(claveSeleccionPedido({ id: 5 })).toBe('l:5');
  });

  it('estadoReparto resume facturación y armado', () => {
    expect(estadoReparto(P(1))).toBe('Sin facturar · Sin armar');
    expect(estadoReparto(P(1, { estado: 'facturado', armado: true }))).toBe('Facturado · Armado');
    expect(estadoReparto(P(1, { armado: true, aReparto: true }))).toBe('Sin facturar · A reparto');
    expect(estadoReparto(null)).toBe('');
  });
});

describe('REQ-SAR "Sin armar" con todo lo atrasado', () => {
  const HOY = '2026-11-16';
  const pedidos = [
    P(1, { fecha: HOY, createdAt: 2 }),
    P(2, { fecha: HOY, armado: true, createdAt: 1 }),
    P(3, { fecha: '2026-11-10' }),                                   // atrasado sin armar
    P(4, { fecha: '2026-11-11', armado: true }),                     // atrasado ya armado
    P(5, { fecha: '2026-11-12', estado: 'facturado' }),              // atrasado ya facturado
    P(6, { fecha: '2026-11-20' }),                                   // futuro
    P(7, { fecha: '2026-11-09', borrado: true }),
    P(8, { fecha: HOY, armado: true, aReparto: true, createdAt: 3 }),
    P(9, { fecha: '2026-11-08', entregado: true }),
  ];

  it('AC-SAR-1 "sin_armar" junta los de la fecha con los atrasados pendientes, del más viejo al más nuevo', () => {
    expect(pedidosParaArmado(pedidos, HOY, 'sin_armar').map(p => p.id)).toEqual([3, 1]);
  });

  it('AC-SAR-1 un pedido de la fecha elegida sin armar aparece aunque ya esté facturado', () => {
    expect(pedidosParaArmado([P(1, { fecha: HOY, estado: 'facturado' })], HOY, 'sin_armar').map(p => p.id)).toEqual([1]);
  });

  it('AC-SAR-1 los demás filtros siguen siendo solo de la fecha elegida', () => {
    expect(pedidosParaArmado(pedidos, HOY, 'todos').map(p => p.id)).toEqual([2, 1, 8]);
    expect(pedidosParaArmado(pedidos, HOY, 'armados').map(p => p.id)).toEqual([2, 8]);
    expect(pedidosParaArmado(pedidos, HOY, 'reparto').map(p => p.id)).toEqual([8]);
  });

  it('AC-SAR-1 sin duplicados y tolera basura', () => {
    const dup = [P(1, { remoteId: 5, fecha: HOY, updatedAt: 1 }), P(2, { remoteId: 5, fecha: HOY, updatedAt: 2 }), null, 3];
    expect(pedidosParaArmado(dup, HOY, 'sin_armar').map(p => p.id)).toEqual([2]);
    expect(pedidosParaArmado(null, HOY, 'sin_armar')).toEqual([]);
  });
});

describe('REQ-OBS notas del pedido', () => {
  it('AC-OBS-1 normaliza: recorta, saca caracteres de control y respeta el tope', () => {
    expect(normalizarObservaciones('  entregar a la tarde \n timbre 2 ')).toBe('entregar a la tarde \n timbre 2');
    expect(normalizarObservaciones('a\u0000b\u0007c')).toBe('a b c');
    expect(normalizarObservaciones('x'.repeat(900))).toHaveLength(MAX_OBSERVACIONES_PEDIDO);
    expect(normalizarObservaciones(null)).toBe('');
    expect(normalizarObservaciones({})).toBe('');
  });

  it('AC-OBS-1 la nota viaja solo si el pedido la conoce', () => {
    expect(observacionesToRemote({ observaciones: ' hola ' })).toEqual({ observaciones: 'hola' });
    expect(observacionesToRemote({ observaciones: '' })).toEqual({ observaciones: '' });
    expect(observacionesToRemote({})).toEqual({});
    expect(observacionesToRemote({ observaciones: null })).toEqual({});
    expect(observacionesToRemote(null)).toEqual({});
  });

  it('AC-OBS-1 al bajar: la del servidor manda; sin columna o null conserva la local', () => {
    expect(observacionesFromRemote({ observaciones: 'del servidor' }, { observaciones: 'local' })).toEqual({ observaciones: 'del servidor' });
    expect(observacionesFromRemote({ observaciones: '' }, { observaciones: 'local' })).toEqual({ observaciones: '' });
    expect(observacionesFromRemote({ observaciones: null }, { observaciones: 'local' })).toEqual({ observaciones: 'local' });
    expect(observacionesFromRemote({}, { observaciones: 'local' })).toEqual({ observaciones: 'local' });
    expect(observacionesFromRemote({}, null)).toEqual({});
  });

  it('AC-OBS-1 tolerancia a la migración 028 sin aplicar', () => {
    expect(sinColumnas028({ total: 1, observaciones: 'x' })).toEqual({ total: 1 });
    expect(nombraColumna028({ message: "Could not find the 'observaciones' column of 'pedidos'" })).toBe(true);
    expect(nombraColumna028({ message: "Could not find the 'grupos' column" })).toBe(false);
  });

  it('AC-OBS-3 notaDePedido usa la nota del pedido y, si no hay, la del pedido web', () => {
    expect(notaDePedido({ observaciones: 'puerta trasera' })).toBe('puerta trasera');
    expect(notaDePedido({ observaciones: '', webContacto: { observaciones: 'tocar timbre' } })).toBe('tocar timbre');
    expect(notaDePedido({})).toBe('');
    expect(notaDePedido(null)).toBe('');
  });
});

describe('REQ-STV stock visible al levantar pedidos', () => {
  it('AC-STV-1 arma el texto con unidades y bultos', () => {
    expect(textoStockDisponible(36, 12)).toBe('Stock: 36 u. (3 bultos)');
    expect(textoStockDisponible(40, 12)).toBe('Stock: 40 u. (3 bultos + 4 u.)');
    expect(textoStockDisponible(12, 12)).toBe('Stock: 12 u. (1 bulto)');
    expect(textoStockDisponible(5, 12)).toBe('Stock: 5 u.');
    expect(textoStockDisponible(7)).toBe('Stock: 7 u.');
    expect(textoStockDisponible(0, 6)).toBe('Stock: 0 u.');
    expect(textoStockDisponible(-3, 6)).toBe('Stock: -3 u.');
  });

  it('AC-STV-1 sin dato de stock no muestra nada', () => {
    expect(textoStockDisponible(undefined, 12)).toBeNull();
    expect(textoStockDisponible(null)).toBeNull();
    expect(textoStockDisponible('')).toBeNull();
    expect(textoStockDisponible('abc')).toBeNull();
  });
});

describe('REQ-INA2 referencia del ingreso sin número de factura', () => {
  const AHORA = new Date(2026, 10, 16, 14, 5, 9);
  it('AC-INA2-1 arma la referencia con el tipo y la fecha/hora', () => {
    expect(referenciaIngreso('A', AHORA)).toBe('A · 16/11/2026 14:05:09');
    expect(referenciaIngreso('b', AHORA)).toBe('B · 16/11/2026 14:05:09');
    expect(referenciaIngreso('N', AHORA)).toBe('En negro · 16/11/2026 14:05:09');
    expect(referenciaIngreso('A', AHORA).length).toBeLessThanOrEqual(40);
    expect(referenciaIngreso('N', AHORA).length).toBeLessThanOrEqual(40);
  });
  it('AC-INA2-1 tipo vacío o inválido => sin referencia', () => {
    expect(referenciaIngreso('', AHORA)).toBe('');
    expect(referenciaIngreso('C', AHORA)).toBe('');
    expect(referenciaIngreso(null, AHORA)).toBe('');
  });
});

describe('AC-ESC2-5 un renglón del borrador toma la escala cargada después', () => {
  const PROD = { id: 7, nombre: 'San Ignacio 1 L', precio: 1500, bultoX: 12 };
  const CON_ESCALA = { ...PROD, escalasBulto: [{ desde: 3, precio: 1300 }] };

  it('renglón agregado ANTES de cargar la escala: al ponerse al día cobra el precio de 3 bultos', () => {
    const viejo = precioAplicadoRenglon({ ...renglonNuevo(PROD), cantidad: 36 }, 36);
    expect(viejo.precio).toBe(1500);
    const alDia = renglonAlDia(viejo, CON_ESCALA);
    expect(alDia.precio).toBe(1300);
    expect(alDia).toMatchObject({ cantidad: 36, precioOriginal: 1500, precioBultoX: 12, escalaDesde: 3, escalaPrecio: 1300 });
    // Y sigue re-preciando al cambiar la cantidad.
    expect(precioAplicadoRenglon({ ...alDia, cantidad: 24 }, 24).precio).toBe(1500);
  });

  it('con precio llevando bulto: 1 bulto => precio de bulto; 3 bultos => escala', () => {
    const prod = { ...CON_ESCALA, precioBulto: 1400 };
    const r = renglonAlDia({ ...renglonNuevo(PROD), cantidad: 12 }, prod);
    expect(r).toMatchObject({ precio: 1400, precioPorBulto: true });
    expect(precioAplicadoRenglon({ ...r, cantidad: 36 }, 36)).toMatchObject({ precio: 1300, escalaDesde: 3 });
  });

  it('si el producto no cambió devuelve el mismo objeto (no re-renderiza)', () => {
    const r = renglonNuevo(CON_ESCALA);
    expect(renglonAlDia(r, CON_ESCALA)).toBe(r);
    const simple = renglonNuevo({ id: 1, nombre: 'Sin bulto', precio: 100 });
    expect(renglonAlDia(simple, { id: 1, nombre: 'Sin bulto', precio: 100 })).toBe(simple);
  });

  it('cambio de precio del producto: el borrador toma el precio nuevo', () => {
    const r = renglonNuevo({ id: 1, nombre: 'X', precio: 100 });
    expect(renglonAlDia(r, { id: 1, nombre: 'X', precio: 120 })).toMatchObject({ precio: 120, precioOriginal: 120, cantidad: 1 });
  });

  it('precio manual o con descuento: no se toca', () => {
    const manual = { ...renglonNuevo(PROD), precio: 1000, precioManual: true };
    expect(renglonAlDia(manual, CON_ESCALA)).toBe(manual);
    const conDesc = { ...renglonNuevo(PROD), precio: 1350, descuentoPct: 10 };
    expect(renglonAlDia(conDesc, CON_ESCALA)).toBe(conDesc);
  });

  it('sin producto (borrado) o basura: igual', () => {
    const r = renglonNuevo(PROD);
    expect(renglonAlDia(r, undefined)).toBe(r);
    expect(renglonAlDia(null, PROD)).toBeNull();
  });
});

describe('AC-RTO-8 / AC-RTO-9 remito: líneas suaves y precio por unidad siempre', () => {
  it('AC-RTO-8 las líneas de las tablas son gris suave y finas', () => {
    expect(ESTILO_TABLA_COMPACTA.lineColor).toEqual([...COLOR_LINEA_TABLA]);
    expect(Math.min(...COLOR_LINEA_TABLA)).toBeGreaterThanOrEqual(160);
    expect(ESTILO_TABLA_COMPACTA.lineWidth).toBeLessThanOrEqual(0.25);
  });

  it('AC-RTO-9 renglón en bultos: sale el precio por unidad y el del bulto', () => {
    const c = columnasRenglonBoleta({ nombre: 'Jugo', cantidad: 36, precio: 1300, bultoX: 12 }, 'Jugo');
    expect(c).toMatchObject({ cantidadTexto: '3', precioUnitTexto: '$1.300', precioBultoTexto: '$15.600', enBultos: true });
  });

  it('AC-RTO-9 renglón en unidades: precio por unidad y columna de bulto vacía', () => {
    const c = columnasRenglonBoleta({ nombre: 'Jugo', cantidad: 5, precio: 1500 }, 'Jugo');
    expect(c).toMatchObject({ cantidadTexto: '5', precioUnitTexto: '$1.500', precioBultoTexto: '' });
  });

  it('AC-RTO-9 todas las filas de la boleta traen precioUnitTexto (grupo armado a mano: vacío)', () => {
    const items = [
      { productoId: 1, nombre: 'A', cantidad: 2, precio: 100 },
      { productoId: 2, nombre: 'Prime Rojo', cantidad: 12, precio: 50, grupoBulto: 'Prime', precioBultoX: 24 },
      { productoId: 3, nombre: 'Prime Azul', cantidad: 12, precio: 50, grupoBulto: 'Prime', precioBultoX: 24 },
    ];
    const filas = filasBoleta(items, []);
    expect(filas.map(f => [f.nombre, f.precioUnitTexto, f.precioBultoTexto])).toEqual([
      ['A', '$100', ''],
      ['Prime (bulto x24)', '$50', '$1.200'],
    ]);
  });
});

describe('AC-CBU-4 precio por unidad del bulto siempre a la vista', () => {
  it('el botón "Bulto" de la lista informa también el precio por unidad', () => {
    const b = botonesProductoLista({ precio: 900, precioBulto: 800, bultoX: 16 });
    expect(b.bulto).toMatchObject({ texto: 'Bulto x16 $12.800', porUnidad: 800, textoUnidad: '$800 c/u' });
    expect(botonesProductoLista({ precio: 900, bultoX: 6 }).bulto.textoUnidad).toBe('$900 c/u');
  });

  it('con escala aplicada el renglón muestra el precio por unidad que se cobra', () => {
    expect(precioVigenteRenglon({ precio: 1300, escalaDesde: 3, escalaPrecio: 1300 })).toEqual({ tipo: 'bulto', precio: 1300, texto: 'Precio bulto $1.300 c/u' });
    expect(precioVigenteRenglon({ precio: 1500 })).toMatchObject({ tipo: 'unidad' });
  });
});
