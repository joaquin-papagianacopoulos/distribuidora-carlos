# Coco Store BA

Tienda + panel de productos (sin dependencias, solo Node 18+).

    cd cocostore
    node server.js

- Tienda: http://localhost:3000
- Panel:  http://localhost:3000/admin  (clave inicial: coco2026)
- Cambiar la clave: `ADMIN_PASS=tuclave node server.js` (en PowerShell: `$env:ADMIN_PASS="tuclave"; node server.js`)
- Productos en `data/products.json`, fotos en `uploads/`. Hacé copia de esas dos carpetas.
- Para publicarla en internet necesita un hosting que corra Node con disco persistente (Render, Railway, un VPS).
