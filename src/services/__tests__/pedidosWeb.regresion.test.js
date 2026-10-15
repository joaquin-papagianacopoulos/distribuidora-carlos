// REQ-WEB AC-WEB-1: un pedido web por revisar no entra al flujo interno ni mueve stock.
// Los pedidos viejos (sin `origen`) siguen funcionando igual.
const mockMovs = [];
jest.mock('../../db', () => ({
  getMovimientosStock: async () => mockMovs.map(m => ({ ...m })),
  addMovimientosStock: async (rows) => { mockMovs.push(...rows); },
  rekeyMovimientosRef: async () => 0,
}));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));

import { isPedidoOculto, isPedidoVisible } from '../../utils/pedidos';
import { aplicarStockPedido } from '../stockService';
import { puedeMarcarEntregado } from '../../domain/comisiones';

const base = { id: 1, remoteId: 10, estado: 'facturado', fecha: '2026-10-14', items: [{ productoId: 1, cantidad: 3 }], total: 300 };

beforeEach(() => { mockMovs.length = 0; });

describe('AC-WEB-1 regresión: pedidos web sin aceptar', () => {
  it('AC-WEB-1 isPedidoOculto: web por revisar y rechazado ocultos; aceptado visible', () => {
    expect(isPedidoOculto({ ...base, origen: 'web', webEstado: 'por_revisar' })).toBe(true);
    expect(isPedidoOculto({ ...base, origen: 'web', webEstado: 'rechazado' })).toBe(true);
    expect(isPedidoOculto({ ...base, origen: 'web' })).toBe(true);
    expect(isPedidoOculto({ ...base, origen: 'web', webEstado: 'aceptado' })).toBe(false);
    expect(isPedidoVisible({ ...base, origen: 'web', webEstado: 'aceptado' })).toBe(true);
  });

  it('AC-WEB-1 pedidos viejos sin origen (o internos) siguen visibles', () => {
    expect(isPedidoOculto({ ...base })).toBe(false);
    expect(isPedidoOculto({ ...base, origen: 'interna' })).toBe(false);
    expect(isPedidoOculto({ ...base, estado: 'cancelado' })).toBe(true);
    expect(isPedidoOculto(null)).toBe(true);
  });

  it('AC-WEB-1 Comisiones: un web por revisar no se puede marcar entregado ni cuenta como facturado', () => {
    expect(puedeMarcarEntregado({ ...base, origen: 'web', webEstado: 'por_revisar' }, 1).ok).toBe(false);
    expect(puedeMarcarEntregado({ ...base, origen: 'web', webEstado: 'aceptado' }, 1).ok).toBe(true);
    expect(puedeMarcarEntregado({ ...base }, 1).ok).toBe(true);
  });

  it('AC-WEB-1 aplicarStockPedido: web sin aceptar devuelve [] aunque se intente facturar', async () => {
    const r = await aplicarStockPedido({ ...base, origen: 'web', webEstado: 'por_revisar' }, { iniciar: true });
    expect(r).toEqual([]);
    expect(mockMovs).toHaveLength(0);
  });

  it('AC-WEB-1 aplicarStockPedido: web aceptado y pedido viejo sí mueven stock al facturar', async () => {
    const a = await aplicarStockPedido({ ...base, origen: 'web', webEstado: 'aceptado' }, { iniciar: true });
    expect(a.length).toBe(1);
    mockMovs.length = 0;
    const b = await aplicarStockPedido({ ...base }, { iniciar: true });
    expect(b.length).toBe(1);
    expect(b[0].cantidad).toBe(-3);
  });
});
