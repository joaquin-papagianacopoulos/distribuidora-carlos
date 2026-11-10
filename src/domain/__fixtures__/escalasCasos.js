// src/domain/__fixtures__/escalasCasos.js — REQ-ESC (AC-ESC-2, AC-ESC-4).
// Casos compartidos cliente/servidor: los corre precios.escalas.test.js (JS) y
// supabase/verificacion/026_escalas_casos.sql tiene EXACTAMENTE los mismos
// (lo verifica migracion026.sql.test.js). Si agregás uno acá, agregalo allá.
//
// producto: { precio, precioBulto, bultoX, escalas } (escalas tal como llegan, crudas)
// base:     precio unitario despues de la regla REQ-PBU (antes de la escala)
// esperado: precio unitario final (pesos, redondeado para arriba al peso entero si hubo escala)
// escala:   desde de la escala aplicada o null
export const CASOS_ESCALAS = [
  { id: 'sin-escalas', precio: 1000, precioBulto: 0, bultoX: 12, escalas: [], cantidad: 120, base: 1000, esperado: 1000, escala: null },
  { id: 'borde-4-bultos-no', precio: 1000, precioBulto: 0, bultoX: 10, escalas: [{ desde: 5, pct: 8 }], cantidad: 49, base: 1000, esperado: 1000, escala: null },
  { id: 'borde-5-bultos-si', precio: 1000, precioBulto: 0, bultoX: 10, escalas: [{ desde: 5, pct: 8 }], cantidad: 50, base: 1000, esperado: 920, escala: 5 },
  { id: 'escala-mas-alta', precio: 1000, precioBulto: 0, bultoX: 10, escalas: [{ desde: 5, pct: 8 }, { desde: 10, pct: 12 }], cantidad: 100, base: 1000, esperado: 880, escala: 10 },
  { id: 'escala-intermedia', precio: 1000, precioBulto: 0, bultoX: 10, escalas: [{ desde: 5, pct: 8 }, { desde: 10, pct: 12 }], cantidad: 99, base: 1000, esperado: 920, escala: 5 },
  { id: 'redondeo-arriba', precio: 815, precioBulto: 0, bultoX: 6, escalas: [{ desde: 3, pct: 8 }], cantidad: 18, base: 815, esperado: 750, escala: 3 },
  { id: 'redondeo-exacto', precio: 800, precioBulto: 0, bultoX: 6, escalas: [{ desde: 3, pct: 8 }], cantidad: 18, base: 800, esperado: 736, escala: 3 },
  { id: 'base-con-centavos', precio: 799.5, precioBulto: 0, bultoX: 6, escalas: [{ desde: 3, pct: 8 }], cantidad: 18, base: 799.5, esperado: 736, escala: 3 },
  { id: 'sobre-precio-bulto', precio: 1000, precioBulto: 800, bultoX: 12, escalas: [{ desde: 5, pct: 8 }], cantidad: 60, base: 800, esperado: 736, escala: 5 },
  { id: 'precio-bulto-mayor', precio: 800, precioBulto: 1000, bultoX: 12, escalas: [{ desde: 5, pct: 10 }], cantidad: 60, base: 800, esperado: 720, escala: 5 },
  { id: 'pct-con-decimales', precio: 1000, precioBulto: 0, bultoX: 10, escalas: [{ desde: 2, pct: 7.5 }], cantidad: 20, base: 1000, esperado: 925, escala: 2 },
  { id: 'desordenadas', precio: 1000, precioBulto: 0, bultoX: 10, escalas: [{ desde: 10, pct: 12 }, { desde: 5, pct: 8 }], cantidad: 100, base: 1000, esperado: 880, escala: 10 },
  { id: 'duplicadas', precio: 1000, precioBulto: 0, bultoX: 10, escalas: [{ desde: 5, pct: 8 }, { desde: 5, pct: 20 }], cantidad: 50, base: 1000, esperado: 920, escala: 5 },
  { id: 'desde-1-ignorada', precio: 1000, precioBulto: 0, bultoX: 10, escalas: [{ desde: 1, pct: 50 }], cantidad: 10, base: 1000, esperado: 1000, escala: null },
  { id: 'pct-cero-ignorado', precio: 1000, precioBulto: 0, bultoX: 10, escalas: [{ desde: 2, pct: 0 }], cantidad: 20, base: 1000, esperado: 1000, escala: null },
  { id: 'pct-100-ignorado', precio: 1000, precioBulto: 0, bultoX: 10, escalas: [{ desde: 2, pct: 100 }], cantidad: 20, base: 1000, esperado: 1000, escala: null },
  { id: 'pct-3-decimales-ignorado', precio: 1000, precioBulto: 0, bultoX: 10, escalas: [{ desde: 2, pct: 7.125 }], cantidad: 20, base: 1000, esperado: 1000, escala: null },
  { id: 'desde-texto-ignorado', precio: 1000, precioBulto: 0, bultoX: 10, escalas: [{ desde: '2', pct: 10 }], cantidad: 20, base: 1000, esperado: 1000, escala: null },
  { id: 'cuatro-escalas-corta-en-3', precio: 1000, precioBulto: 0, bultoX: 10, escalas: [{ desde: 2, pct: 1 }, { desde: 3, pct: 2 }, { desde: 4, pct: 3 }, { desde: 5, pct: 50 }], cantidad: 50, base: 1000, esperado: 970, escala: 4 },
  { id: 'bultox-1-sin-escala', precio: 1000, precioBulto: 0, bultoX: 1, escalas: [{ desde: 2, pct: 10 }], cantidad: 20, base: 1000, esperado: 1000, escala: null },
  { id: 'bultox-0-sin-escala', precio: 1000, precioBulto: 0, bultoX: 0, escalas: [{ desde: 2, pct: 10 }], cantidad: 20, base: 1000, esperado: 1000, escala: null },
  { id: 'cantidad-decimal', precio: 1000, precioBulto: 0, bultoX: 10, escalas: [{ desde: 5, pct: 8 }], cantidad: 49.9, base: 1000, esperado: 1000, escala: null },
  { id: 'no-baja-precio-chico', precio: 5, precioBulto: 0, bultoX: 10, escalas: [{ desde: 2, pct: 8 }], cantidad: 20, base: 5, esperado: 5, escala: null },
  { id: 'escalas-null', precio: 1000, precioBulto: 0, bultoX: 10, escalas: null, cantidad: 50, base: 1000, esperado: 1000, escala: null },
];
