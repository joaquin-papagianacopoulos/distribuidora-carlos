// src/sync/tolerancia.js — detección de "columna inexistente" en Supabase.
// Si la migración todavía no se corrió, PostgREST responde PGRST204 ("Could not
// find the 'x' column") o Postgres 42703. Se usa para reintentar sin las
// columnas nuevas en vez de cortar la sincronización (AC-CLI-5, AC-COM-1).
// Vive aparte para que pedidoRepository lo use sin importar todo syncService.
export const esColumnaInexistente = (error) =>
  String(error?.code) === 'PGRST204' || String(error?.code) === '42703' ||
  /could not find the .* column|column .* does not exist/i.test(String(error?.message || ''));

// S-VTA-01: la RPC no existe todavia (migracion 007 sin aplicar).
export const esFuncionInexistente = (error) =>
  String(error?.code) === 'PGRST202' || String(error?.code) === '42883' ||
  /could not find the function/i.test(String(error?.message || ''));

// 016: lectura denegada (grant de tabla o de columna faltante). PostgREST: 42501 / HTTP 401-403.
export const esPermisoDenegado = (error) =>
  String(error?.code) === '42501' || /permission denied/i.test(String(error?.message || ''));

// S-VTA-01: la escritura directa esta cerrada (grants revocados / RLS).
export const esEscrituraDenegada = (error) =>
  String(error?.code) === '42501' ||
  /permission denied|row-level security/i.test(String(error?.message || ''));
