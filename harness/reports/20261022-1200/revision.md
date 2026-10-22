# Revisión tech lead — RUN 20261022-1200 (REQ-CON, REQ-DIR, REQ-FRB)

VEREDICTO: APROBADO

Gates: todos en verde (3246 tests, 189/189 AC con test, build ok, sin secretos, cobertura dominio 99.85%).

## AC -> test -> resultado
| AC | Verificado en | Resultado |
|---|---|---|
| CON-1 | clientes.js (campo antes de telefono, resumenCliente, sync con escalón sin contacto), frb.contacto / migracion019 / syncTolerante | OK |
| CON-2 | qa.plantillas.import.page (Excel sin columna) | OK |
| DIR-1 | Checkout.js (submit deshabilitado + error en vivo), NuevoPedido.js (disabled + defensa en guardar), tests checkout.direccion / nuevoPedido.direccion | OK |
| DIR-2 | 019: direccion_exacta + tienda_crear_pedido; paridad SQL/JS por fixtures (migracion019.test) | OK (sin probar contra Supabase real) |
| DIR-3 | direccion.js + direccion.test + bordes QA | OK |
| FRB-1/2/3 | precios.js (completarPreciosBulto, totalesBoleta), pdfGen, pdfBoleta011.test (900/800 x16: 10u=9000, 16u=12800) | OK |

Revisión de código: retrocompatible (columna opcional, sync tolerante, clientes/pedidos viejos no se revalidan, sin cambio de schema IndexedDB). El bug menor de QA (contacto '   ') ya está resuelto en clienteExtraToRemote (trim).

## Cambios requeridos
Ninguno.

## Observaciones no bloqueantes
- Heurística: "1 de Mayo" pasa como dirección (límite aceptado, igual en SQL).
- S-019-01 (clientes.contacto legible por anon) es deuda heredada de `clientes`; endurecer aparte.

## Pasos manuales para el dueño
1. Hacer backup y correr `supabase/migrations/019_ajustes_contacto_direccion.sql` en el SQL editor (después de la 010). Hasta entonces la tienda no valida dirección en servidor y `contacto` no sube (el resto sí).
2. Si se re-corre la 010, volver a correr la 019.
3. Deploy del front después de la migración.
