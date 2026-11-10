# Seguridad tanda 3 (REQ-ESC) - RUN 20261110-t3

Alcance: supabase/migrations/026_escalas_bulto.sql, supabase/verificacion/026_escalas_casos.sql, y su contrapartida JS (precios.js, productos.js, syncService.js). Sin Postgres disponible: lectura manual como parser.

## Resumen
Critico: 0, Alto: 0, Medio: 1, Bajo: 4. No se escribio en src/ ni migraciones.
¿La 026 parsea? SI, certeza ~92% (no ejecutada; el 8% restante es semantica fina de plpgsql/SQL que solo un Postgres real confirma).

## Parseo (026 linea por linea)
- Delimitadores pareados: $mig$ x4 (23,39,46,57), $fn$ x8 (69/110, 115/122, 126/128, 134/143), $$ x6 (155/330, 341/379, 389/645). Ninguno anidado ni con $$ interno.
- Comillas, comas, parentesis y `begin/end` de cada bloque: balanceados. `commit` en 650 cierra el `begin` de 18.
- Orden: dependencias verificadas (l.23-39) -> columna/constraint/grant -> helpers (normalizar -> alcanzada -> pct -> precio_con_escala) -> RPC. Cada helper se define antes de usarse (las SQL-function resuelven en creacion: alcanzada llama normalizar, ya creada; pct llama alcanzada; con_escala llama pct).
- Firmas identicas a las previas: admin_guardar_productos(text,text,jsonb), tienda_catalogo(), tienda_crear_pedido(jsonb). No se crean sobrecargas. returns/language/security definer/set search_path identicos (catalogo conserva `set statement_timeout='3s'`).
- Grants: helpers nuevos `revoke all ... from public, anon, authenticated` (145-148); RPC: `revoke from public` + `grant execute to anon, authenticated`, igual que 022/010/024. `grant select (escalas_bulto) on productos to anon, authenticated` (59) por columna.
- Comparacion por diff contra las versiones previas: 
  - admin_guardar_productos vs 022: SOLO agrega v_escalas/v_esc_mal, bloque de validacion, `or v_esc_mal`, columna en insert, y la rama on conflict con `case when v_fila ? 'escalas_bulto'`. PIN admin, id, tope 500, NaN/Infinity, rangos, costos conservados: intactos.
  - tienda_catalogo vs 010: SOLO la clave 'escalasBulto'. 
  - tienda_crear_pedido vs 024: SOLO v_base/v_alc/v_escs, select de escalas_bulto, precio con escala, `precioPorBulto` sobre v_base y campos congelados. Idempotencia, honeypot, topes, direccion_exacta (REQ-DIR), rate limit, minimos y tienda_cantidad_valida (REQ-MUL), disponibilidad, precioVisto, token: intactos.
- Nota de parseo menor: `select ... into v_prod -- REQ-ESC` con comentario antes de `from` en la linea siguiente: valido.

## Hallazgos
| Id | Sev | Archivo:linea | Hallazgo |
|---|---|---|---|
| T3-01 | Medio | 026:48-54 | El CHECK solo limita a 3 elementos, no el tamano de cada elemento; la unica via de escritura es admin_guardar_productos (PIN admin) que guarda el resultado de normalizar (max 3 objetos {desde,pct}), asi que no es explotable hoy. Un UPDATE directo con service_role/SQL editor podria guardar objetos grandes y tienda_catalogo los normaliza (los descarta) pero la lectura REST de la columna los devolveria al anon. Correccion minima: `and pg_column_size(escalas_bulto) <= 512` en el check. |
| T3-02 | Bajo | 026:223-233 | Un array de 1-3 elementos todos invalidos se guarda como NULL en silencio (nullif a '[]'); el admin cree haber guardado escalas. Solo UX; el cliente ya valida (validarEscalasBulto). |
| T3-03 | Bajo | 026:141 vs precios.js:67 | Equivalencia de redondeo: SQL ceil(round(p,2)*100*(10000-bp)/1e6) exacto; JS BigInt (num+999999)/1e6 = ceil para no negativos. Coinciden. Diferencia: JS redondea a centavo con float (Math.round(x*100)) y SQL round(numeric,2); si un precio con >2 decimales como 1.005 llegara al JS, difiere 1 centavo. El servidor es autoritativo y su base ya viene redondeada a 2 decimales (tienda_precio_aplicado); el cliente solo muestra y compara precioVisto (si difiere, cambia a 'cambio' y recarga, sin perdida). Negativos: JS clampa a 0; SQL no los alcanza (precio > 0 en el filtro). pct 100 inalcanzable (normalizar exige <100). |
| T3-04 | Bajo | 026:101 | normalizar compara `v_pct <> round(v_pct,2)` exacto; JS usa tolerancia 1e-7 (esDecimal2). Un pct tipo 8.00000001 lo acepta JS pero lo descarta SQL: el servidor manda y el JS manda solo valores ya normalizados (Math.round(p*100)/100), sin impacto. |
| T3-05 | Bajo | 024:183 (heredado) | tienda_cantidad_valida solo tiene `grant ... to anon` sin revoke from public; es inofensiva (pura, sin datos). Fuera de esta tanda; solo referencia. |

## Verificaciones de prioridad 2 (sin hallazgo)
- Servidor no confia en el cliente: tienda_crear_pedido solo lee del payload productoId, cantidad (regex ^[0-9]{1,7}$), modo y precioVisto (solo para detectar cambio, nunca para fijar precio). Precio, escala, pct y escalasBulto salen de public.productos. Un `escalasBulto`/`pct`/`precio` enviado dentro del item se ignora.
- Cantidad: unidades acumuladas por producto (renglones repetidos suman) antes de calcular escala: no se evade partiendo en renglones, ni se obtiene escala con modo 'bulto' (v_unid = cant*bulto_x, tope 1.000.000).
- escalas_bulto publico: es un dato de precio al publico, no costo. COLUMNAS_PRODUCTO_PUBLICAS (productos.js:177-185) agrega 'escalas_bulto' como la mas nueva (el fallback columnasSinLaMasNueva la descarta si falta el grant/migracion); no incluye costo_final, descuento1/2, ganancia ni precio_venta2.
- App vieja sin la clave: productoPreciosToRemote omite escalas_bulto si undefined, y el servidor usa `v_fila ? 'escalas_bulto'` => conserva. Una app que manda null explicito las borra (intencional).
- Forma jsonb hostil: no-array, objeto, string o >3 elementos => `datos_invalidos`; normalizar lee a lo sumo 10 elementos, exige jsonb_typeof number (rechaza "2" texto, true, null), desde entero 2..9999, pct (0,100) 2 decimales, estrictamente creciente, max 3. Numeros gigantes (1e400) se descartan por rango antes de `::integer`. Excepciones de cast quedan capturadas por el bloque exception.
- Orden de escalas en el pedido congeladas: se guardan normalizadas en v_item (max 3 objetos); sin crecimiento por payload.
- supabase/verificacion/026_escalas_casos.sql: solo `with ... select` (sin insert/update/delete/DDL); no escribe. Usa funciones revocadas a anon: corre en SQL Editor como postgres, OK. Compara base, final y escala; lista solo discrepancias.

## Corregido en esta corrida
CORREGIDO: ninguno (no se modifica codigo ni migraciones por instruccion).

## Requiere accion del dueno
1. Aplicar 025 y luego 026 en el SQL Editor con backup; correr la verificacion (0 filas esperado).
2. Opcional T3-01: agregar limite de tamano al CHECK.
3. Tras aplicar, probar un pedido web con escala y confirmar el centavo contra el JS.
