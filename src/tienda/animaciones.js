// src/tienda/animaciones.js — animaciones de la tienda (solo presentación).
// Usa la Web Animations API: si el navegador no la tiene (o jsdom en tests) o el
// cliente pidió "reducir movimiento", no anima y no rompe nada.

export const reducirMovimiento = (win = typeof window !== 'undefined' ? window : null) => {
  try { return !!(win && win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
};

const puedeAnimar = (el) => !!el && typeof el.animate === 'function' && !reducirMovimiento();

// Rebote del ícono del carrito y "pop" del contador.
export function rebotarCarrito(doc = document) {
  const btn = doc.querySelector('.t-carrito-btn');
  if (!puedeAnimar(btn)) return;
  btn.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.28) rotate(-8deg)' }, { transform: 'scale(.92) rotate(4deg)' }, { transform: 'scale(1)' }],
    { duration: 520, easing: 'cubic-bezier(.3,1.6,.5,1)' },
  );
  const cont = btn.querySelector('.t-contador');
  if (cont && typeof cont.animate === 'function') {
    cont.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.6)' }, { transform: 'scale(1)' }], { duration: 420, delay: 80, easing: 'ease-out' });
  }
}

// La foto del producto vuela en arco desde `origen` (la tarjeta, la ficha o el
// botón) hasta el carrito del encabezado, y al llegar el carrito rebota.
export function volarAlCarrito(origen, doc = document) {
  const destino = doc.querySelector('.t-carrito-btn');
  if (!origen || !destino || !puedeAnimar(destino)) { rebotarCarrito(doc); return; }
  const contenedor = (origen.closest && (origen.closest('.t-card, .t-detalle, .t-sugerencia'))) || origen;
  const foto = contenedor.querySelector && contenedor.querySelector('img');
  const desde = (foto || origen).getBoundingClientRect();
  const hasta = destino.getBoundingClientRect();
  if (!desde.width || !hasta.width) { rebotarCarrito(doc); return; }

  const lado = Math.min(desde.width, desde.height, 140);
  const fantasma = doc.createElement('div');
  fantasma.className = 't-volador';
  fantasma.setAttribute('aria-hidden', 'true');
  if (foto && foto.currentSrc) fantasma.style.backgroundImage = `url("${String(foto.currentSrc).replace(/"/g, '%22')}")`;
  Object.assign(fantasma.style, {
    width: `${lado}px`, height: `${lado}px`,
    left: `${desde.left + desde.width / 2 - lado / 2}px`, top: `${desde.top + desde.height / 2 - lado / 2}px`,
  });
  doc.body.appendChild(fantasma);

  const dx = hasta.left + hasta.width / 2 - (desde.left + desde.width / 2);
  const dy = hasta.top + hasta.height / 2 - (desde.top + desde.height / 2);
  const fin = 28 / lado;
  const anim = fantasma.animate([
    { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1, borderRadius: '12px' },
    { transform: `translate(${dx * 0.35}px, ${dy * 0.35 - 90}px) scale(.7) rotate(-10deg)`, opacity: 1, offset: 0.45 },
    { transform: `translate(${dx}px, ${dy}px) scale(${fin}) rotate(12deg)`, opacity: 0.6, borderRadius: '50%' },
  ], { duration: 720, easing: 'cubic-bezier(.55,.06,.68,.19)' });
  const terminar = () => { if (fantasma.parentNode) fantasma.parentNode.removeChild(fantasma); rebotarCarrito(doc); };
  anim.onfinish = terminar;
  anim.oncancel = terminar;
}
