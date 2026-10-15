// REQ-SST (AC-SST-1/2): vender sin stock con aviso.
import { avisoSinStock, resumenSinStock, stockParaAviso, decidirFacturacion, calcularStock, verificarStock } from '../stock';
import { avisosItemPedido } from '../productos';

describe('REQ-SST aviso sin stock', () => {
  it('AC-SST-1 avisoSinStock: "Sin stock (hay N)" y null si alcanza o no hay dato', () => {
    expect(avisoSinStock(5, 3)).toBe('Sin stock (hay 3)');
    expect(avisoSinStock(5, 0)).toBe('Sin stock (hay 0)');
    expect(avisoSinStock(5, -2)).toBe('Sin stock (hay -2)');
    expect(avisoSinStock(3, 3)).toBeNull();
    expect(avisoSinStock(3, undefined)).toBeNull();
    expect(avisoSinStock(3, null)).toBeNull();
  });
  it('AC-SST-1 avisosItemPedido usa el aviso nuevo', () => {
    expect(avisosItemPedido({ minimoVenta: 1 }, 5, 3)).toEqual(['Sin stock (hay 3)']);
  });
  it('AC-SST-1 resumenSinStock: "3 productos quedan con stock negativo"', () => {
    const f = [1, 2, 3].map(i => ({ productoId: String(i), nombre: `P${i}`, disponible: 0, resultante: -i }));
    expect(resumenSinStock(f)).toMatch(/^3 productos quedan con stock negativo/);
    expect(resumenSinStock(f)).toMatch(/P2: hay 0, queda -2/);
    expect(resumenSinStock(f.slice(0, 1))).toMatch(/^1 producto queda con stock negativo/);
    expect(resumenSinStock([])).toBe('');
  });
  it('AC-SST-1 stockParaAviso suma lo ya descontado y tolera mapa vacío', () => {
    const m = new Map([['1', 2]]);
    expect(stockParaAviso(m, 1)).toBe(2);
    expect(stockParaAviso(m, 1, 5)).toBe(7);
    expect(stockParaAviso(m, 9)).toBeUndefined();
    expect(stockParaAviso(undefined, 1)).toBeUndefined();
  });
  it('AC-SST-1 con la política advertir nunca se bloquea; AC-SST-2 el stock queda negativo', () => {
    const mov = [{ productoId: 1, cantidad: -5 }];
    const faltantes = verificarStock(mov, calcularStock([{ productoId: 1, cantidad: 2 }]), [{ id: 1, nombre: 'A' }]);
    expect(faltantes[0].resultante).toBe(-3);
    expect(decidirFacturacion(faltantes, 'advertir')).toBe('confirmar');
    expect(decidirFacturacion(faltantes)).not.toBe('bloquear');
    expect(calcularStock([{ productoId: 1, cantidad: 2 }, ...mov]).get('1')).toBe(-3);
  });
});
