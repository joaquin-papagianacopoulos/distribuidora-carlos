# Seguridad REQ-VTA - corrida 20261014-1621

Alcance: 006_unidad_venta.sql, upsertEscalonado (syncService), validacion de marca/ventaPor/bultoNombre/visibleTienda en dominio.

| Id | Sev. (CVSS aprox.) | Hallazgo | Evidencia | Remediacion |
|---|---|---|---|---|
| S-VTA-01 | Medio (5.3) | `visible_tienda`, `venta_por` y `precio` son escribibles por cualquier portador de la anon key (policies de productos con `to anon ... using(true)`; la 006 no agrega policies y hereda eso). Cuando REQ-TIE publique por RPC, un atacante puede ocultar/mostrar productos o cambiar precios via REST. Ya existia antes; la 006 amplia la superficie. | 006 (sin policies); 002 policies abiertas | Antes de REQ-TIE: restringir UPDATE/INSERT/DELETE de productos a `authenticated` o RPC admin con PIN (patron `admin_guardar_vendedor`). La RPC publica debe ser `security definer`, `where visible_tienda`, y devolver solo columnas necesarias (sin costo_final, descuentos, ganancia, proveedor). |
| S-VTA-02 | Bajo (3.1) | Constraints `not valid`: filas viejas o de otro cliente pueden tener `venta_por='bulto'` con `bulto_x<=1`. Mitigado: `ventaPorEfectivo` degrada a 'unidad' (test agregado). | 006:19-35 | Tras limpiar datos, `alter table ... validate constraint productos_venta_bulto_chk`. |
| S-VTA-03 | Bajo (3.1) | `marca` pasa por `texto()` en el formulario, no por `csvSafe`; solo la ruta de importacion neutraliza `= + - @`. Una marca `=...` cargada a mano se exportaria a CSV/XLSX tal cual (autoataque, requiere usuario con acceso a Configuracion). | productos.js `normalizarMarca`; plantillas.js:313 usa `textoSeguro` | Aplicar `csvSafe` al exportar celdas de texto (marca, categoria, nombre) en un unico punto. |
| S-VTA-04 | Bajo (2.5) | `upsertEscalonado` baja de escalon ante CUALQUIER "columna inexistente" y solo avisa por `console.warn`: sin la 006, `visible_tienda` no se comparte y puede divergir silenciosamente (un producto oculto localmente sigue visible para la tienda). No expone secretos (el warning solo nombra archivos de migracion). | syncService.js `upsertEscalonado` | Operativo: correr 006 en Supabase antes de REQ-TIE; TIE debe tratar `visible_tienda` ausente como NO visible (fail-closed). |
| S-VTA-05 | Info | `bultoNombre` invalido en plantilla se normaliza a "Bulto" sin error (no es riesgo de seguridad, solo UX). `ventaPor` invalido y `visibleTienda` invalido si dan error. | plantillas.js | - |

Sin hallazgos Criticos ni Altos. Sin XSS (no hay innerHTML; las etiquetas salen de lista cerrada). Sin SQL injection posible (valores via PostgREST + checks de lista). Sin secretos en el diff.

## Corregido en esta corrida
Nada (no se toca codigo de produccion). Tests: `src/domain/__tests__/security.unidadVenta.run1621.test.js` (9 tests: longitud/control de marca, payloads en ventaPor/bultoNombre/visibleTienda, bulto con bultoX 0/negativo/NaN/Infinity, degradacion de datos remotos manipulados, formula injection de marca en plantilla, SQL sin grants/policies/drops).

## Requiere accion del dueño
1. Correr 006 en el SQL Editor (idempotente, no destructiva).
2. Antes de REQ-TIE: cerrar escritura anonima de `productos` (S-VTA-01) y definir RPC publica con columnas minimas y fail-closed.
3. Opcional: `validate constraint` tras revisar datos (S-VTA-02).

## Riesgos a futuro (REQ-TIE, no implementado)
- La RPC no debe aceptar filtros libres (inyeccion via `format`/SQL dinamico) ni devolver `select *`.
- Rate limiting/scraping del catalogo publico: sin throttling en Supabase anon.
- Precio publico: debe ser el vigente en servidor, nunca el enviado por el cliente al armar pedidos.
