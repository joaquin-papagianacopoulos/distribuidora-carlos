import { createClient } from '@supabase/supabase-js';

const url = process.env.REACT_APP_SUPABASE_URL;
const key = process.env.REACT_APP_SUPABASE_ANON_KEY;

// AC-SEC-1: nunca loguear la URL ni la clave (antes se imprimian en consola).
if (!url || !key) {
  // eslint-disable-next-line no-console
  console.error('Falta configurar Supabase (REACT_APP_SUPABASE_URL / REACT_APP_SUPABASE_ANON_KEY).');
}

export const supabase = createClient(url, key);
