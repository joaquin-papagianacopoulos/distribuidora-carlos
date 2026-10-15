// src/domain/tiendaLinks.js — REQ-WEB (AC-WEB-7): links de tienda por vendedor (puro).

// Token que acepta el link: base64url de 43 caracteres (256 bits). Nunca el nombre ni el id.
export const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

export const esTokenValido = (t) => typeof t === 'string' && TOKEN_RE.test(t);

export function construirLinkTienda(origin, token) {
  if (!esTokenValido(token)) return null;
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}/tienda?v=${encodeURIComponent(token)}`;
}

// Un token ausente o con forma inválida se trata como link general (misma respuesta).
export const tokenParaPedido = (t) => (esTokenValido(t) ? t : null);

export function parsearRespuestaToken(data) {
  if (!data || typeof data !== 'object' || data.ok !== true) {
    const motivo = data && data.motivo;
    return { ok: false, mensaje: motivo === 'vendedor_invalido' ? 'El vendedor no existe o está dado de baja.' : 'PIN incorrecto o sin permiso de admin.' };
  }
  if (!esTokenValido(data.token)) return { ok: false, mensaje: 'El servidor devolvió un token inválido.' };
  return { ok: true, token: data.token };
}
