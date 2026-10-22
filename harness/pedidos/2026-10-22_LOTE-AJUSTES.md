# Pedido 2026-10-22 — Ajustes chicos (REQ-CON, REQ-DIR, REQ-FRB)

> Prompt para el pipeline del harness (`/mejorar-app`). Alcance: REQ-CON, REQ-DIR, REQ-FRB.
> Primer paso del arquitecto: verificar en el código qué existe ya (campo de contacto del cliente, regla `precioAplicado` de REQ-PBU, dirección en la tienda) y anotar supuestos en el plan.

1. En la lista/datos de clientes, mostrar el **nombre de contacto antes del celular**.
2. En pedido o carrito (tienda pública y pedido interno): si no se especificó una **dirección exacta**, no se puede enviar.
3. Al **fraccionar fragancias** (vender por unidades sueltas) y llegar al bulto, la factura/boleta/PDF debe pasar a **precio de bulto** (REQ-PBU) en vez del precio por unidad.
