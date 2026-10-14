# QA — RUN 20261014-2036 — S-VTA-01

## Tests agregados (31)
| Archivo | Cubre |
|---|---|
| `src/pages/__tests__/ConfiguracionProductosPin.test.js` (13) | S01-3: aviso de pendientes, "Subir productos" con PIN (se vacia del campo), PIN incorrecto, sin PIN en DOM; S01-4 parcial; S01-5: modal PIN al borrar, confirmar, PIN incorrecto, cancelar, offline, sin 007; S01-6 no admin |
| `src/services/__tests__/syncProductos.qa.test.js` (14) | 007 ausente (42883/PGRST202) y presente; flag directo cerrado + cred; PIN bloqueado; red caida; >500 (lotes 500+1); id ajeno aceptado; edicion con extrasDirty durante subida; syncRechazo se limpia; id invalido; permiso 2/3 + `downloadMaestros` no pisa; PIN no queda en localStorage/sessionStorage/IndexedDB mock |
| `src/domain/__tests__/qa.productosRpc.marca.test.js` (4) | marca 60 vs 120 |

## Marca 60 vs 120
El dominio corta a 60 antes de guardar (`normalizarMarca` -> `normalizarRubro`, MAX_RUBRO=60) en formulario, CSV y plantilla.
Por la ruta normal nunca llega una marca > 60 a la RPC. `filaProductoRpc` no corta: un registro viejo/importado sin pasar por
el dominio con marca > 60 viaja entero, la constraint 006 lo rechaza y queda como `datos_invalidos` (con `syncRechazo`). Documentado en test.

## Resultado
Suite completa: 108 suites, 2003 passed, 1 skipped, 5 todo (antes 105 / 1972). Sin tests borrados ni salteados.

## Bugs
Ninguno nuevo. Observacion menor: el motivo `datos_invalidos` por marca > 60 se muestra solo como conteo ("rechazo N"), sin detalle por fila en la UI.
