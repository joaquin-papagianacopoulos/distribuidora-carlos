// Tests del componente presentacional del botón Bulto (REQ-BUL).
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import BultoControl from '../BultoControl';

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
  await act(async () => { root.render(<BultoControl onSumar={jest.fn()} onRestar={jest.fn()} {...props} />); });
};
const mas = () => container.querySelector('[data-testid="bulto-mas"]');
const menos = () => container.querySelector('[data-testid="bulto-menos"]');
const desglose = () => container.querySelector('[data-testid="bulto-desglose"]');
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };

describe('BultoControl', () => {
  test('AC-BUL-1 con bultoX 12 muestra "+ Bulto (x 12)"', async () => {
    await render({ bultoX: 12, cantidad: 5 });
    expect(mas().textContent).toBe('+ Bulto (x 12)');
    expect(menos()).not.toBeNull();
  });

  test.each([[1], [''], [undefined], [0], ['12,5'], [-12]])('AC-BUL-1 con bultoX %p no se muestra nada', async (bx) => {
    await render({ bultoX: bx, cantidad: 5 });
    expect(container.innerHTML).toBe('');
  });

  test('AC-BUL-2 tocar "+ Bulto" dispara onSumar', async () => {
    const onSumar = jest.fn();
    await render({ bultoX: 12, cantidad: 5, onSumar });
    await click(mas());
    await click(mas());
    expect(onSumar).toHaveBeenCalledTimes(2);
  });

  test('AC-BUL-3 "− Bulto" dispara onRestar y queda deshabilitado con cantidad <= 1', async () => {
    const onRestar = jest.fn();
    await render({ bultoX: 12, cantidad: 41, onRestar });
    expect(menos().disabled).toBe(false);
    await click(menos());
    expect(onRestar).toHaveBeenCalledTimes(1);

    const onRestar2 = jest.fn();
    await render({ bultoX: 12, cantidad: 1, onRestar: onRestar2 });
    expect(menos().disabled).toBe(true);
    await click(menos());
    expect(onRestar2).not.toHaveBeenCalled();
  });

  test('AC-BUL-4 muestra el desglose con el bultoX recibido', async () => {
    await render({ bultoX: 12, cantidad: 41 });
    expect(desglose().textContent).toBe('41 u. = 3 bultos + 5 u.');
    await render({ bultoX: 6, cantidad: 36 });
    expect(desglose().textContent).toBe('36 u. = 6 bultos');
    await render({ bultoX: 12, cantidad: 5 });
    expect(desglose()).toBeNull();
  });

  test('AC-BUL-8 visible=false no renderiza nada', async () => {
    await render({ bultoX: 12, cantidad: 5, visible: false });
    expect(container.innerHTML).toBe('');
  });
});
