// REQ-REN (AC-REN-5): el dashboard de comisiones recibe SOLO las rendiciones confirmadas.
jest.mock('../../db', () => ({
  getPedidos: async () => [], getClientes: async () => [], getVendedores: async () => [], getComisionesCierres: async () => [],
  getComisionBorrador: async () => null, getProductos: async () => [], getComisionesRubro: async () => [],
}));
jest.mock('../../sync/syncService', () => ({
  pullPedidosByRango: jest.fn(async () => ({ ok: true })), syncPedidosPendientes: jest.fn(), syncProductos: jest.fn(), downloadMaestros: jest.fn(),
}));
jest.mock('../comisionesRubroService', () => ({ syncComisionesRubro: jest.fn(), sondearMigracion005: async () => ({ faltaMigracion: false }), MSG_FALTA_MIGRACION_005: '' }));
jest.mock('../rendicionService', () => ({
  cargarRendicionesLocales: async () => ({ rendiciones: [
    { id: 'a', syncEstado: 'confirmada', estado: 'vigente' }, { id: 'b', syncEstado: 'pendiente', estado: 'vigente' }, { id: 'c', syncEstado: 'rechazada' },
  ], cuenta: [] }),
}));
jest.mock('../../lib/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));

import { cargarDatosComisiones } from '../comisionesService';

it('AC-REN-5 cargarDatosComisiones pasa solo rendiciones confirmadas por el servidor', async () => {
  const d = await cargarDatosComisiones({ desde: '2026-10-01', hasta: '2026-10-31' }, { online: false });
  expect(d.rendiciones.map(r => r.id)).toEqual(['a']);
});
