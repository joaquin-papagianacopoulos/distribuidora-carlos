// AC-XLS-2: Excel de productos guardado en la app.
import { validarArchivoPlanilla, nombreSeguroDescarga, textoUltimaPlanilla, MAX_BYTES_PLANILLA } from '../planillaProductos';

describe('AC-XLS-2 planilla de productos guardada', () => {
  test('AC-XLS-2 acepta xlsx/xls/csv y devuelve el mime', () => {
    expect(validarArchivoPlanilla({ name: 'productos.XLSX', size: 1000 })).toMatchObject({ ok: true, ext: 'xlsx' });
    expect(validarArchivoPlanilla({ name: 'a.csv', size: 5 })).toMatchObject({ ok: true, mime: 'text/csv' });
  });
  test('AC-XLS-2 rechaza otro tipo, vacío o de más de 10 MB', () => {
    expect(validarArchivoPlanilla({ name: 'virus.exe', size: 10 }).ok).toBe(false);
    expect(validarArchivoPlanilla({ name: 'a.xlsx', size: 0 }).ok).toBe(false);
    expect(validarArchivoPlanilla({ name: 'a.xlsx', size: MAX_BYTES_PLANILLA + 1 }).ok).toBe(false);
    expect(validarArchivoPlanilla(null).ok).toBe(false);
  });
  test('AC-XLS-2 el nombre de descarga no lleva rutas ni caracteres raros', () => {
    expect(nombreSeguroDescarga('..\..\evil/plantilla (7).xlsx')).toBe('plantilla (7).xlsx');
    expect(nombreSeguroDescarga('')).toBe('productos.xlsx');
  });
  test('AC-XLS-2 texto de "último Excel" con quién y cuándo, y sin ninguno', () => {
    const t = textoUltimaPlanilla({ hay: true, nombre_original: 'p.xlsx', subido_por: 'Jorge', subido_at: '2026-11-25T14:30:00', tam_bytes: 2048 });
    expect(t).toContain('p.xlsx');
    expect(t).toContain('Jorge');
    expect(t).toContain('25/11/2026 14:30');
    expect(textoUltimaPlanilla({ hay: false })).toContain('Todavía no');
  });
});
