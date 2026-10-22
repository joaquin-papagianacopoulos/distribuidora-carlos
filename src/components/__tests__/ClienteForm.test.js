// Tests de UI del alta/edición de clientes (REQ-CLI).
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ClienteForm from '../ClienteForm';
import { hoyISO } from '../../domain/validacion';

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
  await act(async () => { root.render(<ClienteForm onCancelar={jest.fn()} {...props} />); });
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

const botonGuardar = () => [...container.querySelectorAll('button')].find(b => b.textContent === 'Guardar');
const errorDe = (key) => container.querySelector(`[data-error-for="${key}"]`);

// Etiqueta "limpia" (sin " *" de obligatorio ni sufijos "(%)").
const etiquetas = () => [...container.querySelectorAll('label.input-label')]
  .map(l => l.textContent.replace(/ \*$/, '').replace(/ \([^)]*\)$/, '').replace(/ \*$/, '').trim());

// MOD (RUN 20261014-1449, AC-COMR-1): antes 17 etiquetas con 'Comisión'; ahora
// 16, porque el cliente ya no tiene comisión (REQ-COMR).
const ETIQUETAS_SPEC = [
  'Código cliente', 'Razón social', 'Domicilio de entrega', 'Ciudad', 'Código postal',
  'Provincia', 'Zona', 'País', 'Tipo de IVA', 'CUIT', 'Nombre de contacto', 'Celular', 'Vendedor', 'Cobrador',
  'Fecha de alta', 'Tipo de cliente', 'Rubro',
];

describe('ClienteForm', () => {
  it('AC-CLI-1 AC-COMR-1 muestra exactamente los 17 campos con las etiquetas del SPEC, en orden (sin Comisión)', async () => {
    await render({ onGuardar: jest.fn() });
    expect(etiquetas()).toEqual(ETIQUETAS_SPEC);
    expect(etiquetas()).toHaveLength(17);
    expect(campo('comision')).toBeNull();
    // Obligatorios marcados con *
    const req = [...container.querySelectorAll('label.input-label')].filter(l => l.textContent.endsWith(' *')).map(l => l.htmlFor);
    expect(req).toEqual(['campo-codigo', 'campo-nombre', 'campo-direccion']);
  });

  it('AC-CLI-1 defaults: código sugerido, País Argentina, Fecha de alta hoy', async () => {
    await render({ onGuardar: jest.fn(), existentes: [{ id: 1, codigo: '0041', nombre: 'X' }] });
    expect(campo('codigo').value).toBe('0042');
    expect(campo('pais').value).toBe('Argentina');
    expect(campo('fechaAlta').value).toBe(hoyISO());
  });

  it('AC-CLI-1 Provincia lista las 24 jurisdicciones y Vendedor la lista de vendedores', async () => {
    await render({ onGuardar: jest.fn(), vendedores: [{ id: 1, nombre: 'Carlos' }, { id: 2, nombre: 'Ana' }] });
    const provincias = [...campo('provincia').options].filter(o => o.value);
    expect(provincias).toHaveLength(24);
    const vendedores = [...campo('vendedor').options].filter(o => o.value).map(o => o.value);
    expect(vendedores).toEqual(['Carlos', 'Ana']);
    const ivas = [...campo('tipoIva').options].filter(o => o.value).map(o => o.value);
    expect(ivas).toEqual(['Responsable Inscripto', 'Monotributo', 'Exento', 'Consumidor Final', 'No Responsable']);
  });

  it('AC-CLI-2 con código, razón social y domicilio vacíos muestra error por campo y no guarda', async () => {
    const onGuardar = jest.fn();
    await render({ onGuardar });
    await setValue(campo('codigo'), '');
    await click(botonGuardar());
    expect(onGuardar).not.toHaveBeenCalled();
    expect(errorDe('codigo').textContent).toMatch(/obligatorio/i);
    expect(errorDe('nombre').textContent).toMatch(/obligatoria/i);
    expect(errorDe('direccion').textContent).toMatch(/obligatorio/i);
    expect(campo('nombre').getAttribute('aria-invalid')).toBe('true');
  });

  it('AC-CLI-2 solo espacios cuenta como vacío', async () => {
    const onGuardar = jest.fn();
    await render({ onGuardar });
    await llenar({ nombre: '    ', direccion: '\t ' });
    await click(botonGuardar());
    expect(onGuardar).not.toHaveBeenCalled();
    expect(errorDe('nombre')).not.toBeNull();
    expect(errorDe('direccion')).not.toBeNull();
  });

  it('AC-CLI-2 al corregir un campo se limpia su error', async () => {
    await render({ onGuardar: jest.fn() });
    await click(botonGuardar());
    expect(errorDe('nombre')).not.toBeNull();
    await setValue(campo('nombre'), 'Kiosco');
    expect(errorDe('nombre')).toBeNull();
    expect(errorDe('direccion')).not.toBeNull();
  });

  it('AC-CLI-3 CUIT con dígito verificador inválido se rechaza con error en el campo', async () => {
    const onGuardar = jest.fn();
    await render({ onGuardar });
    await llenar({ nombre: 'Kiosco', direccion: 'Calle 1', tipoIva: 'Responsable Inscripto', cuit: '20-12345678-7' });
    await click(botonGuardar());
    expect(onGuardar).not.toHaveBeenCalled();
    expect(errorDe('cuit').textContent).toMatch(/CUIT inválido/);
  });

  it('AC-CLI-3 CUIT obligatorio salvo Consumidor Final', async () => {
    const onGuardar = jest.fn();
    await render({ onGuardar });
    await llenar({ nombre: 'Kiosco', direccion: 'Calle 1', tipoIva: 'Monotributo' });
    await click(botonGuardar());
    expect(onGuardar).not.toHaveBeenCalled();
    expect(errorDe('cuit')).not.toBeNull();
    await setValue(campo('tipoIva'), 'Consumidor Final');
    await click(botonGuardar());
    expect(onGuardar).toHaveBeenCalledTimes(1);
  });

  it('AC-CLI-3 CUIT válido se guarda normalizado XX-XXXXXXXX-X y el resto normalizado', async () => {
    const onGuardar = jest.fn(() => Promise.resolve());
    await render({ onGuardar, vendedores: [{ id: 1, nombre: 'Carlos' }] });
    await llenar({
      codigo: '  c-77 ',
      nombre: '  Almacén   Don José  ',
      direccion: 'Av. Siempre Viva 742',
      codigoPostal: 'b1640 abc',
      provincia: 'Buenos Aires',
      tipoIva: 'Responsable Inscripto',
      cuit: '20123456786',
      telefono: '+54 9 11 4444-5555',
      vendedor: 'Carlos',
    });
    await click(botonGuardar());
    expect(onGuardar).toHaveBeenCalledTimes(1);
    const c = onGuardar.mock.calls[0][0];
    expect(c).toMatchObject({
      codigo: 'c-77',
      nombre: 'Almacén Don José',
      direccion: 'Av. Siempre Viva 742',
      codigoPostal: 'B1640ABC',
      provincia: 'Buenos Aires',
      pais: 'Argentina',
      tipoIva: 'Responsable Inscripto',
      cuit: '20-12345678-6',
      telefono: '5491144445555',
      vendedor: 'Carlos',
      fechaAlta: hoyISO(),
      boletaContraBoleta: false,
    });
    // MOD (RUN 20261014-1449, AC-COMR-1): antes se llenaba y se esperaba comision: 2.5; el campo ya no existe.
    expect(c).not.toHaveProperty('comision');
  });

  it('AC-CLI-4 código de cliente duplicado (sin importar mayúsculas/espacios) se rechaza', async () => {
    const onGuardar = jest.fn();
    await render({ onGuardar, existentes: [{ id: 9, codigo: 'ABC1', nombre: 'Kiosco Pepe' }] });
    await llenar({ codigo: ' abc1 ', nombre: 'Otro', direccion: 'Calle 2' });
    await click(botonGuardar());
    expect(onGuardar).not.toHaveBeenCalled();
    expect(errorDe('codigo').textContent).toContain('Kiosco Pepe');
  });

  it('AC-CLI-4 en edición el propio código no cuenta como duplicado', async () => {
    const onGuardar = jest.fn(() => Promise.resolve());
    const inicial = { id: 9, codigo: 'ABC1', nombre: 'Kiosco Pepe', direccion: 'Calle 1', boletaContraBoleta: true };
    await render({ onGuardar, inicial, existentes: [inicial] });
    expect(container.textContent).toContain('Editar cliente');
    expect(campo('codigo').value).toBe('ABC1');
    await click(botonGuardar());
    expect(onGuardar).toHaveBeenCalledTimes(1);
    expect(onGuardar.mock.calls[0][0]).toMatchObject({ codigo: 'ABC1', boletaContraBoleta: true });
  });

  it('AC-CLI-6 iter 4: un cliente viejo SIN código recibe un código sugerido al editarlo (y se puede guardar)', async () => {
    const onGuardar = jest.fn(() => Promise.resolve());
    const viejo = { id: 3, nombre: 'Sin código', direccion: 'Mitre 100' };
    await render({ onGuardar, inicial: viejo, existentes: [viejo, { id: 4, codigo: '0009', nombre: 'Otro' }] });
    expect(campo('codigo').value).toBe('0010');
    await click(botonGuardar());
    expect(onGuardar.mock.calls[0][0]).toMatchObject({ codigo: '0010', nombre: 'Sin código' });
  });

  it('AC-CLI-6 iter 4: un cliente con código lo conserva (no se sugiere otro)', async () => {
    const viejo = { id: 3, codigo: 'K-1', nombre: 'Con código', direccion: 'Mitre 100' };
    await render({ onGuardar: jest.fn(), inicial: viejo, existentes: [viejo, { id: 4, codigo: '0009' }] });
    expect(campo('codigo').value).toBe('K-1');
  });

  // MOD (RUN 20261014-1449, AC-COMR-1): antes la comisión fuera de rango daba
  // error; ahora el campo no existe (ni input ni error) y el resto sigue igual.
  it('AC-SEC-2 AC-COMR-1 celular corto y CP inválido muestran error; no hay campo ni error de comisión', async () => {
    const onGuardar = jest.fn();
    await render({ onGuardar });
    await llenar({ nombre: 'K', direccion: 'D', telefono: '1234', codigoPostal: '12' });
    await click(botonGuardar());
    expect(onGuardar).not.toHaveBeenCalled();
    expect(campo('comision')).toBeNull();
    expect(errorDe('comision')).toBeNull();
    expect(errorDe('telefono')).not.toBeNull();
    expect(errorDe('codigoPostal')).not.toBeNull();
  });

  it('AC-CLI-6 un cliente viejo (sin campos nuevos) se puede abrir y editar', async () => {
    const onGuardar = jest.fn(() => Promise.resolve());
    const viejo = { id: 3, nombre: 'Cliente Legacy', direccion: 'Mitre 100', telefono: '1144445555', codigo: '0003' };
    await render({ onGuardar, inicial: viejo, existentes: [viejo] });
    expect(campo('nombre').value).toBe('Cliente Legacy');
    expect(campo('pais').value).toBe('Argentina');
    await click(botonGuardar());
    expect(onGuardar).toHaveBeenCalledTimes(1);
  });
});
