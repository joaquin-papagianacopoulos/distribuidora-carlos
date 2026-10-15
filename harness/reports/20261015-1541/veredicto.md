# Veredicto - RUN 20261015-1541 (REQ-INA, REQ-CPR, REQ-STB)

VEREDICTO: APROBADO

## Base
- gates.json: todos PASS (2871 tests, cobertura dominio 99.85%, 165/165 AC, build ok, sin secretos).
- QA: sin bugs confirmados; obs. 1 (costo 0) corregida en vuelta 2. Seguridad: 0 Critico/Alto/Medio abiertos; 4-5 Bajos aceptados.

## Revision del diff
- Retrocompat sync de productos: `downloadMaestros` usa lista explicita `COLUMNAS_PRODUCTO_PUBLICAS` (syncService.js:1061-1089).
  Vendedores/armadores sin PIN siguen bajando productos (nombre, precio, stock_minimo, etc.). Si falta una columna
  (012 sin aplicar) se descarta y reintenta (`columnasSinFaltante`). Costos locales no se pisan con vacio.
- DB_VERSION 9->10: stores nuevos con `if (!contains)`, no se borra nada; tests migracionV5..V10 verdes.
- Offline: compras/pagos/pedidos se escriben local y suben despues; sin 012 hay aviso, no error. Stock sigue solo por movimientos.
- `ingresoToRemote` con whitelist: costos y A/B nunca salen por anon (D2). IDs nuevos con randomUUID.
- Stock.js dividido en pages/stock/*: sin codigo muerto evidente.

## AC verificados a mano
- AC-INA-4 / QA: `costoProductoDesdeIngreso` ignora 0 y respeta precio manual (compras.test.js) - OK.
- AC-CPR-5: anulacion exige motivo, no muta original, doble anulacion rechazada (cuentaProveedores.test.js + trigger SQL) - OK.
- AC-STB-1: `stockMinimo` vacio cae a minimoVenta; 0 explicito gana (stockBajo.test.js) - OK.

## Cambios requeridos
Ninguno bloqueante.
Recomendaciones no bloqueantes: (a) S-012-08, avisar en CLAUDE.md la regla de grant por columna en `productos`;
(b) S-012-05: atar `comprobante_path` al pago en una 014 futura; (c) QA obs. 2: claves numericas en `stockDeMapa`.

## Pasos manuales del dueño (ver manual.md)
1. Backup de Supabase.
2. Publicar la app nueva (deploy) ANTES de las migraciones.
3. SQL Editor: aplicar 012 (version actual, idempotente), luego 013. Nunca 013 antes de 012.
4. Si la 012 vieja ya corrio: `drop function public.admin_compras_bajar(text, text, timestamptz);`.
5. Probar con anon key: `productos?select=costo_final` da error; `select=id,nombre,precio` da 200; 4 tablas nuevas permission denied; bucket vacio.
6. En cada dispositivo admin: "Subir productos"/"Bajar de otros dispositivos" con PIN para traer costos.
