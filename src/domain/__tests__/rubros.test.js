// REQ-COMR (RUN 20261014-1449): dominio de rubros y de la tabla de % por
// vendedor y rubro (src/domain/rubros.js).
import {
  ACENTOS_DESDE, ACENTOS_HASTA, normalizarRubro, claveRubro, listarRubros, resolverRubro, rubroDeProducto,
  rubroDeRenglon, validarPctRubro, indexarTablaRubros, pctDe, upsertPctLocal, filasGrillaVendedor,
  filaRubroToRemote, filaRubroFromRemote, mezclarTablaRubros, interpretarGuardarRubros, vendedorIdPorNombre,
  esFaltaMigracionRpc, MSG_PCT_INVALIDO, MENSAJES_RUBRO,
} from '../rubros';

describe('AC-COMR-4 normalización y clave de rubro', () => {
  it('AC-COMR-4 "golosinas", "Golosinas " y "GOLOSINAS" son el mismo rubro; espacios dobles se colapsan', () => {
    expect(normalizarRubro('  Golosinas   y   Snacks ')).toBe('Golosinas y Snacks');
    expect(claveRubro('golosinas')).toBe('golosinas');
    expect(claveRubro('Golosinas ')).toBe('golosinas');
    expect(claveRubro('GOLOSINAS')).toBe('golosinas');
  });

  it('AC-COMR-4 tildes y ñ no distinguen: "Lácteos" = "lacteos", "Panadería" = "PANADERIA", "Año" = "ano"', () => {
    expect(claveRubro('Lácteos')).toBe(claveRubro('lacteos'));
    expect(claveRubro('Panadería')).toBe(claveRubro('PANADERIA'));
    expect(claveRubro('ÑOQUIS Año')).toBe('noquis ano');
    expect(claveRubro('Ümlaut Çedilla')).toBe('umlaut cedilla');
  });

  it('AC-COMR-4 NBSP, caracteres de control, números, null, objetos', () => {
    expect(normalizarRubro('Bebidas  frías')).toBe('Bebidas frías');
    expect(normalizarRubro('A\u0000B\nC\u007F')).toBe('A B C');
    expect(normalizarRubro(123)).toBe('123');
    expect(normalizarRubro(null)).toBe('');
    expect(normalizarRubro(undefined)).toBe('');
    expect(normalizarRubro({ a: 1 })).toBe('');
    expect(normalizarRubro(['x'])).toBe('');
    expect(normalizarRubro(NaN)).toBe('');
    expect(normalizarRubro('x'.repeat(80))).toHaveLength(60);
    expect(claveRubro('   ')).toBe('');
  });

  it('AC-COMR-4 la tabla de acentos es simétrica (mismo largo) y solo mapea a ASCII', () => {
    expect([...ACENTOS_DESDE]).toHaveLength([...ACENTOS_HASTA].length);
    expect(ACENTOS_HASTA).toMatch(/^[A-Za-z]+$/);
  });
});

describe('AC-COMR-3 AC-COMR-4 lista y dedupe de rubros', () => {
  const PRODUCTOS = [
    { id: 3, categoria: 'GOLOSINAS', createdAt: 300 },
    { id: 1, categoria: 'Golosinas', createdAt: 100 },
    { id: 2, categoria: 'bebidas', createdAt: 200 },
    { id: 4, categoria: '  ', createdAt: 50 },
    { id: 5, categoria: 'Lácteos' },
    { id: 6, categoria: 'lacteos' },
    null,
    'basura',
  ];

  it('AC-COMR-3 rubros distintos, ordenados alfabéticamente, sin vacíos; escritura del producto más viejo', () => {
    expect(listarRubros(PRODUCTOS)).toEqual(['bebidas', 'Golosinas', 'Lácteos']);
  });

  it('AC-COMR-3 empate de antigüedad: gana el id menor; extras se suman sin duplicar', () => {
    expect(listarRubros([{ id: 'b', categoria: 'ZZ' }, { id: 'a', categoria: 'zz' }])).toEqual(['zz']);
    expect(listarRubros([{ id: 1, categoria: 'Bebidas' }], ['BEBIDAS', 'Almacén', '', null])).toEqual(['Almacén', 'Bebidas']);
    expect(listarRubros(null, null)).toEqual([]);
  });

  it('AC-COMR-4 resolverRubro reutiliza la escritura existente o marca el nuevo', () => {
    const existentes = ['Golosinas', 'Bebidas'];
    expect(resolverRubro('GOLOSINAS ', existentes)).toEqual({ rubro: 'Golosinas', clave: 'golosinas', esNuevo: false });
    expect(resolverRubro('  almacén  ', existentes)).toEqual({ rubro: 'almacén', clave: 'almacen', esNuevo: true });
    expect(resolverRubro('', existentes)).toEqual({ rubro: '', clave: '', esNuevo: false });
    expect(resolverRubro('X', null)).toEqual({ rubro: 'X', clave: 'x', esNuevo: true });
    expect(rubroDeProducto({ categoria: ' Bebidas ' })).toBe('Bebidas');
    expect(rubroDeProducto(null)).toBe('');
  });
});

describe('AC-COMR-5 rubro de un renglón', () => {
  const productos = new Map([['1', { id: 1, categoria: 'Golosinas' }], ['2', { id: 2, categoria: '' }]]);

  it('AC-COMR-5 renglón con rubro guardado: manda el guardado aunque el producto haya cambiado', () => {
    expect(rubroDeRenglon({ productoId: 1, rubro: ' Bebidas ' }, productos)).toEqual({ rubro: 'Bebidas', clave: 'bebidas', origen: 'renglon' });
  });

  it('AC-COMR-5 renglón viejo sin rubro: usa el rubro actual del producto', () => {
    expect(rubroDeRenglon({ productoId: 1 }, productos)).toEqual({ rubro: 'Golosinas', clave: 'golosinas', origen: 'producto' });
    expect(rubroDeRenglon({ productoId: '1', rubro: '' }, productos).origen).toBe('producto');
  });

  it('AC-COMR-5 producto borrado, producto sin rubro, renglón sin producto', () => {
    expect(rubroDeRenglon({ productoId: 99 }, productos)).toEqual({ rubro: '', clave: '', origen: 'producto_borrado' });
    expect(rubroDeRenglon({ productoId: 2 }, productos)).toEqual({ rubro: '', clave: '', origen: 'sin_rubro' });
    expect(rubroDeRenglon({ nombre: 'x' }, productos).origen).toBe('sin_rubro');
    expect(rubroDeRenglon(null, productos).origen).toBe('sin_rubro');
    expect(rubroDeRenglon({ productoId: 1 }, null).origen).toBe('producto_borrado');
    expect(rubroDeRenglon({ productoId: 1, rubro: { x: 1 } }, productos).origen).toBe('producto');
  });
});

describe('AC-COMR-6 validación del % de la tabla', () => {
  it.each([
    [0, 0], [100, 100], ['0', 0], ['100', 100], ['5,5', 5.5], ['5.25', 5.25], ['10,25', 10.25], [' 7 ', 7], [12.34, 12.34],
  ])('AC-COMR-6 %p es válido => %p', (v, pct) => {
    expect(validarPctRubro(v)).toEqual({ ok: true, pct, error: null });
  });

  it.each([
    ['', null], ['   ', null], [null, null], [undefined, null],
  ])('AC-COMR-6 vacío (%p) => sin % (null)', (v) => {
    expect(validarPctRubro(v)).toEqual({ ok: true, pct: null, error: null });
  });

  it.each([
    [100.01], ['100.01'], ['100,01'], [-1], ['-1'], ['abc'], ['5,555'], ['1.000'], [1.234], [NaN], [Infinity], [{}], [[]], [true], ['5%'], ['1e2'], ['1000'],
  ])('AC-COMR-6 %p es inválido', (v) => {
    expect(validarPctRubro(v)).toEqual({ ok: false, pct: null, error: MSG_PCT_INVALIDO });
  });
});

describe('AC-COMR-7 AC-COMR-8 tabla de % local', () => {
  const genId = (() => { let n = 0; return () => `uuid-${++n}`; })();
  const FILAS = [
    { id: 'a', vendedorId: '7', rubro: 'Golosinas', rubroClave: 'golosinas', pct: 5, editadoAt: 10 },
    { id: 'b', vendedorId: '7', rubro: 'golosinas', pct: 6, editadoAt: 20 },
    { id: 'c', vendedorId: '7', rubro: 'Bebidas', rubroClave: 'bebidas', pct: null, editadoAt: 5 },
    { id: 'd', vendedorId: '7', rubro: 'Viejo', rubroClave: 'viejo', pct: 9, obsoleto: true },
    { id: 'e', vendedorId: '8', rubro: 'Golosinas', rubroClave: 'golosinas', pct: 3, syncRechazo: 'vendedor_inactivo' },
    { id: 'f', vendedorId: '', rubro: 'X', pct: 1 },
    null,
  ];

  it('AC-COMR-7 indexar: ignora obsoletas y rechazadas; si hay dos para la misma clave gana el editadoAt mayor', () => {
    const idx = indexarTablaRubros(FILAS);
    expect([...idx.keys()]).toEqual(['7']);
    expect(idx.get('7').get('golosinas').id).toBe('b');
    expect(pctDe(idx, '7', 'golosinas')).toBe(6);
    expect(pctDe(idx, '7', 'bebidas')).toBeNull();
    expect(pctDe(idx, '7', 'viejo')).toBeNull();
    expect(pctDe(idx, 7, 'golosinas')).toBe(6);
    expect(pctDe(idx, '9', 'golosinas')).toBeNull();
    expect(pctDe(null, '7', 'golosinas')).toBeNull();
    expect(indexarTablaRubros(FILAS, { incluirRechazadas: true }).get('8').get('golosinas').id).toBe('e');
    expect(indexarTablaRubros(undefined).size).toBe(0);
    // un % inválido guardado cuenta como sin %
    expect(pctDe(indexarTablaRubros([{ id: 'z', vendedorId: '1', rubro: 'R', pct: 500 }]), '1', 'r')).toBeNull();
  });

  it('AC-COMR-7 upsertPctLocal reutiliza el id de la misma (vendedor, rubro) y pone pendingSync', () => {
    const r = upsertPctLocal(FILAS, { vendedorId: '7', vendedorNombre: 'Carlos', rubro: 'GOLOSINAS', pct: '7,5', editadoPor: 'Jorge' }, { now: 99, genId });
    expect(r.ok).toBe(true);
    expect(r.nueva).toBe(false);
    expect(['a', 'b']).toContain(r.fila.id);
    expect(r.fila).toMatchObject({ vendedorId: '7', rubroClave: 'golosinas', clave: '7|golosinas', pct: 7.5, editadoAt: 99, editadoPor: 'Jorge', pendingSync: true, syncRechazo: null });
    const n = upsertPctLocal(FILAS, { vendedorId: '7', rubro: 'Almacén', pct: '' }, { now: 1, genId });
    expect(n).toMatchObject({ ok: true, nueva: true });
    expect(n.fila).toMatchObject({ id: 'uuid-1', rubro: 'Almacén', rubroClave: 'almacen', pct: null });
    // por defecto usa crypto.randomUUID (nuevoId)
    expect(upsertPctLocal([], { vendedorId: '7', rubro: 'Z', pct: 1 }).fila.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('AC-COMR-6 AC-COMR-8 upsertPctLocal valida vendedor sincronizado, rubro y %', () => {
    expect(upsertPctLocal(FILAS, { vendedorId: '', rubro: 'X', pct: 1 })).toMatchObject({ ok: false, error: expect.stringMatching(/sincronizado/) });
    expect(upsertPctLocal(FILAS, { vendedorId: '7', rubro: '  ', pct: 1 })).toMatchObject({ ok: false, error: 'Falta el rubro' });
    expect(upsertPctLocal(FILAS, { vendedorId: '7', rubro: 'X', pct: '100,01' })).toMatchObject({ ok: false, error: MSG_PCT_INVALIDO });
    expect(upsertPctLocal(FILAS, null)).toMatchObject({ ok: false });
    expect(upsertPctLocal(null, { vendedorId: '7', rubro: 'X', pct: 1 }, { genId: () => 'n' })).toMatchObject({ ok: true, nueva: true });
  });

  it('AC-COMR-6 filasGrillaVendedor: todos los rubros existentes + los de su tabla, en orden', () => {
    const filas = [
      { id: 'a', vendedorId: '7', rubro: 'Golosinas', pct: 5, pendingSync: true },
      { id: 'x', vendedorId: '7', rubro: 'Discontinuado', pct: 2, syncRechazo: 'vendedor_inactivo' },
      { id: 'y', vendedorId: '8', rubro: 'Bebidas', pct: 9 },
    ];
    const g = filasGrillaVendedor({ vendedorId: '7', rubros: ['Bebidas', 'golosinas', ''], filas });
    expect(g).toEqual([
      { rubro: 'Bebidas', clave: 'bebidas', pct: null, filaId: null, pendiente: false, rechazo: null },
      { rubro: 'Discontinuado', clave: 'discontinuado', pct: 2, filaId: 'x', pendiente: false, rechazo: 'vendedor_inactivo' },
      { rubro: 'golosinas', clave: 'golosinas', pct: 5, filaId: 'a', pendiente: true, rechazo: null },
    ]);
    expect(filasGrillaVendedor({ vendedorId: '', rubros: ['A'], filas })).toEqual([{ rubro: 'A', clave: 'a', pct: null, filaId: null, pendiente: false, rechazo: null }]);
    expect(filasGrillaVendedor()).toEqual([]);
    expect(filasGrillaVendedor({ vendedorId: '1', filas: [{ id: 'q', vendedorId: '1', rubro: 'R', pct: 'malo' }] })[0].pct).toBeNull();
  });
});

describe('AC-COMR-7 mapeo y mezcla con el servidor', () => {
  it('AC-COMR-7 filaRubroToRemote / filaRubroFromRemote', () => {
    expect(filaRubroToRemote({ id: 'a', vendedorId: 7, rubro: ' Golosinas ', pct: 5.5, editadoAt: 0 })).toEqual({
      id: 'a', vendedor_id: '7', rubro: 'Golosinas', rubro_clave: 'golosinas', pct: 5.5, editado_at: '1970-01-01T00:00:00.000Z',
    });
    const sinFecha = filaRubroToRemote({ id: 'b', vendedorId: '1', rubro: 'X', pct: 'malo', editadoAt: 'nunca' });
    expect(sinFecha.pct).toBeNull();
    expect(sinFecha.editado_at).toMatch(/^\d{4}-/);
    expect(filaRubroToRemote(null)).toMatchObject({ id: '', vendedor_id: '', rubro: '' });
    expect(filaRubroFromRemote({ id: 'a', vendedor_id: '7', rubro: 'Golosinas', rubro_clave: 'GOLOSINAS', pct: '5.00', editado_at: '2026-10-14T10:00:00Z', editado_por: 'Jorge' }, { vendedorNombre: 'Carlos' }))
      .toEqual({
        vendedorNombre: 'Carlos', id: 'a', vendedorId: '7', rubro: 'Golosinas', rubroClave: 'golosinas', clave: '7|golosinas',
        pct: 5, editadoAt: Date.parse('2026-10-14T10:00:00Z'), editadoPor: 'Jorge', pendingSync: false, obsoleto: false, syncRechazo: null,
      });
    const r = filaRubroFromRemote({ id: 'b', vendedor_id: '7', rubro: 'Bebidas', pct: null, editado_at: 'no' }, { editadoAt: 4, editadoPor: 'X' });
    expect(r).toMatchObject({ rubroClave: 'bebidas', pct: null, editadoAt: 4, editadoPor: 'X' });
    expect(filaRubroFromRemote({ id: 'c', vendedor_id: '1', rubro: 'R', editado_at: 1000 })).toMatchObject({ editadoAt: 1000, editadoPor: '' });
    expect(filaRubroFromRemote(null).id).toBe('');
  });

  it('AC-COMR-7 mezclar: no pisa locales pendientes, guarda las remotas y marca obsoletas (sin borrar) las duplicadas', () => {
    const locales = [
      { id: 'pend', vendedorId: '7', rubro: 'Golosinas', pct: 9, pendingSync: true },
      { id: 'dup', vendedorId: '7', rubro: 'BEBIDAS', pct: 1 },
      { id: 'igual', vendedorId: '7', rubro: 'Lácteos', pct: 2 },
      { id: 'ya-obs', vendedorId: '7', rubro: 'Bebidas', obsoleto: true },
    ];
    const remotos = [
      { id: 'pend', vendedor_id: '7', rubro: 'Golosinas', rubro_clave: 'golosinas', pct: 5 },
      { id: 'canon', vendedor_id: '7', rubro: 'Bebidas', rubro_clave: 'bebidas', pct: 3 },
      { id: 'igual', vendedor_id: '7', rubro: 'Lácteos', rubro_clave: 'lacteos', pct: 4 },
      { id: '', vendedor_id: '7', rubro: 'X' },
      { id: 'sinvend', vendedor_id: '', rubro: 'X' },
      null,
    ];
    const { aGuardar, obsoletos } = mezclarTablaRubros(locales, remotos);
    expect(aGuardar.map(f => [f.id, f.pct])).toEqual([['canon', 3], ['igual', 4]]);
    expect(obsoletos).toEqual([{ id: 'dup', vendedorId: '7', rubro: 'BEBIDAS', pct: 1, obsoleto: true }]);
    expect(mezclarTablaRubros(null, null)).toEqual({ aGuardar: [], obsoletos: [] });
  });

  it('AC-COMR-7 interpretar la respuesta de la RPC: aceptadas, rechazadas, falta de migración, PIN, red', () => {
    const ok = interpretarGuardarRubros({ data: {
      ok: true,
      filas: [{ id_enviado: 'a', id: 'a', vendedor_id: '7', rubro: 'X', rubro_clave: 'x', pct: 1 }, { id: 'b', vendedor_id: '7', rubro: 'Y' }, null, {}],
      rechazadas: [{ id: 'c', motivo: 'vendedor_inactivo' }, { id: 'd', motivo: 'raro' }, { motivo: 'x' }],
    } });
    expect(ok.ok).toBe(true);
    expect(ok.aceptados.map(a => [a.idEnviado, a.fila.id])).toEqual([['a', 'a'], ['b', 'b']]);
    expect(ok.rechazados).toEqual([
      { id: 'c', motivo: 'vendedor_inactivo', mensaje: MENSAJES_RUBRO.vendedor_inactivo },
      { id: 'd', motivo: 'fila_invalida', mensaje: MENSAJES_RUBRO.fila_invalida },
    ]);
    expect(interpretarGuardarRubros({ data: { ok: true } })).toMatchObject({ ok: true, aceptados: [], rechazados: [] });
    expect(interpretarGuardarRubros({ error: { code: 'PGRST202' } })).toMatchObject({ ok: false, motivo: 'falta_migracion', mensaje: expect.stringMatching(/005/) });
    expect(interpretarGuardarRubros({ error: { code: 'P0001', message: 'Demasiados intentos' } })).toMatchObject({ motivo: 'pin_bloqueado' });
    expect(interpretarGuardarRubros({ error: { message: 'Failed to fetch' } })).toMatchObject({ motivo: 'red' });
    expect(interpretarGuardarRubros({ error: { code: '23514', message: 'check' } })).toMatchObject({ ok: false, motivo: 'error', mensaje: expect.stringMatching(/check/) });
    expect(interpretarGuardarRubros({ data: { ok: false, motivo: 'no_autorizado' } })).toMatchObject({ motivo: 'no_autorizado' });
    // Cualquier respuesta rara se trata como no autorizado
    expect(interpretarGuardarRubros({ data: 'ok' })).toMatchObject({ ok: false, motivo: 'no_autorizado' });
    expect(interpretarGuardarRubros({ data: { ok: false, motivo: '<script>' } })).toMatchObject({ motivo: 'no_autorizado' });
    expect(interpretarGuardarRubros()).toMatchObject({ ok: false, motivo: 'no_autorizado' });
    expect(esFaltaMigracionRpc({ message: 'Could not find the function public.x' })).toBe(true);
    expect(esFaltaMigracionRpc(null)).toBe(false);
  });
});

describe('AC-COMR-8 identidad estable del vendedor (remoteId)', () => {
  const VENDEDORES = [
    { id: 1, remoteId: 70, nombre: 'Carlos Pérez' },
    { id: 2, remoteId: 'uuid-ana', nombre: 'Ana', activo: false },
    { id: 3, nombre: 'Local sin sincronizar' },
    { id: 4, remoteId: '', nombre: 'Vacío' },
  ];

  it('AC-COMR-8 busca por nombre (sin tildes ni mayúsculas) y devuelve String(remoteId); incluye dados de baja', () => {
    expect(vendedorIdPorNombre('carlos perez', VENDEDORES)).toBe('70');
    expect(vendedorIdPorNombre('  ANA ', VENDEDORES)).toBe('uuid-ana');
  });

  it('AC-COMR-8 renombrado (nombre viejo), sin remoteId o vacío => null', () => {
    expect(vendedorIdPorNombre('Carlos', VENDEDORES)).toBeNull();
    expect(vendedorIdPorNombre('Local sin sincronizar', VENDEDORES)).toBeNull();
    expect(vendedorIdPorNombre('Vacío', VENDEDORES)).toBeNull();
    expect(vendedorIdPorNombre('', VENDEDORES)).toBeNull();
    expect(vendedorIdPorNombre('Ana', null)).toBeNull();
  });
});
