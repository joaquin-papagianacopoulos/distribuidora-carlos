// REQ-CAT (AC-CAT-2): el PDF se genera completo, con ocultos fuera y sin romper con sin stock / sin foto.
import { PDFDocument } from 'pdf-lib';
import { generarCatalogoPdf } from '../catalogoService';

jest.mock('../tiendaConfigService', () => ({ subirImagenTienda: jest.fn() }));
jest.mock('../productosAdminService', () => ({ subirProductosConPin: jest.fn() }));
jest.mock('../../db', () => ({ updateProducto: jest.fn() }));

const productos = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, codigo: String(100 + i), nombre: `Producto ñandú ${i + 1} “especial”`, categoria: 'Varios', precio: 1000 + i, imagen_url: null }));

const leer = (file) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(fr.result);
  fr.onerror = () => rej(fr.error);
  fr.readAsArrayBuffer(file);
});

test('AC-CAT-2 20 productos, 1 oculto y 1 sin stock -> 19 en 2 páginas', async () => {
  const r = await generarCatalogoPdf(productos, [{ productoId: 1, oculto: true }, { productoId: 2, sinStock: true }], { titulo: 'Distri Sulpi' });
  expect(r.productos).toBe(19);
  expect(r.paginas).toBe(2);
  expect(r.file.name).toMatch(/^Catalogo-DistriSulpi-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.pdf$/);
  const doc = await PDFDocument.load(await leer(r.file));
  expect(doc.getPageCount()).toBe(2);
});

test('AC-CAT-2 catálogo vacío igual genera un PDF válido', async () => {
  const r = await generarCatalogoPdf(productos, productos.map(p => ({ productoId: p.id, oculto: true })));
  expect(r.paginas).toBe(0);
  expect((await PDFDocument.load(await leer(r.file))).getPageCount()).toBe(1);
});
