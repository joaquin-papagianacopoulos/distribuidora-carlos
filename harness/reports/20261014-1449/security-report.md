# Security report — RUN 20261014-1449 — REQ-COMR (comisiones por vendedor y por rubro)

Auditor: AppSec (punto 8 de "Tests y revisión" de REQ-COMR). Alcance: `supabase/migrations/005_comisiones_rubro.sql`, `src/domain/rubros.js`, `src/domain/comisiones.js` (modelo rubro), `src/services/comisionesRubroService.js`, `src/services/comisionesService.js`, `src/components/ComisionRubroGrid.js`, `src/components/SelectorRubro.js`, `src/pages/Configuracion.js`, `src/pages/Comisiones.js`, `src/domain/clientes.js` y `src/sync/syncService.js` (upsert de clientes), plantillas e importación (`src/domain/plantillas.js`).

No se modificó código de producción. La 005 **no se ejecutó contra un Postgres real**: la revisión del SQL es estática.

## Resumen ejecutivo

| Severidad | Cant. | Hallazgos nuevos de REQ-COMR |
|---|---|---|
| Crítico | 0 | — |
| Alto | 0 | — |
| Medio | 2 | S-COMR-01, S-COMR-02 |
| Bajo | 4 | S-COMR-03, S-COMR-04, S-COMR-05 (CORREGIDOS en iter 2); S-COMR-06, S-COMR-07 (ABIERTOS) |
| Info | 5 | I-COMR-01 a I-COMR-05 |

Siguen abiertos los hallazgos preexistentes del run 20261012-2106: S-01 (Crítico, no hay Auth), S-BUL-01 y S-DEP-01 (Altos), y S-COM-03, S-COM-06 y S-COM-14 (Medios). No se cuentan acá. S-COMR-01 agrava S-COM-03 y S-COMR-02 agrava S-COM-06.

## Tabla de hallazgos

| Severidad | Hallazgo | Evidencia | Estado | Dónde se corrige | Origen |
|---|---|---|---|---|---|
| Crítico | Sin hallazgos nuevos de esta severidad en REQ-COMR (el Crítico preexistente S-01 sigue ABIERTO) | — | ABIERTO (S-01, preexistente) | Dueño: 002 pasos 1-4 y Auth | Preexistente |
| Alto | Sin hallazgos nuevos de esta severidad (S-BUL-01 y S-DEP-01 siguen ABIERTOS) | — | ABIERTO (preexistentes) | Dueño | Preexistente |
| Medio (CVSS 5.3) | **S-COMR-01**: los % por vendedor y rubro se leen con la anon key a través de `comisiones_cierre_pedidos.desglose` y `comisiones_cierres.lineas`. Incumple AC-COMR-7 | `005:263,616,759`; `003:588-596`; `comisiones.js:644,1073-1086` | Revoke de `comisiones_cierre_pedidos`: CORREGIDO (iter 2, `005:§9`). RESIDUAL ABIERTO: `comisiones_cierres.lineas[].partes[].desglose` sigue legible con la anon key (mismos % por vendedor y rubro) | SQL 006 (revoke) y luego RPC `admin_leer_cierres` + `pullCierres` | Nuevo (REQ-COMR, agrava S-COM-03) |
| Medio (CVSS 5.7) | **S-COMR-02**: la base sale de `pedidos.items` editable; el rubro del renglón manda y no se concilia con `pedidos.total` | `005:322-350,560-617`; `rubros.js:80-82`; `comisiones.js:320-342`; `002:223` | ABIERTO | Código (dominio + RPC, ver Detalle); causa raíz del dueño: Auth/RLS en `pedidos` | Nuevo (agrava S-COM-06) |
| Bajo (CVSS 3.1) | **S-COMR-03**: `modelo` y desglose de `lineas` del cierre los pone el cliente sin verificar | `005:460-463,741-745` | CORREGIDO (iter 2). Residual en S-COMR-07 | SQL (modelo del servidor) | Nuevo |
| Bajo (CVSS 3.1) | **S-COMR-04**: la clave de rubro no normaliza Unicode (NFD/NFC) ni fija el lower | `rubros.js:26-29`; `005:60-70`; falla `qa.rubros.borde.test.js` | CORREGIDO (iter 2). Residual Info: corte a 60 en UTF-16 (JS) vs code points (SQL) | Código + SQL | Nuevo |
| Bajo (CVSS 3.5) | **S-COMR-05**: pedido con precio/cantidad patológicos tumba `cerrar_comisiones` sin identificar el pedido | `005:329,333,342-345` | CORREGIDO (iter 2) | SQL + `subtotalRenglonCentavos` | Nuevo |
| Bajo (CVSS 2.4) | **S-COMR-06**: tabla de % en claro en IndexedDB del admin | `db/index.js` (store v7); `ComisionRubroGrid.js` | ABIERTO | Dueño (decisión) + gating por sesión validada | Nuevo |
| Bajo (CVSS 2.4) | **S-COMR-07**: la comparación de desglose (S-COMR-03) excluye las líneas `ajuste` y la comisión por rubro (prorrateo informativo). Un cliente adulterado con el PIN del admin puede dejar en `lineas` un desglose de ajuste o una comisión por rubro falsos que muestran el historial y el PDF (los montos por parte y los totales sí están verificados) | `005:§8` (comparación, `<> 'ajuste'`, sin `d->>'comision'`) | ABIERTO | SQL: comparar también las líneas `ajuste` contra `v_desgloses` (`pid|ajuste`) y la comisión por rubro; o servir el desglose del servidor (`admin_leer_cierres`) | Nuevo (iter 2) |
| Info | I-COMR-01 sonda de la 005: correcta (sin filtrar ni contar intentos). I-COMR-02 triggers sin `search_path`. I-COMR-03 lockout de PIN (S-COM-14). I-COMR-04 `Configuracion.js:147` sin `esAdmin()`. I-COMR-05 partes no cruzadas con el vendedor del pedido | ver Detalle | I-COMR-01: CORREGIDO/OK; el resto ABIERTO | Código (02, 04, 05); dueño (03) | Nuevo |

## Re-auditoría de la iteración 2

| Hallazgo | Veredicto | Notas |
|---|---|---|
| S-COMR-01 (revoke) | Corregido en parte | `revoke select on comisiones_cierre_pedidos from anon, authenticated` (005 §9). Verificado que `src/**` no nombra la tabla, así que no rompe la PWA, y las RPC definer la siguen leyendo. Sin `drop policy`: la política queda inerte sin el grant. **Sigue abierto** el mismo dato en `comisiones_cierres.lineas`, legible por anon: Medio hasta que exista `admin_leer_cierres`. Re-correr la 003 devuelve el select: volver a correr la 005 |
| S-COMR-03 | Corregido, sin bypass encontrado | El modelo lo decide el servidor. La comparación es bidireccional (`except` en ambos sentidos): sobra o falta un rubro, subtotal o % entre `lineas` y lo que calculó el servidor, y rechaza con `desglose_inconsistente` antes de grabar. Una línea `rubro` sin desglose también falla (el servidor tiene filas que el cliente no). `anular_cierre_comisiones` no se redefine y los ajustes siguen validados por 6a/6b. Residual Bajo: S-COMR-07. Info: un pedido cuyo id termina en `|ajuste` colisionaría con la clave interna del desglose de ajustes; requiere el PIN del admin y un pedido plantado, y el efecto sería rechazar o dejar de comparar esa línea |
| S-COMR-04 | Corregido | `normalizarRubro` hace NFC y `rubro_normalizado` hace `normalize(..., NFC)` primero. NFD y NFC dan la misma clave (test). Requiere Postgres 13+ y base UTF8. Residual Info: JS corta con `slice(0,60)` en unidades UTF-16 y SQL con `left(…,60)` en code points: un rubro de más de 60 con emojis da claves distintas; falla segura (el cierre se rechaza) |
| S-COMR-05 | Corregido | Las regex acotan el largo en la RPC y en el dominio, con el mismo tope; un número patológico es un renglón inválido y no una excepción. `monto_desbordado` devuelve los pedidos y se evalúa después de autorizar (no es oráculo) |

## Controles verificados (OK)

Los cubren los tests nuevos (ver al final).

- **RLS solo admin** (`005:105-109`): `comisiones_rubro` tiene RLS habilitado, **ninguna** política y `revoke all ... from public, anon, authenticated` después del `create table`, lo que neutraliza los default privileges de Supabase. No hay ningún `grant` sobre la tabla.
- **Security definer con search_path fijo.** Las 3 RPC (`admin_leer_comisiones_rubro`, `admin_guardar_comisiones_rubro`, `cerrar_comisiones`) tienen `security definer set search_path = public, pg_temp`, con `pg_temp` al final. Los helpers (`rubro_normalizado`, `rubro_clave`, `comision_rubro_base`, `comision_rubro_partes`) son invoker y sin `execute` para anon/authenticated. **Solo** las 3 RPC tienen `grant execute` a anon.
- **Autorización.** `verificar_pin` se llama **siempre**, junto con `permiso = 1` y `vendedor_habilitado`, antes de leer o escribir `comisiones_rubro`. Las salidas antes de autorizar son exactamente `{'ok':false,'motivo':'no_autorizado'}`. No hay `raise` propio, así que el intento fallido se commitea y cuenta para el bloqueo. Un admin sin PIN (`pin_hash` null) no queda autorizado. El mensaje de UI es genérico ("PIN incorrecto o … no autorizado").
- **Escritura.** El lock global se toma después de autorizar. El lote está acotado (1000 filas). La `rubro_clave` la calcula el servidor (ignora la del cliente). El % va de 0 a 100 con 2 decimales, y además hay un `check` en la tabla. Un `editado_at` futuro se acota a `now()`. `editado_por` sale del admin autenticado. Un id no se puede mover a otro vendedor o rubro (`id_en_uso`). Las filas no se borran (trigger) y vaciar un % es `pct = null`.
- **`cerrar_comisiones` redefinido.** Mantiene la misma firma y el mismo orden: autorizar → lock → idempotencia. Una PWA vieja no puede cerrar con el % del cliente (`modelo_obsoleto`, antes de cualquier insert). Cada parte se recalcula con la tabla del **servidor** y el `desglose` de los renglones lo arma el servidor, nunca el cliente. La división es de 1 o 2 vendedores distintos que suman 100.
- **No se alteran cierres confirmados.** Los triggers de inmutabilidad suman `modelo` (cabecera) y `modelo` + `desglose` (renglones). Anon sigue sin INSERT/UPDATE/DELETE sobre las tablas de cierres. Agregar las columnas con default no dispara los triggers (es DDL).
- **Un pedido no queda en dos cierres vigentes.** Siguen los índices únicos parciales de la 003 (`comisiones_pedido_vigente_uq`, `comisiones_ajuste_vigente_uq`) y la 005 no tiene ningún `drop index` ni `alter index`. `unique_violation` devuelve `ya_cerrado`. Un pedido se rechaza si aparece dos veces en el mismo lote (`renglones_duplicados`) o si es un ajuste sin base vigente.
- **Migración idempotente y no destructiva.** Corre en una sola transacción (`begin`/`commit`) y aborta antes de tocar nada si faltan la 002, la 003 o la 004. Todo usa `if not exists` o `create or replace`, y cada `create trigger` va precedido de su `drop trigger if exists`. No tiene `drop table`, `drop column`, `drop function`, `delete`, `truncate`, `alter column` ni `rename`. **No toca `public.clientes`: la columna `comision` queda.**
- **El upsert de clientes no pisa `comision`.** `clienteExtraToRemote` no incluye la clave (`clientes.js:110-127`), y con la unión de claves de PostgREST el `ON CONFLICT` no toca la columna. El pull conserva la `comision` local por el spread de `syncService.js:870-881`.
- **Formula injection.** El Rubro importado pasa por `textoSeguro` (`csvSafe`), así que `=`, `+`, `-` y `@` quedan con apóstrofo. La plantilla generada pasa todas las celdas por `csvSafe`. `xlsx` se lee con `cellFormula:false`. No hay exportación a planilla de rubros ni de % (el PDF no interpreta fórmulas).
- **XSS.** No hay `dangerouslySetInnerHTML` ni `innerHTML` en `src/`. Rubros y nombres se renderizan como texto de React.
- **La grilla y el dashboard no se exponen a vendedor ni armador.** `App.js:198` (`isAdmin`), `Comisiones.js:349,382-389` (`permisoValido`), `Configuracion.js:170-180`. Además, `guardarPctsVendedor` y `syncComisionesRubro` exigen `esAdminSesion()` y no llaman a ninguna RPC para otro rol. El servidor exige PIN de admin.
- **PIN y secretos.** El PIN viaja solo como argumento de la RPC. No se escribe en IndexedDB, no aparece en `console.*`, no se devuelve en los resultados y el input se limpia antes de llamar (`ComisionRubroGrid.js:63-64`). No hay JWT ni `service_role` en `src/`. `.env` no está trackeado (`git ls-files`).

## Detalle

### S-COMR-01 — los % por rubro se pueden leer a través de los cierres (Medio)

**Paso inmediato (SQL, no rompe el cliente).** La PWA **no lee** `comisiones_cierre_pedidos`: el único `from('comisiones_…')` del cliente es `comisiones_cierres`, en `comisionesService.js:56`. Este paso se puede aplicar ya (migración 006):

```sql
begin;
drop policy if exists comisiones_cierre_pedidos_select on public.comisiones_cierre_pedidos;
revoke select on public.comisiones_cierre_pedidos from anon, authenticated;
commit;
```

Las RPC `security definer` (cerrar y anular) la siguen leyendo como owner.

**Paso completo (código + SQL).** Hay que sacar de `comisiones_cierres` el acceso anon y servir el historial por RPC con el PIN del admin:

```sql
create or replace function public.admin_leer_cierres(p_admin_id text, p_admin_pin text, p_desde timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id text := trim(coalesce(p_admin_id, '')); v_ok boolean; v_adm boolean;
begin
  if length(v_id) = 0 or length(v_id) > 64 then return jsonb_build_object('ok', false, 'motivo', 'no_autorizado'); end if;
  select exists(select 1 from public.vendedores ve where ve.id::text = v_id and ve.permiso = 1
                and public.vendedor_habilitado(ve.id::text)) into v_adm;
  v_ok := coalesce(public.verificar_pin(v_id, p_admin_pin), false);
  if not v_ok or not v_adm then return jsonb_build_object('ok', false, 'motivo', 'no_autorizado'); end if;
  return jsonb_build_object('ok', true, 'cierres', coalesce((select jsonb_agg(to_jsonb(c) order by c.updated_at)
    from public.comisiones_cierres c where p_desde is null or c.updated_at > p_desde), '[]'::jsonb));
end $$;
revoke all on function public.admin_leer_cierres(text, text, timestamptz) from public;
grant execute on function public.admin_leer_cierres(text, text, timestamptz) to anon, authenticated;
-- cuando la PWA nueva esté desplegada:
drop policy if exists comisiones_cierres_select on public.comisiones_cierres;
revoke select on public.comisiones_cierres from anon, authenticated;
```

En el cliente, `pullCierres({ cred })` llama a `admin_leer_cierres` con las mismas credenciales de `credencialesAdminRubro`. Sin PIN, el historial se muestra desde IndexedDB y queda un aviso de "historial sin actualizar". `mezclarCierres` no cambia.

### S-COMR-02 — base de comisión manipulable (Medio)

1. **Dominio** (`src/domain/comisiones.js`, `baseRubrosPedido` y `puedeCerrar`). Calcular `sumaCents = Σ subtotales válidos` y marcar `baseInconsistente` cuando `|sumaCents − aCentavos(pedido.total)| > nRenglones` (1 centavo por renglón de tolerancia, porque `Facturacion.js:655` suma sin redondear). Debe ser un motivo bloqueante en `puedeCerrar`, con un aviso que diga el pedido.
2. **Rubro del renglón.** Aceptar el `item.rubro` solo si su clave existe entre los rubros actuales de `productos`. Si no existe, usar el del producto y avisar `rubroRenglonDesconocido`. Hay que hacerlo igual en `rubroDeRenglon` y en `comision_rubro_base`:

   ```sql
   coalesce(
     (select public.rubro_normalizado(item->>'rubro')
       where exists (select 1 from public.productos pr2
                      where public.rubro_clave(pr2.categoria) = public.rubro_clave(item->>'rubro'))),
     (select public.rubro_normalizado(pr.categoria) from public.productos pr where pr.id::text = item->>'productoId' limit 1))
   ```

3. **RPC.** Agregar un paso 5c en `cerrar_comisiones` antes de 5b:

   ```sql
   select array_agg(x.pid) into v_invalidos from (
     select r->>'pedido_id' as pid,
            coalesce((select sum(b.subtotal) from public.comision_rubro_base(r->>'pedido_id') b), 0) as base,
            (select greatest(round(coalesce(p.total, 0)::numeric, 2), 0) from public.pedidos p where p.id::text = r->>'pedido_id') as tot,
            (select count(*) from public.pedidos p cross join lateral jsonb_array_elements(p.items::jsonb) i
              where p.id::text = r->>'pedido_id') as n
       from jsonb_array_elements(p_renglones) r
      where r->>'tipo' = 'pedido' and coalesce(r->>'sin_comision', 'false') <> 'true') x
    where abs(x.base - x.tot) > 0.01 * greatest(x.n, 1);
   if v_invalidos is not null then
     return jsonb_build_object('ok', false, 'motivo', 'base_inconsistente', 'conflictos', to_jsonb(v_invalidos));
   end if;
   ```

4. **Dueño.** S-01/S-COM-06: Auth y RLS en `pedidos`, o un trigger que congele `items` de los pedidos `facturado`.

### S-COMR-03 — metadatos del cierre que pone el cliente (Bajo)

En `cerrar_comisiones`, que el modelo lo decida el servidor:

```sql
v_modelo := case when exists (select 1 from jsonb_array_elements(p_renglones) r where r->>'tipo' = 'pedido') then 'rubro'
                 else coalesce(p_cierre->>'modelo', 'cliente') end;
```

Para el historial y el PDF hay dos caminos: usar el `desglose` del servidor (vía `admin_leer_cierres`, S-COMR-01), o comparar `lineas[i].partes[j].desglose` contra `v_desgloses` antes de grabar.

### S-COMR-04 — normalización Unicode de rubros (Bajo)

- **JS:** `normalizarRubro = (v) => (esEscalar(v) ? texto(String(v).normalize('NFC'), MAX_RUBRO) : '')`.
- **SQL:** dentro de `rubro_normalizado` usar `normalize(coalesce(p, ''), NFC)` (Postgres 13 o más, Supabase lo cumple).
- **Opcional:** rechazar en `validarProducto` los rubros con caracteres fuera de `[\p{L}\p{N} .,&/()'+-]`, y hacer el `lower` sobre una salida ya traducida a ASCII, para no depender de la collation.

Esto destraba también `qa.rubros.borde.test.js`.

### S-COMR-05 — un pedido patológico tumba el cierre (Bajo)

En `comision_rubro_base`, acotar el largo: `~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$'` para el precio y `~ '^[0-9]{1,9}(\.[0-9]{1,6})?$'` para la cantidad. Hay que aplicar el mismo tope en `subtotalRenglonCentavos`, en `src/domain/comisiones.js:306`, para que JS y SQL coincidan. Si `pedidos.items` no es `jsonb`, cambiar `p.items::jsonb` por un helper plpgsql `try_jsonb(text)` con `exception when others then return '[]'` y marcar el pedido como `pedido_invalido` (con `conflictos`).

### S-COMR-06 — % en claro en IndexedDB (Bajo)

Decisión del dueño. En código: (a) mostrar `ComisionRubroGrid` y la tabla del dashboard solo si la sesión del admin se validó contra el servidor en esta sesión (`sesionValidada`); (b) documentar que el dispositivo del admin no se comparte. **No** se propone borrar el store: la regla dura 6 prohíbe borrar datos de usuario.

## Corregido en esta corrida

Iteración 2 (implementador, re-auditado acá): S-COMR-03, S-COMR-04 y S-COMR-05 CORREGIDOS; S-COMR-01 CORREGIDO solo en `comisiones_cierre_pedidos` (queda el residual en `comisiones_cierres.lineas`). Detalle en "Re-auditoría de la iteración 2".

- **Código de producción:** nada. Las reglas del auditor prohíben modificar `src/**` de producción.
- **Tests de seguridad nuevos (verdes):**
  - `src/domain/__tests__/security.comisionesRubro.test.js`: 49 tests y 2 `todo` (S-COMR-01 y S-COMR-02).
    - Estático de la 005: RLS y grants, `search_path`, grants de execute, orden de autorización, respuesta genérica sin `raise`, lock después de autorizar, clave calculada en el servidor, `modelo_obsoleto`, desglose del servidor, índices únicos intactos, triggers de inmutabilidad, idempotencia y no destrucción, `clientes.comision` intacta.
    - Dominio: upsert sin `comision`, `validarPctRubro` hostil (NaN, Infinity, negativos, `1e2`, fórmulas), formula injection en la importación de rubros y en la plantilla, `interpretarGuardarRubros` fail-closed, `filaRubroToRemote` sin PIN.
    - Documenta S-COMR-02.
  - `src/services/__tests__/security.comisionesRubro.service.test.js`: 10 tests. Cubre la sonda de la 005 sin credenciales y sin efectos locales, el gating de vendedor, armador, sin sesión y permiso raro sin ninguna RPC, que el PIN no queda en IndexedDB, logs ni resultados (tampoco con error de bloqueo) y que las credenciales salen del admin de la sesión.
  - Corrida: `CI=true npx react-scripts test --watchAll=false security.comisionesRubro` → **2 suites, 59 passed, 2 todo**.
  - Suite completa: 90 suites, 1781 passed, 1 skipped, 5 todo y **1 failed**. La que falla es `src/domain/__tests__/qa.rubros.borde.test.js` ("Lácteos" NFD/NFC), que **no es de este auditor** (es de QA) y corresponde a S-COMR-04.

## Requiere acción del dueño

| Acción | Hallazgo |
|---|---|
| Aplicar en el SQL Editor el "paso inmediato" de S-COMR-01 (revocar `select` de `comisiones_cierre_pedidos` a anon). No rompe la PWA | S-COMR-01 |
| Decidir si el historial de cierres pasa a pedir el PIN del admin (`admin_leer_cierres`) y, cuando esté desplegado, revocar `select` de `comisiones_cierres` | S-COMR-01 / S-COM-03 |
| Auth real y RLS en `pedidos` y `productos` (o un trigger que congele `items` y `total` de los pedidos facturados) | S-COMR-02 / S-COM-06 / S-01 |
| Antes de usar la 005 en producción: aplicarla en un proyecto de prueba (orden 002 PASO 1 → 003 → 004 → 005), correrla **dos veces** (idempotencia) y probar un cierre real, un ajuste y una anulación | Riesgo residual de `implementacion.md` §5 |
| No compartir el navegador del admin; mitigar S-BUL-01 | S-COMR-06 |
| PIN de admin de 6 o más dígitos y lockout con backoff por IP o global (S-COM-14) | I-COMR-03 |

## Corregible en código en la próxima iteración (sin el dueño)

S-COMR-02 (dominio y RPC, puntos 1-3), S-COMR-03, S-COMR-04, S-COMR-05, I-COMR-02, I-COMR-04 y la parte de cliente de S-COMR-01 (`pullCierres` con RPC). Las SQL van en una migración 006 idempotente, que el dueño aplica a mano.
