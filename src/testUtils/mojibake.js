// src/testUtils/mojibake.js — BUG-ENC-01 (RUN 20261012-2106, iteracion 2).
// Detector UNICO de mojibake para la regla dura 7. Lo usan
// encoding.regla7.test.js y qa.encoding.test.js (antes cada uno tenia su
// regex y la de la regla 7 no veia las mayusculas acentuadas rotas).
//
// UTF-8 leido como Windows-1252: el byte lider (C2/C3/E2) sale como
// "A circunfleja"/"A con tilde"/"a circunfleja" y el byte de continuacion
// (0x80-0xBF) sale como un caracter Latin-1 (0xA0-0xBF) o, para 0x80-0x9F,
// como los caracteres especiales de Windows-1252 (euro, comillas curvas,
// S con caron, etc.). Tambien se marca el caracter de reemplazo U+FFFD.
//
// Este archivo escribe esos caracteres SOLO como escapes \u, para no
// contener mojibake el mismo (el recorrido del repo lo lee).

// Caracteres que produce Windows-1252 para los bytes 0x80-0x9F.
export const CP1252_ALTOS = [
  '€', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ',
  '‰', 'Š', '‹', 'Œ', 'Ž', '‘', '’', '“',
  '”', '•', '–', '—', '˜', '™', 'š', '›',
  'œ', 'ž', 'Ÿ',
].join('');

export const MOJIBAKE = new RegExp(
  `[\\u00C2\\u00C3][\\u0080-\\u00BF${CP1252_ALTOS}]|\\u00E2[\\u0080-\\u00BF${CP1252_ALTOS}]|\\uFFFD`,
);

// Archivos que escriben los patrones a proposito (como regex o escapes de
// fixtures). Los recorridos del repo los saltean para no fallar por fixtures.
export const ARCHIVOS_CON_FIXTURES = /(encoding\.regla7\.test\.js|qa\.encoding\.test\.js|testUtils[\\/]mojibake\.js)$/;

export const tieneMojibake = (s) => MOJIBAKE.test(String(s ?? ''));
