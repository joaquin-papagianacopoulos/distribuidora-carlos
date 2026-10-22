// REQ-FRB (AC-FRB-1/2/3) y REQ-CON (AC-CON-1): precio de bulto al fraccionar, boleta y contacto del cliente.
import { completarPreciosBulto, precioAplicadoRenglon, totalesBoleta } from '../precios';
import { armarItemsAceptar } from '../pedidosWeb';
import { filasBoleta, SUFIJO_PRECIO_BULTO } from '../gruposFactura';
import {
  CAMPOS_CLIENTE, clienteVacio, validarCliente, clienteExtraToRemote, clienteExtraFromRemote,
  resumenCliente, sinContacto, nombraColumnaContacto,
} from '../clientes';

const DC = { id: 1, precio: 900, precioBulto: 800, bultoX: 16 };
// Renglón de un pedido web: trae precioOriginal pero no los datos de bulto.
const web = (cantidad, precio) => ({ productoId: 1, nombre: 'Dos Corazones', cantidad, precio, precioOriginal: 900, ...(precio === 800 ? { precioPorBulto: true } : {}) });

describe('AC-FRB-1 completarPreciosBulto', () => {
  it('AC-FRB-1 renglón web de 16 u. baja a 10 u. y vuelve a $900', () => {
    const r = completarPreciosBulto(web(16, 800), DC);
    expect(r).toMatchObject({ precio: 800, precioPorBulto: true, precioBultoOriginal: 800, precioBultoX: 16 });
    const baja = precioAplicadoRenglon({ ...r, cantidad: 10 }, 10);
    expect(baja.precio).toBe(900);
    expect(baja.precioPorBulto).toBe(false);
  });
  it('AC-FRB-1 renglón web de 10 u. sube a 16 u. y pasa a $800', () => {
    const r = completarPreciosBulto(web(10, 900), DC);
    expect(precioAplicadoRenglon({ ...r, cantidad: 16 }, 16)).toMatchObject({ precio: 800, precioPorBulto: true });
  });
  it('AC-FRB-1 con cantidad >= bulto, completa y aplica el precio de bulto', () => {
    expect(completarPreciosBulto({ productoId: 1, cantidad: 20, precio: 900, precioOriginal: 900 }, DC)).toMatchObject({ precio: 800, precioPorBulto: true });
  });
  it('AC-FRB-2 precio manual del admin se respeta', () => {
    const manual = { productoId: 1, cantidad: 16, precio: 700, precioOriginal: 900 };
    expect(completarPreciosBulto(manual, DC)).toBe(manual);
  });
  it('AC-FRB-1 si el precio del producto cambió, el renglón queda legacy', () => {
    const it0 = web(16, 800);
    expect(completarPreciosBulto(it0, { ...DC, precio: 1000 })).toBe(it0);
  });
  it('AC-FRB-1 producto sin precio de bulto o sin producto: intacto', () => {
    const it0 = web(16, 900);
    expect(completarPreciosBulto(it0, { ...DC, precioBulto: 0 })).toBe(it0);
    expect(completarPreciosBulto(it0, undefined)).toBe(it0);
  });
  it('AC-FRB-1 armarItemsAceptar completa los datos de bulto de un pedido web', () => {
    const prods = new Map([['1', { ...DC, ventaPor: 'unidad' }]]);
    const r = armarItemsAceptar([web(16, 800)], prods);
    expect(r.items[0]).toMatchObject({ precioBultoOriginal: 800, precioBultoX: 16, precio: 800, subtotal: 12800 });
    expect(r.total).toBe(12800);
  });
});

describe('AC-FRB-2 AC-FRB-3 boleta', () => {
  const r16 = { productoId: 1, nombre: 'Dos Corazones', cantidad: 16, precio: 800, precioOriginal: 900, precioBultoOriginal: 800, precioBultoX: 16, precioPorBulto: true };
  const r10 = { productoId: 1, nombre: 'Dos Corazones', cantidad: 10, precio: 900, precioOriginal: 900, precioBultoOriginal: 800, precioBultoX: 16, precioPorBulto: false };

  it('AC-FRB-3 10 u. -> $9.000 sin descuento; 16 u. -> $12.800 y el bulto no es descuento', () => {
    expect(totalesBoleta([r10])).toEqual({ total: 9000, totalSinDescuento: 9000, descuento: 0, descuentoPct: 0 });
    expect(totalesBoleta([r16])).toEqual({ total: 12800, totalSinDescuento: 12800, descuento: 0, descuentoPct: 0 });
  });
  it('AC-FRB-2 el descuento manual sí se muestra (base = precio sin intervención)', () => {
    const t = totalesBoleta([{ ...r16, precio: 700, precioPorBulto: false }]);
    expect(t.total).toBe(11200);
    expect(t.totalSinDescuento).toBe(16 * 900);
    expect(t.descuento).toBe(16 * 900 - 11200);
  });
  it('AC-FRB-2 la fila lleva la marca "x precio de bulto" solo cuando corresponde', () => {
    const filas = filasBoleta([r16, r10], []);
    expect(filas.find(f => f.cantidadTexto === '16').nombre).toBe(`Dos Corazones${SUFIJO_PRECIO_BULTO}`);
    expect(filas.find(f => f.cantidadTexto === '16').porBulto).toBe(true);
    expect(filas.find(f => f.cantidadTexto === '10').nombre).toBe('Dos Corazones');
    expect(filas.find(f => f.cantidadTexto === '10').porBulto).toBeUndefined();
  });
});

describe('AC-CON-1 contacto del cliente', () => {
  it('AC-CON-1 "Nombre de contacto" va inmediatamente antes de "Celular"', () => {
    const keys = CAMPOS_CLIENTE.map(c => c.key);
    expect(keys.indexOf('contacto')).toBe(keys.indexOf('telefono') - 1);
    expect(CAMPOS_CLIENTE.find(c => c.key === 'contacto').requerido).toBeUndefined();
  });
  it('AC-CON-1 es opcional y se recorta a 80 caracteres', () => {
    const base = { codigo: '1', nombre: 'X', direccion: 'Mitre 1', fechaAlta: '2026-10-22' };
    expect(validarCliente(base).ok).toBe(true);
    expect(validarCliente(base).cliente.contacto).toBe('');
    expect(validarCliente({ ...base, contacto: 'a'.repeat(100) }).cliente.contacto).toHaveLength(80);
    expect(clienteVacio()).toHaveProperty('contacto', '');
  });
  it('AC-CON-1 to/fromRemote: con y sin la columna (cliente viejo conserva lo local)', () => {
    expect(clienteExtraToRemote({ contacto: 'Pepe' }).contacto).toBe('Pepe');
    expect(clienteExtraToRemote({}).contacto).toBeNull();
    expect(clienteExtraFromRemote({ contacto: 'Ana' }, {}).contacto).toBe('Ana');
    expect(clienteExtraFromRemote({}, { contacto: 'Local' }).contacto).toBe('Local');
    expect(clienteExtraFromRemote({}, {}).contacto).toBe('');
  });
  it('AC-CON-1 resumenCliente: código · dirección · contacto · celular, sin vacíos', () => {
    expect(resumenCliente({ codigo: '0001', direccion: 'Mitre 1', contacto: 'Pepe', telefono: '3415551234' })).toBe('0001 · Mitre 1 · Pepe · 3415551234');
    expect(resumenCliente({ direccion: 'Mitre 1', telefono: '3415551234' })).toBe('Mitre 1 · 3415551234');
  });
  it('AC-CON-1 sinContacto y nombraColumnaContacto para el escalón de sync', () => {
    expect(sinContacto({ id: 1, contacto: 'x', cuit: 'y' })).toEqual({ id: 1, cuit: 'y' });
    expect(nombraColumnaContacto({ code: 'PGRST204', message: "Could not find the 'contacto' column of 'clientes' in the schema cache" })).toBe(true);
    expect(nombraColumnaContacto({ code: 'PGRST204', message: "Could not find the 'ciudad' column of 'clientes'" })).toBe(false);
  });
});
