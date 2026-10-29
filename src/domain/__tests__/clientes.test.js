import { validarCliente, CAMPOS_CLIENTE, clienteExtraToRemote, clienteExtraFromRemote, sugerirCodigoCliente, clienteVacio } from '../clientes';
import { validarCuit, formatearCuit } from '../validacion';

const base = { codigo: 'C001', nombre: 'Almacén Don José SRL', direccion: 'Av. Siempre Viva 742', tipoIva: 'Responsable Inscripto', cuit: '20-12345678-6' };
// 20123456786 es un CUIT con dígito verificador válido (ver test de validarCuit).

describe('AC-CLI-1 campos del alta de clientes', () => {
  // MOD (RUN 20261014-1449, AC-COMR-1): antes 17 campos con 'Comisión'; ahora
  // 16, porque el cliente ya no tiene comisión (se carga por vendedor y rubro).
  // MOD (AC-CLI2-2): sin 'Provincia', quedan 16.
  it('AC-CLI-1 AC-COMR-1 AC-CLI2-2 tiene exactamente los 16 campos pedidos, en orden y con sus etiquetas', () => {
    expect(CAMPOS_CLIENTE.map(c => c.label)).toEqual([
      'Código cliente', 'Razón social', 'Domicilio de entrega', 'Ciudad', 'Código postal',
      'Zona', 'País', 'Tipo de IVA', 'CUIT', 'Nombre de contacto', 'Celular', 'Vendedor', 'Cobrador',
      'Fecha de alta', 'Tipo de cliente', 'Rubro',
    ]);
    expect(CAMPOS_CLIENTE.some(c => c.key === 'comision')).toBe(false);
    expect(clienteVacio()).not.toHaveProperty('comision');
    expect(CAMPOS_CLIENTE.some(c => c.key === 'provincia')).toBe(false);
    expect(clienteVacio()).not.toHaveProperty('provincia');
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
  // MOD (AC-CLI2-1): el alta ya no valida el CUIT; con 11 dígitos se formatea.
  it('AC-CLI2-1 acepta cualquier CUIT y formatea el de 11 dígitos', () => {
    const r = validarCliente({ ...base, cuit: '20123456787' });
    expect(r.ok).toBe(true);
    expect(r.cliente.cuit).toBe('20-12345678-7');
    expect(validarCliente({ ...base, cuit: '20123456786' }).cliente.cuit).toBe('20-12345678-6');
    expect(validarCliente({ ...base, cuit: ' 123-abc ' }).cliente.cuit).toBe('123-abc');
    expect(formatearCuit('123')).toBe('123');
  });
  it('AC-CLI2-1 el CUIT es opcional para cualquier tipo de IVA', () => {
    expect(validarCliente({ ...base, cuit: '' }).ok).toBe(true);
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
  // MOD (RUN 20261014-1449, AC-COMR-1): antes 'comision: 150' daba error; ahora
  // la comisión ya no se valida (ni aparece en el cliente), el resto sí.
  // MOD (AC-CLI2-2): la provincia tampoco se valida ni se devuelve.
  it('AC-COMR-1 AC-CLI2-2 rechaza CP, tipo IVA, celular y fecha inválidos; comisión y provincia ya no se validan', () => {
    const r = validarCliente({ ...base, codigoPostal: '12', provincia: 'Narnia', tipoIva: 'Otro', telefono: '123', comision: '150', fechaAlta: '2026-02-30' });
    expect(Object.keys(r.errores)).toEqual(expect.arrayContaining(['codigoPostal', 'tipoIva', 'telefono', 'fechaAlta']));
    expect(r.errores).not.toHaveProperty('comision');
    expect(r.errores).not.toHaveProperty('provincia');
    expect(r.cliente).not.toHaveProperty('provincia');
    expect(r.cliente).not.toHaveProperty('comision');
  });
  // MOD (RUN 20261014-1449, AC-COMR-1): antes 'comision: 2,5' quedaba 2.5; ahora la clave no se devuelve.
  it('AC-COMR-1 acepta CPA y celular con símbolos; una comisión en el form no aparece en el cliente', () => {
    const r = validarCliente({ ...base, codigoPostal: 'b1878 abc', telefono: '+54 9 11 5555-4444', comision: '2,5', provincia: 'Buenos Aires' });
    expect(r.ok).toBe(true);
    expect(r.cliente.codigoPostal).toBe('B1878ABC');
    expect(r.cliente.telefono).toBe('5491155554444');
    expect(r.cliente).not.toHaveProperty('comision');
  });
  // MOD (RUN 20261014-1449, AC-COMR-1): antes '-1' / 'abc' daban error; ahora se ignoran sin error.
  it('AC-COMR-1 comisión negativa o no numérica ya no da error ni se guarda', () => {
    for (const comision of ['-1', 'abc', '150', '2,5']) {
      const r = validarCliente({ ...base, comision });
      expect(r.ok).toBe(true);
      expect(r.errores).not.toHaveProperty('comision');
      expect(r.cliente).not.toHaveProperty('comision');
    }
  });
  it('elimina caracteres de control y limita largo (AC-SEC-2)', () => {
    const r = validarCliente({ ...base, nombre: `A\u0000B\nC${'x'.repeat(500)}` });
    expect(r.cliente.nombre.startsWith('A B C')).toBe(true);
    expect(r.cliente.nombre.length).toBe(120);
  });
});

describe('AC-CLI-5 / AC-CLI-6 mapeo con Supabase', () => {
  // MOD (RUN 20261014-1449, AC-COMR-1): antes mandaba comision: 3; ahora la
  // clave no viaja nunca (así el upsert no pisa la columna en Supabase).
  it('AC-CLI-5 AC-COMR-1 arma columnas snake_case sin la clave comision', () => {
    const r = clienteExtraToRemote({ codigoPostal: '1878', tipoIva: 'Monotributo', comision: '3', fechaAlta: '2026-10-07' });
    expect(r).toMatchObject({ codigo_postal: '1878', tipo_iva: 'Monotributo', fecha_alta: '2026-10-07', cuit: null });
    expect(r).not.toHaveProperty('comision');
    expect(clienteExtraToRemote({ comision: '' })).not.toHaveProperty('comision');
    expect(clienteExtraToRemote(undefined).codigo).toBeNull();
  });
  // MOD (RUN 20261014-1449, AC-COMR-1): antes el mapeo devolvía comision; ahora
  // no la mapea (el valor local lo conserva el spread del pull: syncTolerante).
  it('AC-CLI-5 AC-COMR-1 si la columna no existe en Supabase conserva el valor local; comision no se mapea', () => {
    const r = clienteExtraFromRemote({ ciudad: 'Quilmes', comision: 9 }, { codigo: 'L1', comision: 4 });
    expect(r.ciudad).toBe('Quilmes');
    expect(r.codigo).toBe('L1');
    expect(r).not.toHaveProperty('comision');
  });
  it('AC-CLI-6 cliente viejo sin campos nuevos no rompe el mapeo', () => {
    const r = clienteExtraFromRemote({ codigo: null, comision: null }, undefined);
    expect(r.codigo).toBe('');
    expect(r).not.toHaveProperty('comision');
    expect(clienteExtraFromRemote(undefined, undefined).rubro).toBe('');
  });
});
