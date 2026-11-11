// AC-ESC-1 / REQ-ESC2: formulario de producto con "Escalas por bulto" (3 filas: desde N bultos, precio por unidad).
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ProductoForm from '../ProductoForm';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container; let root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => { root.unmount(); }); container.remove(); });
const render = async (props) => { await act(async () => { root.render(<ProductoForm onCancelar={jest.fn()} {...props} />); }); };
const campo = (k) => container.querySelector(`#campo-${k}`);
const fila = (n, que) => container.querySelector(`[aria-label="Escala ${n} ${que}"]`);
const setValue = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const guardar = async () => {
  const b = [...container.querySelectorAll('button')].find(x => x.textContent === 'Guardar');
  await act(async () => { b.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};

describe('ProductoForm escalas (AC-ESC-1)', () => {
  it('AC-ESC2-1 muestra 3 filas Desde (bultos) y Precio c/u', async () => {
    await render({ onGuardar: jest.fn(), inicial: { id: 1, codigo: 'A', nombre: 'X', precio: 100, bultoX: 10 } });
    for (const n of [1, 2, 3]) {
      expect(fila(n, 'desde (bultos)')).not.toBeNull();
      expect(fila(n, 'precio por unidad')).not.toBeNull();
    }
    expect(container.textContent).toContain('Escalas por bulto');
  });
  it('AC-ESC-1 con Bulto x <= 1 las filas estan deshabilitadas y la ayuda lo explica', async () => {
    await render({ onGuardar: jest.fn() });
    expect(fila(1, 'desde (bultos)').disabled).toBe(true);
    expect(container.textContent).toMatch(/Bulto x" mayor que 1/);
  });
  it('AC-ESC2-1 carga y guarda las escalas con precio directo', async () => {
    const onGuardar = jest.fn();
    await render({ onGuardar, inicial: { id: 1, codigo: 'A', nombre: 'X', precio: 100, bultoX: 10, escalasBulto: [{ desde: 3, precio: 95 }] } });
    expect(fila(1, 'desde (bultos)').value).toBe('3');
    expect(fila(1, 'precio por unidad').value).toBe('95');
    await setValue(fila(2, 'desde (bultos)'), '10');
    await setValue(fila(2, 'precio por unidad'), '90,5');
    await guardar();
    expect(onGuardar).toHaveBeenCalled();
    expect(onGuardar.mock.calls[0][0].escalasBulto).toEqual([{ desde: 3, precio: 95 }, { desde: 10, precio: 90.5 }]);
  });
  it('AC-ESC2-1 una escala vieja en % se muestra como "8%" y se conserva al guardar', async () => {
    const onGuardar = jest.fn();
    await render({ onGuardar, inicial: { id: 1, codigo: 'A', nombre: 'X', precio: 100, bultoX: 10, escalasBulto: [{ desde: 5, pct: 8 }] } });
    expect(fila(1, 'precio por unidad').value).toBe('8%');
    await guardar();
    expect(onGuardar.mock.calls[0][0].escalasBulto).toEqual([{ desde: 5, pct: 8 }]);
  });
  it('AC-ESC-1 un error se muestra en el campo y no guarda', async () => {
    const onGuardar = jest.fn();
    await render({ onGuardar, inicial: { id: 1, codigo: 'A', nombre: 'X', precio: 100, bultoX: 10 } });
    await setValue(fila(1, 'desde (bultos)'), '5');
    await guardar();
    expect(onGuardar).not.toHaveBeenCalled();
    expect(container.querySelector('[data-error-for="escalasBulto"]')).not.toBeNull();
    expect(campo('escalasBulto')).not.toBeNull();
  });
});
