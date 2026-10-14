// S-VTA-01 (QA): la RPC acepta marca de hasta 120 caracteres pero la constraint 006 limita a 60.
// El dominio corta a 60 ANTES de guardar (normalizarMarca -> normalizarRubro, MAX_RUBRO=60),
// por lo que por la ruta normal nunca llega una marca > 60 a la RPC.
import { validarProducto } from '../productos';
import { normalizarMarca, marcaParaGuardar } from '../marcas';
import { filaProductoRpc } from '../productosRpc';

describe('S-VTA-01 marca 60 vs 120', () => {
  it('AC-VTA-1 normalizarMarca corta a 60 caracteres', () => {
    expect(normalizarMarca('M'.repeat(120))).toHaveLength(60);
  });
  it('AC-VTA-1 validarProducto no deja pasar marca > 60 (con y sin lista de marcas)', () => {
    const base = { codigo: 'C1', nombre: 'Prod', precio: 10 };
    const largo = 'x'.repeat(100);
    expect(validarProducto({ ...base, marca: largo }).producto.marca.length).toBeLessThanOrEqual(60);
    expect(validarProducto({ ...base, marca: largo }, { marcas: [] }).producto.marca.length).toBeLessThanOrEqual(60);
  });
  it('AC-VTA-1 marcaParaGuardar (CSV/plantilla) tambien corta a 60', () => {
    expect(marcaParaGuardar({ marcaForm: 'y'.repeat(90), marcas: [] }).length).toBeLessThanOrEqual(60);
  });
  it('S01-2 filaProductoRpc NO corta: un registro viejo con marca de 100 viaja entera y la constraint 006 lo rechaza como datos_invalidos', () => {
    const fila = filaProductoRpc({ id: 1, nombre: 'A', precio: 1, marca: 'z'.repeat(100) }, { conExtras: false });
    expect(fila.marca).toHaveLength(100);
  });
});
