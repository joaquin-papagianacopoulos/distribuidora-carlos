// QA RUN 20261110-t0: bordes de REQ-PVC y REQ-SEG2 (sin duplicar lo del implementador).
import { COLUMNAS_PLANTILLA, planificarImportacion } from '../plantillas';
import { validarProducto } from '../productos';
import { debeRecalcularPrecio, productosConPrecioSospechoso } from '../precioCosto';
import { armarRespaldo, contarPendientes, esPendiente, decidirBorradoCache, confirmacionEscritaValida } from '../respaldo';
import { idsFaltantesABorrar, idsSinCambios } from '../syncGuardas';
import { asegurarClientUuid, mapearRemoteIds } from '../pedidosIdempotencia';

const LP = COLUMNAS_PLANTILLA.productos.map(c => c.label);
const fila = (obj) => LP.map(l => (obj[l] === undefined ? '' : obj[l]));
const EX = { id: 7, codigo: 'E1', nombre: 'Ex', costoFinal: 1000, descuento1: 0, descuento2: 0, ganancia: 30, precio: 1300, bultoX: 1, minimoVenta: 1 };

describe('AC-PVC-1 importacion Excel sobre existente (caso 1)', () => {
  test('AC-PVC-1 existente con ganancia 30 y precio a mano: costo nuevo con precio vacio conserva el precio', () => {
    const plan = planificarImportacion([LP, fila({ 'Código': 'E1', 'Costo final': 5000 })], 'productos', { existentes: [{ ...EX, precio: 1999 }] });
    expect(plan.entradas[0].valor.producto.precio).toBe(1999);
  });
  test('AC-PVC-1 ganancia explicita 0 en la fila y precio vacio conserva el precio (no lo lleva al costo)', () => {
    const plan = planificarImportacion([LP, fila({ 'Código': 'E1', 'Costo final': 5000, '% Ganancia': 0 })], 'productos', { existentes: [EX] });
    expect(plan.entradas[0].accion).toBe('actualizar');
    expect(plan.entradas[0].valor.producto.precio).toBe(1300);
  });
  test('AC-PVC-1 precio vacio nunca termina igual al costo nuevo', () => {
    const plan = planificarImportacion([LP, fila({ 'Código': 'E1', 'Costo final': 800, '% Ganancia': 0 })], 'productos', { existentes: [EX] });
    expect(plan.entradas[0].valor.producto.precio).not.toBe(800);
  });
  test('AC-PVC-1 debeRecalcularPrecio sin existente (alta) es true; ganancia negativa o basura no recalcula', () => {
    expect(debeRecalcularPrecio(null, {})).toBe(true);
    expect(debeRecalcularPrecio(EX, { ganancia: '-5' })).toBe(false);
    expect(debeRecalcularPrecio(EX, { ganancia: 'abc' })).toBe(false);
  });
});

describe('AC-PVC-2 alta con costo>0 sin precio (caso 2)', () => {
  const base = { codigo: 'A', nombre: 'A', costoFinal: '100', precio: '' };
  test.each([[undefined], [null], [''], ['0'], [0], ['  ']])('AC-PVC-2 ganancia %p es error en precio', (g) => {
    const r = validarProducto({ ...base, ganancia: g });
    expect(r.ok).toBe(false);
    expect(r.errores.precio).toBe('Falta el precio de venta o el % de ganancia');
  });
  test('AC-PVC-2 precio undefined con costo tambien es error', () => {
    expect(validarProducto({ ...base, precio: undefined }).ok).toBe(false);
  });
  test('AC-PVC-2 alta por planilla con ganancia 0 y precio vacio se rechaza', () => {
    const plan = planificarImportacion([LP, fila({ 'Código': 'N1', 'Descripción': 'N', 'Costo final': 100, '% Ganancia': 0 })], 'productos');
    expect(plan.entradas[0].accion).toBe('rechazar');
  });
});

describe('AC-PVC-4 bordes', () => {
  test('AC-PVC-4 elementos null y precio vacio con costo conocido', () => {
    const r = productosConPrecioSospechoso([null, { id: 1, costoFinal: '100', precio: '' }, { id: 2, costoFinal: 100, precio: 100.01 }]);
    expect(r.map(x => x.id)).toEqual([1]);
  });
});

describe('AC-SEG2-6 respaldo sin PIN ni claves (caso 6)', () => {
  test('AC-SEG2-6 el JSON final no contiene los valores del PIN, en anidados y arreglos', () => {
    const snap = {
      vendedores: [{ id: 1, nombre: 'Ana', pin: '4321', pinHash: 'HASH-SECRETO', tienePin: true, extra: { PIN: '4321', adminPin: '9999' } }],
      otros: [[{ pin_hash: 'HASH-SECRETO2' }]],
    };
    const txt = JSON.stringify(armarRespaldo(snap));
    for (const s of ['4321', '9999', 'HASH-SECRETO', 'HASH-SECRETO2']) expect(txt).not.toContain(s);
    expect(txt).toContain('Ana');
  });
  test('AC-SEG2-6 snapshot null/undefined no rompe', () => {
    expect(armarRespaldo(null).stores).toEqual({});
    expect(armarRespaldo(undefined).stores).toEqual({});
  });
});

describe('AC-SEG2-2 bordes', () => {
  test('AC-SEG2-2 stores con null o no arreglo y filas null no cuentan', () => {
    expect(contarPendientes({ a: null, b: [null, undefined], pedidos: [{ synced: true }] }).total).toBe(0);
    expect(contarPendientes(undefined).total).toBe(0);
  });
  test('AC-SEG2-2 pedido viejo sin campos nuevos no es pendiente; con synced false si (caso 7)', () => {
    expect(esPendiente('pedidos', { id: 1, remoteId: 'R', items: [] })).toBe(false);
    expect(esPendiente('pedidos', { id: 2, synced: false })).toBe(true);
    expect(esPendiente('clientes', { id: 3, pendingSync: true })).toBe(true);
  });
  test('AC-SEG2-2 total>0 gana sobre offline; sin argumentos permite; BORRAR con espacios y null', () => {
    expect(decidirBorradoCache({ total: 1, online: false }).motivo).toBe('pendientes');
    expect(decidirBorradoCache().permitir).toBe(true);
    expect(confirmacionEscritaValida(' borrar ')).toBe(true);
    expect(confirmacionEscritaValida(null)).toBe(false);
    expect(confirmacionEscritaValida('BORRAR TODO')).toBe(false);
  });
});

describe('AC-SEG2-4 faltantes con lista remota incompleta (caso 5)', () => {
  const locales = [{ id: 1, remoteId: 'a' }, { id: 2, remoteId: 'b' }, { id: 3, remoteId: 'c', pendingSync: true }, { id: 4 }];
  test('AC-SEG2-4 lectura incompleta (completo false u omitido) no purga nada', () => {
    expect(idsFaltantesABorrar(locales, [{ id: 'a' }])).toEqual([]);
    expect(idsFaltantesABorrar(locales, [{ id: 'a' }], { completo: false })).toEqual([]);
  });
  test('AC-SEG2-4 lectura completa no borra pendientes ni sin remoteId; compara ids numericos y string', () => {
    expect(idsFaltantesABorrar([{ id: 1, remoteId: 5 }, ...locales], [{ id: '5' }], { completo: true })).toEqual([1, 2]);
  });
  test('AC-SEG2-4 remotos null o locales null no rompen', () => {
    expect(idsFaltantesABorrar(null, null, { completo: true })).toEqual([]);
    expect(idsFaltantesABorrar(null, [{ id: 1 }], { completo: true })).toEqual([]);
  });
});

describe('AC-SEG2-3 / AC-SEG2-7 bordes', () => {
  test('AC-SEG2-3 pedido viejo sin UUID recibe uno; null no rompe; UUID distintos', () => {
    expect(asegurarClientUuid({ id: 1 }).clientUuid).toBeTruthy();
    expect(asegurarClientUuid(null).clientUuid).toBeTruthy();
    expect(asegurarClientUuid({}).clientUuid).not.toBe(asegurarClientUuid({}).clientUuid);
  });
  test('AC-SEG2-3 mapearRemoteIds ignora enviados sin UUID y respuesta vacia', () => {
    expect(mapearRemoteIds([{ localId: 1 }], [{ id: 'x', client_uuid: 'u' }])).toEqual([]);
    expect(mapearRemoteIds([{ localId: 1, clientUuid: 'u' }], null)).toEqual([]);
  });
  test('AC-SEG2-7 idsSinCambios: registro borrado, sin updatedAt (viejo) y editado', () => {
    expect(idsSinCambios([{ id: 1, updatedAt: 5 }], [])).toEqual([]);
    expect(idsSinCambios([{ id: 1 }], [{ id: 1 }])).toEqual([1]);
    expect(idsSinCambios([{ id: 1, updatedAt: 5 }], [{ id: 1, updatedAt: 6 }])).toEqual([]);
  });
});
