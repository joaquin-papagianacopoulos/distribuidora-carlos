// src/sync/tolerancia.js — detección de "columna inexistente" en Supabase.
// Si la migración todavía no se corrió, PostgREST responde PGRST204 ("Could not
// find the 'x' column") o Postgres 42703. Se usa para reintentar sin las
// columnas nuevas en vez de cortar la sincronización (AC-CLI-5, AC-COM-1).
// Vive aparte para que pedidoRepository lo use sin importar todo syncService.
export const esColumnaInexistente = (error) =>
  String(error?.code) === 'PGRST204' || String(error?.code) === '42703' ||
  /could not find the .* column|column .* does not exist/i.test(String(error?.message || ''));
