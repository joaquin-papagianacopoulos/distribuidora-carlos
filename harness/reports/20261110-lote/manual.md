# Manual del lote 2026-11-10 (para el dueño)

## Antes de nada: nada de esto está aplicado en Supabase
El código está listo y probado (272 suites, 3884 tests, build y gates en verde), pero **las migraciones 023, 024, 025 y 026 no se corrieron en ninguna base** y no hay commit. La app sigue andando sin ellas (cada cambio vuelve al comportamiento de antes y avisa una vez por consola), pero las protecciones de seguridad **no valen hasta aplicarlas**.

## Orden de aplicación (Supabase → SQL Editor, una por una)
0. **Backup primero** (Supabase → Database → Backups; el plan Free no los trae: bajá también un CSV de pedidos, clientes y productos). Y verificá que ya estén aplicadas la 002, la 004 y la 019.
1. `023_no_perder_datos.sql` (requiere 002 y 004)
2. `024_pedidos_edicion_vendedor.sql` (requiere 019)
3. `025_remito_redondeo_medio_pago.sql`
4. `026_escalas_bulto.sql` → después correr `supabase/verificacion/026_escalas_casos.sql`: **tiene que devolver 0 filas**.
5. Recién ahí, desplegar la app. Si una migración da error, frená y mandame el mensaje: son re-ejecutables y no borran datos.
Nunca ejecutaron contra Postgres real (no había uno a mano): fueron revisadas línea por línea, pero la primera corrida es la prueba de verdad.

## Qué cambió y cómo se usa
- **Precio de venta = costo (bug):** causa: precio vacío y sin % de ganancia se guardaba el costo como precio. Ahora da error en el campo y el Excel conserva el precio de los productos existentes. En Configuración, admin ve el aviso "N productos con precio igual o menor al costo". **Ojo: puede haber productos ya dañados**; revisá esa lista y corregí a mano. Pedidos hechos al costo desde la importación conviene revisarlos.
- **Vendedor edita su pedido** hasta que se facture (desde la lista, "Editar"). Si ya estaba armado, queda "Modificado" y el armador lo confirma.
- **Mínimo en múltiplos:** mínimo 3 → 3, 6, 9. Bajo el mínimo en Armado solo administradores, con confirmación.
- **Bulto aparte:** en la lista de productos, botones "Unidad $X" y "Bulto xN $Y"; en el renglón, casilleros de bultos y de unidades sueltas, cada uno con su + y −.
- **Sin stock** se puede cargar ("Sin stock — por recibir").
- **Vendedor del pedido:** se elige al cargar; los pedidos de la tienda llegan "sin vendedor" y el admin los asigna (pide PIN). Sin vendedor no suman comisión.
- **Pendientes:** al abrir la lista del día se ven todos los pedidos no facturados de cualquier fecha.
- **Remito:** título "REMITO", dirección, vendedor grande, renglones numerados, saldo deudor, interlineado menor (≈30 % más renglones por hoja) y sin pie de página.
- **Hoja de ruta** (Orden de entrega): importe y saldo de cada cliente y columnas para anotar efectivo / transferencia / transf. a proveedor.
- **Redondeo:** Configuración → pestaña Tienda; sin redondeo / $500 / $1000, al múltiplo más cercano (arranca en $500). Aplica al facturar; pedidos ya facturados no cambian.
- **Deudas:** al cobrar hay que elegir Efectivo o Transferencia; el historial muestra el medio y totales por medio.
- **Descuento por escala de bultos:** en cada producto, hasta 3 filas "desde N bultos → D %", sobre el precio llevando bulto; el precio por unidad se redondea para arriba al peso. Vale también en la tienda.
- **Respaldo:** Configuración → "Exportar respaldo". "Borrar caché" ya no borra si hay datos sin subir.

## Seguridad (resumen)
- Cerrado: borrados con la clave pública, pedidos perdidos/duplicados con mala red, cobros pisados entre dispositivos, stock falseable (ajustes solo con PIN), exportaciones con datos financieros para no-admin.
- **Abierto y decisión tuya:** la app no tiene autenticación real (solo PIN en pantalla); con la clave pública de Supabase se pueden leer pedidos y clientes. El arreglo de fondo es pasar a usuarios reales de Supabase (Auth + permisos por usuario): es un proyecto aparte.
- Residuales anotados en los informes de cada tanda (`harness/reports/20261110-t0` a `t3`).

## Preguntas pendientes
1. ¿"Facturas a emitir" debe sumar renglones sin redondeo (como está) o el total redondeado?
2. ¿El redondeo de las escalas al peso entero está bien, o a $10/$50/$100?
3. ¿Un vendedor puede cargar un pedido a nombre de otro? (hoy sí, al crear; después solo el admin reasigna).
4. ¿El redondeo también en los pedidos de la tienda online?
