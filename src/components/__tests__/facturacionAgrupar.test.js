// REQ-FAB (AC-FAB-1, 2) y REQ-AGR (AC-AGR-1, 2, 4): selector de tipo de factura y agrupar renglones.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import TipoFacturaSelector from '../TipoFacturaSelector';
import AgruparRenglones from '../AgruparRenglones';

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
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const q = (sel) => container.querySelector(sel);
const porAria = (label) => q(`[aria-label="${label}"]`);
const botonConTexto = (t) => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === t);
const checkDe = (texto) => [...container.querySelectorAll('label')].find(l => l.textContent.includes(texto)).querySelector('input');
const escribir = async (el, valor) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, 'value').set;
  await act(async () => {
    set.call(el, valor);
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
};

describe('AC-FAB-1 TipoFacturaSelector', () => {
  it('AC-FAB-1 sugiere A para Responsable Inscripto y deja confirmar', async () => {
    const onChange = jest.fn();
    await render(<TipoFacturaSelector pedido={{ id: 1 }} cliente={{ tipoIva: 'Responsable Inscripto', cuit: '20-12345678-6' }} onChange={onChange} />);
    expect(porAria('Tipo de factura').value).toBe('A');
    expect(container.textContent).toMatch(/sugerido/i);
    await click(botonConTexto('Confirmar'));
    expect(onChange).toHaveBeenCalledWith('A');
  });

  it('AC-FAB-1 sin dato de IVA => Sin factura; cambiar el select avisa el tipo', async () => {
    const onChange = jest.fn();
    await render(<TipoFacturaSelector pedido={{ id: 1 }} cliente={{}} onChange={onChange} />);
    expect(porAria('Tipo de factura').value).toBe('ninguna');
    await escribir(porAria('Tipo de factura'), 'B');
    expect(onChange).toHaveBeenCalledWith('B');
  });

  it('AC-FAB-1 un tipo ya guardado manda y no muestra la sugerencia', async () => {
    await render(<TipoFacturaSelector pedido={{ id: 1, tipoFactura: 'B' }} cliente={{ tipoIva: 'Responsable Inscripto' }} onChange={() => {}} />);
    expect(porAria('Tipo de factura').value).toBe('B');
    expect(container.textContent).not.toMatch(/sugerido/i);
  });
});

describe('AC-FAB-2 aviso de Factura A sin CUIT valido', () => {
  it('AC-FAB-2 muestra el aviso y deja seguir (el selector no se bloquea)', async () => {
    await render(<TipoFacturaSelector pedido={{ id: 1, tipoFactura: 'A' }} cliente={{ cuit: '' }} onChange={() => {}} />);
    expect(q('[data-testid="aviso-factura-a"]').textContent).toMatch(/CUIT/);
    expect(porAria('Tipo de factura').disabled).toBe(false);
  });
  it('AC-FAB-2 sin aviso con CUIT valido o tipo B', async () => {
    await render(<TipoFacturaSelector pedido={{ id: 1, tipoFactura: 'A' }} cliente={{ cuit: '20-12345678-6' }} onChange={() => {}} />);
    expect(q('[data-testid="aviso-factura-a"]')).toBeNull();
    await render(<TipoFacturaSelector pedido={{ id: 1, tipoFactura: 'B' }} cliente={{ cuit: '' }} onChange={() => {}} />);
    expect(q('[data-testid="aviso-factura-a"]')).toBeNull();
  });
});

describe('AC-AGR-1 AgruparRenglones', () => {
  const items = [
    { productoId: 1, nombre: 'Saphirus Lavanda', cantidad: 12, precio: 100, bultoX: 12 },
    { productoId: 2, nombre: 'Saphirus Rosa', cantidad: 12, precio: 100, bultoX: 12 },
    { productoId: 3, nombre: 'Jabon', cantidad: 2, precio: 50 },
  ];
  const productosById = new Map([['1', { marca: 'Saphirus' }], ['2', { marca: 'Saphirus' }], ['3', { marca: 'Otra' }]]);

  it('AC-AGR-1 selecciona renglones, sugiere la marca como nombre y agrupa', async () => {
    const onChange = jest.fn();
    await render(<AgruparRenglones items={items} grupos={[]} productosById={productosById} onChange={onChange} />);
    expect(botonConTexto('Agrupar (2)')).toBeUndefined();
    await click(checkDe('Saphirus Lavanda'));
    await click(checkDe('Saphirus Rosa'));
    expect(porAria('Nombre del nuevo grupo').value).toBe('Saphirus');
    await click(botonConTexto('Agrupar (2)'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const grupos = onChange.mock.calls[0][0];
    expect(grupos).toHaveLength(1);
    expect(grupos[0]).toMatchObject({ nombre: 'Saphirus', itemIds: ['1', '2'] });
    expect(grupos[0].id).toBeTruthy();
  });

  it('AC-AGR-1 el nombre se puede editar antes de agrupar', async () => {
    const onChange = jest.fn();
    await render(<AgruparRenglones items={items} grupos={[]} productosById={productosById} onChange={onChange} />);
    await click(checkDe('Saphirus Lavanda'));
    await click(checkDe('Jabon'));
    expect(porAria('Nombre del nuevo grupo').value).toBe('Grupo');
    await escribir(porAria('Nombre del nuevo grupo'), 'Mis cosas');
    await click(botonConTexto('Agrupar (2)'));
    expect(onChange.mock.calls[0][0][0].nombre).toBe('Mis cosas');
  });

  it('AC-AGR-1 muestra los grupos con bultos, permite renombrar y deshacer', async () => {
    const onChange = jest.fn();
    const grupos = [{ id: 'g1', nombre: 'Saphirus', itemIds: ['1', '2'] }];
    await render(<AgruparRenglones items={items} grupos={grupos} productosById={productosById} onChange={onChange} />);
    expect(q('[data-testid="grupo-factura"]').textContent).toMatch(/2 bultos \(24 u\.\)/);
    await escribir(porAria('Nombre del grupo'), 'Aromas');
    expect(onChange.mock.calls[0][0][0].nombre).toBe('Aromas');
    await click(botonConTexto('Deshacer'));
    expect(onChange.mock.calls[1][0]).toEqual([]);
  });

  it('AC-AGR-2 no modifica los renglones (items) que recibe', async () => {
    const copia = JSON.stringify(items);
    await render(<AgruparRenglones items={items} grupos={[]} productosById={productosById} onChange={() => {}} />);
    await click(checkDe('Saphirus Lavanda'));
    await click(checkDe('Saphirus Rosa'));
    await click(botonConTexto('Agrupar (2)'));
    expect(JSON.stringify(items)).toBe(copia);
  });

  it('AC-AGR-4 un grupo con renglones eliminados no se muestra', async () => {
    const grupos = [{ id: 'g1', nombre: 'Fantasma', itemIds: ['98', '99'] }];
    await render(<AgruparRenglones items={items} grupos={grupos} productosById={productosById} onChange={() => {}} />);
    expect(q('[data-testid="grupo-factura"]')).toBeNull();
  });
});
