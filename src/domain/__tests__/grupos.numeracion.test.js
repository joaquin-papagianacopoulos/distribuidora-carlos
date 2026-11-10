import { filasBoleta, numerarFilasBoleta } from '../gruposFactura';

const it1 = (id, nombre, cantidad = 1, precio = 100) => ({ productoId: id, nombre, cantidad, precio });

describe('AC-RTO-3 numerarFilasBoleta', () => {
  it('AC-RTO-3 numera renglones sueltos 1..n y cuenta items', () => {
    const filas = filasBoleta([it1(1, 'A'), it1(2, 'B'), it1(3, 'C')], []);
    const r = numerarFilasBoleta(filas);
    expect(r.filas.map(f => f.nro)).toEqual([1, 2, 3]);
    expect(r.items).toBe(3);
  });
  it('AC-RTO-3 un grupo REQ-AGR cuenta como un renglon y su detalle no lleva numero', () => {
    const items = [it1(1, 'A'), it1(2, 'B1'), it1(3, 'B2')];
    const filas = filasBoleta(items, [{ id: 'g', nombre: 'Marca B', itemIds: ['2', '3'] }]);
    const r = numerarFilasBoleta(filas);
    expect(r.items).toBe(2);
    expect(r.filas.filter(f => f.tipo === 'detalle').every(f => f.nro === undefined)).toBe(true);
    expect(r.filas.filter(f => f.tipo !== 'detalle').map(f => f.nro)).toEqual([1, 2]);
  });
  it('AC-RTO-3 una linea combinable REQ-GBU cuenta como un renglon', () => {
    const items = [
      { ...it1(1, 'Pelota roja'), grupoBulto: 'pelotas', bultoX: 12 },
      { ...it1(2, 'Pelota azul'), grupoBulto: 'pelotas', bultoX: 12 },
      it1(3, 'Otro'),
    ];
    const r = numerarFilasBoleta(filasBoleta(items, []));
    expect(r.items).toBe(r.filas.length);
    expect(r.items).toBeLessThanOrEqual(3);
  });
  it('AC-RTO-3 vacio o invalido => 0 y no muta', () => {
    expect(numerarFilasBoleta([])).toEqual({ filas: [], items: 0 });
    expect(numerarFilasBoleta(null)).toEqual({ filas: [], items: 0 });
    const filas = [{ tipo: 'item', nombre: 'x' }];
    numerarFilasBoleta(filas);
    expect(filas[0].nro).toBeUndefined();
  });
});
