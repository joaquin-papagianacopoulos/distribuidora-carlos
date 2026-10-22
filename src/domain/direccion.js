// src/domain/direccion.js — REQ-DIR: dirección de entrega "exacta" (calle y número).
// Función pura. Espejo SQL: public.direccion_exacta (migración 019).

const MOTIVOS = {
  vacia: 'Ingresá la dirección de entrega',
  corta: 'La dirección es muy corta. Ej: Av. Siempreviva 742',
  sin_numero: 'Falta la altura. Ej: Av. Siempreviva 742 (o "s/n")',
  sin_calle: 'Falta el nombre de la calle. Ej: Av. Siempreviva 742',
};

/**
 * @returns {{ ok: boolean, valor: string, motivo: null|'vacia'|'corta'|'sin_numero'|'sin_calle' }}
 */
export const direccionExacta = (texto) => {
  const valor = String(texto ?? '').replace(/\s+/g, ' ').trim();
  if (!valor) return { ok: false, valor, motivo: 'vacia' };
  if (valor.length < 5) return { ok: false, valor, motivo: 'corta' };
  const tieneLetra = /\p{L}/u.test(valor);
  const tieneNumero = /(^|[^\p{L}\d])\d+/u.test(valor) || /(^|\s)s\/n($|[\s.,;])/i.test(valor);
  if (!tieneLetra) return { ok: false, valor, motivo: 'sin_calle' };
  if (!tieneNumero) return { ok: false, valor, motivo: 'sin_numero' };
  return { ok: true, valor, motivo: null };
};

export const mensajeDireccion = (motivo) => MOTIVOS[motivo] || '';

// Mismo set para el test de dominio y para la paridad con el SQL (AC-DIR-2).
export const FIXTURES_DIRECCION = [
  ['', false],
  ['     ', false],
  ['Av 1', false],
  ['Siempreviva', false],
  ['Av. Siempreviva', false],
  ['742', false],
  ['12345', false],
  ['Av. Siempreviva 742', true],
  ['  Av.   Siempreviva   742  ', true],
  ['Mitre s/n', true],
  ['Mitre S/N', true],
  ['Ñandú 1500', true],
  ['José Hernández 2020', true],
  ['Calle 5', true],
  ['Ruta 9 km 40', true],
  ['San Martín 15 piso 3', true],
];
