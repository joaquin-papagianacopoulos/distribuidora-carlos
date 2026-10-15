import {
  esPedidoWebPendiente, esPedidoWebNoAceptado, estadoBandeja, sugerirClientes, vendedorAlAceptar, validarAccionWeb,
  clienteDesdeContacto, pedidoWebFromRemote, accionWebToRpc, filtrarHistorialWeb, contarPorRevisar, armarItemsAceptar,
} from '../pedidosWeb';

const clientes = [
  { id: 1, nombre: 'Kiosco El Sol', cuit: '20-12345678-6', telefono: '341 555-1234', vendedor: 'Juan' },
  { id: 2, nombre: 'Almacén Sol y Luna', cuit: '', telefono: '3415559999' },
  { id: 3, nombre: 'Otro', cuit: '', telefono: '1111111111' },
  { id: 4, nombre: 'Kiosco El Sol', cuit: '', telefono: '' },
];

describe('pedidos web (AC-WEB-1, 3, 4, 5, 6)', () => {
  it('AC-WEB-1 pendientes y no aceptados; pedidos viejos sin origen son internos', () => {
    expect(esPedidoWebPendiente({ origen: 'web', webEstado: 'por_revisar' })).toBe(true);
    expect(esPedidoWebPendiente({ origen: 'web' })).toBe(true);
    expect(esPedidoWebPendiente({ origen: 'web', webEstado: 'aceptado' })).toBe(false);
    expect(esPedidoWebPendiente({ estado: 'pendiente' })).toBe(false);
    expect(esPedidoWebNoAceptado({ origen: 'web', webEstado: 'rechazado' })).toBe(true);
    expect(esPedidoWebNoAceptado({ origen: 'web', webEstado: 'aceptado' })).toBe(false);
    expect(esPedidoWebNoAceptado({})).toBe(false);
    expect(contarPorRevisar([{ origen: 'web' }, { origen: 'web', webEstado: 'aceptado' }, {}, null])).toBe(1);
  });

  it('AC-WEB-6 estadoBandeja: pendiente de subir si hay acción sin subir', () => {
    const p = { origen: 'web', webEstado: 'por_revisar', remoteId: 7 };
    expect(estadoBandeja(p, [])).toBe('por_revisar');
    expect(estadoBandeja(p, [{ pedidoRemoteId: 7, pendingSync: true }])).toBe('pendiente_subir');
    expect(estadoBandeja(p, [{ pedidoRemoteId: 7, pendingSync: false }])).toBe('por_revisar');
    expect(estadoBandeja({ origen: 'web', webEstado: 'rechazado' }, [])).toBe('rechazado');
    expect(estadoBandeja({}, [])).toBeNull();
  });

  it('AC-WEB-3 sugerirClientes: CUIT > teléfono > nombre, ordenado', () => {
    const r = sugerirClientes({ nombre: 'Kiosco El Sol', cuit: '20123456786', telefono: '+54 9 341 555 1234' }, clientes);
    expect(r[0].cliente.id).toBe(1);
    expect(r[0].motivos).toEqual(['CUIT', 'Teléfono', 'Nombre']);
    const soloTel = sugerirClientes({ nombre: 'Zzz', telefono: '3415559999' }, clientes);
    expect(soloTel.map(x => x.cliente.id)).toEqual([2]);
    const nom = sugerirClientes({ nombre: 'KIOSCO el sol' }, clientes);
    expect(nom.map(x => x.cliente.id)).toEqual([1, 4]);
    expect(sugerirClientes({ nombre: 'sol luna' }, clientes)[0].cliente.id).toBe(2);
  });

  it('AC-WEB-3 sugerirClientes: máximo, vacío y entradas raras', () => {
    expect(sugerirClientes({}, clientes)).toEqual([]);
    expect(sugerirClientes(null, null)).toEqual([]);
    expect(sugerirClientes({ nombre: 'kiosco' }, clientes, 1).length).toBe(1);
    expect(sugerirClientes({ telefono: '123' }, clientes)).toEqual([]);
  });

  it('AC-WEB-4 vendedorAlAceptar: link, ficha, admin', () => {
    expect(vendedorAlAceptar({ vendedor: 'Ana' }, { vendedor: 'Juan' }, 'Pepe')).toEqual({ vendedor: 'Ana', requiereElegir: false });
    expect(vendedorAlAceptar({ vendedor: '' }, { vendedor: 'Juan' })).toEqual({ vendedor: 'Juan', requiereElegir: false });
    expect(vendedorAlAceptar({}, {}, 'Pepe')).toEqual({ vendedor: 'Pepe', requiereElegir: false });
    expect(vendedorAlAceptar({}, null)).toEqual({ vendedor: null, requiereElegir: true });
  });

  it('AC-WEB-5 validarAccionWeb: rechazar exige motivo; aceptar exige cliente y vendedor', () => {
    expect(validarAccionWeb('rechazar', { motivo: '  ' }).ok).toBe(false);
    expect(validarAccionWeb('rechazar', { motivo: 'ab' }).ok).toBe(false);
    expect(validarAccionWeb('rechazar', { motivo: 'Sin zona de reparto' }).ok).toBe(true);
    expect(validarAccionWeb('rechazar', { motivo: 'x'.repeat(301) }).errores.motivo).toBeTruthy();
    expect(validarAccionWeb('aceptar', { clienteId: 3, vendedor: 'Ana' }).ok).toBe(true);
    expect(Object.keys(validarAccionWeb('aceptar', {}).errores).sort()).toEqual(['clienteId', 'vendedor']);
    expect(validarAccionWeb('otra', {}).ok).toBe(false);
  });

  it('AC-WEB-3 clienteDesdeContacto precarga sin código', () => {
    const f = clienteDesdeContacto({ nombre: 'Ana', direccion: 'Calle 1', ciudad: 'Rosario', cp: '2000', provincia: 'Santa Fe', cuit: '20-12345678-6', telefono: '341-5551234' }, { vendedor: 'Juan' });
    expect(f).toMatchObject({ codigo: '', nombre: 'Ana', direccion: 'Calle 1', codigoPostal: '2000', provincia: 'Santa Fe', telefono: '3415551234', vendedor: 'Juan', pais: 'Argentina' });
    expect(clienteDesdeContacto(null).nombre).toBe('');
  });

  it('AC-WEB-6 pedidoWebFromRemote: tolera columnas faltantes y conserva lo local', () => {
    expect(pedidoWebFromRemote({}, null)).toEqual({ origen: 'interna' });
    const web = pedidoWebFromRemote({ origen: 'web', web_estado: 'por_revisar', web_contacto: '{"nombre":"Ana"}', web_revisado_at: '2026-10-14T10:00:00Z' }, null);
    expect(web.webContacto).toEqual({ nombre: 'Ana' });
    expect(web.webEstado).toBe('por_revisar');
    expect(web.webRevisadoAt).toBe(Date.parse('2026-10-14T10:00:00Z'));
    const conservado = pedidoWebFromRemote({ origen: 'web' }, { origen: 'web', webEstado: 'aceptado', webContacto: { nombre: 'X' } });
    expect(conservado.webEstado).toBe('aceptado');
    expect(conservado.webContacto).toEqual({ nombre: 'X' });
    expect(pedidoWebFromRemote({ origen: null }, null).origen).toBe('interna');
  });

  it('AC-WEB-6 accionWebToRpc: aceptar y rechazar, con id de acción estable', () => {
    const cred = { adminId: 'a1', pin: '1234' };
    const acc = accionWebToRpc({ id: 'acc-1', pedidoRemoteId: 9, tipo: 'aceptar', clienteId: 5, clienteNombre: 'Ana', zona: 'Z1', vendedor: 'Juan', items: [{ productoId: 1 }], total: 10, por: 'admin' }, cred);
    expect(acc).toMatchObject({ p_admin_id: 'a1', p_admin_pin: '1234', p_pedido_id: '9', p_accion_id: 'acc-1', p_tipo: 'aceptar' });
    expect(acc.p_datos).toMatchObject({ cliente_id: 5, vendedor: 'Juan', total: 10, por: 'admin' });
    const rec = accionWebToRpc({ id: 'acc-2', pedidoRemoteId: 9, tipo: 'rechazar', motivo: 'No llegamos' }, cred);
    expect(rec.p_datos.motivo).toBe('No llegamos');
    expect(rec.p_datos.items).toBeUndefined();
  });

  it('AC-WEB-5 filtrarHistorialWeb por estado', () => {
    const ps = [
      { origen: 'web', webEstado: 'por_revisar', fecha: '2026-10-14' },
      { origen: 'web', webEstado: 'aceptado', fecha: '2026-10-13' },
      { origen: 'web', webEstado: 'rechazado', fecha: '2026-10-12' },
      { estado: 'pendiente', fecha: '2026-10-14' },
      { origen: 'web', webEstado: 'rechazado', borrado: true },
    ];
    expect(filtrarHistorialWeb(ps, 'todos').length).toBe(3);
    expect(filtrarHistorialWeb(ps, 'rechazado').length).toBe(1);
    expect(filtrarHistorialWeb(ps, 'por_revisar')[0].fecha).toBe('2026-10-14');
    expect(filtrarHistorialWeb(null)).toEqual([]);
  });

  it('AC-WEB-2 armarItemsAceptar: recalcula total, congela bultos y avisa no múltiplos sin bloquear al admin', () => {
    const prods = new Map([['1', { id: 1, nombre: 'Dos Corazones', precio: 900, ventaPor: 'bulto', bultoX: 16, bultoNombre: 'Display' }]]);
    const ok = armarItemsAceptar([{ productoId: 1, nombre: 'Dos Corazones', cantidad: 48, precio: 900 }, { productoId: 2, cantidad: 0, precio: 5 }], prods);
    expect(ok.items).toHaveLength(1);
    expect(ok.items[0]).toMatchObject({ cantidad: 48, subtotal: 43200, bultos: 3, bultoX: 16, bultoNombre: 'Display' });
    expect(ok.total).toBe(43200);
    expect(ok.avisos).toEqual([]);
    const raro = armarItemsAceptar([{ productoId: 1, nombre: 'Dos Corazones', cantidad: 20, precio: 900 }], prods);
    expect(raro.avisos).toHaveLength(1);
    expect(raro.bloquea).toBe(false);
    expect(armarItemsAceptar(null).total).toBe(0);
  });
});
