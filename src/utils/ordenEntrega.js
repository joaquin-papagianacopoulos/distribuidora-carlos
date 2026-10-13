export const getOrdenEntrega = (pedido) => {
  const direct = Number(pedido?.ordenEntrega);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const item = (pedido?.items || []).find(i => {
    const n = Number(i?.__ordenEntrega);
    return Number.isFinite(n) && n > 0;
  });
  const fromItem = Number(item?.__ordenEntrega);
  return Number.isFinite(fromItem) && fromItem > 0 ? fromItem : null;
};

export const withOrdenEntrega = (pedido, orden) => {
  const n = Number(orden);
  if (!Number.isFinite(n) || n <= 0) return pedido;

  return {
    ...pedido,
    ordenEntrega: n,
    items: (pedido?.items || []).map(item => ({
      ...item,
      __ordenEntrega: n,
    })),
  };
};

export const normalizePedidoOrdenEntrega = (pedido) => {
  const orden = getOrdenEntrega(pedido);
  return orden ? withOrdenEntrega(pedido, orden) : pedido;
};

// Renumera los pedidos de un dia segun el puesto fijo que cada cliente tiene
// asignado en "Orden de entrega" (diaEntrega/ordenEntrega del cliente), PERO
// sin dejar huecos: si el cliente 2 no tiene pedido ese dia, el que sigue pasa
// a ocupar el numero 2, no el 3. Los clientes sin puesto asignado (o asignado
// a otro dia) van al final, ordenados por nombre.
// diaObjetivo: nombre del dia ('lunes'...'domingo') contra el que se valida
// el dia asignado a cada cliente. Es el dia EN QUE SE CARGO el pedido (el dia
// habitual del cliente), no el dia en que se entrega/imprime — la entrega es
// al dia siguiente.
export const calcularOrdenDelDia = (pedidosDelDia, clientes, diaObjetivo) => {
  const clientePorId = new Map((clientes || []).map(c => [c.id, c]));
  const conAsignacion = [];
  const sinAsignacion = [];

  for (const p of (pedidosDelDia || [])) {
    const cliente = p.clienteId != null ? clientePorId.get(p.clienteId) : null;
    const mismoDia = cliente?.diaEntrega && diaObjetivo && cliente.diaEntrega === diaObjetivo;
    const orden = mismoDia ? Number(cliente.ordenEntrega) : NaN;
    if (Number.isFinite(orden) && orden > 0) {
      conAsignacion.push({ pedido: p, ordenBase: orden });
    } else {
      sinAsignacion.push({ pedido: p });
    }
  }

  const porNombre = (a, b) => String(a.pedido.clienteNombre || '').localeCompare(String(b.pedido.clienteNombre || ''), 'es');
  conAsignacion.sort((a, b) => a.ordenBase - b.ordenBase || porNombre(a, b));
  sinAsignacion.sort(porNombre);

  let n = 1;
  const resultado = [];
  for (const { pedido } of conAsignacion) resultado.push({ pedido, orden: n++ });
  for (const { pedido } of sinAsignacion) resultado.push({ pedido, orden: n++ });
  return resultado;
};
