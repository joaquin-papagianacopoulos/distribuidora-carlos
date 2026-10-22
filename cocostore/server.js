// Servidor mínimo de Coco Store (sin dependencias). Node 18+.
// Guarda productos en data/products.json y las fotos en uploads/.
// Uso: node server.js   ->  http://localhost:3000  (panel: /admin)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_PASS = process.env.ADMIN_PASS || 'coco2026'; // cambiala con la variable ADMIN_PASS
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = path.join(ROOT, 'uploads');
const DATA = path.join(ROOT, 'data');
const F_PROD = path.join(DATA, 'products.json');
const F_CONF = path.join(DATA, 'config.json');

fs.mkdirSync(UPLOADS, { recursive: true });
fs.mkdirSync(DATA, { recursive: true });

const leer = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
const guardar = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));

const tokens = new Set();
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' };

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function body(req, max = 8e6) {
  return new Promise((ok, fail) => {
    let n = 0; const parts = [];
    req.on('data', (c) => { n += c.length; if (n > max) { fail(new Error('grande')); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { ok(JSON.parse(Buffer.concat(parts).toString() || '{}')); } catch (e) { fail(e); } });
  });
}
const esAdmin = (req) => tokens.has((req.headers.authorization || '').replace('Bearer ', ''));

// Guarda un dataURL (jpeg/png/webp) en uploads/ y devuelve la ruta pública
function guardarFoto(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  const nombre = crypto.randomUUID() + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
  fs.writeFileSync(path.join(UPLOADS, nombre), Buffer.from(m[2], 'base64'));
  return '/uploads/' + nombre;
}
function borrarFoto(ruta) {
  if (!ruta || !ruta.startsWith('/uploads/')) return;
  const f = path.join(UPLOADS, path.basename(ruta));
  fs.rm(f, { force: true }, () => {});
}

async function api(req, res, url) {
  const m = req.method;
  if (url === '/api/products' && m === 'GET') return json(res, 200, leer(F_PROD, []));
  if (url === '/api/config' && m === 'GET') return json(res, 200, leer(F_CONF, { whatsapp: '' }));

  if (url === '/api/login' && m === 'POST') {
    const { password } = await body(req);
    if (password !== ADMIN_PASS) return json(res, 401, { error: 'Contraseña incorrecta' });
    const t = crypto.randomUUID(); tokens.add(t);
    return json(res, 200, { token: t });
  }
  if (!esAdmin(req)) return json(res, 401, { error: 'Tenés que ingresar de nuevo' });

  if (url === '/api/config' && m === 'PUT') {
    const { whatsapp } = await body(req);
    const conf = { whatsapp: String(whatsapp || '').replace(/\D/g, '') };
    guardar(F_CONF, conf);
    return json(res, 200, conf);
  }
  if (url === '/api/products' && m === 'POST') {
    const d = await body(req);
    const foto = guardarFoto(d.foto);
    const p = { id: crypto.randomUUID(), nombre: String(d.nombre || '').slice(0, 120), precio: Number(d.precio) || 0,
      categoria: String(d.categoria || 'Vapes'), imagen: foto || '', agotado: false, creado: Date.now() };
    if (!p.nombre) return json(res, 400, { error: 'Falta el nombre' });
    const lista = leer(F_PROD, []); lista.unshift(p); guardar(F_PROD, lista);
    return json(res, 201, p);
  }
  const mm = /^\/api\/products\/([\w-]+)$/.exec(url);
  if (mm) {
    const lista = leer(F_PROD, []);
    const i = lista.findIndex((p) => p.id === mm[1]);
    if (i < 0) return json(res, 404, { error: 'No existe' });
    if (m === 'DELETE') { borrarFoto(lista[i].imagen); lista.splice(i, 1); guardar(F_PROD, lista); return json(res, 200, { ok: true }); }
    if (m === 'PUT') {
      const d = await body(req);
      const p = lista[i];
      if (d.nombre !== undefined) p.nombre = String(d.nombre).slice(0, 120);
      if (d.precio !== undefined) p.precio = Number(d.precio) || 0;
      if (d.categoria !== undefined) p.categoria = String(d.categoria);
      if (d.agotado !== undefined) p.agotado = !!d.agotado;
      if (d.foto) { const f = guardarFoto(d.foto); if (f) { borrarFoto(p.imagen); p.imagen = f; } }
      guardar(F_PROD, lista);
      return json(res, 200, p);
    }
  }
  json(res, 404, { error: 'No encontrado' });
}

http.createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (url.startsWith('/api/')) return await api(req, res, url);
    let rel = url === '/' ? '/index.html' : url === '/admin' ? '/admin.html' : url;
    const base = rel.startsWith('/uploads/') ? UPLOADS : PUBLIC;
    const file = path.join(base, rel.startsWith('/uploads/') ? rel.slice(9) : rel);
    if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('No encontrado'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  } catch (e) {
    json(res, 400, { error: 'Pedido inválido' });
  }
}).listen(PORT, () => console.log(`Coco Store en http://localhost:${PORT}  (panel: /admin, clave: ${ADMIN_PASS === 'coco2026' ? 'coco2026 — cambiala' : 'definida por ADMIN_PASS'})`));
