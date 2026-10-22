// Panel simple de Coco Store: subir, editar, marcar agotado y borrar productos.
const CATEGORIAS = ['Descartables', 'Recargables', 'Pods', 'Líquidos', 'Perfumes', 'Otros'];
const $ = (id) => document.getElementById(id);
const peso = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

let token = '';
try { token = sessionStorage.getItem('cocoTok') || ''; } catch {}
let productos = [];
let fotoNueva = ''; // dataURL ya achicada
let editando = null;

async function api(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } , body: opts.body ? JSON.stringify(opts.body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== '/api/login') { salir(); throw new Error(d.error || 'Ingresá de nuevo'); }
  if (!r.ok) throw new Error(d.error || 'Algo salió mal');
  return d;
}
function msg(id, txt, mal) { const m = $(id); m.textContent = txt; m.className = 'msg' + (mal ? ' mal' : ''); }

function mostrar(ok) { $('login').hidden = ok; $('panel').hidden = !ok; }
function salir() { token = ''; try { sessionStorage.removeItem('cocoTok'); } catch {} mostrar(false); }

// Achica la foto del celu (suele pesar varios MB) a 1000px
function achicar(file) {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1000 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      ok(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => fail(new Error('No se pudo leer la foto'));
    img.src = URL.createObjectURL(file);
  });
}

function vistaPrevia(src) {
  const p = $('prev');
  p.hidden = !src; if (src) p.src = src;
  $('zona-txt').hidden = !!src;
}

function limpiarForm() {
  editando = null; fotoNueva = '';
  $('f-prod').reset(); vistaPrevia('');
  $('t-form').textContent = 'Subir un producto';
  $('guardar').textContent = 'Subir producto';
  $('cancelar').hidden = true;
}

function pintarLista() {
  const l = $('lista'); l.replaceChildren();
  if (!productos.length) {
    const p = document.createElement('p'); p.textContent = 'Todavía no cargaste productos. Subí el primero arriba.'; p.style.fontWeight = '600'; l.append(p); return;
  }
  productos.forEach((p) => {
    const f = document.createElement('div'); f.className = 'fila';
    const img = document.createElement('img'); img.alt = '';
    if (p.imagen) img.src = p.imagen; else { img.src = '/img/mascota.svg'; img.className = 'vacia'; }
    const t = document.createElement('div');
    const b = document.createElement('b'); b.textContent = p.nombre;
    const s = document.createElement('small'); s.textContent = `${p.categoria} · ${p.precio > 0 ? peso.format(p.precio) : 'Sin precio'}${p.agotado ? ' · Agotado' : ''}`;
    t.append(b, s);
    const acc = document.createElement('div'); acc.className = 'acc';
    const mk = (txt, fn, cls) => { const x = document.createElement('button'); x.type = 'button'; x.textContent = txt; if (cls) x.className = cls; x.onclick = fn; acc.append(x); };
    mk('Editar', () => editar(p));
    mk(p.agotado ? 'Hay stock' : 'Agotado', async () => { await api('/api/products/' + p.id, { method: 'PUT', body: { agotado: !p.agotado } }); cargar(); });
    mk('Borrar', async () => { if (confirm(`¿Borrar "${p.nombre}"? No se puede deshacer.`)) { await api('/api/products/' + p.id, { method: 'DELETE' }); cargar(); } }, 'borrar');
    f.append(img, t, acc); l.append(f);
  });
}

function editar(p) {
  editando = p.id; fotoNueva = '';
  $('nombre').value = p.nombre; $('precio').value = p.precio || ''; $('cat').value = p.categoria;
  vistaPrevia(p.imagen);
  $('t-form').textContent = 'Editar producto';
  $('guardar').textContent = 'Guardar cambios';
  $('cancelar').hidden = false;
  $('f-prod').scrollIntoView({ behavior: 'smooth' });
}

async function cargar() {
  productos = await fetch('/api/products').then((r) => r.json());
  pintarLista();
  const c = await fetch('/api/config').then((r) => r.json());
  $('wa').value = c.whatsapp || '';
}

function iniciar() {
  mostrar(true);
  cargar();
}

$('cat').replaceChildren(...CATEGORIAS.map((c) => { const o = document.createElement('option'); o.textContent = c; return o; }));

$('foto').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { fotoNueva = await achicar(f); vistaPrevia(fotoNueva); msg('m-prod', ''); } catch (er) { msg('m-prod', er.message, true); }
});
$('cancelar').onclick = () => { limpiarForm(); msg('m-prod', ''); };
$('salir').onclick = salir;

$('f-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const d = await api('/api/login', { method: 'POST', body: { password: $('pass').value } });
    token = d.token; try { sessionStorage.setItem('cocoTok', token); } catch {}
    $('pass').value = ''; msg('m-login', ''); iniciar();
  } catch (er) { msg('m-login', er.message, true); }
});

$('f-prod').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = { nombre: $('nombre').value.trim(), precio: Number($('precio').value.replace(/\D/g, '')) || 0, categoria: $('cat').value };
  if (fotoNueva) body.foto = fotoNueva;
  $('guardar').disabled = true;
  try {
    if (editando) await api('/api/products/' + editando, { method: 'PUT', body });
    else await api('/api/products', { method: 'POST', body });
    msg('m-prod', editando ? 'Cambios guardados' : 'Producto subido. Ya está en la tienda.');
    limpiarForm(); await cargar();
  } catch (er) { msg('m-prod', er.message, true); }
  $('guardar').disabled = false;
});

$('f-conf').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await api('/api/config', { method: 'PUT', body: { whatsapp: $('wa').value } }); msg('m-conf', 'Número guardado'); } catch (er) { msg('m-conf', er.message, true); }
});

// El servidor guarda las sesiones en memoria: si se reinició, el primer guardado pide entrar de nuevo.
mostrar(false);
if (token) iniciar();
