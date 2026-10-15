// Tests de UI del alta/edición de productos (REQ-PROD).
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ProductoForm from '../ProductoForm';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

const render = async (props) => {
  await act(async () => { root.render(<ProductoForm onCancelar={jest.fn()} {...props} />); });
};

const campo = (key) => container.querySelector(`#campo-${key}`);
const setValue = async (el, value) => {
  const isSelect = el.tagName === 'SELECT';
  const proto = isSelect ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event(isSelect ? 'change' : 'input', { bubbles: true }));
  });
};
const llenar = async (valores) => {
  for (const [k, v] of Object.entries(valores)) await setValue(campo(k), v);
};
const click = async (el) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
const boton = (txt) => [...container.querySelectorAll('button')].find(b => b.textContent.startsWith(txt));
const errorDe = (key) => container.querySelector(`[data-error-for="${key}"]`);

const PROVEEDORES = [{ id: 'prov-1', codigo: 'P1', descripcion: 'Arcor' }];

describe('ProductoForm', () => {
  it('AC-PROD-1 muestra las etiquetas del SPEC (AC-VTA-1 suma 4; REQ-STB suma Stock mínimo)', async () => {
    await render({ onGuardar: jest.fn() });
    const labels = [...container.querySelectorAll('label.input-label')]
      .map(l => l.textContent.replace(/ \*$/, '').replace(/ \([^)]*\)$/, '').replace(/ \*$/, ''));
    expect(labels).toEqual([
      'Código', 'Descripción', 'Rubro', 'Marca', 'Proveedor', 'Costo final', 'Descuento 1', 'Descuento 2',
      '% Ganancia', 'Precio por unidad', 'Precio por unidad llevando bulto', 'Precio venta 2', 'Bulto x', 'Se vende por', 'Etiqueta del bulto', 'Mostrar en tienda', 'Mínimo venta', 'Stock mínimo', 'Stock',
    ]);
  });

  it('AC-PBU-1 avisa (sin bloquear) si el precio llevando bulto supera al precio por unidad', async () => {
    const onGuardar = jest.fn();
    await render({ onGuardar });
    await setValue(campo('codigo'), 'A1');
    await setValue(campo('nombre'), 'Algo');
    await setValue(campo('precio'), '900');
    await setValue(campo('precioBulto'), '1000');
    expect(container.textContent).toMatch(/precio llevando bulto es mayor/);
    await click(boton('Guardar'));
    expect(onGuardar).toHaveBeenCalled();
    expect(onGuardar.mock.calls[0][0]).toMatchObject({ precio: 900, precioBulto: 1000 });
  });

  it('AC-PROD-1 recalcula Precio venta 1 al cambiar costo, descuentos y ganancia', async () => {
    await render({ onGuardar: jest.fn() });
    await setValue(campo('costoFinal'), '1000');
    expect(campo('precio').value).toBe('1000');
    await setValue(campo('descuento1'), '10');
    expect(campo('precio').value).toBe('900');
    await setValue(campo('descuento2'), '5');
    expect(campo('precio').value).toBe('855');
    await setValue(campo('ganancia'), '30');
    // 1000 × 0,9 × 0,95 × 1,3 = 1111,5
    expect(campo('precio').value).toBe('1111.5');
    // La ayuda muestra costo neto y sugerido
    expect(container.textContent).toMatch(/Costo neto \$855,00/);
  });

  it('AC-PROD-1 redondea a 2 decimales y acepta coma decimal', async () => {
    await render({ onGuardar: jest.fn() });
    await llenar({ costoFinal: '99,99', descuento1: '33,333', ganancia: '17' });
    // 99.99 × 0.66667 = 66.6603 → 66.66 (costoNeto) ; ×1.17 = 77.9925... → 77.99
    const esperado = Math.round(99.99 * (1 - 33.333 / 100) * 1.17 * 100) / 100;
    expect(Number(campo('precio').value)).toBeCloseTo(esperado, 2);
    expect(campo('precio').value.split('.')[1]?.length || 0).toBeLessThanOrEqual(2);
  });

  it('AC-PROD-1 si el usuario pisa el precio a mano deja de recalcularse', async () => {
    await render({ onGuardar: jest.fn() });
    await llenar({ costoFinal: '1000', ganancia: '30' });
    expect(campo('precio').value).toBe('1300');
    await setValue(campo('precio'), '2000');
    await setValue(campo('ganancia'), '50');
    await setValue(campo('costoFinal'), '1200');
    expect(campo('precio').value).toBe('2000');
    expect(container.textContent).toContain('precio cargado a mano');
    // Botón para volver al calculado
    await click(boton('Usar precio calculado'));
    expect(campo('precio').value).toBe('1800');
    await setValue(campo('ganancia'), '0');
    expect(campo('precio').value).toBe('1200');
  });

  it('AC-PROD-1 borrar el precio manual vuelve al modo automático', async () => {
    await render({ onGuardar: jest.fn() });
    await llenar({ costoFinal: '100' });
    await setValue(campo('precio'), '500');
    await setValue(campo('precio'), '');
    await setValue(campo('ganancia'), '10');
    expect(campo('precio').value).toBe('110');
  });

  it('AC-PROD-1 en edición de un producto viejo (precio sin costo) no se pisa el precio', async () => {
    const inicial = { id: 5, codigo: 'A1', nombre: 'Alfajor', precio: 900 };
    await render({ onGuardar: jest.fn(), inicial, existentes: [inicial], stockActual: 7 });
    expect(campo('precio').value).toBe('900');
    expect(campo('stock').value).toBe('7');
    await setValue(campo('costoFinal'), '100');
    expect(campo('precio').value).toBe('900');
  });

  // MOD (RUN 20261014-1449, AC-COMR-3): el Rubro ahora es un selector, así que
  // se renderiza con rubros: ['Bebidas'] (el select necesita la opción). Las
  // aserciones de onGuardar no cambian.
  it('AC-PROD-3 onGuardar recibe (producto, stock) con el stock aparte del producto', async () => {
    const onGuardar = jest.fn(() => Promise.resolve());
    await render({ onGuardar, proveedores: PROVEEDORES, rubros: ['Bebidas'] });
    await llenar({
      codigo: 'CC500', nombre: '  Coca   Cola 500 ', categoria: 'Bebidas', proveedorId: 'prov-1',
      costoFinal: '1000', descuento1: '10', ganancia: '50', precioVenta2: '1400',
      bultoX: '12', minimoVenta: '6', stock: '24',
    });
    await click(boton('Guardar'));
    expect(onGuardar).toHaveBeenCalledTimes(1);
    const [producto, stock] = onGuardar.mock.calls[0];
    expect(stock).toBe(24);
    expect(producto).not.toHaveProperty('stock');
    expect(producto).toMatchObject({
      codigo: 'CC500', nombre: 'Coca Cola 500', categoria: 'Bebidas', proveedorId: 'prov-1',
      costoFinal: 1000, descuento1: 10, descuento2: 0, ganancia: 50, precio: 1350,
      precioVenta2: 1400, bultoX: 12, minimoVenta: 6,
    });
  });

  it('AC-PROD-3 bloqueante 2: en edición, si no se toca Stock, onGuardar recibe (producto, null, stockMostrado)', async () => {
    const onGuardar = jest.fn(() => Promise.resolve());
    const inicial = { id: 5, codigo: 'A1', nombre: 'Alfajor', precio: 900 };
    await render({ onGuardar, inicial, existentes: [inicial], stockActual: 10 });
    // el ledger cambia mientras el form está abierto (sync)
    await render({ onGuardar, inicial, existentes: [inicial], stockActual: 7 });
    expect(campo('stock').value).toBe('10');
    await setValue(campo('precio'), '950');
    await click(boton('Guardar'));
    expect(onGuardar).toHaveBeenCalledWith(expect.objectContaining({ precio: 950 }), null, 10);
  });

  it('AC-PROD-3 bloqueante 2: cambiar Stock 10 → 12 manda (producto, 12, 10) aunque la prop ya sea 7', async () => {
    const onGuardar = jest.fn(() => Promise.resolve());
    const inicial = { id: 5, codigo: 'A1', nombre: 'Alfajor', precio: 900 };
    await render({ onGuardar, inicial, existentes: [inicial], stockActual: 10 });
    await render({ onGuardar, inicial, existentes: [inicial], stockActual: 7 });
    await setValue(campo('stock'), '12');
    await click(boton('Guardar'));
    expect(onGuardar).toHaveBeenCalledWith(expect.anything(), 12, 10);
  });

  it('AC-PROD-3 bloqueante 2: en alta, stock inicial cargado ⇒ (producto, n, 0)', async () => {
    const onGuardar = jest.fn(() => Promise.resolve());
    await render({ onGuardar });
    await llenar({ codigo: 'X', nombre: 'Y', stock: '8' });
    await click(boton('Guardar'));
    expect(onGuardar).toHaveBeenCalledWith(expect.anything(), 8, 0);
  });

  it('AC-PROD-3 sin stock cargado onGuardar recibe stock null', async () => {
    const onGuardar = jest.fn(() => Promise.resolve());
    await render({ onGuardar });
    await llenar({ codigo: 'X1', nombre: 'Algo' });
    await click(boton('Guardar'));
    expect(onGuardar.mock.calls[0][1]).toBeNull();
  });

  it('AC-PROD-3 stock decimal o negativo se rechaza', async () => {
    const onGuardar = jest.fn();
    await render({ onGuardar });
    await llenar({ codigo: 'X1', nombre: 'Algo', stock: '1,5' });
    await click(boton('Guardar'));
    expect(onGuardar).not.toHaveBeenCalled();
    expect(errorDe('stock')).not.toBeNull();
    await setValue(campo('stock'), '-3');
    await click(boton('Guardar'));
    expect(onGuardar).not.toHaveBeenCalled();
  });

  it('AC-SEC-2 valida obligatorios, descuentos 0–100, bulto entero y código duplicado', async () => {
    const onGuardar = jest.fn();
    await render({ onGuardar, existentes: [{ id: 1, codigo: 'cc500', nombre: 'Coca' }] });
    await llenar({ codigo: 'CC500', descuento1: '150', bultoX: '0' });
    await click(boton('Guardar'));
    expect(onGuardar).not.toHaveBeenCalled();
    expect(errorDe('codigo').textContent).toContain('Coca');
    expect(errorDe('nombre')).not.toBeNull();
    expect(errorDe('descuento1')).not.toBeNull();
    expect(errorDe('bultoX')).not.toBeNull();
  });

  it('AC-PROD-1 el select de Proveedor lista los proveedores', async () => {
    await render({ onGuardar: jest.fn(), proveedores: PROVEEDORES });
    const opts = [...campo('proveedorId').options].filter(o => o.value);
    expect(opts.map(o => [o.value, o.textContent])).toEqual([['prov-1', 'P1 — Arcor']]);
  });
});

// REQ-VTA (AC-VTA-1): Marca, Se vende por, Etiqueta del bulto y Mostrar en tienda.
describe('ProductoForm unidad de venta y marca (REQ-VTA)', () => {
  const nuevoEn = async (key, texto) => {
    await setValue(campo(key), '__nuevo__');
    await setValue(container.querySelector(`#campo-${key}-nuevo`), texto);
    await click(boton('Usar'));
  };

  it('AC-VTA-1 muestra los 4 campos nuevos con sus defaults en un alta', async () => {
    await render({ onGuardar: jest.fn() });
    expect(campo('marca').tagName).toBe('SELECT');
    expect(campo('ventaPor').value).toBe('unidad');
    expect(campo('bultoNombre').value).toBe('Bulto');
    expect(campo('visibleTienda').type).toBe('checkbox');
    expect(campo('visibleTienda').checked).toBe(true);
  });

  it('AC-VTA-1 el selector de marca ofrece las existentes y "Agregar marca nueva…"', async () => {
    await render({ onGuardar: jest.fn(), marcas: ['Arcor', 'Bagley'] });
    expect([...campo('marca').options].map(o => o.textContent)).toEqual(['— Sin marca —', 'Arcor', 'Bagley', 'Agregar marca nueva…']);
  });

  it('AC-VTA-1 "Agregar marca nueva…" con dedupe: ARCOR reutiliza Arcor', async () => {
    const onGuardar = jest.fn(() => Promise.resolve());
    await render({ onGuardar, marcas: ['Arcor'] });
    await nuevoEn('marca', ' ARCOR ');
    expect(container.querySelector('[data-testid="marca-aviso"]').textContent).toContain('Arcor');
    await llenar({ codigo: 'A1', nombre: 'Alfajor' });
    await click(boton('Guardar'));
    expect(onGuardar.mock.calls[0][0].marca).toBe('Arcor');
  });

  it('AC-VTA-1 Dos Corazones: bulto x16, Se vende por bulto, Display, guarda los campos', async () => {
    const onGuardar = jest.fn(() => Promise.resolve());
    await render({ onGuardar, marcas: [] });
    await nuevoEn('marca', 'Dos Corazones');
    await llenar({ codigo: 'DC1', nombre: 'Dos Corazones', precio: '900', bultoX: '16', ventaPor: 'bulto', bultoNombre: 'Display' });
    await click(campo('visibleTienda'));
    await click(boton('Guardar'));
    expect(onGuardar).toHaveBeenCalledTimes(1);
    expect(onGuardar.mock.calls[0][0]).toMatchObject({
      marca: 'Dos Corazones', bultoX: 16, ventaPor: 'bulto', bultoNombre: 'Display', visibleTienda: false, precio: 900,
    });
  });

  it('AC-VTA-1 "bulto" con Bulto x 1 muestra el error en el campo Se vende por y no guarda', async () => {
    const onGuardar = jest.fn();
    await render({ onGuardar });
    await llenar({ codigo: 'DC1', nombre: 'Dos Corazones', bultoX: '1', ventaPor: 'bulto' });
    await click(boton('Guardar'));
    expect(onGuardar).not.toHaveBeenCalled();
    expect(errorDe('ventaPor').textContent).toMatch(/Bulto x/);
  });

  it('AC-VTA-1 editar un producto viejo (sin campos nuevos) arranca con los defaults derivados', async () => {
    const inicial = { id: 5, codigo: 'A1', nombre: 'Alfajor', precio: 900, bultoX: 12 };
    await render({ onGuardar: jest.fn(), inicial, existentes: [inicial] });
    expect(campo('ventaPor').value).toBe('ambos');
    expect(campo('bultoNombre').value).toBe('Bulto');
    expect(campo('visibleTienda').checked).toBe(true);
  });
});
