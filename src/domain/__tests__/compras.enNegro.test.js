// REQ-NEG: compras "En negro" (tipo N) en el dominio de compras y en la migración 017.
import fs from 'fs';
import path from 'path';
import {
  normalizarTipoCompra, normalizarTipoAB, validarCostosIngreso, subtotalesIngreso, filtrarHistorial,
  totalesHistorial, ingresosPorProducto, costosFromRemote, ETIQUETA_TIPO_COMPRA,
} from '../compras';

const ingreso = (o = {}) => ({
  id: 'i1', proveedorId: 'p1', proveedorNombre: 'Prov', facturaProveedor: 'S/F', fecha: '2026-10-10T15:00:00.000Z',
  items: [{ productoId: '1', descripcion: 'Uno', ingreso: 10 }, { productoId: '2', descripcion: 'Dos', ingreso: 5 }], ...o,
});

describe('REQ-NEG dominio', () => {
  it('AC-NEG-1 normaliza "En negro" a N; A/B siguen igual y la rendición sigue solo A/B', () => {
    for (const v of ['N', 'n', 'negro', 'En negro', ' EN NEGRO ']) expect(normalizarTipoCompra(v)).toBe('N');
    expect(normalizarTipoCompra('factura a')).toBe('A');
    expect(normalizarTipoCompra('C')).toBeNull();
    expect(normalizarTipoCompra(null)).toBeNull();
    expect(normalizarTipoAB('N')).toBeNull();
    expect(ETIQUETA_TIPO_COMPRA.N).toBe('En negro');
  });

  it('AC-NEG-1 validarCostosIngreso acepta N en cabecera y renglón, y rechaza otro tipo con error en el campo', () => {
    const r = validarCostosIngreso({ tipoCabecera: 'N', items: [{ productoId: '1', costoUnitario: '10' }, { productoId: '2', costoUnitario: '4', tipoFactura: 'A' }] }, { ingreso: ingreso() });
    expect(r.ok).toBe(true);
    expect(r.costos.tipoCabecera).toBe('N');
    expect(r.costos.renglones.map(x => x.tipoFactura)).toEqual(['N', 'A']);
    const mal = validarCostosIngreso({ tipoCabecera: 'X' }, { ingreso: ingreso() });
    expect(mal.errores.tipoCabecera).toMatch(/En negro/);
  });

  it('AC-NEG-2 subtotales, historial filtrado por N, totales y vista por producto', () => {
    const costos = { id: 'i1', tipoCabecera: 'N', renglones: [
      { productoId: '1', costoUnitario: 10, tipoFactura: 'N', unidades: 10 },
      { productoId: '2', costoUnitario: 4, tipoFactura: 'A', unidades: 5 }] };
    const s = subtotalesIngreso(ingreso(), costos);
    expect(s.N).toEqual({ unidades: 10, costoCentavos: 10000 });
    expect(s.A).toEqual({ unidades: 5, costoCentavos: 2000 });
    expect(s.total).toEqual({ unidades: 15, costoCentavos: 12000 });
    const map = new Map([['i1', costos]]);
    const soloN = filtrarHistorial([ingreso()], map, { tipo: 'N' });
    expect(soloN).toHaveLength(1);
    expect(soloN[0].subtotales.A.unidades).toBe(0);
    expect(soloN[0].subtotales.total).toEqual({ unidades: 10, costoCentavos: 10000 });
    expect(filtrarHistorial([ingreso({ id: 'i2' })], map, { tipo: 'N' })).toHaveLength(0);
    const tot = totalesHistorial(filtrarHistorial([ingreso()], map));
    expect(tot.N).toEqual({ unidades: 10, costoCentavos: 10000 });
    // Filas armadas antes de REQ-NEG (sin N) no rompen los totales.
    const vieja = { subtotales: { A: { unidades: 1, costoCentavos: 1 }, B: { unidades: 0, costoCentavos: 0 }, sinDato: { unidades: 0 }, total: { unidades: 1, costoCentavos: 1 } } };
    expect(totalesHistorial([vieja]).N.unidades).toBe(0);
    expect(ingresosPorProducto([ingreso()], map, '1')[0].tipo).toBe('N');
    expect(costosFromRemote({ ingreso_id: 'i1', tipo_cabecera: 'N', renglones: [{ producto_id: '1', tipo_factura: 'N', unidades: 1 }] }).renglones[0].tipoFactura).toBe('N');
  });

  it('AC-NEG-2 ingresos viejos sin tipo siguen como "sin dato"', () => {
    const s = subtotalesIngreso(ingreso(), null);
    expect(s.sinDato.unidades).toBe(15);
    expect(s.N).toEqual({ unidades: 0, costoCentavos: 0 });
  });
});

describe('REQ-NEG migración 017', () => {
  const MIG = path.join(__dirname, '..', '..', '..', 'supabase', 'migrations');
  const sql = fs.readFileSync(path.join(MIG, '017_compras_en_negro.sql'), 'utf8').replace(/\r\n/g, '\n');
  const codigo = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  const cuerpo = (s) => { const i = s.indexOf('create or replace function public.admin_compras_guardar'); return s.slice(i, s.indexOf('end $$;', i)); };

  it('AC-NEG-3 la tabla y admin_compras_guardar aceptan N; misma firma, PIN y grants que la 012', () => {
    expect(codigo).toMatch(/check \(tipo_cabecera in \('A','B','N'\)\)/);
    expect(codigo).toMatch(/v_fila->>'tipo_cabecera', ''\) not in \('A','B','N'\)/);
    expect(codigo).toMatch(/v_ren->>'tipo_factura', ''\) not in \('A','B','N'\)/);
    expect(codigo).not.toMatch(/not in \('A','B'\)/);
    expect(codigo).toMatch(/create or replace function public\.admin_compras_guardar\(p_admin_id text, p_admin_pin text, p_lote jsonb\)/);
    expect(codigo).toMatch(/security definer set search_path = public, pg_temp/);
    expect(codigo.indexOf('_es_admin_con_pin(p_admin_id, p_admin_pin)')).toBeGreaterThan(0);
    expect(codigo).toMatch(/grant execute on function public\.admin_compras_guardar\(text, text, jsonb\) to anon, authenticated/);
    expect(codigo).not.toMatch(/drop table|drop column|truncate|delete from/i);
  });

  it('AC-NEG-3 la función es la de la 012 con el único cambio de N', () => {
    const f012 = fs.readFileSync(path.join(MIG, '012_lote_operacion_compras_stock.sql'), 'utf8').replace(/\r\n/g, '\n');
    expect(cuerpo(sql).replace(/,'N'\)/g, ')')).toBe(cuerpo(f012));
  });
});
