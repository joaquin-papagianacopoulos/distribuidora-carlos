// REQ-GBU (AC-GBU-1..4): productos combinables para llegar al bulto.
import {
  normalizarGrupoBulto, claveGrupoBulto, preciosPorGrupoBulto, progresoGrupoBulto, lineaGrupoBulto,
} from '../grupoBulto';
import { renglonNuevo } from '../bultos';
import { filasBoleta, totalFilasBoleta, SUFIJO_PRECIO_BULTO } from '../gruposFactura';
import { totalesBoleta } from '../precios';
import { validarProducto, productoPreciosToRemote, productoExtraFromRemote, CAMPOS_PRODUCTO, COLUMNAS_PRODUCTO_PUBLICAS } from '../productos';

// Unidad $1.000, llevando bulto $900, bulto x24.
const prime = (id, color, extra = {}) => ({ id, nombre: `Prime ${color}`, precio: 1000, precioBulto: 900, bultoX: 24, ventaPor: 'ambos', grupoBulto: 'Prime', ...extra });
const ROJO = prime(1, 'Rojo');
const AZUL = prime(2, 'Azul');
const VIOLETA = prime(3, 'Violeta');
const conCant = (p, cantidad) => ({ ...renglonNuevo(p), cantidad });

describe('AC-GBU-1 normalizacion del grupo', () => {
  it('espacios, tope y clave sin mayusculas ni tildes', () => {
    expect(normalizarGrupoBulto('  Prime   Max ')).toBe('Prime Max');
    expect(normalizarGrupoBulto(null)).toBe('');
    expect(normalizarGrupoBulto('x'.repeat(60))).toHaveLength(40);
    expect(claveGrupoBulto('PRÍME ')).toBe(claveGrupoBulto('prime'));
  });
  it('validarProducto guarda el grupo y el sync lo manda solo si se conoce', () => {
    const r = validarProducto({ codigo: 'P1', nombre: 'Prime Rojo', precio: '1000', grupoBulto: ' Prime ' });
    expect(r.producto.grupoBulto).toBe('Prime');
    expect(productoPreciosToRemote({ grupoBulto: 'Prime' }).grupo_bulto).toBe('Prime');
    expect(productoPreciosToRemote({ grupoBulto: '' }).grupo_bulto).toBeNull();
    expect(productoPreciosToRemote({})).not.toHaveProperty('grupo_bulto');
    expect(productoExtraFromRemote({ grupo_bulto: 'Prime' }).grupoBulto).toBe('Prime');
    expect(productoExtraFromRemote({}, { grupoBulto: 'Local' }).grupoBulto).toBe('Local');
    expect(CAMPOS_PRODUCTO.some(c => c.key === 'grupoBulto')).toBe(true);
    expect(COLUMNAS_PRODUCTO_PUBLICAS).toContain('grupo_bulto');
  });
  it('el renglon nuevo congela el grupo del producto', () => {
    expect(renglonNuevo(ROJO).grupoBulto).toBe('Prime');
    expect(renglonNuevo({ ...ROJO, grupoBulto: '' })).not.toHaveProperty('grupoBulto');
  });
});

describe('AC-GBU-2 precio de bulto por grupo', () => {
  it('bajo el bulto del grupo: precio por unidad', () => {
    const items = preciosPorGrupoBulto([conCant(ROJO, 3), conCant(AZUL, 3), conCant(VIOLETA, 3)]);
    expect(items.map(i => i.precio)).toEqual([1000, 1000, 1000]);
  });
  it('al llegar a 24 entre colores, todos pasan a precio de bulto', () => {
    const items = preciosPorGrupoBulto([conCant(ROJO, 8), conCant(AZUL, 8), conCant(VIOLETA, 8)]);
    expect(items.map(i => i.precio)).toEqual([900, 900, 900]);
    expect(items.every(i => i.precioPorBulto === true)).toBe(true);
  });
  it('lo que sobra del bulto tambien va a precio de bulto', () => {
    const items = preciosPorGrupoBulto([conCant(ROJO, 12), conCant(AZUL, 12), conCant(VIOLETA, 6)]);
    expect(items.map(i => i.precio)).toEqual([900, 900, 900]);
  });
  it('si el grupo baja del bulto, vuelve al precio por unidad', () => {
    const arriba = preciosPorGrupoBulto([conCant(ROJO, 12), conCant(AZUL, 12)]);
    const abajo = preciosPorGrupoBulto([{ ...arriba[0], cantidad: 11 }, arriba[1]]);
    expect(abajo.map(i => i.precio)).toEqual([1000, 1000]);
    expect(abajo.some(i => i.precioPorBulto)).toBe(false);
  });
  it('no mezcla grupos distintos ni bultos distintos, e ignora eliminados', () => {
    const otro = prime(4, 'Negro', { grupoBulto: 'Otro' });
    const x12 = prime(5, 'Blanco', { bultoX: 12 });
    const items = preciosPorGrupoBulto([conCant(ROJO, 12), conCant(otro, 12), conCant(x12, 6), { ...conCant(AZUL, 12), eliminado: true }]);
    expect(items.map(i => i.precio)).toEqual([1000, 1000, 1000, 1000]);
  });
  it('precio manual se respeta y sin grupos devuelve el mismo array', () => {
    const manual = { ...conCant(ROJO, 12), precio: 500, precioManual: true };
    const items = preciosPorGrupoBulto([manual, conCant(AZUL, 12)]);
    expect(items[0].precio).toBe(500);
    expect(items[1].precio).toBe(900);
    const sin = [{ productoId: 9, nombre: 'X', cantidad: 3, precio: 10 }];
    expect(preciosPorGrupoBulto(sin)).toBe(sin);
  });
  it('progreso para la pantalla', () => {
    const items = [conCant(ROJO, 3), conCant(AZUL, 6)];
    expect(progresoGrupoBulto(items[0], items).texto).toBe('Prime: 9 de 24 para precio de bulto');
    const llenos = [conCant(ROJO, 20), conCant(AZUL, 6)];
    expect(progresoGrupoBulto(llenos[0], llenos)).toMatchObject({ llego: true, total: 26 });
    expect(progresoGrupoBulto({ productoId: 9, cantidad: 1 }, items)).toBeNull();
  });
});

describe('AC-GBU-3 factura en una sola linea', () => {
  const boleta = (items) => filasBoleta(preciosPorGrupoBulto(items), []);
  const peso = (n) => `$${Number(n).toLocaleString('es-AR')}`;

  it('24 u. entre colores => "Prime (bulto x24)" | 1 | precio del bulto', () => {
    const items = [conCant(ROJO, 8), conCant(AZUL, 8), conCant(VIOLETA, 8)];
    const filas = boleta(items);
    expect(filas).toHaveLength(1);
    expect(filas[0].nombre).toBe(`Prime (bulto x24)${SUFIJO_PRECIO_BULTO}`);
    expect(filas[0].cantidadTexto).toBe('1');
    expect(filas[0].precioTexto).toBe(peso(21600));
    expect(filas[0].subtotal).toBe(21600);
    expect(totalFilasBoleta(filas)).toBe(totalesBoleta(preciosPorGrupoBulto(items)).total);
  });
  it('30 u. => "1 bulto + 6 u." en una linea, todo a precio de bulto', () => {
    const filas = boleta([conCant(ROJO, 12), conCant(AZUL, 12), conCant(VIOLETA, 6)]);
    expect(filas).toHaveLength(1);
    expect(filas[0].cantidadTexto).toBe('1 bulto + 6 u.');
    expect(filas[0].precioTexto).toBe(`${peso(900)} c/u`);
    expect(filas[0].subtotal).toBe(27000);
  });
  it('9 u. (bajo el bulto) => "Prime" | 9 | precio por unidad, sin colores', () => {
    const filas = boleta([conCant(ROJO, 3), conCant(AZUL, 3), conCant(VIOLETA, 3)]);
    expect(filas).toEqual([expect.objectContaining({ tipo: 'item', nombre: 'Prime', cantidadTexto: '9', precioTexto: peso(1000), subtotal: 9000 })]);
  });
  it('48 u. => 2 bultos; los otros renglones quedan como siempre y ordenados', () => {
    const filas = boleta([conCant(ROJO, 24), conCant(AZUL, 24), { productoId: 9, nombre: 'Alfajor', cantidad: 2, precio: 50 }]);
    expect(filas.map(f => [f.nombre, f.cantidadTexto])).toEqual([['Alfajor', '2'], [`Prime (bulto x24)${SUFIJO_PRECIO_BULTO}`, '2']]);
  });
  it('un solo producto del grupo sale con su nombre', () => {
    const filas = boleta([conCant(ROJO, 3)]);
    expect(filas[0].nombre).toBe('Prime Rojo');
  });
  it('un grupo armado a mano (REQ-AGR) manda sobre el grupo bulto', () => {
    const items = preciosPorGrupoBulto([conCant(ROJO, 12), conCant(AZUL, 12)]);
    const filas = filasBoleta(items, [{ id: 'g', nombre: 'Aromas', itemIds: ['1', '2'] }]);
    expect(filas.map(f => f.tipo)).toEqual(['grupo', 'detalle', 'detalle']);
  });
  it('precios distintos en el grupo => columna precio vacia, subtotal correcto', () => {
    const r = lineaGrupoBulto([{ grupoBulto: 'Prime', precioBultoX: 24, cantidad: 3, precio: 1000 }, { grupoBulto: 'Prime', precioBultoX: 24, cantidad: 3, precio: 800 }]);
    expect(r.precioTexto).toBe('');
    expect(r.subtotal).toBe(5400);
  });
});

describe('AC-GBU-4 dominio sin romper pedidos viejos', () => {
  it('AC-GBU-4 un producto sin grupo no se combina y sus totales no cambian', () => {
    const suelto = conCant({ id: 9, nombre: 'Suelto', precio: 500, bultoX: 6, ventaPor: 'unidad' }, 3);
    expect(claveGrupoBulto(undefined)).toBe(claveGrupoBulto(''));
    const filas = filasBoleta([suelto]);
    expect(totalFilasBoleta(filas)).toBe(1500);
  });
});
