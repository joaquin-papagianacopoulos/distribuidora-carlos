// AC-ESC-1: escalas por bulto en el producto (validacion, sync, columnas publicas).
import {
  validarProducto, productoPreciosToRemote, productoExtraFromRemote, COLUMNAS_PRODUCTO_PUBLICAS, COSTOS_PRODUCTO,
  columnasSinLaMasNueva, CAMPOS_PRODUCTO,
} from '../productos';
import { filaProductoRpc } from '../productosRpc';

const base = { codigo: 'P1', nombre: 'Prime', precio: '1000', bultoX: '10' };
const esc = (...f) => f.map(([d, p]) => ({ desde: d, pct: p }));

describe('AC-ESC-1 validarProducto con escalas', () => {
  it('AC-ESC-1 sin escalas el producto queda con []', () => {
    const r = validarProducto(base);
    expect(r.ok).toBe(true);
    expect(r.producto.escalasBulto).toEqual([]);
  });
  it('AC-ESC-1 guarda las escalas normalizadas', () => {
    const r = validarProducto({ ...base, escalasBulto: esc(['5', '8'], ['10', '12,5'], ['', '']) });
    expect(r.ok).toBe(true);
    expect(r.producto.escalasBulto).toEqual([{ desde: 5, pct: 8 }, { desde: 10, pct: 12.5 }]);
  });
  it('AC-ESC-1 error en el campo escalasBulto y no se guarda ninguna', () => {
    const r = validarProducto({ ...base, escalasBulto: esc(['5', '8'], ['4', '9']) });
    expect(r.ok).toBe(false);
    expect(r.errores.escalasBulto).toBeTruthy();
    expect(r.producto.escalasBulto).toEqual([]);
  });
  it('AC-ESC-1 con Bulto x = 1 las escalas son un error', () => {
    const r = validarProducto({ ...base, bultoX: '1', escalasBulto: esc(['5', '8']) });
    expect(r.errores.escalasBulto).toMatch(/Bulto x/);
  });
  it('AC-ESC-1 descuento que no crece es solo aviso', () => {
    const r = validarProducto({ ...base, escalasBulto: esc(['5', '10'], ['8', '8']) });
    expect(r.ok).toBe(true);
    expect(r.avisos.escalasBulto).toBeTruthy();
  });
  it('AC-ESC-1 el campo va al final de CAMPOS_PRODUCTO (no corre columnas viejas)', () => {
    expect(CAMPOS_PRODUCTO[CAMPOS_PRODUCTO.length - 1]).toMatchObject({ key: 'escalasBulto', label: 'Escalas por bulto' });
  });
});

describe('AC-ESC-1 sync de escalas_bulto', () => {
  it('AC-ESC-1 clave ausente no viaja (el servidor conserva)', () => {
    expect(productoPreciosToRemote({ precioBulto: 0 })).not.toHaveProperty('escalas_bulto');
  });
  it('AC-ESC-1 viaja normalizado, y null si no hay escalas', () => {
    expect(productoPreciosToRemote({ escalasBulto: esc([5, 8], [4, 9]) }).escalas_bulto).toEqual([{ desde: 5, pct: 8 }]);
    expect(productoPreciosToRemote({ escalasBulto: [] }).escalas_bulto).toBeNull();
    expect(filaProductoRpc({ id: 1, precio: 1, escalasBulto: esc([5, 8]) }, { conExtras: true }).escalas_bulto).toEqual([{ desde: 5, pct: 8 }]);
    expect(filaProductoRpc({ id: 1, precio: 1, escalasBulto: esc([5, 8]) }, { conExtras: false })).not.toHaveProperty('escalas_bulto');
  });
  it('AC-ESC-1 desde remoto: ausente conserva lo local; null => []; basura se ignora', () => {
    const local = { escalasBulto: esc([5, 8]) };
    expect(productoExtraFromRemote({}, local).escalasBulto).toEqual([{ desde: 5, pct: 8 }]);
    expect(productoExtraFromRemote({ escalas_bulto: null }, local).escalasBulto).toEqual([]);
    expect(productoExtraFromRemote({ escalas_bulto: [{ desde: 3, pct: 5 }, 'x'] }, {}).escalasBulto).toEqual([{ desde: 3, pct: 5 }]);
    expect(productoExtraFromRemote({}, {}).escalasBulto).toEqual([]);
  });
});

describe('AC-ESC-1 columnas publicas (regla 8 de CLAUDE.md)', () => {
  it('AC-ESC-1 escalas_bulto es publica y la mas nueva; los costos nunca', () => {
    expect(COLUMNAS_PRODUCTO_PUBLICAS[COLUMNAS_PRODUCTO_PUBLICAS.length - 1]).toBe('escalas_bulto');
    for (const [col] of COSTOS_PRODUCTO) expect(COLUMNAS_PRODUCTO_PUBLICAS).not.toContain(col);
    expect(columnasSinLaMasNueva(COLUMNAS_PRODUCTO_PUBLICAS)).not.toContain('escalas_bulto');
  });
});
