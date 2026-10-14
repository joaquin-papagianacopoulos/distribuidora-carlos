# Implementacion — RUN 20261014-2036 — S-VTA-01

Cierra la escritura anonima de `public.productos` (migracion 007, NO aplicada: solo el archivo).

## Archivos
- Nuevos: `supabase/migrations/007_productos_escritura_admin.sql`, `src/domain/productosRpc.js`,
  `src/services/productosAdminService.js`.
- Modificados: `src/sync/tolerancia.js` (`esFuncionInexistente`, `esEscrituraDenegada`),
  `src/db/index.js` (`clearProductosPendingSyncSiIgual`, `DB_VERSION` sin cambios),
  `src/sync/syncService.js` (`syncProductos({ cred })`, flag de sesion, mensaje en `uploadSeedToSupabase`),
  `src/services/comisionesService.js` (`confirmarCierre` pasa `cred`), `src/hooks/useAppContext.js`
  (`syncNote` si `requierePinAdmin`), `src/pages/Configuracion.js` (aviso + PIN + "Subir productos",
  modal PIN para borrar con 007, marca `syncRechazo`).
- Tests nuevos: `migracion007.productos.test.js`, `productosRpc.test.js`, `syncProductos.s01.test.js`,
  `productosAdminService.test.js`; ampliado `comisionesService.test.js` (S01-3).

## Decisiones del dueño aplicadas
- El PIN nunca se guarda (solo parametro por llamada; estado de React se vacia al enviar).
- Permiso 2/3: sin `cred` el sync intenta directo; con 007 queda pendiente y `syncNote` avisa. Nunca se
  descarta, `downloadMaestros` no lo pisa, y nunca se llama a las RPC admin (S01-6).
- Baja fisica (como hoy); sin "descartar cambios locales".

## AC cubiertos
S01-1, S01-2, S01-3, S01-4, S01-5, S01-6, S01-7, AC-SEC-2/4, AC-VTA-5 (tolerancia a 007 faltante).

## Desvios
- No se agregaron tests de UI en `Configuracion` (plan: Testing Library); la logica esta cubierta en los
  tests de servicio. Los tests existentes de Configuracion siguen verdes (sonda falla => flujo viejo).
- El rechazo por columna `marca` > 60 lo hace la constraint 006 (la RPC acepta 120); cae en `datos_invalidos`.

## Resultado
Suite completa: 105 suites, 1972 passed, 1 skipped, 5 todo. `run-gates.mjs --fast`: todos en verde.

## Vuelta 2 (build)
Configuracion.js:331: `// eslint-disable-line react-hooks/exhaustive-deps` pasa a `// eslint-disable-line` (como SelectorVendedor.js), porque el plugin react-hooks no esta activo en el build. Sin cambio de comportamiento. Build y tests en verde (108 suites, 2003 tests).
