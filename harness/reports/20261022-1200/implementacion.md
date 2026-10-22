# Implementación — RUN 20261022-1200 (REQ-CON, REQ-DIR, REQ-FRB)

## Archivos
Dominio: `src/domain/direccion.js` (nuevo), `clientes.js`, `plantillas.js`, `precios.js` (`completarPreciosBulto`, `totalesBoleta`), `gruposFactura.js` (marca "x precio de bulto"), `tienda.js`, `pedidosWeb.js`.
Sync: `src/sync/syncService.js` (escalón sin `contacto` en `syncClientes`).
UI: `src/pages/Configuracion.js` (lista con `resumenCliente`, búsqueda por contacto), `NuevoPedido.js` (campo dirección), `Facturacion.js` (destachar), `src/tienda/Checkout.js`, `src/utils/pdfGen.js` (`totalesBoleta`).
SQL: `supabase/migrations/019_ajustes_contacto_direccion.sql`.
SPEC: aclaraciones S1/S2/S3/S5 al final.
`DB_VERSION` sin cambios (12): `contacto` es propiedad opcional de `clientes`.

## AC cubiertos
AC-CON-1/2, AC-DIR-1/2/3, AC-FRB-1/2/3.

## Tests
Nuevos: `domain/__tests__/{direccion,migracion019,frb.contacto}.test.js`, `tienda/__tests__/checkout.direccion.test.js`, `pages/__tests__/nuevoPedido.direccion.test.js`; ampliados `tienda.checkout`, `syncTolerante`, `pdfBoleta011`.
Actualizados por el cambio de 16 a 17 campos de cliente: clientes, ClienteForm, ConfiguracionAltas, plantillas (varios) y por la dirección obligatoria: tests de Nuevo pedido (drafts con `direccion`).

## Pasos manuales
1. Supabase SQL editor: correr `019_ajustes_contacto_direccion.sql` (después de la 010). Sin ella la app sigue andando: sube todo menos `contacto` y la tienda no valida dirección en el servidor.
2. Si se vuelve a correr la 010, volver a correr la 019 (redefine `tienda_crear_pedido`).

## Decisiones a confirmar con el dueño
- S3: en la boleta el precio de bulto ya no aparece como descuento (cambio visible).
- S1: la dirección de Nuevo pedido se guarda en el cliente (LWW si dos dispositivos la editan).

## Gates
`run-gates.mjs --fast` verde; `react-scripts build` OK; suite completa verde.

## Iteración 2
- `clienteExtraToRemote` (src/domain/clientes.js): `contacto` se recorta; vacío o solo espacios -> null (test QA en verde).
- npm-audit: dompurify (transitiva de jspdf) tenía advisories <=3.4.16. Se subió 3.4.16 -> 3.4.17 (parche) con `npm update dompurify`; solo cambia package-lock.json. package.json intacto. xlsx (high) sigue en baseline.
- Tests 222 suites verdes, build OK, gates --fast verdes.
