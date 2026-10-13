// Busca una foto de producto por nombre usando Google Custom Search (Image Search).
// Gratis hasta 100 búsquedas/día por proyecto de Google Cloud. El resultado se
// guarda una sola vez en productos.imagen_url, así que la cuota no se vuelve
// a gastar en las próximas visitas ni sincronizaciones.

const API_KEY = process.env.REACT_APP_GOOGLE_CSE_KEY;
const CX = process.env.REACT_APP_GOOGLE_CSE_CX;

export class ImageSearchQuotaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImageSearchQuotaError';
    this.quotaExceeded = true;
  }
}

export const isImageSearchConfigured = () => Boolean(API_KEY && CX);

export const fetchProductImage = async (nombre) => {
  if (!isImageSearchConfigured()) return null;
  const q = String(nombre || '').trim();
  if (!q) return null;

  const params = new URLSearchParams({
    key: API_KEY,
    cx: CX,
    q,
    searchType: 'image',
    num: '1',
    safe: 'active',
    imgSize: 'medium',
  });

  const res = await fetch(`https://www.googleapis.com/customsearch/v1?${params.toString()}`);

  if (res.status === 429) {
    throw new ImageSearchQuotaError('Cuota diaria de búsqueda de imágenes agotada.');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const reason = body?.error?.errors?.[0]?.reason || '';
    if (reason.includes('rateLimitExceeded') || reason.includes('dailyLimitExceeded') || reason.includes('quotaExceeded')) {
      throw new ImageSearchQuotaError('Cuota diaria de búsqueda de imágenes agotada.');
    }
    return null;
  }

  const data = await res.json();
  const link = data?.items?.[0]?.link;
  return link || null;
};
