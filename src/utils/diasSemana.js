// src/utils/diasSemana.js
// Dias de la semana en español, usados para asignar a cada cliente su dia
// habitual de reparto en "Orden de entrega".

export const DIAS_SEMANA = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

export const DIA_LABEL = {
  lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles', jueves: 'Jueves',
  viernes: 'Viernes', sabado: 'Sábado', domingo: 'Domingo',
};

// JS: Date.getDay() → 0=domingo, 1=lunes, ... 6=sabado.
const JS_DAY_TO_DIA = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

export const diaDeFecha = (fechaStr) => {
  const [y, m, d] = String(fechaStr || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return JS_DAY_TO_DIA[new Date(y, m - 1, d).getDay()];
};

// Fecha (YYYY-MM-DD) desplazada N dias desde otra fecha (o desde hoy si no se pasa).
export const sumarDias = (fechaStr, n) => {
  let base;
  if (fechaStr) {
    const [y, m, d] = String(fechaStr).split('-').map(Number);
    base = new Date(y, m - 1, d);
  } else {
    base = new Date();
  }
  base.setDate(base.getDate() + n);
  const y2 = base.getFullYear();
  const m2 = String(base.getMonth() + 1).padStart(2, '0');
  const d2 = String(base.getDate()).padStart(2, '0');
  return `${y2}-${m2}-${d2}`;
};
