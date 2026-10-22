# Seguridad - RUN 20261022-1200 (REQ-CON, REQ-DIR, REQ-FRB)

Crítico: 0, Alto: 0, Medio: 1, Bajo: 2.

| Id | Severidad | Hallazgo | Evidencia | Estado |
|---|---|---|---|---|
| S-019-01 | Medio (CVSS ~5.3) | `clientes.contacto` queda legible/escribible por anon: la tabla tiene grants a nivel tabla (nunca hubo select por columnas) y la columna nueva los hereda. Es el riesgo previo de `clientes` (CUIT, tel, domicilio; ver 002:367) ampliado con otro dato personal. No es regresión nueva. | 019:14; 002:224 | ABIERTO (heredado) |
| S-019-02 | Bajo | `direccion_exacta` es ejecutable por anon vía `/rpc`. Es pura, immutable, no toca tablas ni secretos. Sin ReDoS: las regex de Postgres no hacen backtracking exponencial y los patrones son lineales. Un texto enorme solo consume CPU lineal, igual que cualquier RPC. | 019:16-25 | ABIERTO (aceptable) |
| S-019-03 | Bajo | La regla de dirección es débil por diseño ("Ab 12" pasa). Es calidad de dato, no un control de seguridad. El JS usa `\p{L}\d` y el SQL `[:alnum:]`: paridad casi total, pero con Unicode raro puede diferir (el SQL manda). | direccion.js:19; 019:21 | ABIERTO |

## Verificado sin hallazgo
- `tienda_crear_pedido` (019) vs 010: diff de todo el cuerpo y de los grants. La ÚNICA diferencia es la línea `not public.direccion_exacta(...)` (019:110). Se conservan honeypot, idempotencia (chequeo previo + captura de `unique_violation`), topes, límite por IP con hash y sal, advisory lock, `security definer` con `search_path` fijo, recálculo de precios en servidor, `revoke all ... from public` y `grant` a anon/authenticated.
- Idempotencia: la dirección se valida DESPUÉS de devolver un pedido repetido, así que un reintento con el mismo id sigue devolviendo el pedido original. La migración es re-ejecutable (`add column if not exists`, `create or replace`). Está en transacción.
- No se expone nada nuevo: la respuesta no incluye contacto ni IP. El contacto sigue en `pedidos_web_contacto` (tabla aparte, la 010 no la cambió). El motivo de rechazo es el genérico `invalido` (no revela qué regla falló).
- Orden: la validación corre antes de consumir el límite por hora, así que los rechazos no gastan cupo (correcto) pero tampoco se registran. Un atacante puede probar sin costo, pero eso ya era así con las demás validaciones.
- `syncClientes`: el escalón sin `contacto` solo quita la propiedad al reintentar. No loguea datos, solo un `console.warn` con texto fijo. El filtro por mensaje de error (`nombraColumnaContacto`) no es explotable por el cliente.

## Corregido en esta corrida
CORREGIDO: ninguno (no hubo cambios en `src/**` de producción por parte de seguridad).

## Requiere acción del dueño
1. Correr la 019 en Supabase (después de la 010). Hasta entonces la tienda no valida la dirección en el servidor: la validación del cliente sola es eludible llamando a `/rpc` directo.
2. S-019-01 (opcional, endurecimiento): migrar `clientes` a select por columnas o a RPC con PIN, como se hizo con `productos` (013). Hoy es la deuda del paso 5 de la 002 (autenticación real).
3. Si se re-corre la 010, volver a correr la 019, o `tienda_crear_pedido` pierde la regla de dirección (ya anotado en implementacion.md).
