import {
  calcularStock, stockDe, movimientosParaPedido, verificarStock, decidirFacturacion, movimientoAjuste,
  validarIngreso, productosStockBajo, refsPedido, refPedido, efectoDeseado,
  movimientoToRemote, movimientoFromRemote, ingresoToRemote, ingresoFromRemote,
} from '../stock';
import { csvSafe, toNum, toInt, nuevoId, esFechaISO, texto } from '../validacion';

let seq = 0;
const genId = () => `id-${++seq}`;
const now = new Date('2026-10-07T12:00:00Z');
const opts = { genId, now, usuario: 'Jorge' };

const pedido = (over = {}) => ({
  id: 7, remoteId: 700, clienteNombre: 'Kiosco', estado: 'facturado',
  items: [{ productoId: 1, nombre: 'Alfajor', cantidad: 10 }, { productoId: 2, nombre: 'Gaseosa', cantidad: 3 }],
  ...over,
});
const aplicar = (ledger, p) => { const n = movimientosParaPedido(p, ledger, opts); ledger.push(...n); return n; };

describe('REQ-STK ledger', () => {
  it('AC-STK-1 stock = suma de movimientos, ignora basura', () => {
    const m = calcularStock([
      { productoId: 1, cantidad: 10 }, { productoId: '1', cantidad: -3 }, { productoId: 2, cantidad: 5 },
      { productoId: 3, cantidad: 'x' }, null, { cantidad: 4 },
    ]);
    expect(stockDe(m, 1)).toBe(7);
    expect(stockDe(m, '2')).toBe(5);
    expect(stockDe(m, 3)).toBe(0);
    expect(stockDe(undefined, 1)).toBe(0);
  });

  it('AC-STK-2 facturar genera ventas negativas por ítem', () => {
    const ledger = [];
    const n = aplicar(ledger, pedido());
    expect(n).toHaveLength(2);
    expect(n.every(m => m.tipo === 'venta' && m.ref === 'pedido:700')).toBe(true);
    expect(stockDe(calcularStock(ledger), 1)).toBe(-10);
  });

  it('AC-STK-2 suma ítems repetidos del mismo producto e ignora cantidades inválidas', () => {
    const p = pedido({ items: [{ productoId: 1, cantidad: 2 }, { productoId: 1, cantidad: 3 }, { productoId: 9, cantidad: 0 }, { cantidad: 5 }, { productoId: 4, cantidad: 'x' }] });
    const n = movimientosParaPedido(p, [], opts);
    expect(n).toHaveLength(1);
    expect(n[0].cantidad).toBe(-5);
  });

  it('AC-STK-2 un pedido pendiente no mueve stock', () => {
    expect(movimientosParaPedido(pedido({ estado: 'pendiente' }), [], opts)).toEqual([]);
    expect(movimientosParaPedido(null, [], opts)).toEqual([]);
  });

  it('AC-STK-3 revertir a pendiente devuelve el stock', () => {
    const ledger = [{ id: 'ini', productoId: '1', cantidad: 50, ref: 'ajuste:1' }];
    aplicar(ledger, pedido());
    const n = aplicar(ledger, pedido({ estado: 'pendiente' }));
    expect(n.every(m => m.tipo === 'anulacion')).toBe(true);
    expect(stockDe(calcularStock(ledger), 1)).toBe(50);
    expect(stockDe(calcularStock(ledger), 2)).toBe(0);
  });

  it('AC-STK-3 borrar un pedido facturado devuelve el stock', () => {
    const ledger = [];
    aplicar(ledger, pedido());
    aplicar(ledger, pedido({ borrado: true }));
    expect(calcularStock(ledger).get('1')).toBe(0);
    aplicar(ledger, pedido({ estado: 'cancelado' }));
    expect(calcularStock(ledger).get('1')).toBe(0);
  });

  it('AC-STK-4 editar un facturado registra solo la diferencia', () => {
    const ledger = [];
    aplicar(ledger, pedido());
    const n = aplicar(ledger, pedido({ items: [{ productoId: 1, cantidad: 7 }, { productoId: 3, cantidad: 1 }] }));
    const by = Object.fromEntries(n.map(m => [m.productoId, m.cantidad]));
    expect(by).toEqual({ 1: 3, 2: 3, 3: -1 });
    const s = calcularStock(ledger);
    expect([s.get('1'), s.get('2'), s.get('3')]).toEqual([-7, 0, -1]);
  });

  it('AC-STK-5 facturar dos veces no descuenta doble (idempotente)', () => {
    const ledger = [];
    aplicar(ledger, pedido());
    expect(aplicar(ledger, pedido())).toEqual([]);
    expect(aplicar(ledger, pedido())).toEqual([]);
    expect(calcularStock(ledger).get('1')).toBe(-10);
  });

  it('AC-STK-5 reconoce movimientos hechos con ref local antes de tener remoteId', () => {
    const ledger = [];
    aplicar(ledger, pedido({ remoteId: undefined }));
    expect(ledger[0].ref).toBe('pedido-local:7');
    expect(aplicar(ledger, pedido())).toEqual([]); // ya con remoteId: no duplica
    expect(refsPedido({ id: 7, remoteId: 700 })).toEqual(['pedido:700', 'pedido-local:7']);
    expect(refsPedido({})).toEqual([]);
    expect(refPedido({ id: 3 })).toBe('pedido-local:3');
    expect(efectoDeseado(undefined).size).toBe(0);
  });

  it('AC-STK-6 detecta faltantes y decide según política', () => {
    const stock = calcularStock([{ productoId: 1, cantidad: 4 }, { productoId: 2, cantidad: 100 }]);
    const nuevos = movimientosParaPedido(pedido(), [], opts);
    const f = verificarStock(nuevos, stock, [{ id: 1, nombre: 'Alfajor' }]);
    expect(f).toEqual([{ productoId: '1', nombre: 'Alfajor', disponible: 4, requerido: 10, resultante: -6 }]);
    expect(decidirFacturacion(f, 'advertir')).toBe('confirmar');
    expect(decidirFacturacion(f, 'bloquear')).toBe('bloquear');
    expect(decidirFacturacion([], 'bloquear')).toBe('ok');
    expect(verificarStock([{ productoId: 1, cantidad: 5 }], stock)).toEqual([]); // ingreso no falta
  });

  it('AC-STK-7 stock bajo = stock ≤ mínimo de venta', () => {
    const stock = calcularStock([{ productoId: 1, cantidad: 2 }, { productoId: 2, cantidad: 50 }]);
    const bajos = productosStockBajo([{ id: 1, minimoVenta: 6 }, { id: 2, minimoVenta: 6 }, { id: 3 }], stock);
    expect(bajos.map(p => p.id)).toEqual([1, 3]);
  });

  it('AC-STK-8 movimientos llevan UUID propio y mapean a Supabase sin perder datos', () => {
    const m = movimientosParaPedido(pedido(), [], { now, usuario: 'Jorge' })[0];
    expect(m.id).toMatch(/^[0-9a-f-]{36}$/);
    const back = movimientoFromRemote(movimientoToRemote(m));
    expect(back).toMatchObject({ id: m.id, productoId: '1', cantidad: -10, tipo: 'venta', ref: 'pedido:700', pendingSync: false });
    expect(movimientoFromRemote({ id: 'x', producto_id: 3, cantidad: '2' })).toMatchObject({ productoId: '3', cantidad: 2, usuario: '', nota: '' });
  });
});

describe('AC-PROD-3 ajustes de stock', () => {
  it('AC-PROD-3 stock inicial y ajuste generan la diferencia', () => {
    expect(movimientoAjuste(1, 0, 24, { ...opts, inicial: true })).toMatchObject({ cantidad: 24, tipo: 'inicial', productoId: '1' });
    expect(movimientoAjuste(1, 24, 20, opts)).toMatchObject({ cantidad: -4, tipo: 'ajuste' });
    expect(movimientoAjuste(1, 20, '20', opts)).toBeNull();
    expect(movimientoAjuste(1, undefined, 3, opts).cantidad).toBe(3);
    expect(() => movimientoAjuste(1, 0, -1, opts)).toThrow();
    expect(() => movimientoAjuste(1, 0, '2.5', opts)).toThrow();
    expect(() => movimientoAjuste(1, 0, 1000001, opts)).toThrow(); // S-12 tope = CHECK de Supabase
    expect(() => movimientoAjuste(1, -999999, 999999, opts)).toThrow(/dos pasos/);
  });
});

describe('REQ-ING ingreso de mercadería', () => {
  const productos = [{ id: 1, codigo: 'ALF', nombre: 'Alfajor' }, { id: 2, codigo: 'GAS', nombre: 'Gaseosa' }];
  const proveedores = [{ id: 'p-1', codigo: 'ARC', descripcion: 'Arcor' }];
  const stockMap = calcularStock([{ productoId: 1, cantidad: 5 }]);
  const ctx = { productos, proveedores, stockMap, ingresosExistentes: [], ...opts };

  it('AC-ING-1 / AC-ING-2 / AC-ING-5 arma renglones con stock actual, ingreso y total', () => {
    const r = validarIngreso({ facturaProveedor: ' A-0001-123 ', proveedorId: 'p-1', items: [{ productoId: 1, ingreso: '12' }, { productoId: '2', ingreso: 3 }] }, ctx);
    expect(r.ok).toBe(true);
    expect(r.ingreso).toMatchObject({ facturaProveedor: 'A-0001-123', proveedorNombre: 'Arcor', usuario: 'Jorge' });
    expect(r.ingreso.items).toEqual([
      { productoId: '1', codigo: 'ALF', descripcion: 'Alfajor', stockActual: 5, ingreso: 12, stockTotal: 17 },
      { productoId: '2', codigo: 'GAS', descripcion: 'Gaseosa', stockActual: 0, ingreso: 3, stockTotal: 3 },
    ]);
    // AC-ING-5: el stock sube exactamente en "ingreso"
    const after = calcularStock([{ productoId: 1, cantidad: 5 }, ...r.movimientos]);
    expect([after.get('1'), after.get('2')]).toEqual([17, 3]);
    expect(r.movimientos.every(m => m.tipo === 'ingreso' && m.ref === `ingreso:${r.ingreso.id}`)).toBe(true);
  });

  it('AC-ING-3 ingreso entero > 0 y sin productos repetidos', () => {
    const r = validarIngreso({ facturaProveedor: 'F1', proveedorId: 'p-1', items: [{ productoId: 1, ingreso: '0' }, { productoId: 2, ingreso: '1.5' }, { productoId: 2, ingreso: 1 }, { productoId: 99, ingreso: 1 }] }, ctx);
    expect(r.ok).toBe(false);
    // errores por producto (B5): '1' cero, '2' decimal y luego repetido, '99' inexistente
    expect(Object.keys(r.errores).sort()).toEqual(['item:1', 'item:2', 'item:99']);
    const rep = validarIngreso({ facturaProveedor: 'F1', proveedorId: 'p-1', items: [{ productoId: 1, ingreso: 1 }, { productoId: 1, ingreso: 1 }] }, ctx);
    expect(rep.errores['item:1']).toMatch(/repetido/);
    expect(validarIngreso({ facturaProveedor: 'F1', proveedorId: 'p-1', items: [{ productoId: 1, ingreso: 2000000 }] }, ctx).ok).toBe(false);
  });

  it('AC-ING-4 factura y proveedor obligatorios; misma factura no se repite', () => {
    const r = validarIngreso({ items: [] }, ctx);
    expect(Object.keys(r.errores).sort()).toEqual(['facturaProveedor', 'items', 'proveedorId']);
    expect(validarIngreso({ facturaProveedor: 'F', proveedorId: 'zzz', items: [{ productoId: 1, ingreso: 1 }] }, ctx).errores.proveedorId).toMatch(/inexistente/);
    const dup = validarIngreso({ facturaProveedor: 'a-0001-123', proveedorId: 'p-1', items: [{ productoId: 1, ingreso: 1 }] },
      { ...ctx, ingresosExistentes: [{ proveedorId: 'p-1', facturaProveedor: 'A-0001-123' }] });
    expect(dup.errores.facturaProveedor).toMatch(/ya fue ingresada/);
    // misma factura de OTRO proveedor sí se permite
    const otro = validarIngreso({ facturaProveedor: 'A-0001-123', proveedorId: 'p-1', items: [{ productoId: 1, ingreso: 1 }] },
      { ...ctx, ingresosExistentes: [{ proveedorId: 'p-2', facturaProveedor: 'A-0001-123' }] });
    expect(otro.ok).toBe(true);
    expect(validarIngreso(undefined, undefined).ok).toBe(false);
  });

  it('AC-ING-6 mapeo del historial a/desde Supabase', () => {
    const r = validarIngreso({ facturaProveedor: 'F9', proveedorId: 'p-1', items: [{ productoId: 1, ingreso: 1 }] }, ctx);
    const back = ingresoFromRemote(ingresoToRemote(r.ingreso));
    expect(back).toMatchObject({ id: r.ingreso.id, facturaProveedor: 'F9', proveedorId: 'p-1', items: r.ingreso.items, pendingSync: false });
    expect(ingresoFromRemote({ id: 'x', items: null }).items).toEqual([]);
  });
});

describe('AC-SEC-2 / AC-SEC-3 helpers de validación', () => {
  it('AC-SEC-3 csvSafe neutraliza fórmulas y respeta números', () => {
    expect(csvSafe('=HYPERLINK("http://x")')).toBe('\'=HYPERLINK("http://x")');
    expect(csvSafe('+1+1')).toBe("'+1+1");
    expect(csvSafe('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvSafe('-10')).toBe('-10');
    expect(csvSafe('-1,5')).toBe('-1,5');
    expect(csvSafe('Coca')).toBe('Coca');
    expect(csvSafe(5)).toBe(5);
    expect(csvSafe(null)).toBe('');
  });
  it('AC-SEC-2 toNum/toInt rechazan basura, Infinity y notación rara', () => {
    expect(toNum('1.234,56')).toBe(1234.56);
    expect(toNum('$ 10')).toBe(10);
    expect(toNum('1e9')).toBeNull();
    expect(toNum('Infinity')).toBeNull();
    expect(toNum(Infinity)).toBeNull();
    expect(toNum('')).toBeNull();
    expect(toNum('  ')).toBeNull();
    expect(toInt('3')).toBe(3);
    expect(toInt('3,5')).toBeNull();
    expect(texto(undefined)).toBe('');
  });
  it('nuevoId genera UUID v4 aun sin crypto.randomUUID', () => {
    const orig = globalThis.crypto;
    const ids = new Set(Array.from({ length: 50 }, () => nuevoId()));
    expect(ids.size).toBe(50);
    try {
      Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues: (b) => b.fill(7) }, configurable: true });
      expect(nuevoId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
      expect(nuevoId()).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: orig, configurable: true });
    }
  });
  it('esFechaISO valida calendario real', () => {
    expect(esFechaISO('2024-02-29')).toBe(true);
    expect(esFechaISO('2026-02-29')).toBe(false);
    expect(esFechaISO('07/10/2026')).toBe(false);
  });
});

describe('AC-SEC-2 toNum con separadores de miles (iter 3)', () => {
  it('AC-SEC-2 el ultimo separador es el decimal', () => {
    expect(toNum('1.234,50')).toBe(1234.5);
    expect(toNum('1,234.50')).toBe(1234.5);
    expect(toNum('1.234.567,8')).toBe(1234567.8);
    expect(toNum('2,5')).toBe(2.5);
    expect(toNum('$1.234,50')).toBe(1234.5);
    expect(toNum('1e15')).toBeNull();
    expect(toNum('consultar')).toBeNull();
  });
});
