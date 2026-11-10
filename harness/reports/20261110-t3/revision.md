# Revision final RUN 20261110-t3 — REQ-ESC (tech lead)

VEREDICTO: CAMBIOS REQUERIDOS (menores, solo documentacion; el codigo se puede aprobar)

## Evidencia
- Suite: 272 suites, 3884 OK, 1 skipped (preexistente AC-SEC-4), 5 todo, 0 fallos. Gates (gates.json): unit, coverage, traceability, build, secret-scan, security-rules, npm-audit = PASS.
- Los 2 arreglos posteriores a seguridad estan: CHECK octet_length<=512 (026:52) y guarda Number.isFinite en BigInt (precios.js:69).

## (1) AC -> test -> resultado (todo PASS)
- AC-ESC-1: ProductoForm.escalas, productos.escalas, plantillas.escalas, qa.escalas.bordes. Columna publica + grant (026:59) + RPC con PIN (026:153).
- AC-ESC-2: precios.escalas (24 casos del fixture), grupoBulto.escalas, qa.escalas.bordes (borde N-1/N, redondeo, manual, grupo).
- AC-ESC-3: escalas.pantallas (Nuevo pedido), escalas.armadoFacturacion, tienda.escalas, migracion026.sql. Remito/PDF: etiqueta ASCII por dominio (pdfGen mockeado).
- AC-ESC-4: precios.escalas + qa.escalas.bordes (sin escalas = shape identico, invalidas ignoradas, REQ-PBU intacto).
Verificados a mano: borde 49u/50u (fixture 'borde-5-bultos-si' = 920) contra precios.js y 026:119; redondeo 815-8% = 750 (ceil) contra 026:141; sin escalas con bulto_x<=1 contra 026:118.

## (2) Migracion 026 (lectura linea a linea)
- Delimitadores: $mig$ (23/39, 46/57) , $fn$ (69/110, 115/122, 126/128, 134/143) y $$ (155/330, 341/379, 389/645) pareados. begin/commit presentes.
- Firmas identicas: admin_guardar_productos(text,text,jsonb) = 022; tienda_catalogo() = 010; tienda_crear_pedido(jsonb) = 024. Mismos revoke/grant.
- Helpers definidos (67-143) antes de usarse (228, 368, 566-592); revoke a anon/authenticated. Dependencias verificadas en el bloque 0 (admin_guardar_productos, grupo_bulto, tienda_cantidad_valida de 024, tienda_precio_aplicado de 010).
- Idempotente: add column if not exists, constraint con guarda por pg_constraint, create or replace. Sin drop ni delete; no revoca grants.
- Aritmetica SQL en numeric exacta; coincide con el BigInt de JS (ceil sobre centavos).

## (3) Cliente == servidor
Los 24 casos de escalasCasos.js y de 026_escalas_casos.sql son identicos (lo verifica migracion026.sql.test.js, en verde). La verificacion SQL es solo SELECT (0 filas = OK). NO se pudo ejecutar contra Postgres: queda como paso manual.

## (4) Tests viejos
Ninguno borrado ni saltado por esta tanda. Los 4 // ADAPTADO solo suman 'Escalas por bulto' (20->21 columnas). Observacion: qa.plantillas.bordes.test.js suma ademas 'Precio por unidad': 120 en una fila del caso Descuento 1 (probablemente de la Tanda 1/2 de precios, no de REQ-ESC); el dueño debe confirmarlo al revisar el diff.

## (5) Regla 8
escalas_bulto: grant select por columna (026:59), sumada a COLUMNAS_PRODUCTO_PUBLICAS (productos.js:184) con fallback si falta la migracion. No se expone costo/descuento/ganancia.

## (6) No regresion
REQ-PBU cubierto (precio bulto $800 x16 = 12800); tests de t0-t2 todos verdes; clientes viejos: clave ausente conserva escalas.

## Cambios requeridos
1. supabase/migrations/026_escalas_bulto.sql:2 — el encabezado dice solo "DESPUES de la 025". Agregar explicitamente: "Requiere 024 (tienda_cantidad_valida, y por ende 019/tienda_crear_pedido), 022 (grupo_bulto) y 010 (tienda_precio_aplicado)". El chequeo existe en 23-39 pero el encabezado no lo documenta. Cambio de comentario, sin impacto funcional.
2. (Opcional) 026:223-233 — array con 1-3 elementos todos invalidos se guarda como NULL en silencio (T3-02, solo UX; el cliente valida).

## Orden de aplicacion (migraciones sin aplicar)
Prerrequisito: 001-022 aplicadas (en particular 002 verificar_pin, 010, 019, 022).
1. 023_no_perder_datos.sql — requiere 002. Toca DELETE/pedidos.client_uuid/movimientos_stock. Independiente de 024-026.
2. 024_pedidos_edicion_vendedor.sql — "DESPUES de la 023"; copia tienda_crear_pedido de la 019 (+ tienda_cantidad_valida).
3. 025_remito_redondeo_medio_pago.sql — "DESPUES de la 024"; no redefine RPC de tienda ni productos (sin conflicto con 026).
4. 026_escalas_bulto.sql — DESPUES de la 025; DEPENDE de 024 (copia tienda_crear_pedido de la 024; si 024 faltara, aborta con mensaje) y 022. Aplicar siempre 024 antes que 026: invertir el orden pisaria las reglas REQ-MUL.
Todas idempotentes; hacer backup antes. Despues de la 026 correr supabase/verificacion/026_escalas_casos.sql (0 filas) y probar un pedido web con escala.
