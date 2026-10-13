import { validarCliente, CAMPOS_CLIENTE, clienteExtraToRemote, clienteExtraFromRemote, sugerirCodigoCliente, clienteVacio } from '../clientes';
import { validarCuit, formatearCuit } from '../validacion';

const base = { codigo: 'C001', nombre: 'Almacén Don José SRL', direccion: 'Av. Siempre Viva 742', tipoIva: 'Responsable Inscripto', cuit: '20-12345678-6' };
// 20123456786 es un CUIT con dígito verificador válido (ver test de validarCuit).

describe('AC-CLI-1 campos del alta de clientes', () => {
  it('AC-CLI-1 tiene exactamente los 17 campos pedidos, en orden y con sus etiquetas', () => {
    expect(CAMPOS_CLIENTE.map(c => c.label)).toEqual([
      'Código cliente', 'Razón social', 'Domicilio de entrega', 'Ciudad', 'Código postal', 'Provincia',
      'Zona', 'País', 'Tipo de IVA', 'CUIT', 'Celular', 'Vendedor', 'Cobrador', 'Comisión',
      'Fecha de alta', 'Tipo de cliente', 'Rubro',
    ]);
  });
  it('AC-CLI-1 cliente vacío trae país Argentina y fecha de alta de hoy', () => {
    const v = clienteVacio(new Date(2026, 9, 7));
    expect(v.pais).toBe('Argentina');
    expect(v.fechaAlta).toBe('2026-10-07');
  });
});

describe('AC-CLI-2 obligatorios', () => {
  it('AC-CLI-2 rechaza código, razón social y domicilio vacíos con error por campo', () => {
    const r = validarCliente({ codigo: '  ', nombre: '', direccion: undefined });
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errores)).toEqual(expect.arrayContaining(['codigo', 'nombre', 'direccion']));
  });
  it('AC-CLI-2 acepta un cliente completo y normaliza espacios', () => {
    const r = validarCliente({ ...base, nombre: '  Almacén   Don José SRL ' });
    expect(r.ok).toBe(true);
    expect(r.cliente.nombre).toBe('Almacén Don José SRL');
  });
});

describe('AC-CLI-3 CUIT', () => {
  it('AC-CLI-3 valida dígito verificador', () => {
    expect(validarCuit('20123456786')).toBe(true);
    expect(validarCuit('20-12345678-6')).toBe(true);
    expect(validarCuit('20123456787')).toBe(false);
    expect(validarCuit('99123456786')).toBe(false); // prefijo inválido
    expect(validarCuit('2012345678')).toBe(false); // 10 dígitos
    expect(validarCuit('')).toBe(false);
    expect(validarCuit(null)).toBe(false);
  });
  it('AC-CLI-3 CUIT de persona jurídica (30-) válido', () => {
    expect(validarCuit('30-71234567-1')).toBe(validarCuit('30712345671'));
  });
  it('AC-CLI-3 caso dígito verificador 0 (resto 11) y caso inválido resto 10', () => {
    // Buscamos por fuerza bruta un ejemplo de cada caso para no depender de números mágicos.
    const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const dv = (s) => { const r = 11 - (pesos.reduce((a, p, i) => a + p * Number(s[i]), 0) % 11); return r; };
    let cero = null; let diez = null;
    for (let n = 10000000; n < 10001000 && (!cero || !diez); n++) {
      const s = `20${n}`;
      const r = dv(s);
      if (r === 11 && !cero) cero = `${s}0`;
      if (r === 10 && !diez) diez = s;
    }
    expect(validarCuit(cero)).toBe(true);
    for (let d = 0; d <= 9; d++) expect(validarCuit(`${diez}${d}`)).toBe(false);
  });
  it('AC-CLI-3 rechaza CUIT inválido y guarda el válido formateado', () => {
    expect(validarCliente({ ...base, cuit: '20123456787' }).errores.cuit).toBeTruthy();
    expect(validarCliente({ ...base, cuit: '20123456786' }).cliente.cuit).toBe('20-12345678-6');
    expect(formatearCuit('123')).toBe('123');
  });
  it('AC-CLI-3 CUIT obligatorio salvo Consumidor Final', () => {
    expect(validarCliente({ ...base, cuit: '' }).errores.cuit).toBeTruthy();
    expect(validarCliente({ ...base, cuit: '', tipoIva: 'Consumidor Final' }).ok).toBe(true);
    expect(validarCliente({ ...base, cuit: '', tipoIva: '' }).ok).toBe(true);
  });
});

describe('AC-CLI-4 código único', () => {
  const existentes = [{ id: 1, codigo: 'c001', nombre: 'Otro' }];
  it('AC-CLI-4 rechaza código duplicado (sin importar mayúsculas)', () => {
    expect(validarCliente(base, existentes).errores.codigo).toMatch(/Otro/);
  });
  it('AC-CLI-4 al editar el mismo cliente no se considera duplicado', () => {
    expect(validarCliente(base, existentes, { editId: 1 }).ok).toBe(true);
  });
  it('AC-CLI-4 sugiere el próximo código libre', () => {
    expect(sugerirCodigoCliente([{ codigo: '0007' }, { codigo: 'X12' }, { codigo: null }])).toBe('0013');
    expect(sugerirCodigoCliente([])).toBe('0001');
  });
});

describe('validaciones de formato', () => {
  it('rechaza CP, provincia, tipo IVA, celular, comisión y fecha inválidos', () => {
    const r = validarCliente({ ...base, codigoPostal: '12', provincia: 'Narnia', tipoIva: 'Otro', telefono: '123', comision: '150', fechaAlta: '2026-02-30' });
    expect(Object.keys(r.errores)).toEqual(expect.arrayContaining(['codigoPostal', 'provincia', 'tipoIva', 'telefono', 'comision', 'fechaAlta']));
  });
  it('acepta CPA, celular con símbolos y comisión con coma', () => {
    const r = validarCliente({ ...base, codigoPostal: 'b1878 abc', telefono: '+54 9 11 5555-4444', comision: '2,5', provincia: 'Buenos Aires' });
    expect(r.ok).toBe(true);
    expect(r.cliente.codigoPostal).toBe('B1878ABC');
    expect(r.cliente.telefono).toBe('5491155554444');
    expect(r.cliente.comision).toBe(2.5);
  });
  it('comisión negativa o no numérica se rechaza', () => {
    expect(validarCliente({ ...base, comision: '-1' }).errores.comision).toBeTruthy();
    expect(validarCliente({ ...base, comision: 'abc' }).errores.comision).toBeTruthy();
  });
  it('elimina caracteres de control y limita largo (AC-SEC-2)', () => {
    const r = validarCliente({ ...base, nombre: `A\u0000B\nC${'x'.repeat(500)}` });
    expect(r.cliente.nombre.startsWith('A B C')).toBe(true);
    expect(r.cliente.nombre.length).toBe(120);
  });
});

describe('AC-CLI-5 / AC-CLI-6 mapeo con Supabase', () => {
  it('AC-CLI-5 arma columnas snake_case', () => {
    const r = clienteExtraToRemote({ codigoPostal: '1878', tipoIva: 'Monotributo', comision: '3', fechaAlta: '2026-10-07' });
    expect(r).toMatchObject({ codigo_postal: '1878', tipo_iva: 'Monotributo', comision: 3, fecha_alta: '2026-10-07', cuit: null });
    expect(clienteExtraToRemote({ comision: '' }).comision).toBeNull();
    expect(clienteExtraToRemote(undefined).codigo).toBeNull();
  });
  it('AC-CLI-5 si la columna no existe en Supabase conserva el valor local', () => {
    const r = clienteExtraFromRemote({ ciudad: 'Quilmes' }, { codigo: 'L1', comision: 4 });
    expect(r.ciudad).toBe('Quilmes');
    expect(r.codigo).toBe('L1');
    expect(r.comision).toBe(4);
  });
  it('AC-CLI-6 cliente viejo sin campos nuevos no rompe el mapeo', () => {
    const r = clienteExtraFromRemote({ codigo: null, comision: null }, undefined);
    expect(r.codigo).toBe('');
    expect(r.comision).toBeNull();
    expect(clienteExtraFromRemote(undefined, undefined).rubro).toBe('');
  });
});
