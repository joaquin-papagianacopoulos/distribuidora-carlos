# Reporte de seguridad — corrida 20261007-run1

Rol: `auditor-seguridad` · Fecha: 2026-10-07 · Alcance: commit `944c1e8` (altas de clientes/proveedores/productos, ledger de stock, migración `001_altas_y_stock.sql`) + superficie existente de la app.
Referencia: `harness/SPEC.md` → REQ-SEC (AC-SEC-1..6).

## Resumen ejecutivo

- **La app no tiene autenticación del lado servidor.** Todo entra a Supabase con la *anon key*, que va dentro del bundle JS. Cualquiera que abra la PWA (o descargue `main.*.js`) puede leer y escribir con `curl` todo lo que la app lee y escribe: clientes con CUIT, teléfono y domicilio, precios, pedidos, deudas y **los PIN de los vendedores en texto plano**. Con el PIN del admin, o forjando `localStorage`, se entra como admin. Esto es **Crítico** y no se arregla solo con código del cliente: hace falta configurar Supabase (pasos 1 a 3 de `002_seguridad_recomendada.sql`) y, como objetivo final, usar Supabase Auth (paso 5).
- **Lo nuevo de esta corrida está razonablemente bien hecho:** se sacó el log de la key, hay validación en dominio, `csvSafe` en la importación, el ledger se sube de forma idempotente por UUID, hay RLS en las tablas nuevas, el ledger no tiene política de DELETE y tiene trigger de inmutabilidad. Quedan huecos de integridad en el ledger: `ref` se puede modificar (eso permite que un pedido descuente dos veces), se pueden insertar movimientos falsos, las refs locales chocan entre dispositivos y hay valores que hacen fallar la sincronización en cada intento.
- **Dependencias:** el gate `npm-audit` está en ROJO por `jspdf` 2.5.2 (crítico), `jspdf-autotable`, `xlsx` 0.18.5 y `ws` (altos). Las cuatro tienen arreglo. Para `jspdf` 4.x + `jspdf-autotable` 5.x alcanza con cambiar 4 líneas de `pdfGen.js` (detalle en S-08).
- **Build:** se publican sourcemaps (7 archivos `.map`) y `public/_headers` no define CSP ni anti-framing.

Totales de la iteración 1: **2 Críticos, 5 Altos, 7 Medios, 5 Bajos** abiertos, y 7 controles **CORREGIDOS**.
**Después de la iteración 2:** siguen abiertos 2 Críticos (S-01, S-02), 2 Altos (S-04 y S-05, ambos en Supabase), 2 Medios (S-10 y S-14, en Supabase) y 5 Bajos (S-17, S-18, S-19, S-20, S-21). MITIGADOS: S-03, S-07, S-09. CORREGIDOS: S-06, S-08 (en código), S-11, S-12, S-13, S-15, S-16. Gates: `secret-scan` PASS · `security-rules` PASS · `npm-audit` **PASS** (solo `xlsx` sigue alta en runtime). Ver la sección "Iteración 2".

## Tabla de hallazgos

| Severidad | Hallazgo | Evidencia | Estado (ABIERTO/CORREGIDO) | Dónde se corrige (código/Supabase/infra) |
|---|---|---|---|---|
| Crítico (CVSS ~9.1) | S-01 Sin autenticación en el servidor: con la anon key se puede leer, escribir y borrar en las tablas legacy (`clientes` con CUIT/teléfono/domicilio, `productos`, `pedidos`, `deudas`, `faltantes`, `vendedores`) | `src/sync/syncService.js:604-625` (`select('*')` con anon), `src/services/deudaRepository.js:73,167`, `src/pages/Configuracion.js:302`, `src/pages/Faltantes.js:273` (DELETE con anon) | ABIERTO | Supabase (002 paso 3 y paso 5: Auth) |
| Crítico (CVSS ~8.8) | S-02 PIN de vendedores en texto plano, legible con la anon key y comparado en el cliente ⇒ toma de la cuenta admin | `syncService.js:702,741` (`pin: r.pin`), `SelectorVendedor.js:103-104`, `Configuracion.js:260-274` (alta con `pin` plano) | ABIERTO | Supabase (002 pasos 1-2) + código (RPC `verificar_pin`) |
| Alto (CVSS ~8.1) | S-03 Rol forjable: `vendedorActual` (id/permiso) se restaura desde `localStorage` sin validar; un id inexistente con `permiso:1` da UI de admin sin PIN | `src/hooks/useAppContext.js:218-221`, `:321-323` (iter 1) | MITIGADO (iter 3: permiso desde IndexedDB, PIN por sesión, `localStorage` sin PIN ni permiso; lo que queda es un límite del cliente, ver Iteración 3) | código (mitigación) + Supabase Auth (fix real) |
| Alto (CVSS ~8.1) | S-04 Escalada por alta de vendedores: anon puede `INSERT vendedores {permiso:1}` o `PATCH pin` del admin; además el selector permite crear vendedores sin autenticación | `SelectorVendedor.js:49-66`, `syncService.js:555-569`; reproducido en Postgres 16 local | ABIERTO | Supabase (002 paso 1: trigger `vendedor_esc_sin_escalada`) |
| Alto (CVSS ~7.1) | S-05 Integridad del ledger: anon puede cambiar `ref`, `usuario`, `nota` y `fecha` de un movimiento (si se cambia `ref` de una venta, el pedido vuelve a descontar), insertar ingresos sin cabecera o ventas con cantidad positiva | `001_altas_y_stock.sql:147-149` (políticas `using (true)`), el trigger `tg_movimiento_inmutable` solo cubre 3 columnas (`:106-114`); reproducido en Postgres local | ABIERTO | Supabase (002 paso 4) |
| Alto (npm: crítico) | S-06 `jspdf` 2.5.2 (+ `dompurify` 2.5.9): PDF/JS injection, LFI y DoS. Explotabilidad real baja: la app no usa `addJS`, AcroForm, `html()` ni `loadFile` | `package.json`, `src/utils/pdfGen.js:12-13,67-68,151-152,219-220`, `npm audit` | CORREGIDO (iter 2: jspdf 4.2.1, autotable 5.0.8, dompurify 3.4.16) | código |
| Alto | S-07 `xlsx` 0.18.5: prototype pollution (GHSA-4r6h-8v6p-xvw6) y ReDoS al parsear planillas de proveedores (origen no confiable) | `Configuracion.js:169-176` (`XLSX.read` de un archivo subido) | MITIGADO (iter 2: solo admin y tope de 5 MB; la versión corregida queda pendiente) | dueño (instalar el tarball de cdn.sheetjs.com) |
| Medio (CVSS ~5.3) | S-08 Se publican sourcemaps (código fuente completo, incluida la lógica de roles) | `build/static/js/*.map` (7 archivos), no se define `GENERATE_SOURCEMAP=false` | CORREGIDO en código (iter 2: `.env.production`; build verificado sin `.map`). Falta borrar los `.map` ya publicados | código + infra (redeploy) |
| Medio (CVSS ~5.4) | S-09 `public/_headers` sin CSP, `frame-ancestors`/X-Frame-Options, `nosniff`, Referrer-Policy ni Permissions-Policy (clickjacking, sin defensa en profundidad contra XSS) | `public/_headers:1-11` | MITIGADO (iter 2: todos los headers activos; la CSP está en Report-Only) | infra (pasar la CSP a modo enforced) |
| Medio | S-10 La política `proveedores_rw` es `for all`: anon puede BORRAR proveedores (si no tienen ingresos) | `001_altas_y_stock.sql:142` | ABIERTO | Supabase (002 paso 4) + código (borrado lógico) |
| Medio | S-11 Colisión de refs `pedido-local:<autoincrement>` entre dispositivos: si se suben movimientos antes del re-key, otro dispositivo con el mismo id local los toma como propios y emite anulaciones o ventas incorrectas | `src/domain/stock.js:36-42`, `stockService.js:72-80` (iter 1) | CORREGIDO (iter 2: `esRefLocal` retiene las refs locales) | código |
| Medio | S-12 "Poison pill" de sincronización: el dominio acepta valores que la DB rechaza (ajuste de stock con delta > 1.000.000, cantidades de pedido > 1e6, `costo/precio` > numeric(14,2), `bultoX` > int4). El upsert por lotes de 200 falla en cada intento y frena todo el sync de stock | `stock.js:110-112`, `productos.js:60-87`, `stockService.js:77` (iter 1) | CORREGIDO (iter 2: `MAX_CANTIDAD`, `MAX_IMPORTE`, push fila por fila) | código |
| Medio | S-13 La importación CSV/XLSX no pasa por `validarProducto`: `codigo`/`unidad` sin `texto()`/`csvSafe`, `precio` con `parseFloat` (`"1.234,50"` → 1.234) y sin topes | `Configuracion.js:96-101` (iter 1) | CORREGIDO (iter 2: `toNum`/`texto`/`csvSafe`; ver S-21) | código |
| Medio | S-14 Datos personales de clientes (CUIT, teléfono, domicilio) expuestos sin control de acceso (Ley 25.326) | consecuencia de S-01; columnas en `001:9-22` | ABIERTO | Supabase (paso 5) |
| Bajo | S-15 `ws` 8.20.0 (dependencia de `@supabase/realtime-js`; en el navegador se usa el WebSocket nativo y no se empaqueta) | `npm ls ws` | CORREGIDO (iter 2: ws 8.22.0) | código |
| Bajo | S-16 `fflate` 0.8.2 (bucle infinito con ZIP64 malformado) | `package.json` | CORREGIDO (iter 2: fflate 0.8.3) | código |
| Bajo | S-17 Auditoría débil del ledger: `usuario` y `created_at` los manda el cliente, así que no se puede saber quién hizo cada movimiento | `stock.js:75,117,175`; `001:65-67` | ABIERTO | Supabase (002 paso 4: `tg_sello_servidor`) |
| Bajo | S-18 Logs verbosos del sync (`console.error('ERROR EN SYNC:', e)` con el objeto completo; mensajes de PostgREST en el banner de la UI) | `useAppContext.js:117-205` | ABIERTO | código |
| Bajo | S-19 El ajuste de stock se calcula como delta sobre el stock local: dos dispositivos que ajustan offline al mismo valor aplican el ajuste dos veces | `stockService.js:47-52`, `stock.js:109-119` | ABIERTO | código (diseño) |
| Bajo | S-20 (iter 2, lo encontró QA) El `usuario` de los movimientos de stock de pedidos se lee de `localStorage.vendedorActual.nombre`, que se puede forjar; además ese JSON guarda el PIN en texto plano | `src/services/pedidoRepository.js:173-175`, `useAppContext.js:311,334` (iter 2) | CORREGIDO (iter 3: `getNombreUsuarioSesion()` y `datosPersistibles`) | código |
| Bajo | S-21 (iter 2) La importación CSV/XLSX no limita el precio a `MAX_IMPORTE`, y `syncProductos` corta el lote entero ante un error de dato | `Configuracion.js:97-98`, `syncService.js:180-182` (iter 2) | CORREGIDO (iter 3: `if (precio > MAX_IMPORTE)` descarta la fila) | código |
| — | K-1 La URL y la anon key ya no se loguean | `src/lib/supabase.js:6-10`; test `security.supabase.test.js` | CORREGIDO | código |
| — | K-2 Validación y normalización en dominio de clientes, proveedores, productos, ingresos y ajustes (NaN, Infinity, negativos, largos) | `src/domain/validacion.js`, `clientes.js`, `productos.js`, `stock.js`; test `security.validacion.test.js` | CORREGIDO | código |
| — | K-3 `csvSafe` contra formula injection en la importación (nombre y categoría) | `validacion.js:77-83`, `Configuracion.js:96,101` | CORREGIDO (parcial, ver S-13) | código |
| — | K-4 RLS habilitado en `proveedores`, `movimientos_stock` e `ingresos_mercaderia`; el ledger no tiene política de DELETE | `001:136-158`; test `security.migracion.test.js` | CORREGIDO (falta correr la 001 en Supabase) | Supabase |
| — | K-5 Trigger de inmutabilidad (cantidad, producto y tipo) + CHECK de cantidad y tipo en el ledger | `001:65-66,106-114` | CORREGIDO | Supabase |
| — | K-6 Stock y Configuración bloqueados para no-admin (UI) | `Stock.js:240-249`, `Configuracion.js:181-200`, `App.js:187`; test `security.roles.test.js` | CORREGIDO (solo UI, ver S-03) | código |
| — | K-7 Sync del ledger idempotente: upsert por UUID y `movimientosParaPedido` emite solo la diferencia, así que los reintentos no duplican | `stockService.js:76`, `stock.js:63-86` | CORREGIDO | código |

Sin hallazgo: XSS (no hay `dangerouslySetInnerHTML`, `innerHTML`, `eval` ni `javascript:`; los PDFs se abren como Blob). Secretos: el gate `secret-scan` pasa, `.env` está en `.gitignore` y no está versionado, y en el build actual no se encontró ningún JWT. Ojo: un build real con `.env` **siempre** embebe la anon key, por diseño. Por eso la anon key no puede ser la barrera de seguridad.

## Detalle

### S-01 — Crítico — Sin autenticación en el servidor (anon key = acceso total)
- **Evidencia:** la app no llama nunca a `supabase.auth.*`. Todas las lecturas y escrituras (`select('*')` de productos, clientes y vendedores; `insert/update` de pedidos; `delete` de deudas, faltantes, productos y proveedores) se hacen con la anon key. Si la app puede hacerlo, cualquiera puede hacerlo. El repo no tiene las políticas de las tablas legacy, así que no se pudo verificar si tienen RLS. Lo que sí se sabe es que, si la tienen, dejan pasar a anon.
- **Impacto:** exfiltración de toda la cartera de clientes, manipulación de precios, deudas y pedidos, y borrado de deudas y faltantes. Un competidor o un ex empleado lo puede hacer desde cualquier lado.
- **Remediación:** `supabase/migrations/002_seguridad_recomendada.sql` paso 3 (revocar DELETE/TRUNCATE en las tablas críticas, sin cambios de cliente) y paso 5 (Supabase Auth o Edge Function que emita un JWT con `permiso`, con políticas por rol y después `revoke all ... from anon`).

### S-02 — Crítico — PIN en texto plano y verificado en el cliente
- **Evidencia:** `GET /rest/v1/vendedores?select=nombre,permiso,pin` devuelve los PIN (reproducido en Postgres 16 con los grants por defecto de Supabase). `SelectorVendedor.js:103` compara `pinClean !== expected` en el navegador.
- **Remediación:** 002 paso 1 (columna `pin_hash` con bcrypt, RPC `verificar_pin` con bloqueo de 15 minutos después de 5 fallos y RPC `admin_guardar_vendedor`) y paso 2 (ocultar `pin`/`pin_hash` con privilegios por columna). Cambios de cliente (probado contra Postgres local):
  ```js
  // src/sync/syncService.js (downloadMaestros y downloadVendedores)
  supabase.from('vendedores').select('id,nombre,zona,permiso,tiene_pin')
  // ...y en el mapeo: tienePin: !!r.tiene_pin  (dejar de copiar r.pin)

  // src/components/SelectorVendedor.js
  const trySelect = (v) => { if (!v?.tienePin && !v?.pin) { seleccionarVendedor(v); return; } ... };
  const confirmarPin = async () => {
    const { data, error } = await supabase.rpc('verificar_pin', {
      p_vendedor_id: String(pinVendedor.remoteId ?? pinVendedor.id), p_pin: String(pin || '').trim(),
    });
    if (error || data !== true) { setPinError(error?.message?.includes('Demasiados') ? error.message : 'PIN incorrecto'); return; }
    seleccionarVendedor(pinVendedor); ...
  };
  ```
  Offline no hay forma segura de validar un PIN de 4 dígitos: cualquier hash local se rompe por fuerza bruta. Lo recomendable es permitir reentrar solo al último vendedor ya validado en ese dispositivo.
  Nota: el bloqueo es por vendedor, así que alguien podría bloquear al admin a propósito durante 15 minutos (DoS). Es un costo aceptable frente a la fuerza bruta.

### S-03 — Alto — Rol forjable desde localStorage
- **Evidencia:** `useAppContext.js:218-221` restaura `{...v, permiso}` tal cual está guardado. El efecto de `:321` solo pisa el permiso si encuentra el id. Con `localStorage.setItem('vendedorActual','{"id":999999,"nombre":"x","permiso":1}')` se obtiene la UI de admin (Facturación, Deudas, Stock, Configuración). Con el id real del admin se entra como admin sin pedir PIN.
- **Remediación en código (mitiga a usuarios no técnicos; el arreglo real es S-01 paso 5):**
  ```js
  // src/hooks/useAppContext.js — en init(), después de recargar()
  const saved = localStorage.getItem('vendedorActual');
  if (saved) {
    let id = null;
    try { id = JSON.parse(saved)?.id ?? null; } catch { /* corrupto */ }
    const v = (await getVendedores()).find(x => x.id === id);
    const validado = sessionStorage.getItem('pinValidado') === String(id);
    if (v && (!(v.pin || v.tienePin) || validado)) setVendedorActual({ ...v, permiso: Number(v.permiso || 2) });
    else localStorage.removeItem('vendedorActual');
  }
  // en seleccionarVendedor(vv): guardar solo el id
  localStorage.setItem('vendedorActual', JSON.stringify({ id: vv.id }));
  // y en SelectorVendedor.confirmarPin, cuando el PIN es correcto:
  sessionStorage.setItem('pinValidado', String(pinVendedor.id));
  ```
  Con esto, cerrar la PWA vuelve a pedir el PIN de los vendedores que tienen PIN.

### S-04 — Alto — Escalada por alta o edición de vendedores con anon
- **Evidencia (Postgres local con la 001):** `insert into vendedores (nombre, permiso) values ('Atacante', 1)` → permiso 1. `update vendedores set pin='0000' where nombre='Admin'` → OK. Con la 002 aplicada: el permiso queda forzado a 2 y el UPDATE de PIN o permiso da error.
- **Remediación:** 002 paso 1 (triggers `vendedor_esc_sin_escalada` y `vendedor_hashear_pin`). En el cliente, el alta de admin o armador pasa a `supabase.rpc('admin_guardar_vendedor', {...})`, pidiendo el PIN del admin. Hay que evaluar si el botón "+ Agregar vendedor" del selector tiene que existir (hoy cualquiera crea un vendedor sin autenticarse).

### S-05 — Alto — Integridad del ledger (`movimientos_stock`)
- **Evidencia (Postgres local con la 001):** `update movimientos_stock set ref='pedido:otro' where id='m-v1'` → OK. A partir de ahí, `movimientosParaPedido` del pedido 10 no ve su venta y emite otra: **doble descuento**. También se pudo cambiar `usuario`, insertar `tipo='ingreso', cantidad=999999` sin cabecera e insertar una `venta` con cantidad positiva.
- **Remediación:** 002 paso 4, probado: inmutabilidad total salvo `ref` `pedido-local:* → pedido:*`, CHECK de signo por tipo y de formato de `ref` (NOT VALID, no toca filas viejas), cabecera obligatoria para los ingresos, y `created_at` + `origen_ip` puestos por el servidor. Es compatible con el upsert actual del cliente (el reintento idempotente y el re-key legítimo pasan).

### S-06 — Alto — jspdf 2.5.2 / jspdf-autotable 3.8.4
- **Compatibilidad verificada** (tarballs `jspdf@4.2.1` y `jspdf-autotable@5.0.8` descargados aparte, sin instalarlos en el proyecto):
  - jsPDF 4: misma API (`new jsPDF()`, `setFont`, `setFontSize`, `text`, `output('blob')`, `save`, `internal.pageSize.getHeight`). El cambio que rompe compatibilidad es que en Node se bloquea el acceso al FS (`allowFsRead`), y eso no aplica al navegador. `dompurify` pasa a ^3.3.1, como dependencia opcional.
  - autotable 5: `peerDependencies: jspdf ^2 || ^3 || ^4`, y `doc.lastAutoTable.finalY` sigue existiendo. **Lo que cambia:** importar el módulo por side effect ya no parchea `jsPDF` (en 3.8 hacía `require("jspdf")` internamente; en 5.x solo parchea `window.jsPDF`). Por eso `doc.autoTable(...)` quedaría `undefined`.
- **Remediación (4 lugares en `src/utils/pdfGen.js`: líneas 12-13, 67-68, 151-152 y 219-220):**
  ```js
  const { jsPDF } = await import('jspdf');
  const { applyPlugin } = await import('jspdf-autotable');
  applyPlugin(jsPDF);            // reemplaza: await import('jspdf-autotable');
  ```
  ```bash
  npm i jspdf@^4.2.1 jspdf-autotable@^5.0.8
  ```
  Después, generar una boleta y una lista de armado a mano y correr `npx react-scripts build`.

### S-07 — Alto — xlsx 0.18.5
- npm ya no publica versiones corregidas. SheetJS distribuye las versiones corregidas en su CDN:
  ```json
  "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
  ```
  La API que se usa (`XLSX.read(buf,{type:'array'})` y `utils.sheet_to_json(ws,{header:1,raw:false,defval:''})`) no cambia. Desde este entorno no se pudo llegar a cdn.sheetjs.com (proxy 403): hay que verificar en https://cdn.sheetjs.com cuál es la última versión. Mitigación adicional: rechazar archivos de más de 5 MB antes de `XLSX.read` (`if (file.size > 5e6) throw new Error('Archivo demasiado grande')`).

### S-08 — Medio — Sourcemaps publicados
- `package.json`: `"build": "GENERATE_SOURCEMAP=false react-scripts build"`, o `GENERATE_SOURCEMAP=false` en `.env.production`. Si se necesitan para depurar, subirlos a un servicio privado y no al hosting.

### S-09 — Medio — Headers
Agregar al principio de `public/_headers`:
```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://www.googleapis.com; worker-src 'self' blob:; frame-src blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
```
(El build no tiene scripts inline, así que `script-src 'self'` funciona. Antes de activarlo, probar `Content-Security-Policy-Report-Only` en un deploy de preview.)

### S-10 — Medio — proveedores `for all`
002 paso 4 separa la política por comando. Mientras `Configuracion.js:344` siga borrando físicamente, se mantiene el DELETE (la FK `on delete restrict` protege a los proveedores con ingresos). Destino final: borrado lógico y `drop policy proveedores_delete`.

### S-11 — Medio — Colisión de `pedido-local:<id>` entre dispositivos
`src/services/stockService.js`, en `syncStock`: no subir movimientos cuyo `ref` todavía es local (quedan pendientes hasta el re-key de `markPedidoSynced`):
```js
movimientos: await pushPendientes(
  movs.filter(m => !String(m.ref || '').startsWith('pedido-local:')),
  'movimientos_stock', movimientoToRemote, clearMovimientosPendingSync),
```
Además, en `movimientosParaPedido` / `aplicarStockPedido`, si el pedido ya tiene `remoteId`, considerar solo los movimientos `pedido-local:` con `pendingSync` de este dispositivo.

### S-12 — Medio — Valores que hacen fallar el sync en cada intento
- `src/domain/stock.js` `movimientoAjuste`: `if (nuevo === null || nuevo < 0 || nuevo > 1_000_000) throw ...` y además `if (Math.abs(delta) > 1_000_000) throw ...`.
- `efectoDeseado`: ignorar o limitar `cant > 1_000_000`, y validar el máximo en el ítem del pedido (`avisosItemPedido`).
- `src/domain/productos.js`: `costo/precio/precioVenta2 <= 999_999_999_999.99`, y `bultoX/minimoVenta <= 1_000_000`.
- `stockService.pushPendientes`: si el lote falla con un error de CHECK (código `23514`), reintentar fila por fila y marcar las filas rechazadas (`syncError`) en vez de cortar todo el sync.

### S-13 — Medio — Importación sin dominio
En `Configuracion.js:96-101`, pasar cada fila por `validarProducto` (o al menos usar `codigo = csvSafe(texto(..., 40))`, `unidad = texto(..., 20)` y `precio = toNum(precioRaw)`, que ya maneja bien `1.234,50`), y descartar las filas con `precio === null || precio < 0`.

### S-14..S-19
- S-14: depende de S-01, paso 5.
- S-15: `npm update ws`, o `"overrides": {"ws": "^8.21.0"}`.
- S-16: `npm i fflate@^0.8.3`.
- S-17: 002 paso 4.
- S-18: dejar los `console.log` de pasos detrás de `if (process.env.NODE_ENV !== 'production')` y loguear `e?.message` en vez del objeto.
- S-19: registrar el ajuste como "conteo" (`tipo:'ajuste'` con `stockContado`) y resolver el conflicto en el servidor, o bien bloquear ajustes offline.

## Corregido en esta corrida

Controles ya implementados en el código actual, ahora fijados con tests (`CI=true npx react-scripts test --watchAll=false --testPathPattern=security` → 4 suites, todo en verde):

| AC | Test | Qué fija |
|---|---|---|
| AC-SEC-1 | `src/lib/__tests__/security.supabase.test.js` | `supabase.js` no imprime la key ni la URL (se mockean la consola y `createClient`) |
| AC-SEC-2 | `src/domain/__tests__/security.validacion.test.js` | Validadores rechazan NaN, Infinity, `1e309`, negativos y textos enormes; el ledger ignora cantidades inválidas; los reintentos no duplican |
| AC-SEC-3 | ídem | `csvSafe` con `= + - @ \t \r`, sin tocar los números; la importación lo aplica |
| AC-SEC-4 | `src/pages/__tests__/security.roles.test.js` | Stock y Configuración niegan el acceso a vendedor, armador, permisos raros y sesiones sin vendedor, y no muestran datos ni PIN |
| AC-SEC-5 | `src/__tests__/security.migracion.test.js` | Toda `create table` de toda migración tiene RLS; el ledger y los ingresos no tienen política DELETE/ALL ni GRANT DELETE; trigger de inmutabilidad; CHECKs; vista `security_invoker` |
| AC-SEC-6 | ídem | Este reporte existe, tiene la tabla de severidades y las secciones, y no filtra JWT |

Además se agregó **`supabase/migrations/002_seguridad_recomendada.sql` (borrador, NO aplicado)**. Se probó en Postgres 16 local con un esquema que imita los grants de Supabase: aplica sin errores, es idempotente y bloquea los ataques de S-02/S-04/S-05/S-10 sin romper el upsert ni el re-key actuales del cliente.

## Requiere acción del dueño

1. **Supabase (hoy):** correr `001_altas_y_stock.sql` si todavía no se corrió. Después correr la 002 **paso 1, paso 3 y paso 4**: no requieren cambios en la app.
2. **Supabase (después de publicar el cliente nuevo):** 002 **paso 2** (ocultar PIN) y quitar el DELETE de productos, proveedores, deudas y faltantes cuando se use borrado lógico.
3. **Decisión de arquitectura:** adoptar Supabase Auth o una Edge Function de login (002 paso 5). Sin eso, S-01, S-03 y S-14 no se pueden cerrar.
4. **Rotación:** si la anon key estuvo en builds públicos con los PIN expuestos, después del paso 2 **cambiar todos los PIN**. La anon key en sí es pública por diseño: rotarla no aporta mientras no exista el paso 5.
5. **Hosting:** aplicar `_headers` (S-09) y deshabilitar sourcemaps (S-08). Borrar los `.map` ya publicados.
6. **Baseline de npm-audit:** `jspdf` y `ws` ya están corregidas. Sobre `xlsx`, ver la recomendación de la Iteración 2.
7. **(iter 2) Instalar xlsx desde cdn.sheetjs.com** (S-07), porque el proxy de este entorno bloquea ese host: `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (o la última versión publicada ahí).
8. **(iter 2) Redeploy:** publicar un build nuevo (ya sale sin `.map`) y **borrar del hosting los `.map` viejos**; la carpeta local `build/` es de las 18:57 y todavía tiene los 7 `.map`. Probar la CSP Report-Only en preview y después cambiar `Content-Security-Policy-Report-Only` por `Content-Security-Policy`.

## Iteración 2

Verificación del commit `082c552` (implementador, iteración 2). Leí el diff, corrí los gates, `npm audit --omit=dev` y un build de producción en un directorio temporal (`BUILD_PATH`, sin tocar `build/`).

| ID | Fix aplicado | Verificación | Estado |
|---|---|---|---|
| S-03 | `useAppContext.js` init: del JSON guardado solo se usa `id`/`remoteId`; el vendedor y su `permiso` salen de `getVendedores()`; si el id no existe, se borra `localStorage` | `src/hooks/__tests__/security.sesion.test.js`: permiso forjado ignorado, id inexistente sin sesión, JSON corrupto | **MITIGADO** |
| S-06 | jspdf 4.2.1, jspdf-autotable 5.0.8 y `applyPlugin(jsPDF)` en los 4 builders de `pdfGen.js` | `npm ls`: jspdf@4.2.1, autotable@5.0.8, dompurify@3.4.16; `npm audit` sin hallazgos en ellos; smoke test `src/utils/__tests__/pdfGen.smoke.test.js` (del implementador) | **CORREGIDO** |
| S-07 | Archivos de más de 5 MB rechazados (`MAX_IMPORT_BYTES`, `Configuracion.js:172,396`); importación solo para admin | `npm audit`: xlsx sigue **high** sin fix en npm | **MITIGADO** (falta la acción del dueño) |
| S-08 | `.env.production` con `GENERATE_SOURCEMAP=false` y `INLINE_RUNTIME_CHUNK=false` (sin claves) | El build temporal salió con 0 `.map`, 0 `sourceMappingURL` y 0 scripts inline en `index.html`; test `src/__tests__/security.build.test.js` | **CORREGIDO** en código (falta el redeploy) |
| S-09 | `public/_headers` `/*`: nosniff, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy, HSTS y CSP en **Report-Only** (`script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`) | test `security.build.test.js` (S-09) | **MITIGADO** (falta pasar la CSP a enforced) |
| S-11 | `syncStock` retiene los movimientos con `ref` `pedido-local:*` (`esRefLocal`) | test `src/services/__tests__/security.stockSync.test.js` | **CORREGIDO** |
| S-12 | `MAX_CANTIDAD = 1_000_000` (igual al CHECK), `MAX_IMPORTE = 999_999_999_999` (numeric(14,2)), `bultoX`/`minimoVenta`/`stock` ≤ 1e6, `|delta|` de ajuste ≤ 1e6; `pushPendientes` reintenta fila por fila ante 23505/23514/23503/22003/22P02 y deja pendiente la fila mala | test `security.stockSync.test.js`: la fila con −2.000.000 no bloquea a las demás; los topes coinciden con el SQL | **CORREGIDO** |
| S-13 | Importación: `precio = toNum(...)` (≥ 0), `codigo`/`unidad` con `csvSafe(texto(...))` | test `security.validacion.test.js` (AC-SEC-3 S-13) | **CORREGIDO** (residual en S-21) |
| S-15 | ws 8.22.0 | `npm ls ws` | **CORREGIDO** |
| S-16 | fflate 0.8.3 | `npm ls fflate` | **CORREGIDO** |

**Gates (iter 2):** `secret-scan` PASS · `security-rules` PASS · `npm-audit` **PASS**. Runtime: 0 críticas, única alta `xlsx`. Las 3 críticas y 73 altas que reporta `npm audit` son de tooling de build (react-scripts) y no se publican.

**Lo que sigue abierto en código:**
1. **S-03 residual (Medio):** con `{"id": <id del admin>}` en `localStorage` se entra como admin **sin volver a pedir el PIN**. Además, `seleccionarVendedor` y el efecto de sincronización (`useAppContext.js:311,334`) siguen guardando el objeto completo, PIN incluido, en `localStorage`. Remediación: guardar solo `{ id }` y, si el vendedor tiene PIN, exigir `sessionStorage.pinValidado === String(id)`, que se setea en `SelectorVendedor.confirmarPin` (código en el detalle de S-03). Hay un test `test.skip` en `security.sesion.test.js` para habilitar cuando esté hecho.
2. **S-20 (Bajo):** `pedidoRepository.js:173-175` `usuarioActual()` lee el nombre de `localStorage`, así que un vendedor puede firmar movimientos como "Jorge" (admin). Remediación: pasar `vendedorActual.nombre` desde el contexto (como ya hace `Configuracion.js:225`) o leer el vendedor por id desde IndexedDB.
3. **S-21 (Bajo):** en `Configuracion.js`, la importación no limita el precio (`precio > MAX_IMPORTE` debería contar como fila con error), y `syncProductos` (`syncService.js:182`) lanza ante el primer error del lote: un precio fuera de rango frena todo el sync de productos. Remediación: aplicar el tope en la importación y reutilizar la estrategia fila por fila de `pushPendientes` (`esErrorDeDato`).

**Recomendación sobre `harness/gates/audit-baseline.json`:** **sí** corresponde agregar `xlsx` en `"high"`, con esta justificación:
- npm no publica versiones corregidas y la corregida (0.20.x) solo está en cdn.sheetjs.com, que el proxy de este entorno bloquea.
- El único uso es `XLSX.read` en la importación de Configuración: solo admin, con un archivo que elige el admin, con tope de 5 MB, y no hay exportación.
- El gate hoy ya pasa (las altas nuevas solo dan aviso). La entrada sirve para dejar documentado que el riesgo es aceptado y no ignorado.

Condición: que la entrada lleve fecha de revisión y se saque apenas el dueño instale el tarball de SheetJS (acción 7). No agregar nada más al baseline. No edité el archivo.

**Tests de seguridad (iter 2):** `CI=true npx react-scripts test --watchAll=false --testPathPattern=security` → 7 suites, 88 tests en verde y 1 skip (el S-03 residual, documentado). Nuevos: `src/hooks/__tests__/security.sesion.test.js` (S-03), `src/__tests__/security.build.test.js` (S-08, S-09), `src/services/__tests__/security.stockSync.test.js` (S-11, S-12) y un caso S-13 en `security.validacion.test.js`.

## Iteración 3

Verificación del commit `5ead627`. Leí el diff, corrí los tests de seguridad y los gates.

| ID | Fix | Verificación | Estado final |
|---|---|---|---|
| S-03 residual | `src/services/sesion.js`: `localStorage` guarda solo `{id, remoteId, nombre}` (`datosPersistibles`); al iniciar, un vendedor con PIN solo se restaura si `sessionStorage.sesionVendedorId` coincide (lo marca `seleccionarVendedor` después de que el selector valida el PIN); al cerrar sesión se limpian la sesión en memoria y `sessionStorage` | `security.sesion.test.js`: el test en skip quedó reactivado ("exige PIN de nuevo"), más restauración con PIN ya validado, vendedor sin PIN, `localStorage` sin `pin`/`permiso` | **MITIGADO** (máximo posible en el cliente) |
| S-20 | `pedidoRepository.usuarioActual()` → `getNombreUsuarioSesion()` (sesión en memoria, resuelta contra IndexedDB) | `security.sesion.test.js` (S-20): con `localStorage` forjado como "Admin", la firma es "Carlos"; test estático en `security.validacion.test.js` | **CORREGIDO** |
| S-21 | La importación descarta las filas con `precio > MAX_IMPORTE` | `security.validacion.test.js` (S-21) | **CORREGIDO** |
| S-07 baseline | `harness/gates/audit-baseline.json` `high: ["xlsx"]` con `_justificacion` y revisión 2026-11-07 | Coincide con la recomendación de la iteración 2 | Riesgo aceptado temporalmente; queda la acción del dueño |

**Gates:** `secret-scan` PASS · `security-rules` PASS · `npm-audit` PASS.
**Tests:** `CI=true npx react-scripts test --watchAll=false --testPathPattern=security` → 7 suites, **95 tests en verde, 0 skip**.

**Límite de S-03 en el cliente (no se puede cerrar en código):** quien tenga la consola del navegador puede escribir `sessionStorage.sesionVendedorId` o editar IndexedDB y ver la UI de admin. Tampoco hace falta la UI: con la anon key puede llamar a la API directamente (S-01). El control real de autorización solo puede estar en Supabase (002 paso 5). Cuando se aplique el paso 2 de la 002, `useAppContext` init y `SelectorVendedor` deben usar `tiene_pin` en lugar de `pin` (hoy usan `found.pin` / `v.pin`). Eso ya está detallado en la remediación de S-02.

### Estado final de la corrida

- **Abierto en código:** nada que se pueda resolver solo en el cliente. S-17, S-18 y S-19 son bajos: S-17 se resuelve en Supabase con el paso 4; S-18 (logs verbosos) y S-19 (ajuste offline concurrente, de diseño) quedan como mejoras opcionales.
- **Corregido:** S-06, S-08 (código), S-11, S-12, S-13, S-15, S-16, S-20 y S-21, además de los controles K-1 a K-7.
- **Mitigado:** S-03, S-07 y S-09.
- **Depende del dueño:**
  1. Supabase: correr la 001; después los pasos 1, 3 y 4 de la 002; el paso 2 con el cliente adaptado a `verificar_pin`/`tiene_pin`; y el paso 5 (Auth). Eso cubre S-01, S-02, S-04, S-05, S-10, S-14 y S-17.
  2. Instalar xlsx desde cdn.sheetjs.com y sacarlo del baseline (S-07).
  3. Redeploy sin `.map`, borrar los `.map` publicados y pasar la CSP a enforced (S-08, S-09).
  4. Cambiar todos los PIN después del paso 2.
