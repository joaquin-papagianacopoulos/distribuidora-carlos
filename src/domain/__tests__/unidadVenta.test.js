// REQ-VTA (AC-VTA-2/3/4): funciones puras de unidad de venta.
import {
  ventaPorPorDefecto, ventaPorEfectivo, normalizarVentaPor, normalizarBultoNombre, parsearBooleano,
  validarUnidadVenta, unidadesDeBultos, bultosDeUnidades, precioBulto, importeBultos, esMultiploDeBulto,
  cantidadInicialRenglon, pasoCantidad, avisoMultiplo, puedeGuardarNoMultiplo, validarMultiplosItems,
  congelarBultosRenglon, congelarBultosItems, textoRenglonBultos, MSG_BULTO_SIN_BULTOX,
} from '../unidadVenta';
import { MAX_CANTIDAD } from '../stock';
import { renglonNuevo, etiquetaBotonBulto } from '../bultos';

const DOS_CORAZONES = { id: 'dc', nombre: 'Dos Corazones', precio: 900, bultoX: 16, ventaPor: 'bulto', bultoNombre: 'Display' };

describe('AC-VTA-4 caso de referencia Dos Corazones', () => {
  it('AC-VTA-4 1 Display = 16 u. x $900 = $14.400', () => {
    expect(importeBultos(1, 16, 900)).toEqual({ unidades: 16, importe: 14400 });
    expect(precioBulto(900, 16)).toBe(14400);
  });
  it('AC-VTA-4 3 Display = 48 u. = $43.200', () => {
    expect(importeBultos(3, 16, 900)).toEqual({ unidades: 48, importe: 43200 });
    expect(unidadesDeBultos(3, 16)).toBe(48);
    expect(bultosDeUnidades(48, 16)).toEqual({ bultos: 3, sueltas: 0 });
  });
  it('AC-VTA-4 el renglon guarda la cantidad en unidades y congela bultos (AC-VTA-2)', () => {
    const item = { productoId: 'dc', nombre: 'Dos Corazones', precio: 900, cantidad: 48 };
    const r = congelarBultosRenglon(item, DOS_CORAZONES);
    expect(r).toMatchObject({ cantidad: 48, bultos: 3, bultoX: 16, bultoNombre: 'Display' });
    expect(textoRenglonBultos(r)).toBe('3 Display (48 u.)');
    expect(textoRenglonBultos(congelarBultosRenglon({ ...item, cantidad: 16 }, DOS_CORAZONES))).toBe('1 Display (16 u.)');
  });
});

describe('AC-VTA-4 defaults de ventaPor', () => {
  it.each([
    [12, 'ambos'], ['12', 'ambos'], [2, 'ambos'],
    [1, 'unidad'], [0, 'unidad'], ['', 'unidad'], [null, 'unidad'], [undefined, 'unidad'],
    [2.5, 'unidad'], ['abc', 'unidad'], [-3, 'unidad'], [NaN, 'unidad'], [{}, 'unidad'],
  ])('AC-VTA-4 ventaPorPorDefecto(%p) = %p', (bx, esperado) => {
    expect(ventaPorPorDefecto(bx)).toBe(esperado);
  });
  it('AC-VTA-4 ventaPorEfectivo: producto viejo sin campo deriva del bultoX', () => {
    expect(ventaPorEfectivo({ bultoX: 12 })).toBe('ambos');
    expect(ventaPorEfectivo({ bultoX: 1 })).toBe('unidad');
    expect(ventaPorEfectivo(null)).toBe('unidad');
    expect(ventaPorEfectivo(undefined)).toBe('unidad');
  });
  it('AC-VTA-4 ventaPorEfectivo respeta el valor guardado y degrada "bulto" inconsistente', () => {
    expect(ventaPorEfectivo({ ventaPor: 'unidad', bultoX: 12 })).toBe('unidad');
    expect(ventaPorEfectivo(DOS_CORAZONES)).toBe('bulto');
    expect(ventaPorEfectivo({ ventaPor: 'bulto', bultoX: 1 })).toBe('unidad');
    expect(ventaPorEfectivo({ ventaPor: 'BULTO', bultoX: 6 })).toBe('bulto');
    expect(ventaPorEfectivo({ ventaPor: 'cualquiera', bultoX: 6 })).toBe('ambos');
  });
  it('AC-VTA-4 normalizarVentaPor / normalizarBultoNombre / parsearBooleano', () => {
    expect(normalizarVentaPor(' Ambos ')).toBe('ambos');
    expect(normalizarVentaPor('x')).toBeNull();
    expect(normalizarBultoNombre('display')).toBe('Display');
    expect(normalizarBultoNombre('CAJA')).toBe('Caja');
    expect(normalizarBultoNombre('Palet')).toBe('Bulto');
    expect(normalizarBultoNombre(null)).toBe('Bulto');
    expect(['Sí', 'si', 'TRUE', '1', 'x', true, 1].map(parsearBooleano)).toEqual(Array(7).fill(true));
    expect(['No', 'false', '0', false, 0].map(parsearBooleano)).toEqual(Array(5).fill(false));
    expect(['', null, undefined, 'tal vez', 7].map(parsearBooleano)).toEqual(Array(5).fill(null));
  });
});

describe('AC-VTA-4 validarUnidadVenta (AC-VTA-1)', () => {
  it('AC-VTA-1 "bulto" con bultoX <= 1, vacio, 0, decimal o texto se rechaza con error en el campo', () => {
    for (const bx of [1, 0, '', null, undefined, 2.5, 'abc']) {
      const r = validarUnidadVenta({ ventaPor: 'bulto', bultoX: bx });
      expect(r.ok).toBe(false);
      expect(r.errores.ventaPor).toBe(MSG_BULTO_SIN_BULTOX);
    }
  });
  it('AC-VTA-1 "bulto" con bultoX > 1 es valido', () => {
    expect(validarUnidadVenta({ ventaPor: 'bulto', bultoX: 16 }).ok).toBe(true);
  });
  it('AC-VTA-1 vacio usa el default y los demas campos se normalizan', () => {
    expect(validarUnidadVenta({ bultoX: 12 }).valor).toEqual({ ventaPor: 'ambos', bultoNombre: 'Bulto', visibleTienda: true });
    expect(validarUnidadVenta({ bultoX: 1, bultoNombre: 'pack', visibleTienda: 'No' }).valor).toEqual({ ventaPor: 'unidad', bultoNombre: 'Pack', visibleTienda: false });
  });
  it('AC-VTA-1 un valor desconocido de ventaPor da error', () => {
    const r = validarUnidadVenta({ ventaPor: 'docena', bultoX: 12 });
    expect(r.ok).toBe(false);
    expect(r.errores.ventaPor).toBeTruthy();
  });
});

describe('AC-VTA-4 unidades, bultos y precios', () => {
  it('AC-VTA-4 unidadesDeBultos: entradas invalidas => null', () => {
    for (const [b, bx] of [[0, 16], [-1, 16], [1.5, 16], ['x', 16], [null, 16], [NaN, 16], [1, 1], [1, 0], [1, ''], [1, 2.5], [1, 'abc'], [1, null]]) {
      expect(unidadesDeBultos(b, bx)).toBeNull();
    }
  });
  it('AC-VTA-4 unidadesDeBultos respeta MAX_CANTIDAD (totales grandes)', () => {
    expect(unidadesDeBultos(1000, 1000)).toBe(1000000);
    expect(unidadesDeBultos(1001, 1000)).toBeNull();
    expect(MAX_CANTIDAD).toBe(1000000);
    expect(unidadesDeBultos(Number.MAX_SAFE_INTEGER, 16)).toBeNull();
  });
  it('AC-VTA-4 bultosDeUnidades con sueltas e invalidos', () => {
    expect(bultosDeUnidades(50, 16)).toEqual({ bultos: 3, sueltas: 2 });
    expect(bultosDeUnidades(5, 16)).toEqual({ bultos: 0, sueltas: 5 });
    expect(bultosDeUnidades(-1, 16)).toBeNull();
    expect(bultosDeUnidades(2.5, 16)).toBeNull();
    expect(bultosDeUnidades('x', 16)).toBeNull();
    expect(bultosDeUnidades(10, 1)).toBeNull();
  });
  it('AC-VTA-4 precioBulto con centavos y redondeo', () => {
    expect(precioBulto(12.345, 7)).toBe(86.45); // 1235 centavos x 7 = 8645
    expect(precioBulto(0.1, 3)).toBe(0.3);
    expect(precioBulto(0.1 + 0.2, 10)).toBe(3);
    expect(precioBulto('900,50', 2)).toBe(1801);
  });
  it('AC-VTA-4 precioBulto: entradas invalidas o sin bulto => null', () => {
    for (const [p, bx] of [[900, 1], [900, 0], [900, ''], [900, 2.5], [900, 'abc'], [-1, 16], ['abc', 16], [null, 16], [NaN, 16], [Infinity, 16], [undefined, 16]]) {
      expect(precioBulto(p, bx)).toBeNull();
    }
  });
  it('AC-VTA-4 importeBultos: invalidos => null', () => {
    expect(importeBultos(0, 16, 900)).toBeNull();
    expect(importeBultos(2, 16, 'abc')).toBeNull();
    expect(importeBultos(2, 1, 900)).toBeNull();
    expect(importeBultos(2, 16, -5)).toBeNull();
  });
  it('AC-VTA-4 esMultiploDeBulto', () => {
    expect(esMultiploDeBulto(48, 16)).toBe(true);
    expect(esMultiploDeBulto(20, 16)).toBe(false);
    expect(esMultiploDeBulto(0, 16)).toBe(false);
    expect(esMultiploDeBulto(16, 1)).toBe(false);
    expect(esMultiploDeBulto('x', 16)).toBe(false);
    expect(esMultiploDeBulto(16, '')).toBe(false);
    expect(esMultiploDeBulto(16.5, 16)).toBe(false);
  });
});

describe('AC-VTA-3 cantidad inicial, paso y avisos', () => {
  it('AC-VTA-3 "solo bulto" arranca y se mueve de a bultoX; el resto de a 1 (AC-BUL-9 intacto)', () => {
    expect(cantidadInicialRenglon(DOS_CORAZONES)).toBe(16);
    expect(pasoCantidad(DOS_CORAZONES)).toBe(16);
    expect(cantidadInicialRenglon({ bultoX: 12 })).toBe(1);
    expect(cantidadInicialRenglon({ ventaPor: 'ambos', bultoX: 12 })).toBe(1);
    expect(pasoCantidad({ ventaPor: 'unidad', bultoX: 12 })).toBe(1);
    expect(pasoCantidad(null)).toBe(1);
    expect(renglonNuevo(DOS_CORAZONES).cantidad).toBe(16);
    expect(renglonNuevo({ id: 1, nombre: 'X', precio: 1, bultoX: 12 }).cantidad).toBe(1);
  });
  it('AC-VTA-3 etiquetaBotonBulto usa el nombre del bulto', () => {
    expect(etiquetaBotonBulto(16, 'Display')).toBe('+ Display (x 16)');
    expect(etiquetaBotonBulto(12)).toBe('+ Bulto (x 12)');
    expect(etiquetaBotonBulto(1, 'Display')).toBeNull();
  });
  it('AC-VTA-3 avisoMultiplo solo para "bulto" con cantidad no multiplo', () => {
    expect(avisoMultiplo(20, DOS_CORAZONES)).toBe('Se vende por Display de 16: 20 u. no es múltiplo');
    expect(avisoMultiplo(32, DOS_CORAZONES)).toBeNull();
    expect(avisoMultiplo(20, { ventaPor: 'ambos', bultoX: 16 })).toBeNull();
    expect(avisoMultiplo(20, { bultoX: 16 })).toBeNull();
    expect(avisoMultiplo(20, null)).toBeNull();
  });
  it('AC-VTA-3 solo el admin en Facturacion puede guardar no multiplos', () => {
    expect(puedeGuardarNoMultiplo(1, 'facturacion')).toBe(true);
    expect(puedeGuardarNoMultiplo(1, 'pedido')).toBe(false);
    expect(puedeGuardarNoMultiplo(1, 'armado')).toBe(false);
    expect(puedeGuardarNoMultiplo(2, 'facturacion')).toBe(false);
    expect(puedeGuardarNoMultiplo(3, 'facturacion')).toBe(false);
    expect(puedeGuardarNoMultiplo(undefined, 'facturacion')).toBe(false);
  });
  it('AC-VTA-3 validarMultiplosItems: vendedor bloquea, admin en Facturacion no, sin cambios se saltea', () => {
    const byId = new Map([['dc', DOS_CORAZONES]]);
    const items = [{ productoId: 'dc', nombre: 'Dos Corazones', cantidad: 20 }];
    const vend = validarMultiplosItems(items, byId, { permiso: 2, pantalla: 'pedido' });
    expect(vend).toMatchObject({ ok: false, bloquea: true });
    expect(vend.avisos[0]).toMatchObject({ productoId: 'dc', cantidad: 20, bultoX: 16 });
    expect(validarMultiplosItems(items, byId, { permiso: 1, pantalla: 'facturacion' })).toMatchObject({ ok: false, bloquea: false });
    expect(validarMultiplosItems(items, byId, { permiso: 1, pantalla: 'armado' }).bloquea).toBe(true);
    // pedido viejo: la cantidad no cambio => no se valida
    expect(validarMultiplosItems(items, byId, { permiso: 2, pantalla: 'pedido', previos: [{ productoId: 'dc', cantidad: 20 }] }).ok).toBe(true);
    // producto desconocido o items invalidos no rompen
    expect(validarMultiplosItems([{ productoId: 'zz', cantidad: 3 }, null, {}], byId, { permiso: 2, pantalla: 'pedido' }).ok).toBe(true);
    expect(validarMultiplosItems(null, byId).ok).toBe(true);
  });
});

describe('AC-VTA-2 congelar bultos en el renglon', () => {
  const item = (c, extra = {}) => ({ productoId: 'dc', nombre: 'Dos Corazones', precio: 900, cantidad: c, ...extra });
  it('AC-VTA-2 nunca toca cantidad y quita lo congelado si deja de ser multiplo', () => {
    const r = congelarBultosRenglon(item(20, { bultos: 1, bultoX: 16, bultoNombre: 'Display' }), DOS_CORAZONES);
    expect(r.cantidad).toBe(20);
    expect(r).not.toHaveProperty('bultos');
    expect(r).not.toHaveProperty('bultoX');
    expect(r).not.toHaveProperty('bultoNombre');
  });
  it('AC-VTA-2 si la cantidad no cambio conserva lo congelado aunque el producto haya cambiado', () => {
    const previo = item(48, { bultos: 3, bultoX: 16, bultoNombre: 'Display' });
    const cambiado = { ...DOS_CORAZONES, bultoX: 12, bultoNombre: 'Caja' };
    const r = congelarBultosRenglon(item(48, { bultos: 3, bultoX: 16, bultoNombre: 'Display' }), cambiado, previo);
    expect(r).toMatchObject({ cantidad: 48, bultos: 3, bultoX: 16, bultoNombre: 'Display' });
  });
  it('AC-VTA-2 producto "unidad", sin bulto o desconocido no congela; "ambos" congela solo si es multiplo exacto', () => {
    expect(congelarBultosRenglon(item(48), { bultoX: 16, ventaPor: 'unidad' })).not.toHaveProperty('bultos');
    expect(congelarBultosRenglon(item(48), { bultoX: 1 })).not.toHaveProperty('bultos');
    expect(congelarBultosRenglon(item(48), undefined)).not.toHaveProperty('bultos');
    expect(congelarBultosRenglon(item(48), { bultoX: 16, ventaPor: 'ambos' })).toMatchObject({ bultos: 3 });
    expect(congelarBultosRenglon(item(50), { bultoX: 16, ventaPor: 'ambos' })).not.toHaveProperty('bultos');
  });
  it('AC-VTA-2 congelarBultosItems usa los previos por productoId', () => {
    const byId = new Map([['dc', DOS_CORAZONES]]);
    const out = congelarBultosItems([item(32), { productoId: 'otro', nombre: 'Otro', cantidad: 3, precio: 1 }], byId, { previos: [] });
    expect(out[0]).toMatchObject({ cantidad: 32, bultos: 2 });
    expect(out[1]).toEqual({ productoId: 'otro', nombre: 'Otro', cantidad: 3, precio: 1 });
    expect(congelarBultosItems(null, byId)).toEqual([]);
  });
  it('AC-VTA-2 textoRenglonBultos: sin campos congelados o invalidos => null', () => {
    expect(textoRenglonBultos(item(48))).toBeNull();
    expect(textoRenglonBultos(null)).toBeNull();
    expect(textoRenglonBultos({ bultos: 0, bultoX: 16 })).toBeNull();
    expect(textoRenglonBultos({ bultos: 3, bultoX: 1 })).toBeNull();
    expect(textoRenglonBultos({ bultos: 3, bultoX: 16 })).toBe('3 Bulto (48 u.)');
  });
});
