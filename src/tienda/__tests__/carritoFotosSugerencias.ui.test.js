// TIE-SUG: el carrito muestra la foto de cada producto elegido y sugiere
// productos de los mismos rubros que todavía no están en el carrito.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Carrito from '../Carrito';
import TarjetaProducto from '../TarjetaProducto';
import { rubrosParaMenu } from '../TiendaApp';
import { volarAlCarrito } from '../animaciones';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const P = (id, rubro, extra = {}) => ({
  id, nombre: `Producto ${id}`, rubro, marca: '', precio: 1000, disponible: true, bultoX: 1, ventaPor: 'unidad', ...extra,
});
const productos = [
  P('a', 'Golosinas', { imagen: 'https://img.ejemplo/a.png' }),
  P('b', 'Golosinas', { imagen: 'https://img.ejemplo/b.png', precio: 800, precioAnterior: 1000 }),
  P('c', 'Golosinas', { imagen: 'http://inseguro/c.png' }),
  P('d', 'Bebidas'),
];
const catalogoById = new Map(productos.map(p => [String(p.id), p]));

let container;
let root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

const renderCarrito = async (lineas, onAgregar = jest.fn()) => {
  await act(async () => {
    root.render(
      <Carrito lineas={lineas} catalogoById={catalogoById} productos={productos} config={{}} onAgregar={onAgregar}
        onCambiar={() => {}} onQuitar={() => {}} navegar={() => {}} search="" cantidadCarrito={lineas.length} nombreTienda="Tienda" />,
    );
  });
  return onAgregar;
};

describe('TIE-SUG carrito con fotos y sugerencias', () => {
  test('cada renglón muestra la foto https del producto elegido', async () => {
    await renderCarrito([{ productoId: 'a', unidades: 2, modo: 'unidad' }]);
    const linea = container.querySelector('[data-testid="linea-carrito"]');
    expect(linea.querySelector('img').getAttribute('src')).toBe('https://img.ejemplo/a.png');
  });

  test('sugiere solo productos del mismo rubro que no están en el carrito, sin fotos inseguras', async () => {
    await renderCarrito([{ productoId: 'a', unidades: 2, modo: 'unidad' }]);
    const sec = container.querySelector('[data-testid="sugerencias-carrito"]');
    expect(sec.querySelector('h2').textContent).toBe('Sumá más de Golosinas');
    const nombres = Array.from(sec.querySelectorAll('.t-sugerencia-nombre')).map(n => n.textContent);
    expect(nombres).toEqual(['Producto b', 'Producto c']);
    expect(sec.textContent).toContain('20% OFF');
    expect(sec.querySelector('img[src^="http:"]')).toBeNull();
  });

  test('agregar desde una sugerencia llama a onAgregar con ese producto', async () => {
    const onAgregar = await renderCarrito([{ productoId: 'a', unidades: 2, modo: 'unidad' }]);
    await act(async () => { container.querySelector('button[aria-label="Agregar Producto b"]').click(); });
    expect(onAgregar).toHaveBeenCalledTimes(1);
    expect(onAgregar.mock.calls[0][0].id).toBe('b');
  });

  test('con el carrito vacío no hay sugerencias y se invita a ver la tienda', async () => {
    await renderCarrito([]);
    expect(container.querySelector('[data-testid="sugerencias-carrito"]')).toBeNull();
    expect(container.textContent).toContain('Todavía no agregaste productos');
  });
});

describe('TIE-SUG tarjeta, menú de rubros y animación', () => {
  test('la tarjeta muestra el % OFF y el botón Agregar pasa el elemento de origen', async () => {
    const onAgregar = jest.fn();
    await act(async () => { root.render(<TarjetaProducto prod={productos[1]} navegar={() => {}} onAgregar={onAgregar} />); });
    expect(container.textContent).toContain('20% OFF');
    const btn = container.querySelector('.t-btn-primario');
    await act(async () => { btn.click(); });
    expect(onAgregar.mock.calls[0][0].id).toBe('b');
    expect(onAgregar.mock.calls[0][3]).toBe(btn);
  });

  test('rubrosParaMenu ordena por cantidad de productos y respeta el máximo', () => {
    expect(rubrosParaMenu(productos)).toEqual(['Golosinas', 'Bebidas']);
    expect(rubrosParaMenu(productos, 1)).toEqual(['Golosinas']);
    expect(rubrosParaMenu(null)).toEqual([]);
  });

  test('volarAlCarrito no rompe sin Web Animations API ni sin carrito en pantalla', () => {
    expect(() => volarAlCarrito(null)).not.toThrow();
    expect(() => volarAlCarrito(document.body)).not.toThrow();
    expect(document.querySelector('.t-volador')).toBeNull();
  });
});
