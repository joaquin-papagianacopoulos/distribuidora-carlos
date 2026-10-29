// QA RUN 20261012-2106 — REQ-PLA en Configuracion: bordes del lector de archivos
// (CSV con ';' y ',', decimales con coma, codificacion), 1000 filas, productos
// legacy (AC-PROD-5) y texto de ayuda de la pestaña Clientes.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApp = {};
jest.mock('../../hooks/useAppContext', () => ({ useApp: () => mockApp }));

jest.mock('../../db', () => ({
  addProductoLocal: jest.fn(),
  updateProducto: jest.fn(() => Promise.resolve()),
  deleteProducto: jest.fn(() => Promise.resolve()),
  addCliente: jest.fn(() => Promise.resolve(1)),
  updateCliente: jest.fn(() => Promise.resolve()),
  deleteCliente: jest.fn(() => Promise.resolve()),
  getVendedores: jest.fn(() => Promise.resolve([])),
  getProductos: jest.fn(() => Promise.resolve([])),
  updateVendedor: jest.fn(),
  markVendedorSynced: jest.fn(),
  putProveedor: jest.fn(() => Promise.resolve()),
  deleteProveedor: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../sync/syncService', () => ({
  syncProductos: jest.fn(() => Promise.resolve({ ok: true })),
  buscarImagenesFaltantes: jest.fn(),
}));
jest.mock('../../services/imageSearch', () => ({ isImageSearchConfigured: () => false }));
jest.mock('../../services/stockService', () => ({ ajustarStock: jest.fn(() => Promise.resolve(null)) }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: () => ({}) } }));

import Configuracion from '../Configuracion';
import { addProductoLocal, updateProducto, getProductos, addCliente, updateCliente } from '../../db';
import { ajustarStock } from '../../services/stockService';

let container;
let root;
const setOnline = (v) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v });
const render = async () => { await act(async () => { root.render(<Configuracion />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const boton = (txt) => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === txt);
const esperar = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const subir = async (input, file) => {
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await esperar();
};
const csv = (nombre, contenido) => ({ name: nombre, size: contenido.length, text: () => Promise.resolve(contenido) });
// Lo que hace un navegador real con Blob.text(): decodifica SIEMPRE como UTF-8.
// Iteracion 2 (implementador): un Blob real tambien tiene arrayBuffer(); sin
// eso el fixture no tenia los bytes (y en jsdom TextDecoder no existe, asi que
// text() lanzaba). Se agrega arrayBuffer() como en el navegador; la asercion
// del test no cambia.
const csvBytes = (nombre, bytes) => ({
  name: nombre,
  size: bytes.length,
  arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  text: () => Promise.resolve(new TextDecoder('utf-8').decode(bytes)),
});
const latin1 = (s) => Uint8Array.from([...s].map(ch => ch.charCodeAt(0) & 0xff));
const xlsxFile = (nombre, aoa) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Hoja1');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return { name: nombre, size: buf.byteLength, arrayBuffer: () => Promise.resolve(buf) };
};
const inputProductos = () => container.querySelector('[data-testid="input-import-productos"]') || container.querySelector('input[type="file"]');
const inputClientes = () => container.querySelector('[data-testid="input-import-clientes"]');
const irAClientes = async () => { await render(); await click(boton('clientes')); };
const resumen = (id) => container.querySelector(`[data-testid="${id}-resumen"]`)?.textContent || '';
const rechazos = (id) => container.querySelector(`[data-testid="${id}-rechazos"]`)?.textContent || '';

let anchorClick;
beforeEach(() => {
  jest.clearAllMocks();
  getProductos.mockResolvedValue([]);
  let nextId = 100;
  addProductoLocal.mockImplementation(() => Promise.resolve(nextId++));
  Object.assign(mockApp, {
    productos: [],
    clientes: [{ id: 10, codigo: '0010', nombre: 'Kiosco Pepe', direccion: 'Mitre 1', comision: 4 }],
    vendedores: [{ id: 1, nombre: 'Admin', permiso: 1 }, { id: 2, nombre: 'Juan', permiso: 2 }, { id: 3, nombre: 'Viejo', permiso: 2, activo: false }],
    proveedores: [{ id: 'prov-1', codigo: 'ARC', descripcion: 'Arcor' }],
    stockMap: new Map(),
    vendedorActual: { id: 1, nombre: 'Admin', permiso: 1 },
    seleccionarVendedor: jest.fn(),
    recargar: jest.fn(() => Promise.resolve()),
  });
  window.alert = jest.fn();
  window.confirm = jest.fn(() => true);
  setOnline(true);
  URL.createObjectURL = jest.fn(() => 'blob:x');
  URL.revokeObjectURL = jest.fn();
  anchorClick = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  anchorClick.mockRestore();
  act(() => { root.unmount(); });
  container.remove();
});

describe('AC-PLA-3 CSV con ";" y con ","', () => {
  it('AC-PLA-3 CSV separado por ";" (Excel es-AR), con CRLF y comillas: se importa bien', async () => {
    await render();
    const txt = 'Código;Descripción;Proveedor;Costo final;Mínimo venta\r\nA1;"Coca; 500ml";Arcor;100;2\r\nA2;Fanta;;50;1\r\n';
    await subir(inputProductos(), csv('p.csv', txt));
    expect(addProductoLocal).toHaveBeenCalledTimes(2);
    expect(addProductoLocal.mock.calls[0][0]).toMatchObject({ codigo: 'A1', nombre: 'Coca; 500ml', proveedorId: 'prov-1', costoFinal: 100, minimoVenta: 2 });
    expect(resumen('resultado-productos')).toContain('Creados: 2');
  });

  it('AC-PLA-3 CSV separado por "," (Excel en-US/UTF-8), con CRLF: se importa bien', async () => {
    await render();
    const txt = 'Código,Descripción,Costo final,% Ganancia\r\nB1,Galletitas,100,20\r\n';
    await subir(inputProductos(), csv('p.csv', txt));
    expect(addProductoLocal).toHaveBeenCalledTimes(1);
    expect(addProductoLocal.mock.calls[0][0]).toMatchObject({ codigo: 'B1', costoFinal: 100, ganancia: 20, precio: 120 });
  });

  it('AC-PLA-3 CSV con "," entre comillas ("1.234,50") separado por ";" no se parte', async () => {
    await render();
    const txt = 'Código;Descripción;Costo final\nC1;Quoted;"1.234,50"\n';
    await subir(inputProductos(), csv('p.csv', txt));
    expect(addProductoLocal.mock.calls[0][0]).toMatchObject({ codigo: 'C1', costoFinal: 1234.5 });
  });

  // BUG: BUG-PLA-02 (ver qa-report.md). parseCSVLine corta en ',' Y en ';' a la
  // vez. En un CSV con ';' (el que genera Excel es-AR) un decimal SIN comillas
  // como 1234,50 se parte en dos celdas: se corren todas las columnas de la
  // derecha y el producto se guarda con datos equivocados SIN ningun aviso.
  // La hoja Instrucciones promete "acepta coma decimal: 1234,50".
  it('AC-PLA-3 BUG CSV con ";" y coma decimal sin comillas (1234,50): no corre las columnas', async () => {
    await render();
    const txt = 'Código;Descripción;Costo final;Precio venta 1;Bulto x\nD1;Decimal;1234,50;1500,75;12\n';
    await subir(inputProductos(), csv('p.csv', txt));
    const llamadas = addProductoLocal.mock.calls.map(c => c[0]);
    if (llamadas.length) {
      expect(llamadas[0]).toMatchObject({ codigo: 'D1', costoFinal: 1234.5, precio: 1500.75, bultoX: 12 });
    } else {
      expect(llamadas).toHaveLength(1);
    }
  });

  // BUG: BUG-PLA-02 (misma causa) en clientes: el CSV con ';' y un campo con coma
  // sin comillas ("Mitre 123, piso 2") corre las columnas siguientes.
  it('AC-PLA-4 BUG CSV con ";" y una coma dentro del domicilio sin comillas: el domicilio queda entero y el resto en su columna', async () => {
    await irAClientes();
    const txt = 'Código cliente;Razón social;Domicilio de entrega;Ciudad\n0200;Con coma;Mitre 123, piso 2;Rosario\n';
    await subir(inputClientes(), csv('c.csv', txt));
    expect(addCliente).toHaveBeenCalledTimes(1);
    expect(addCliente.mock.calls[0][0]).toMatchObject({ direccion: 'Mitre 123, piso 2', ciudad: 'Rosario' });
  });

  it('AC-PLA-3 CSV con BOM UTF-8 al principio (Excel "CSV UTF-8"): reconoce la primera columna', async () => {
    await render();
    await subir(inputProductos(), csv('p.csv', '\uFEFFCódigo;Descripción;Precio venta 1\nE1;Con BOM;5\n'));
    expect(addProductoLocal).toHaveBeenCalledTimes(1);
    expect(addProductoLocal.mock.calls[0][0]).toMatchObject({ codigo: 'E1' });
  });

  // BUG: BUG-PLA-03 (ver qa-report.md). "Guardar como CSV" de Excel en es-AR
  // genera Windows-1252 (ANSI), no UTF-8. leerFilas usa file.text() (siempre
  // UTF-8): "Descripción" llega como "DescripciU+FFFDn" y el archivo se rechaza
  // con "No se encontró columna de nombre". Los nombres con ñ/tildes quedan
  // con U+FFFD aunque el encabezado se reconociera.
  it('AC-PLA-3 BUG CSV guardado como ANSI/Windows-1252 desde Excel: se importa con tildes y ñ', async () => {
    await render();
    const txt = 'Código;Descripción;Precio venta 1\nF1;Piña colada;5\n';
    await subir(inputProductos(), csvBytes('p.csv', latin1(txt)));
    expect(container.textContent).not.toContain('No se encontró columna de nombre');
    expect(addProductoLocal).toHaveBeenCalledTimes(1);
    expect(addProductoLocal.mock.calls[0][0].nombre).toBe('Piña colada');
  });

  it('AC-PLA-5 CSV con renglones vacios intercalados y sin salto final: el numero de fila coincide con el del archivo', async () => {
    await irAClientes();
    const txt = 'Código cliente;Razón social;Domicilio de entrega\n\n0301;Ok;x\n\n\n0302;;y';
    await subir(inputClientes(), csv('c.csv', txt));
    expect(rechazos('resultado-clientes')).toContain('Fila 6: La razón social es obligatoria');
    expect(addCliente).toHaveBeenCalledTimes(1);
  });

  it('AC-PLA-3 CSV solo con encabezado o vacio: error claro y no guarda nada', async () => {
    await render();
    await subir(inputProductos(), csv('p.csv', 'Código;Descripción;Precio venta 1\n'));
    expect(addProductoLocal).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="resultado-productos"]').textContent).toContain('El archivo no tiene datos suficientes.');
    await subir(inputProductos(), csv('p.csv', ''));
    expect(addProductoLocal).not.toHaveBeenCalled();
  });

  it('AC-PLA-6 un CSV con "=cmd|calc!A1" en la descripcion se guarda neutralizado', async () => {
    await render();
    await subir(inputProductos(), csv('p.csv', 'Código;Descripción;Precio venta 1\nG1;=cmd|"/c calc"!A1;5\n'));
    expect(addProductoLocal.mock.calls[0][0].nombre.startsWith("'=")).toBe(true);
  });
});

describe('AC-PLA-5 archivo grande desde la pantalla', () => {
  it('AC-PLA-3 AC-PLA-5 AC-PROD-3 CSV de 1000 filas: se guardan todas, un movimiento inicial por cada producto con stock y el resumen cuadra', async () => {
    await render();
    const filas = ['Código;Descripción;Costo final;Stock'];
    for (let i = 0; i < 1000; i++) filas.push(`P${i};Producto ${i};${100 + i};${i % 2 ? 5 : 0}`);
    await subir(inputProductos(), csv('p.csv', filas.join('\n')));
    expect(addProductoLocal).toHaveBeenCalledTimes(1000);
    expect(ajustarStock).toHaveBeenCalledTimes(500);
    expect(ajustarStock.mock.calls.every(c => c[1] === 5 && c[2].inicial === true)).toBe(true);
    expect(updateProducto).not.toHaveBeenCalled();
    expect(resumen('resultado-productos')).toContain('Creados: 1000 · Actualizados: 0 · Rechazados: 0');
  }, 60000);

  // MOD (AC-CLI2-1): el CUIT ya no se valida; la fila mala ahora es sin domicilio.
  it('AC-PLA-4 AC-PLA-5 XLSX de 1000 clientes con una fila invalida cada 10: guarda 900, lista 100 rechazos con su fila', async () => {
    await irAClientes();
    const aoa = [['Código cliente', 'Razón social', 'Domicilio de entrega', 'Tipo de IVA', 'CUIT']];
    for (let i = 0; i < 1000; i++) aoa.push([`K${i}`, `Cli ${i}`, i % 10 === 5 ? '' : `Calle ${i}`, 'Monotributo', '20123456786']);
    await subir(inputClientes(), xlsxFile('c.xlsx', aoa));
    expect(addCliente).toHaveBeenCalledTimes(900);
    expect(resumen('resultado-clientes')).toContain('Creados: 900 · Actualizados: 0 · Rechazados: 100');
    const rech = rechazos('resultado-clientes');
    expect(rech).toContain('Fila 7: El domicilio de entrega es obligatorio');
    expect(rech).toContain('Fila 997: El domicilio de entrega es obligatorio');
    expect(addCliente.mock.calls.every(c => c[0].cuit === '20-12345678-6')).toBe(true);
  }, 60000);
});

describe('AC-PROD-5 archivos viejos desde la pantalla', () => {
  it('AC-PROD-5 CSV viejo "nombre,precio,codigo,unidad,categoria": crea sin extrasDirty ni stock y actualiza por nombre', async () => {
    getProductos.mockResolvedValue([{ id: 7, nombre: 'Coca Cola', codigo: 'CC', precio: 100, unidad: 'unidad', marca: 'Coca' }]);
    await render();
    const txt = 'nombre,precio,codigo,unidad,categoria\nAlfajor,10,A1,caja,Golosinas\ncoca cola,150,,,\n';
    await subir(inputProductos(), csv('viejo.csv', txt));
    expect(addProductoLocal).toHaveBeenCalledTimes(1);
    const alta = addProductoLocal.mock.calls[0][0];
    expect(alta).toMatchObject({ nombre: 'Alfajor', precio: 10, codigo: 'A1', unidad: 'caja', categoria: 'Golosinas' });
    expect(alta).not.toHaveProperty('extrasDirty');
    expect(updateProducto).toHaveBeenCalledWith(expect.objectContaining({ id: 7, precio: 150, codigo: 'CC', unidad: 'unidad' }), expect.anything());
    expect(updateProducto.mock.calls[0][0]).not.toHaveProperty('extrasDirty');
    expect(ajustarStock).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="resultado-productos"]').textContent).toContain('1 creado, 1 actualizado');
  });

  it('AC-PROD-5 XLSX viejo (nombre/precio) con precios numericos y una fila sin precio', async () => {
    await render();
    await subir(inputProductos(), xlsxFile('viejo.xlsx', [['Nombre', 'Precio'], ['Galletas', 25.5], ['Sin precio', ''], ['Pan', 3]]));
    expect(addProductoLocal).toHaveBeenCalledTimes(2);
    expect(addProductoLocal.mock.calls.map(c => c[0].precio)).toEqual([25.5, 3]);
    expect(rechazos('resultado-productos')).toContain('Fila 3: Precio vacío o inválido');
  });

  it('AC-PROD-5 archivo sin columna de precio o de nombre: error claro, nada guardado', async () => {
    await render();
    await subir(inputProductos(), csv('x.csv', 'foo;bar\n1;2\n'));
    expect(addProductoLocal).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="resultado-productos"]').textContent).toMatch(/No se encontró columna/);
  });
});

describe('AC-PLA-4 / AC-PLA-2 clientes: texto de ayuda y comisión', () => {
  // BUG: BUG-PLA-04 (ver qa-report.md). Tras el cambio del dueño (AC-PLA-2: 16
  // columnas, sin Comisión) la tarjeta de importación de clientes sigue diciendo
  // "los 17 campos del alta de clientes" (Configuracion.js:582).
  // MOD (AC-CLI2-2): sin Provincia, quedan 16.
  it('AC-PLA-2 AC-CON-2 AC-CLI2-2 la ayuda de la tarjeta de clientes dice "16 campos" (sin Comisión ni Provincia)', async () => {
    await irAClientes();
    const txt = container.querySelector('[data-testid="import-clientes"]').textContent;
    expect(txt).toMatch(/16 campos/);
  });

  it('AC-PLA-4 CSV con ";" y columna Comisión en el medio: se ignora, no corre las demas columnas y no pisa la ficha', async () => {
    await irAClientes();
    const txt = 'Código cliente;Comisión;Razón social;Domicilio de entrega;Ciudad\n0010;99;Kiosco Pepe;Mitre 1;Rosario\n0555;7;Nuevo;Calle 5;Salta\n';
    await subir(inputClientes(), csv('c.csv', txt));
    expect(updateCliente.mock.calls[0][0]).toMatchObject({ id: 10, ciudad: 'Rosario', comision: 4 });
    // MOD (RUN 20261014-1449, AC-COMR-2): antes comision: null en el alta; ahora la clave no existe.
    expect(addCliente.mock.calls[0][0]).toMatchObject({ codigo: '0555', ciudad: 'Salta' });
    expect(addCliente.mock.calls[0][0]).not.toHaveProperty('comision');
    expect(container.querySelector('[data-testid="resultado-clientes-excluidas"]')).not.toBeNull();
  });

  it('AC-PLA-4 AC-VEN-3 CSV con vendedor dado de baja en una fila: esa fila se rechaza y las demas se guardan', async () => {
    await irAClientes();
    const txt = 'Código cliente;Razón social;Domicilio de entrega;Vendedor\n0601;A;x;Viejo\n0602;B;x;Juan\n0603;C;x;\n';
    await subir(inputClientes(), csv('c.csv', txt));
    expect(addCliente).toHaveBeenCalledTimes(2);
    expect(addCliente.mock.calls.map(c => c[0].vendedor)).toEqual(['Juan', '']);
    expect(rechazos('resultado-clientes')).toContain('Fila 2: Vendedor "Viejo" no existe o está dado de baja');
  });

  it('AC-PLA-4 AC-VEN-3 si el vendedor se da de baja y la pantalla se recarga, el mismo archivo ya lo rechaza (usa la lista vigente)', async () => {
    mockApp.vendedores = [{ id: 1, nombre: 'Admin', permiso: 1 }, { id: 2, nombre: 'Juan', permiso: 2, activo: false }];
    await irAClientes();
    await subir(inputClientes(), csv('c.csv', 'Código cliente;Razón social;Domicilio de entrega;Vendedor\n0701;A;x;Juan\n'));
    expect(addCliente).not.toHaveBeenCalled();
    expect(rechazos('resultado-clientes')).toContain('Vendedor "Juan" no existe o está dado de baja');
  });
});
