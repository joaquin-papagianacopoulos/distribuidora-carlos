const ESTADOS_OCULTOS = new Set(['cancelado', 'eliminado', 'borrado']);

export const isPedidoOculto = (pedido) => {
  if (!pedido) return true;
  if (pedido.borrado) return true;
  // REQ-WEB (AC-WEB-1): un pedido web que no fue aceptado no entra al flujo interno.
  if (pedido.origen === 'web' && pedido.webEstado !== 'aceptado') return true;
  return ESTADOS_OCULTOS.has(String(pedido.estado || '').toLowerCase());
};

export const isPedidoVisible = (pedido) => !isPedidoOculto(pedido);

// Estado de armado (preparacion del pedido en deposito). Es independiente del
// estado de facturacion ("pendiente" / "facturado"): un pedido puede estar
// armado y seguir pendiente de facturar, o facturarse sin haber sido armado.
// Guardarlo en un campo separado evita tocar/romper el campo "estado" existente.
export const isPedidoArmado = (pedido) => !!pedido?.armado;

export const makePedidoArmado = (pedido, armado, armadoPor = null) => ({
  ...pedido,
  armado: !!armado,
  armadoAt: armado ? Date.now() : null,
  armadoPor: armado ? (armadoPor || null) : null,
  updatedAt: Date.now(),
});

// Estado "a reparto": la ultima verificacion antes de que el pedido salga a
// entregar. Es independiente de "armado" y de "estado" (pendiente/facturado):
// un pedido normalmente pasa sin armar -> armado -> a reparto, pero se guarda
// en su propio campo para no romper nada de lo que ya existia.
export const isPedidoAReparto = (pedido) => !!pedido?.aReparto;

export const makePedidoAReparto = (pedido, aReparto, aRepartoPor = null) => ({
  ...pedido,
  aReparto: !!aReparto,
  aRepartoAt: aReparto ? Date.now() : null,
  aRepartoPor: aReparto ? (aRepartoPor || null) : null,
  updatedAt: Date.now(),
});

// Registro de lo que hizo el armador al preparar el pedido: que productos
// tildo como "listo" y cuales saco o redujo (esos ya quedaron reflejados en
// Faltantes, pero conviene tenerlos a mano aca tambien para que Facturacion
// sepa de un vistazo que revisar sin tener que cruzar con la pantalla de
// Faltantes). Es puramente informativo, no participa del total ni del estado.
export const getArmadoLog = (pedido) => pedido?.armadoLog || null;

// Lo que todavia debe una deuda: monto original menos lo ya cobrado (pago
// parcial). Una deuda marcada como pagada no debe nada.
export const saldoDeuda = (d) => {
  if (!d || d.pagada) return 0;
  return Math.max(0, Number(d.monto || 0) - Number(d.montoPagado || 0));
};

const normNombre = (s) => String(s || '').trim().toLowerCase();

// Una deuda pertenece a un pedido si coincide el id remoto o el id local
// (el local sirve cuando el pedido todavia no se sincronizo y no tiene remoteId).
export const deudaEsDePedido = (d, pedido) => {
  if (!d || !pedido) return false;
  if (pedido.remoteId != null && d.pedidoId != null && String(d.pedidoId) === String(pedido.remoteId)) return true;
  if (pedido.id != null && d.pedidoLocalId != null && d.pedidoLocalId === pedido.id) return true;
  return false;
};

// Suma de lo que debe el cliente de este pedido (para mostrar "Deuda pendiente"
// en la boleta). Se excluye la deuda del propio pedido que se esta imprimiendo:
// esa es la boleta actual, no una deuda anterior.
export const getDeudaPendienteParaPedido = (deudas, pedido) => {
  if (!pedido) return 0;
  const clienteId = pedido.clienteId ?? null;
  return (deudas || [])
    .filter(d => {
      const mismoCliente = (clienteId != null && d.clienteId != null)
        ? String(d.clienteId) === String(clienteId)
        : normNombre(d.clienteNombre) === normNombre(pedido.clienteNombre);
      return mismoCliente && !deudaEsDePedido(d, pedido);
    })
    .reduce((acc, d) => acc + saldoDeuda(d), 0);
};

export const makePedidoEliminado = (pedido, estado = 'eliminado') => ({
  ...pedido,
  estado,
  borrado: true,
  updatedAt: Date.now(),
});

export const normalizePedidoFecha = (fecha) => {
  const raw = String(fecha || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10);
  return raw;
};

export const getLocalTodayStr = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};
