// REQ-COMR (RUN 20261014-1449): "Rubro" del producto es un selector con
// "Agregar rubro nuevo…" y dedupe (AC-COMR-3, AC-COMR-4).
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ProductoForm from '../ProductoForm';
import SelectorRubro, { OPCION_NUEVO } from '../SelectorRubro';

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

const render = async (el) => { await act(async () => { root.render(el); }); };
const $ = (sel) => container.querySelector(sel);
const setValue = async (el, value) => {
  const isSelect = el.tagName === 'SELECT';
  const proto = isSelect ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  await act(async () => { el.dispatchEvent(new Event(isSelect ? 'change' : 'input', { bubbles: true })); });
};
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const boton = (txt) => [...container.querySelectorAll('button')].find(b => b.textContent.startsWith(txt));
const opciones = () => [...$('#campo-categoria').options].map(o => o.textContent);

describe('AC-COMR-3 selector de Rubro en el formulario del producto', () => {
  it('AC-COMR-3 lista los rubros existentes ordenados alfabéticamente, más "Sin rubro" y "Agregar rubro nuevo…"', async () => {
    await render(<ProductoForm onGuardar={jest.fn()} onCancelar={jest.fn()} rubros={['Golosinas', 'bebidas', 'Almacén', 'GOLOSINAS']} />);
    expect($('#campo-categoria').tagName).toBe('SELECT');
    expect($('label[for="campo-categoria"]').textContent).toBe('Rubro');
    expect(opciones()).toEqual(['— Sin rubro —', 'Almacén', 'bebidas', 'Golosinas', 'Agregar rubro nuevo…']);
  });

  it('AC-COMR-3 "Agregar rubro nuevo…" muestra el campo sin salir del formulario y el nuevo queda elegido', async () => {
    const onGuardar = jest.fn(() => Promise.resolve());
    await render(<ProductoForm onGuardar={onGuardar} onCancelar={jest.fn()} rubros={['Golosinas']} />);
    expect($('#campo-categoria-nuevo')).toBeNull();
    await setValue($('#campo-categoria'), OPCION_NUEVO);
    expect($('#campo-categoria-nuevo')).not.toBeNull();
    await setValue($('#campo-categoria-nuevo'), '  Limpieza   hogar ');
    await click(boton('Usar'));
    expect($('#campo-categoria-nuevo')).toBeNull();
    expect($('#campo-categoria').value).toBe('Limpieza hogar');
    expect(opciones()).toContain('Limpieza hogar');
    await setValue($('#campo-codigo'), 'L1');
    await setValue($('#campo-nombre'), 'Lavandina');
    await click(boton('Guardar'));
    expect(onGuardar.mock.calls[0][0]).toMatchObject({ categoria: 'Limpieza hogar' });
  });

  it('AC-COMR-4 escribir "GOLOSINAS " con "Golosinas" existente usa el existente y avisa', async () => {
    const onGuardar = jest.fn(() => Promise.resolve());
    await render(<ProductoForm onGuardar={onGuardar} onCancelar={jest.fn()} rubros={['Golosinas', 'Bebidas']} />);
    await setValue($('#campo-categoria'), OPCION_NUEVO);
    await setValue($('#campo-categoria-nuevo'), 'GOLOSINAS ');
    await click(boton('Usar'));
    expect($('#campo-categoria').value).toBe('Golosinas');
    expect($('[data-testid="rubro-aviso"]').textContent).toBe('Ya existe: se usa «Golosinas»');
    expect(opciones().filter(o => /golosinas/i.test(o))).toEqual(['Golosinas']);
    await setValue($('#campo-codigo'), 'A1');
    await setValue($('#campo-nombre'), 'Alfajor');
    await click(boton('Guardar'));
    expect(onGuardar.mock.calls[0][0].categoria).toBe('Golosinas');
  });

  it('AC-COMR-4 un producto viejo con rubro fuera de la lista lo conserva; con otra escritura se guarda la canónica', async () => {
    const onGuardar = jest.fn(() => Promise.resolve());
    await render(<ProductoForm onGuardar={onGuardar} onCancelar={jest.fn()} inicial={{ id: 5, codigo: 'V1', nombre: 'Viejo', precio: 10, categoria: 'Discontinuado' }} existentes={[]} rubros={['Bebidas']} />);
    expect($('#campo-categoria').value).toBe('Discontinuado');
    expect(opciones()).toEqual(['— Sin rubro —', 'Bebidas', 'Discontinuado', 'Agregar rubro nuevo…']);
    await click(boton('Guardar'));
    expect(onGuardar.mock.calls[0][0].categoria).toBe('Discontinuado');
  });

  it('AC-COMR-4 rubro guardado en minúsculas con "Bebidas" existente: el select muestra el existente y se guarda la escritura canónica', async () => {
    const onGuardar = jest.fn(() => Promise.resolve());
    await render(<ProductoForm onGuardar={onGuardar} onCancelar={jest.fn()} inicial={{ id: 6, codigo: 'C1', nombre: 'Coca', precio: 10, categoria: 'bebidas ' }} existentes={[]} rubros={['Bebidas']} />);
    expect($('#campo-categoria').value).toBe('Bebidas');
    await click(boton('Guardar'));
    expect(onGuardar.mock.calls[0][0].categoria).toBe('Bebidas');
  });

  it('AC-COMR-3 "Usar" vacío avisa; Cancelar vuelve al selector; elegir "Sin rubro" deja vacío', async () => {
    const onChange = jest.fn();
    await render(<SelectorRubro value="Bebidas" onChange={onChange} rubros={['Bebidas']} />);
    await setValue($('#campo-categoria'), OPCION_NUEVO);
    await click(boton('Usar'));
    expect($('[data-testid="rubro-error"]').textContent).toBe('Escribí el nombre del rubro');
    expect(onChange).not.toHaveBeenCalled();
    await click(boton('Cancelar'));
    expect($('#campo-categoria-nuevo')).toBeNull();
    await setValue($('#campo-categoria'), '');
    expect(onChange).toHaveBeenLastCalledWith('');
    // Enter en el campo nuevo equivale a "Usar"
    await setValue($('#campo-categoria'), OPCION_NUEVO);
    await setValue($('#campo-categoria-nuevo'), 'Kiosco');
    await act(async () => { $('#campo-categoria-nuevo').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onChange).toHaveBeenLastCalledWith('Kiosco');
  });
});

// REQ-VTA (AC-VTA-1): el mismo selector se reutiliza para la Marca.
describe('AC-VTA-1 SelectorRubro con props de marca', () => {
  it('AC-VTA-1 sin props nuevas el selector de Rubro no cambia', async () => {
    await render(<SelectorRubro value="" onChange={jest.fn()} rubros={['Bebidas']} />);
    expect($('[data-testid="selector-rubro"]')).not.toBeNull();
    expect($('#campo-categoria').name).toBe('categoria');
    expect(opciones()).toEqual(['— Sin rubro —', 'Bebidas', 'Agregar rubro nuevo…']);
  });

  it('AC-VTA-1 la variante marca usa sus textos, name y testids', async () => {
    const SelectorMarca = require('../SelectorMarca').default;
    const onChange = jest.fn();
    await render(<SelectorMarca value="" onChange={onChange} marcas={['Arcor']} />);
    expect($('[data-testid="selector-marca"]')).not.toBeNull();
    expect($('#campo-marca').name).toBe('marca');
    expect([...$('#campo-marca').options].map(o => o.textContent)).toEqual(['— Sin marca —', 'Arcor', 'Agregar marca nueva…']);
    await setValue($('#campo-marca'), OPCION_NUEVO);
    await click(boton('Usar'));
    expect($('[data-testid="marca-error"]').textContent).toBe('Escribí el nombre de la marca');
    await setValue($('#campo-marca-nuevo'), 'arcor');
    await click(boton('Usar'));
    expect(onChange).toHaveBeenLastCalledWith('Arcor');
    expect($('[data-testid="marca-aviso"]').textContent).toContain('Arcor');
  });
});
