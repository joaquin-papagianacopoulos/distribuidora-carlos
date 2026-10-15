// src/pages/stock/IngresoMercaderia.js — REQ-ING (AC-ING-1..6) y REQ-INA (AC-INA-1, 2, 4). Solo admin.
// Cada renglon suma Costo unitario (opcional) y Factura A/B. Los costos NO viajan dentro del ingreso:
// quedan aparte (ingresosCostos) y suben con PIN desde Proveedores. El stock sale solo de los movimientos.
import React, { useMemo, useState } from 'react';
import { registrarIngreso } from '../../services/stockService';
import { stockDe } from '../../domain/stock';
import { subtotalesIngreso } from '../../domain/compras';
import { formatearCentavos } from '../../domain/cuentaProveedores';
import { toInt, toNum } from '../../domain/validacion';
import { normalize } from '../../utils/fuzzy';
import { generarComprobanteIngresoFile } from '../../utils/pdfGen';
import { descargarArchivo } from '../../utils/descargarArchivo';

const TextoSubtotales = ({ s, testid }) => (
  <div data-testid={testid} style={{ fontSize: 13, display: 'grid', gap: 2 }}>
    <div>Factura A: <strong>{s.A.unidades}</strong> u. · {formatearCentavos(s.A.costoCentavos)}</div>
    <div>Factura B: <strong>{s.B.unidades}</strong> u. · {formatearCentavos(s.B.costoCentavos)}</div>
    {s.sinDato.unidades > 0 && <div>Sin dato: <strong>{s.sinDato.unidades}</strong> u.</div>}
    <div style={{ fontWeight: 700 }}>Total: {s.total.unidades} u. · {formatearCentavos(s.total.costoCentavos)}</div>
    {s.renglonesSinCosto > 0 && <div style={{ color: 'var(--text3)' }}>{s.renglonesSinCosto} renglón(es) sin costo</div>}
  </div>
);

const IngresoMercaderia = ({ productos, proveedores, stockMap, usuario, onListo, precarga = null, onConfirmado }) => {
  const [factura, setFactura] = useState('');
  const [proveedorId, setProveedorId] = useState(() => (precarga?.proveedorId ? String(precarga.proveedorId) : ''));
  const [busqueda, setBusqueda] = useState('');
  // [{ productoId, ingreso }] — viene precargado al recibir un pedido al proveedor (AC-CPR-4).
  const [renglones, setRenglones] = useState(() => (precarga?.items || []).map(i => ({ productoId: String(i.productoId), ingreso: String(i.ingreso) })));
  const [tipoCabecera, setTipoCabecera] = useState('');
  const [facturaA, setFacturaA] = useState('');
  const [facturaB, setFacturaB] = useState('');
  const [actualizarCosto, setActualizarCosto] = useState(true);
  const [costos, setCostos] = useState({}); // { [productoId]: { costo, tipo } }
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [ok, setOk] = useState(null);
  const [comprobante, setComprobante] = useState(null);

  const prodById = useMemo(() => new Map(productos.map(p => [String(p.id), p])), [productos]);
  const sugeridos = useMemo(() => {
    const nq = normalize(busqueda.trim());
    if (!nq) return [];
    const exacto = productos.filter(p => normalize(String(p.codigo || '')) === nq);
    const resto = productos.filter(p => !exacto.includes(p) && (normalize(String(p.codigo || '')).includes(nq) || normalize(p.nombre || '').includes(nq)));
    return [...exacto, ...resto].slice(0, 8);
  }, [busqueda, productos]);

  const agregar = (p) => {
    setOk(null);
    setComprobante(null);
    setRenglones(prev => (prev.some(r => r.productoId === String(p.id)) ? prev : [...prev, { productoId: String(p.id), ingreso: '' }]));
    setBusqueda('');
  };
  const setIngreso = (pid, v) => setRenglones(prev => prev.map(r => (r.productoId === pid ? { ...r, ingreso: v } : r)));
  const setCosto = (pid, campo, v) => setCostos(prev => ({ ...prev, [pid]: { ...(prev[pid] || {}), [campo]: v } }));
  const quitar = (pid) => {
    setRenglones(prev => prev.filter(r => r.productoId !== pid));
    setErrores(prev => { const n = { ...prev }; delete n[`item:${pid}`]; return n; });
  };

  const hayCostos = !!(tipoCabecera || facturaA.trim() || facturaB.trim()
    || renglones.some(r => String(costos[r.productoId]?.costo ?? '').trim() !== '' || costos[r.productoId]?.tipo));
  const hayCostoCargado = renglones.some(r => String(costos[r.productoId]?.costo ?? '').trim() !== '');

  // AC-INA-2: subtotales en vivo mientras se carga.
  const previo = useMemo(() => {
    if (!hayCostos || !renglones.length) return null;
    return subtotalesIngreso(
      { items: renglones.map(r => ({ productoId: r.productoId, ingreso: toInt(r.ingreso) || 0 })) },
      {
        tipoCabecera: tipoCabecera || null,
        renglones: renglones.map(r => ({
          productoId: r.productoId,
          costoUnitario: toNum(costos[r.productoId]?.costo),
          tipoFactura: costos[r.productoId]?.tipo || tipoCabecera || null,
        })),
      },
    );
  }, [hayCostos, renglones, costos, tipoCabecera]);

  const confirmar = async () => {
    setGuardando(true);
    setOk(null);
    setComprobante(null);
    try {
      const form = { facturaProveedor: factura, proveedorId, items: renglones };
      if (hayCostos) {
        form.costos = {
          tipoCabecera, facturaA, facturaB, actualizarCosto,
          items: renglones.map(r => ({ productoId: r.productoId, costoUnitario: costos[r.productoId]?.costo ?? '', tipoFactura: costos[r.productoId]?.tipo ?? '' })),
        };
      }
      const r = await registrarIngreso(form, { productos, usuario });
      if (!r.ok) { setErrores(r.errores); return; }
      setErrores({});
      setOk(`Ingreso registrado: ${r.movimientos.length} producto(s), factura ${r.ingreso.facturaProveedor}.`);
      if (r.costos) setComprobante({ ingreso: r.ingreso, subtotales: subtotalesIngreso(r.ingreso, r.costos), actualizados: (r.productosActualizados || []).length });
      setFactura(''); setProveedorId(''); setRenglones([]); setCostos({});
      setTipoCabecera(''); setFacturaA(''); setFacturaB('');
      if (onConfirmado) await onConfirmado(r, precarga);
      await onListo?.();
    } catch (e) {
      setErrores({ general: e?.message || String(e) });
    } finally {
      setGuardando(false);
    }
  };

  const descargar = async () => {
    if (!comprobante) return;
    descargarArchivo(await generarComprobanteIngresoFile(comprobante.ingreso, comprobante.subtotales));
  };

  const err = (k) => errores[k] && <div role="alert" style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{errores[k]}</div>;

  return (
    <div className="card" data-testid="ingreso-form">
      {precarga?.pedidoProveedorId && (
        <div role="note" style={{ fontSize: 13, marginBottom: 10, color: 'var(--text3)' }} data-testid="aviso-precarga">
          Ingreso precargado desde el pedido al proveedor. Completá la factura y las cantidades reales, y confirmá.
        </div>
      )}
      <div className="input-group">
        <label className="input-label" htmlFor="ing-factura">Factura proveedor *</label>
        <input id="ing-factura" className="input" value={factura} onChange={e => setFactura(e.target.value)} placeholder="Ej: A-0001-00012345" />
        {err('facturaProveedor')}
      </div>
      <div className="input-group">
        <label className="input-label" htmlFor="ing-proveedor">Proveedor *</label>
        <select id="ing-proveedor" className="input" value={proveedorId} onChange={e => setProveedorId(e.target.value)}>
          <option value="">— Elegir —</option>
          {proveedores.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.descripcion}</option>)}
        </select>
        {err('proveedorId')}
      </div>
      <div className="input-group">
        <label className="input-label" htmlFor="ing-tipo">Tipo de factura (cabecera)</label>
        <select id="ing-tipo" className="input" value={tipoCabecera} onChange={e => setTipoCabecera(e.target.value)}>
          <option value="">— Sin dato —</option>
          <option value="A">Factura A</option>
          <option value="B">Factura B</option>
        </select>
        {err('tipoCabecera')}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div className="input-group" style={{ flex: 1 }}>
          <label className="input-label" htmlFor="ing-fa">N.º factura A</label>
          <input id="ing-fa" className="input" value={facturaA} onChange={e => setFacturaA(e.target.value)} maxLength={40} />
        </div>
        <div className="input-group" style={{ flex: 1 }}>
          <label className="input-label" htmlFor="ing-fb">N.º factura B</label>
          <input id="ing-fb" className="input" value={facturaB} onChange={e => setFacturaB(e.target.value)} maxLength={40} />
        </div>
      </div>

      <div className="input-group">
        <label className="input-label" htmlFor="ing-buscar">Código producto</label>
        <input id="ing-buscar" className="input" type="search" value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && sugeridos[0]) agregar(sugeridos[0]); }}
          placeholder="Escribí código o descripción y Enter" autoComplete="off" />
        {sugeridos.map(p => (
          <div key={p.id} className="list-item" style={{ cursor: 'pointer' }} onClick={() => agregar(p)} data-testid="sugerido">
            <div><div className="list-item-name">{p.nombre}</div><div className="list-item-sub">{p.codigo || '—'}</div></div>
            <div style={{ fontSize: 12 }}>Stock {stockDe(stockMap, p.id)}</div>
          </div>
        ))}
        {err('items')}
      </div>

      {renglones.length > 0 && (
        <div style={{ overflowX: 'auto', marginBottom: 14 }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text3)' }}>
                <th>Código</th><th>Descripción</th><th>Stock actual</th><th>Ingreso</th><th>Stock total</th><th>Costo unit.</th><th>Factura</th><th />
              </tr>
            </thead>
            <tbody>
              {renglones.map((r) => {
                const p = prodById.get(r.productoId);
                const actual = stockDe(stockMap, r.productoId);
                const n = parseInt(r.ingreso, 10);
                const total = Number.isFinite(n) ? actual + n : actual;
                return (
                  <tr key={r.productoId} data-testid="renglon-ingreso">
                    <td>{p?.codigo || '—'}</td>
                    <td>{p?.nombre || '¿?'}{errores[`item:${r.productoId}`] && <div role="alert" style={{ color: 'var(--danger)', fontSize: 11 }}>{errores[`item:${r.productoId}`]}</div>}</td>
                    <td>{actual}</td>
                    <td><input className="qty-input" aria-label={`Ingreso ${p?.nombre || ''}`} inputMode="numeric" value={r.ingreso} onChange={e => setIngreso(r.productoId, e.target.value)} style={{ width: 70 }} /></td>
                    <td><strong>{total}</strong></td>
                    <td><input className="qty-input" aria-label={`Costo unitario ${p?.nombre || ''}`} inputMode="decimal" placeholder="opcional" value={costos[r.productoId]?.costo ?? ''} onChange={e => setCosto(r.productoId, 'costo', e.target.value)} style={{ width: 84 }} /></td>
                    <td>
                      <select aria-label={`Factura ${p?.nombre || ''}`} className="input" value={costos[r.productoId]?.tipo ?? ''} onChange={e => setCosto(r.productoId, 'tipo', e.target.value)} style={{ width: 92 }}>
                        <option value="">{tipoCabecera ? `Cabecera (${tipoCabecera})` : 'Sin dato'}</option>
                        <option value="A">A</option>
                        <option value="B">B</option>
                      </select>
                    </td>
                    <td><button className="btn-icon" style={{ color: 'var(--danger)' }} onClick={() => quitar(r.productoId)} aria-label="Quitar">×</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {previo && <div style={{ marginBottom: 12 }}><TextoSubtotales s={previo} testid="subtotales-previo" /></div>}
      {hayCostoCargado && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 12 }}>
          <input type="checkbox" checked={actualizarCosto} onChange={e => setActualizarCosto(e.target.checked)} />
          Actualizar el costo final de los productos
        </label>
      )}

      {err('general')}
      {ok && <div role="status" style={{ color: 'var(--success)', fontSize: 13, marginBottom: 10 }}>{ok}</div>}
      {comprobante && (
        <div className="card" style={{ marginBottom: 10 }} data-testid="comprobante-ingreso">
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Comprobante: subtotales por factura</div>
          <TextoSubtotales s={comprobante.subtotales} testid="subtotales-comprobante" />
          {comprobante.actualizados > 0 && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>Costo final actualizado en {comprobante.actualizados} producto(s). Subí los productos desde Config para que el cambio llegue a los demás dispositivos.</div>}
          <button className="btn btn-ghost btn-sm" style={{ width: 'auto', marginTop: 8 }} onClick={descargar}>Descargar comprobante (PDF)</button>
        </div>
      )}
      <button className="btn btn-primary" onClick={confirmar} disabled={guardando} style={{ width: '100%' }}>
        {guardando ? 'Registrando...' : 'Confirmar ingreso'}
      </button>
    </div>
  );
};

export default IngresoMercaderia;
