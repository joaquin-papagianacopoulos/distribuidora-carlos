// REQ-PLA — generacion de la plantilla .xlsx y round-trip
// (plantilla -> leer con xlsx -> completar -> importar) — AC-PLA-7.
import * as XLSX from 'xlsx';
import { libroPlantilla, generarPlantillaXlsx, descargarBlob, descargarPlantilla, MIME_XLSX } from '../plantillaExcel';
import { armarPlantilla, planificarImportacion, COLUMNAS_PLANTILLA } from '../../domain/plantillas';
import { CAMPOS_PRODUCTO } from '../../domain/productos';
import { CAMPOS_CLIENTE } from '../../domain/clientes';

const PROVEEDORES = [{ id: 'prov-1', codigo: 'ARC', descripcion: 'Arcor' }];
const VENDEDORES = [{ id: 1, nombre: 'Admin', permiso: 1 }, { id: 2, nombre: 'Ex', permiso: 2, activo: false }];

const escribirYLeer = (wb) => XLSX.read(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }), { type: 'array' });
const filasDe = (wb, hoja) => XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, raw: false, defval: '', blankrows: true });

describe('AC-PLA-1 / AC-PLA-2 libro .xlsx', () => {
  it('AC-PLA-1 plantilla de productos: hoja Productos con los encabezados del form e Instrucciones', () => {
    const wb = escribirYLeer(libroPlantilla(XLSX, armarPlantilla('productos', { proveedores: PROVEEDORES })));
    expect(wb.SheetNames).toEqual(['Productos', 'Instrucciones']);
    const filas = filasDe(wb, 'Productos');
    expect(filas).toEqual([CAMPOS_PRODUCTO.map(c => c.label)]);
    const inst = filasDe(wb, 'Instrucciones');
    expect(inst[0]).toEqual(['Columna', 'Obligatorio', 'Formato', 'Valores válidos', 'Ejemplo']);
    expect(inst.find(f => f[0] === 'Proveedor')[3]).toBe('Arcor');
  });

  // MOD (RUN 20261012-2106): antes eran los 17 encabezados de CAMPOS_CLIENTE.
  // AC-PLA-2 (dueño, 2026-10-12) saca Comisión: quedan 16, mismo orden.
  it('AC-PLA-2 plantilla de clientes: los 16 encabezados en orden (sin Comisión)', () => {
    const wb = escribirYLeer(libroPlantilla(XLSX, armarPlantilla('clientes', { vendedores: VENDEDORES })));
    expect(wb.SheetNames).toEqual(['Clientes', 'Instrucciones']);
    const enc = filasDe(wb, 'Clientes')[0];
    expect(enc).toEqual(CAMPOS_CLIENTE.filter(c => c.key !== 'comision').map(c => c.label));
    expect(enc).toHaveLength(16);
    expect(enc).not.toContain('Comisión');
    const inst = filasDe(wb, 'Instrucciones');
    expect(inst.find(f => f[0] === 'Vendedor')[3]).toBe('Admin');
    expect(inst.some(f => f[0] === 'Comisión')).toBe(false);
  });

  it('AC-PLA-6 AC-SEC-3 ninguna celda exportada queda como fórmula', () => {
    const wb = escribirYLeer(libroPlantilla(XLSX, armarPlantilla('productos', {
      proveedores: [{ id: 'x', codigo: 'X', descripcion: '=1+1' }],
    })));
    for (const nombre of wb.SheetNames) {
      const ws = wb.Sheets[nombre];
      for (const [ref, c] of Object.entries(ws)) {
        if (ref.startsWith('!')) continue;
        expect(c.f).toBeUndefined();
        if (typeof c.v === 'string') expect(c.v).not.toMatch(/^[=+@]/);
      }
    }
  });

  it('AC-PLA-1 generarPlantillaXlsx devuelve un Blob xlsx con el nombre correcto', async () => {
    const r = await generarPlantillaXlsx('productos');
    expect(r.nombreArchivo).toBe('plantilla_productos.xlsx');
    expect(r.blob.type).toBe(MIME_XLSX);
    expect(r.blob.size).toBeGreaterThan(1000);
  });
});

describe('AC-PLA-1 descarga', () => {
  let click;
  beforeEach(() => {
    jest.useFakeTimers();
    URL.createObjectURL = jest.fn(() => 'blob:fake');
    URL.revokeObjectURL = jest.fn();
    click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { this.dataset.clicked = '1'; });
  });
  afterEach(() => { click.mockRestore(); jest.useRealTimers(); });

  it('AC-PLA-1 descargarBlob crea un link con download y lo libera', () => {
    descargarBlob(new Blob(['x']), 'a.xlsx');
    expect(click).toHaveBeenCalledTimes(1);
    expect(click.mock.instances[0].download).toBe('a.xlsx');
    expect(click.mock.instances[0].href).toBe('blob:fake');
    expect(document.querySelector('a[download]')).toBeNull();
    jest.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('AC-PLA-2 descargarPlantilla("clientes") baja plantilla_clientes.xlsx', async () => {
    const nombre = await descargarPlantilla('clientes', { vendedores: VENDEDORES });
    expect(nombre).toBe('plantilla_clientes.xlsx');
    expect(click.mock.instances[0].download).toBe('plantilla_clientes.xlsx');
  });
});

describe('AC-PLA-7 round-trip: plantilla -> completar -> importar', () => {
  const completar = (entidad, datos, ctx = {}) => {
    const wb = escribirYLeer(libroPlantilla(XLSX, armarPlantilla(entidad, ctx)));
    const hoja = wb.SheetNames[0];
    const encabezados = filasDe(wb, hoja)[0];
    const filas = [encabezados, ...datos.map(d => encabezados.map(h => d[h] ?? ''))];
    const nuevo = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(nuevo, XLSX.utils.aoa_to_sheet(filas), hoja);
    const leido = escribirYLeer(nuevo);
    return filasDe(leido, leido.SheetNames[0]);
  };

  it('AC-PLA-7 productos: todas las columnas de la plantilla llegan a su campo', () => {
    const rows = completar('productos', [{
      'Código': 'RT1', 'Descripción': 'Round Trip', 'Rubro': 'Test', 'Proveedor': 'Arcor', 'Costo final': '1000',
      'Descuento 1': '10', 'Descuento 2': '5', '% Ganancia': '30', 'Precio venta 1': '', 'Precio venta 2': '1300',
      'Bulto x': '12', 'Mínimo venta': '2', 'Stock': '24',
    }]);
    const plan = planificarImportacion(rows, 'productos', { existentes: [], proveedores: PROVEEDORES });
    expect(plan.ok).toBe(true);
    expect(plan.modo).toBe('plantilla');
    expect(plan.ignoradas).toEqual([]);
    expect(plan.entradas).toHaveLength(1);
    const e = plan.entradas[0];
    expect(e.accion).toBe('crear');
    expect(e.valor.producto).toMatchObject({
      codigo: 'RT1', nombre: 'Round Trip', categoria: 'Test', proveedorId: 'prov-1', costoFinal: 1000,
      descuento1: 10, descuento2: 5, ganancia: 30, precio: 1111.5, precioVenta2: 1300, bultoX: 12, minimoVenta: 2,
    });
    expect(e.valor.stock).toBe(24);
    expect(rows[0]).toEqual(COLUMNAS_PLANTILLA.productos.map(c => c.label));
  });

  // MOD (RUN 20261012-2106): antes eran 17 campos y comision: 5. La plantilla
  // ya no tiene Comisión (AC-PLA-2), asi que el dato 'Comisión' de abajo no
  // tiene columna donde caer y el alta queda con comision null (AC-PLA-4).
  it('AC-PLA-7 clientes: los 16 campos de la plantilla llegan normalizados', () => {
    const rows = completar('clientes', [{
      'Código cliente': 'C1', 'Razón social': 'Cliente RT', 'Domicilio de entrega': 'Calle 1', 'Ciudad': 'Rosario',
      'Código postal': 's2000', 'Provincia': 'Santa Fe', 'Zona': 'Centro', 'País': 'Argentina', 'Tipo de IVA': 'Monotributo',
      'CUIT': '20123456786', 'Celular': '3415551234', 'Vendedor': 'admin', 'Cobrador': 'Pedro', 'Comisión': '5',
      'Fecha de alta': '2026-10-01', 'Tipo de cliente': 'Mayorista', 'Rubro': 'Almacén',
    }], { vendedores: VENDEDORES });
    expect(rows[0]).toHaveLength(16);
    const plan = planificarImportacion(rows, 'clientes', { existentes: [], vendedores: VENDEDORES });
    expect(plan.ok).toBe(true);
    expect(plan.ignoradas).toEqual([]);
    expect(plan.excluidas).toEqual([]);
    expect(plan.entradas[0].accion).toBe('crear');
    expect(plan.entradas[0].valor).toEqual({
      codigo: 'C1', nombre: 'Cliente RT', direccion: 'Calle 1', ciudad: 'Rosario', codigoPostal: 'S2000', provincia: 'Santa Fe',
      zona: 'Centro', pais: 'Argentina', tipoIva: 'Monotributo', cuit: '20-12345678-6', telefono: '3415551234', vendedor: 'Admin',
      cobrador: 'Pedro', comision: null, fechaAlta: '2026-10-01', tipoCliente: 'Mayorista', rubro: 'Almacén',
    });
    expect(rows[0]).toEqual(COLUMNAS_PLANTILLA.clientes.map(c => c.label));
  });

  it('AC-PLA-4 AC-PLA-7 un XLSX viejo con columna Comisión: se ignora y el resumen lo avisa', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      CAMPOS_CLIENTE.map(c => c.label),
      CAMPOS_CLIENTE.map(c => ({ codigo: 'C2', nombre: 'Viejo', direccion: 'Dir', comision: '8' }[c.key] ?? '')),
    ]), 'Clientes');
    const leido = escribirYLeer(wb);
    const plan = planificarImportacion(filasDe(leido, 'Clientes'), 'clientes', { existentes: [] });
    expect(plan.ok).toBe(true);
    expect(plan.excluidas).toEqual(['Comisión']);
    expect(plan.entradas[0].valor.comision).toBeNull();
    expect(plan.resumen.columnasExcluidas).toEqual(['Comisión']);
  });

  it('AC-PLA-6 una celda "=cmd" escrita en el Excel se importa neutralizada', () => {
    const rows = completar('productos', [{ 'Código': 'F1', 'Descripción': '=cmd|"/c calc"!A1', 'Precio venta 1': '1' }]);
    const plan = planificarImportacion(rows, 'productos', {});
    expect(plan.entradas[0].valor.producto.nombre.startsWith("'=")).toBe(true);
  });
});
