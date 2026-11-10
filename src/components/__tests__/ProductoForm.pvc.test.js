// AC-PVC-2 / AC-PVC-3: el formulario no autocompleta el precio con el costo.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ProductoForm from '../ProductoForm';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container; let root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => { root.unmount(); }); container.remove(); });
const render = async (props) => { await act(async () => { root.render(<ProductoForm onCancelar={jest.fn()} {...props} />); }); };
const campo = (k) => container.querySelector(`#campo-${k}`);
const setValue = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };

describe('ProductoForm REQ-PVC', () => {
  it('AC-PVC-3 tipear el costo sin ganancia no toca el precio', async () => {
    await render({ onGuardar: jest.fn() });
    await setValue(campo('costoFinal'), '1000');
    expect(campo('precio').value).toBe('');
  });
  it('AC-PVC-3 con ganancia > 0 sí se autocompleta', async () => {
    await render({ onGuardar: jest.fn() });
    await setValue(campo('costoFinal'), '1000');
    await setValue(campo('ganancia'), '10');
    expect(campo('precio').value).toBe('1100');
  });
  it('AC-PVC-3 inicial sin costos (ganancia undefined): tipear costo no cambia el precio', async () => {
    await render({ onGuardar: jest.fn(), inicial: { id: 1, codigo: 'A', nombre: 'A', precio: 800 } });
    await setValue(campo('costoFinal'), '500');
    expect(campo('precio').value).toBe('800');
  });
  it('AC-PVC-2 guardar con costo sin precio ni ganancia muestra error en el campo y no guarda', async () => {
    const onGuardar = jest.fn();
    await render({ onGuardar });
    await setValue(campo('codigo'), 'A1');
    await setValue(campo('nombre'), 'Algo');
    await setValue(campo('costoFinal'), '1000');
    const guardar = [...container.querySelectorAll('button')].find(b => b.textContent.startsWith('Guardar'));
    await click(guardar);
    expect(onGuardar).not.toHaveBeenCalled();
    expect(container.querySelector('[data-error-for="precio"]').textContent).toBe('Falta el precio de venta o el % de ganancia');
  });
});
