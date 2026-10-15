import {
  nuevoPedidoProveedor, agregarItems, quitarItem, unidadesItem, marcarEnviado, marcarRecibido,
  vincularIngreso, textoCompartirPedido, fijarItem, pedidoProveedorToRemote, pedidoProveedorFromRemote,
} from '../pedidosProveedor';

const now = new Date('2026-10-15T12:00:00Z');
const later = new Date('2026-10-15T13:00:00Z');
const nuevo = () => nuevoPedidoProveedor('p1', { usuario: ' ana ', now, genId: () => 'ped-1' });

describe('AC-CPR-4 pedido al proveedor', () => {
  it('AC-CPR-4 nace como borrador pendiente de sync', () => {
    expect(nuevo()).toEqual({
      id: 'ped-1', proveedorId: 'p1', estado: 'borrador', items: [], ingresoId: null, usuario: 'ana',
      creadoAt: now.getTime(), updatedAt: now.getTime(), pendingSync: true,
    });
  });
  it('AC-CPR-4 bultos a unidades (bultoX <= 1 o vacío => unidades)', () => {
    expect(unidadesItem({ cantidad: 3, unidad: 'bulto', bultoX: 12 })).toBe(36);
    expect(unidadesItem({ cantidad: 3, unidad: 'bulto', bultoX: 1 })).toBe(3);
    expect(unidadesItem({ cantidad: 3, unidad: 'bulto', bultoX: null })).toBe(3);
    expect(unidadesItem({ cantidad: 5, unidad: 'u', bultoX: 12 })).toBe(5);
    expect(unidadesItem({ cantidad: 0, unidad: 'u' })).toBe(0);
    expect(unidadesItem({ cantidad: 1.5, unidad: 'u' })).toBe(0);
    expect(unidadesItem(null)).toBe(0);
  });
  it('AC-CPR-4 agrega renglones válidos e ignora cantidades inválidas', () => {
    const p = agregarItems(nuevo(), [
      { productoId: 1, cantidad: 4, unidad: 'u' },
      { productoId: 2, cantidad: 2, unidad: 'bulto', bultoX: 6 },
      { productoId: 3, cantidad: 0 }, { productoId: 4, cantidad: -2 }, { productoId: 5, cantidad: 1.5 },
      { productoId: 6, cantidad: 'x' }, { cantidad: 2 }, null,
    ], { now: later });
    expect(p.items).toEqual([
      { productoId: '1', cantidad: 4, unidad: 'u', bultoX: null },
      { productoId: '2', cantidad: 2, unidad: 'bulto', bultoX: 6 },
    ]);
    expect(p.updatedAt).toBe(later.getTime());
    expect(p.pendingSync).toBe(true);
  });
  it('AC-CPR-4 bulto sin bultoX > 1 pasa a unidades', () => {
    const p = agregarItems(nuevo(), [{ productoId: 1, cantidad: 2, unidad: 'bulto', bultoX: 1 }]);
    expect(p.items[0]).toMatchObject({ unidad: 'u', cantidad: 2 });
  });
  it('AC-CPR-4 producto repetido suma; con unidades distintas suma en unidades', () => {
    let p = agregarItems(nuevo(), [{ productoId: 1, cantidad: 4, unidad: 'u' }]);
    p = agregarItems(p, [{ productoId: 1, cantidad: 6, unidad: 'u' }]);
    expect(p.items).toEqual([{ productoId: '1', cantidad: 10, unidad: 'u', bultoX: null }]);
    let q = agregarItems(nuevo(), [{ productoId: 2, cantidad: 2, unidad: 'bulto', bultoX: 6 }]);
    q = agregarItems(q, [{ productoId: 2, cantidad: 1, unidad: 'bulto', bultoX: 6 }]);
    expect(q.items).toEqual([{ productoId: '2', cantidad: 3, unidad: 'bulto', bultoX: 6 }]);
    q = agregarItems(q, [{ productoId: 2, cantidad: 4, unidad: 'u' }]);
    expect(q.items).toEqual([{ productoId: '2', cantidad: 22, unidad: 'u', bultoX: 6 }]);
  });
  it('AC-CPR-4 sin items válidos devuelve el mismo pedido; no muta el original', () => {
    const p = nuevo();
    expect(agregarItems(p, [{ productoId: 1, cantidad: 0 }])).toBe(p);
    const q = agregarItems(p, [{ productoId: 1, cantidad: 1 }]);
    expect(p.items).toEqual([]);
    expect(q).not.toBe(p);
  });
  it('AC-CPR-4 fijar cantidad/unidad de un renglón; inválido no cambia nada', () => {
    const p = agregarItems(nuevo(), [{ productoId: 2, cantidad: 2, unidad: 'bulto', bultoX: 6 }]);
    const q = fijarItem(p, { productoId: 2, cantidad: 5, unidad: 'u' });
    expect(q.items).toEqual([{ productoId: '2', cantidad: 5, unidad: 'u', bultoX: 6 }]);
    expect(fijarItem(p, { productoId: 2, cantidad: 0, unidad: 'u' })).toBe(p);
    expect(fijarItem(p, { productoId: 2, cantidad: 1.5 })).toBe(p);
  });
  it('AC-CPR-4 quitar renglón', () => {
    const p = agregarItems(nuevo(), [{ productoId: 1, cantidad: 1 }, { productoId: 2, cantidad: 1 }]);
    expect(quitarItem(p, 1).items.map(x => x.productoId)).toEqual(['2']);
    expect(quitarItem(p, 99)).toBe(p);
  });
  it('AC-CPR-4 recibido abre un ingreso precargado en unidades y es terminal', () => {
    const p = agregarItems(nuevo(), [{ productoId: 1, cantidad: 4 }, { productoId: 2, cantidad: 2, unidad: 'bulto', bultoX: 6 }]);
    const e = marcarEnviado(p, { now: later });
    expect(e.estado).toBe('enviado');
    const r = marcarRecibido(e, { now: later });
    expect(r.ok).toBe(true);
    expect(r.pedido.estado).toBe('recibido');
    expect(r.pedido.pendingSync).toBe(true);
    expect(r.formIngreso).toEqual({ proveedorId: 'p1', pedidoProveedorId: 'ped-1', items: [{ productoId: '1', ingreso: 4 }, { productoId: '2', ingreso: 12 }] });
    // terminal: no se edita ni vuelve atrás
    expect(agregarItems(r.pedido, [{ productoId: 9, cantidad: 1 }])).toBe(r.pedido);
    expect(marcarEnviado(r.pedido)).toBe(r.pedido);
  });
  it('AC-CPR-4 marcar recibido dos veces es idempotente (mismo pedido, mismo formulario)', () => {
    const p = agregarItems(nuevo(), [{ productoId: 1, cantidad: 4 }]);
    const r1 = marcarRecibido(p, { now });
    const r2 = marcarRecibido(r1.pedido, { now: later });
    expect(r2.ok).toBe(true);
    expect(r2.pedido).toBe(r1.pedido);
    expect(r2.formIngreso).toEqual(r1.formIngreso);
  });
  it('AC-CPR-4 pedido vacío o inexistente no se puede recibir', () => {
    expect(marcarRecibido(nuevo()).ok).toBe(false);
    expect(marcarRecibido(null).ok).toBe(false);
  });
  it('AC-CPR-4 vincula el ingreso confirmado una sola vez', () => {
    const p = nuevo();
    const v = vincularIngreso(p, 'ing-1', { now: later });
    expect(v.ingresoId).toBe('ing-1');
    expect(vincularIngreso(v, 'ing-1')).toBe(v);
  });
  it('AC-CPR-4 texto para compartir (sin precios)', () => {
    const p = agregarItems(nuevo(), [{ productoId: 1, cantidad: 4 }, { productoId: 2, cantidad: 2, unidad: 'bulto', bultoX: 6 }, { productoId: 3, cantidad: 1 }]);
    const t = textoCompartirPedido(p, [{ id: 1, codigo: 'A1', nombre: 'Uno' }, { id: 2, nombre: 'Dos', precio: 50 }], { descripcion: 'Prov Uno' });
    expect(t).toBe('Pedido para Prov Uno\n- A1 - Uno: 4 u.\n- Dos: 2 bultos (12 u.)\n- Producto 3: 1 u.');
    expect(t).not.toMatch(/\$|50/);
  });
  it('AC-CPR-4 round-trip remoto', () => {
    const p = { ...agregarItems(nuevo(), [{ productoId: 2, cantidad: 2, unidad: 'bulto', bultoX: 6 }]), ingresoId: 'ing-1' };
    const r = pedidoProveedorToRemote(p);
    expect(r.items).toEqual([{ producto_id: '2', cantidad: 2, unidad: 'bulto', bulto_x: 6 }]);
    expect(pedidoProveedorFromRemote(r)).toEqual({ ...p, pendingSync: false });
    expect(pedidoProveedorFromRemote({ ...r, estado: 'raro', items: [{ producto_id: 1, cantidad: 0 }] })).toMatchObject({ estado: 'borrador', items: [] });
  });
});
