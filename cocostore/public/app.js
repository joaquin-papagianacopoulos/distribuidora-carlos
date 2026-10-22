// Tienda Coco Store: carga productos del servidor y los muestra con filtros.
const CATEGORIAS = ['Descartables', 'Recargables', 'Pods', 'Líquidos', 'Perfumes', 'Otros'];
const IG_DM = 'https://ig.me/m/cocostoreba';
const $ = (id) => document.getElementById(id);
const peso = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

let productos = [];
let whatsapp = '';
let filtro = 'Todos';
let texto = '';

function el(tag, clase, txt) {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (txt !== undefined) e.textContent = txt;
  return e;
}

function linkPedido(msg) {
  return whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(msg)}` : IG_DM;
}

// Solo las categorías que tienen al menos un producto cargado
const categoriasConProductos = () => CATEGORIAS.filter((c) => productos.some((p) => p.categoria === c));

function pintarNav() {
  const nav = $('nav');
  nav.replaceChildren();
  ['Todos', ...categoriasConProductos()].forEach((c) => {
    const b = el('button', '', c);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(c === filtro));
    b.onclick = () => { filtro = c; pintar(); $('productos').scrollIntoView(); };
    nav.append(b);
  });
}

function pintarCats() {
  const cont = $('cats');
  cont.replaceChildren();
  categoriasConProductos().forEach((c) => {
    const n = productos.filter((p) => p.categoria === c).length;
    const b = el('button', 'cat');
    b.type = 'button';
    b.append(el('b', '', c), el('span', '', n === 1 ? '1 producto' : `${n} productos`));
    b.onclick = () => { filtro = c; pintar(); $('productos').scrollIntoView(); };
    cont.append(b);
  });
}

function tarjeta(p) {
  const art = el('article', 'prod' + (p.agotado ? ' agotado' : ''));
  const foto = el('div', 'foto');
  const img = el('img');
  img.alt = p.nombre; img.loading = 'lazy';
  if (p.imagen) img.src = p.imagen; else { img.src = '/img/mascota.svg'; img.className = 'vacia'; img.alt = ''; }
  foto.append(img);
  if (p.agotado) foto.append(el('span', 'cinta', 'Agotado'));
  const info = el('div', 'info');
  info.append(el('span', 'cat-nombre', p.categoria), el('h3', '', p.nombre),
    el('div', 'precio', p.precio > 0 ? peso.format(p.precio) : 'Consultar precio'));
  const a = el('a', 'btn', p.agotado ? 'Sin stock' : 'Pedir por WhatsApp');
  a.href = linkPedido(`Hola Coco Store! Quiero pedir: ${p.nombre}${p.precio > 0 ? ' (' + peso.format(p.precio) + ')' : ''}`);
  a.target = '_blank'; a.rel = 'noopener';
  info.append(a);
  art.append(foto, info);
  return art;
}

function pintar() {
  if (filtro !== 'Todos' && !categoriasConProductos().includes(filtro)) filtro = 'Todos';
  pintarNav();
  const q = texto.trim().toLowerCase();
  const lista = productos
    .filter((p) => (filtro === 'Todos' || p.categoria === filtro) && (!q || p.nombre.toLowerCase().includes(q)))
    // agrupa por categoría y deja los agotados al final de cada una (el sort es estable)
    .sort((a, b) => CATEGORIAS.indexOf(a.categoria) - CATEGORIAS.indexOf(b.categoria) || Number(!!a.agotado) - Number(!!b.agotado));
  $('t-prod').textContent = filtro === 'Todos' ? 'Todos los productos' : filtro;
  $('cuenta').textContent = lista.length === 1 ? '1 producto' : `${lista.length} productos`;
  const g = $('grilla');
  g.replaceChildren();
  if (!lista.length) {
    const v = el('div', 'vacio');
    v.append(el('h3', '', 'No encontramos productos acá'), el('p', '', 'Escribinos y te decimos qué hay disponible.'));
    const a = el('a', 'btn', 'Consultar por WhatsApp');
    a.href = linkPedido('Hola Coco Store! Quería consultar por un producto.'); a.target = '_blank'; a.rel = 'noopener';
    v.append(a); g.append(v);
    return;
  }
  lista.forEach((p) => g.append(tarjeta(p)));
}

function enlacesWA() {
  const h = linkPedido('Hola Coco Store! Quería hacer una consulta.');
  ['wa-cab', 'wa-pie', 'wa-flota'].forEach((id) => { $(id).href = h; });
  document.querySelectorAll('[data-wa]').forEach((a) => { a.href = h; });
}

async function cargar() {
  try {
    const [p, c] = await Promise.all([fetch('/api/products').then((r) => r.json()), fetch('/api/config').then((r) => r.json())]);
    productos = p; whatsapp = c.whatsapp || '';
  } catch { productos = []; }
  enlacesWA(); pintarCats(); pintar();
}

$('q').addEventListener('input', (e) => { texto = e.target.value; pintar(); });

// Verificación +18 (se recuerda en este dispositivo)
try {
  if (localStorage.getItem('coco18') !== '1') {
    $('edad').hidden = false;
    $('edad-si').focus();
    $('edad-si').onclick = () => { try { localStorage.setItem('coco18', '1'); } catch {} $('edad').hidden = true; };
  }
} catch { /* sin storage: no se muestra el cartel */ }

// Botones del banner que filtran la grilla
document.querySelectorAll('[data-filtro]').forEach((a) => {
  a.addEventListener('click', () => { filtro = a.dataset.filtro; pintar(); });
});

// Slider del banner: cada slide dura lo que dura la barra de progreso (animationend avanza)
(function slider() {
  const slides = [...document.querySelectorAll('.slide')];
  const cont = $('puntos');
  let i = 0;
  const dots = slides.map((s, n) => {
    const d = el('button', 'punto');
    d.type = 'button'; d.setAttribute('role', 'tab'); d.setAttribute('aria-label', `Banner ${n + 1} de ${slides.length}`);
    d.style.setProperty('--dur', (Number(s.dataset.t) || 6500) + 'ms');
    d.append(el('i'));
    d.onclick = () => ir(n);
    d.querySelector('i').addEventListener('animationend', () => ir(i + 1));
    cont.append(d); return d;
  });
  function ir(n) {
    i = (n + slides.length) % slides.length;
    slides.forEach((s, k) => { s.classList.toggle('on', k === i); s.setAttribute('aria-hidden', String(k !== i)); });
    dots.forEach((d, k) => {
      d.setAttribute('aria-selected', String(k === i));
      d.classList.remove('on'); void d.offsetWidth; // reinicia la barra
      if (k === i) d.classList.add('on');
    });
  }
  $('prev').onclick = () => ir(i - 1);
  $('next').onclick = () => ir(i + 1);
  const b = $('banner');
  const pausa = (p) => b.classList.toggle('pausa', p);
  b.addEventListener('mouseenter', () => pausa(true));
  b.addEventListener('mouseleave', () => pausa(false));
  b.addEventListener('focusin', () => pausa(true));
  b.addEventListener('focusout', () => pausa(false));
  // deslizar con el dedo
  let x0 = null;
  b.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  b.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 50) ir(i + (dx < 0 ? 1 : -1));
  });
  document.addEventListener('visibilitychange', () => pausa(document.hidden));
  ir(0);
})();

cargar();
