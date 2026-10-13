// src/utils/fuzzy.js - Búsqueda por similitud
import { getLocalTodayStr } from './pedidos';

export const normalize = (str) =>
  str.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

// Distancia de Levenshtein simplificada
const levenshtein = (a, b) => {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
};

export const fuzzySearch = (query, items, key = 'nombre', limit = 6) => {
  if (!query || query.length < 1) return [];
  const q = normalize(query);

  return items
    .map(item => {
      const name = normalize(item[key] || '');
      const startsWith = name.startsWith(q) ? 0 : 1;
      const contains = name.includes(q) ? 0 : 1;
      const words = name.split(' ');
      const wordMatch = words.some(w => w.startsWith(q)) ? 0 : 1;
      const dist = levenshtein(q, name.substring(0, q.length + 2));
      const score = startsWith * 10 + wordMatch * 5 + contains * 3 + dist;
      return { item, score, contains: !contains };
    })
    .filter(x => x.contains || x.score < 20)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map(x => x.item);
};

// Búsqueda rápida para productos (nombre y código). Devuelve más resultados y prioriza
// coincidencias por prefijo / contiene.
export const searchProductos = (query, productos, limit = 80) => {
  if (!query || query.trim().length < 1) return [];
  const q = normalize(query);
  // Si se escriben solo numeros se busca por codigo: los codigos que empiezan
  // igual (o coinciden exacto) van arriba de todo, y recien despues lo demas.
  const soloNumeros = /^\d+$/.test(q);

  const scored = [];
  for (const p of (productos || [])) {
    const nombre = normalize(p.nombre || '');
    const codigo = normalize(String(p.codigo || ''));

    const inNombre = nombre.includes(q);
    const inCodigo = codigo.includes(q);
    if (!inNombre && !inCodigo) continue;

    if (soloNumeros) {
      let tier;
      if (codigo === q) tier = 0;
      else if (codigo.startsWith(q)) tier = 100;
      else if (inCodigo) tier = 300;
      else tier = 600; // solo coincide en el nombre (ej: "500" ml)
      scored.push({ p, score: tier + Math.min(50, Math.abs(codigo.length - q.length)) });
      continue;
    }

    const score =
      (nombre.startsWith(q) ? 0 : 20) +
      (codigo.startsWith(q) ? 0 : 10) +
      (inNombre ? 0 : 40) +
      (inCodigo ? 0 : 30) +
      Math.min(10, Math.abs((nombre.length || 0) - q.length));

    scored.push({ p, score });
  }

  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map(x => x.p);
};

export const formatFecha = (dateStr) => {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
};

export const getTodayStr = () => {
  return getLocalTodayStr();
};
