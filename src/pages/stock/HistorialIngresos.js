// src/pages/stock/HistorialIngresos.js — REQ-ING (AC-ING-6) y REQ-INA (AC-INA-3, 5). Solo admin.
// Historial filtrable por proveedor, fechas y Factura A/B, con totales A vs B, vista por producto y PDF.
// Los ingresos viejos (sin costo ni A/B) se siguen viendo como "sin dato".
import React, { useMemo, useState } from 'react';
import { filtrarHistorial, totalesHistorial, ingresosPorProducto, ETIQUETA_TIPO_COMPRA } from '../../domain/compras';
import { formatearCentavos } from '../../domain/cuentaProveedores';
import { buscarProductos } from '../../domain/stockBajo';
import { generarIngresosFile } from '../../utils/pdfGen';
import { descargarArchivo } from '../../utils/descargarArchivo';

const fechaCorta = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const resumen = (s) => {
  const partes = [];
  if (s.A.unidades) partes.push(`A: ${s.A.unidades} u. ${formatearCentavos(s.A.costoCentavos)}`);
  if (s.B.unidades) partes.push(`B: ${s.B.unidades} u. ${formatearCentavos(s.B.costoCentavos)}`);
  if (s.N?.unidades) partes.push(`en negro: ${s.N.unidades} u. ${formatearCentavos(s.N.costoCentavos)}`);
  if (s.sinDato.unidades) partes.push(`sin dato: ${s.sinDato.unidades} u.`);
  return partes.join(' · ');
};

const HistorialIngresos = ({ ingresos = [], costos = [], productos = [], proveedores = [] }) => {
  const [abierto, setAbierto] = useState(null);
  const [proveedorId, setProveedorId] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [tipo, setTipo] = useState('todas');
  const [qProducto, setQProducto] = useState('');
  const [productoId, setProductoId] = useState('');

  const costosById = useMemo(() => new Map((costos || []).map(c => [String(c.id), c])), [costos]);
  const ingresoById = useMemo(() => new Map(ingresos.map(i => [i.id, i])), [ingresos]);
  const filas = useMemo(() => filtrarHistorial(ingresos, costosById, { proveedorId, desde, hasta, tipo }), [ingresos, costosById, proveedorId, desde, hasta, tipo]);
  const totales = useMemo(() => totalesHistorial(filas), [filas]);
  const sugeridos = useMemo(() => (qProducto.trim() ? buscarProductos(productos, qProducto).slice(0, 6) : []), [productos, qProducto]);
  const porProducto = useMemo(() => (productoId ? ingresosPorProducto(ingresos, costosById, productoId) : []), [ingresos, costosById, productoId]);
  const producto = productos.find(p => String(p.id) === String(productoId));

  const exportar = async () => {
    const prov = proveedores.find(p => String(p.id) === String(proveedorId));
    descargarArchivo(await generarIngresosFile(filas, totales, { desde, hasta, tipo, proveedor: prov?.descripcion || '' }));
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <select className="input" aria-label="Filtrar ingresos por proveedor" value={proveedorId} onChange={e => setProveedorId(e.target.value)} style={{ flex: 1, minWidth: 130 }}>
          <option value="">Todos los proveedores</option>
          {proveedores.map(p => <option key={p.id} value={p.id}>{p.descripcion}</option>)}
        </select>
        <select className="input" aria-label="Filtrar ingresos por tipo de factura" value={tipo} onChange={e => setTipo(e.target.value)} style={{ flex: 1, minWidth: 110 }}>
          <option value="todas">Todas</option>
          <option value="A">Solo Factura A</option>
          <option value="B">Solo Factura B</option>
          <option value="N">Solo en negro</option>
          <option value="sinDato">Sin dato</option>
        </select>
        <input className="input" type="date" aria-label="Ingresos desde" value={desde} onChange={e => setDesde(e.target.value)} style={{ flex: 1, minWidth: 130 }} />
        <input className="input" type="date" aria-label="Ingresos hasta" value={hasta} onChange={e => setHasta(e.target.value)} style={{ flex: 1, minWidth: 130 }} />
      </div>

      <div data-testid="totales-historial" style={{ fontSize: 13, marginBottom: 10 }}>
        <div>Total Factura A: <strong>{totales.A.unidades}</strong> u. · {formatearCentavos(totales.A.costoCentavos)}</div>
        <div>Total Factura B: <strong>{totales.B.unidades}</strong> u. · {formatearCentavos(totales.B.costoCentavos)}</div>
        {totales.N?.unidades > 0 && <div>Total en negro: <strong>{totales.N.unidades}</strong> u. · {formatearCentavos(totales.N.costoCentavos)}</div>}
        {totales.sinDato.unidades > 0 && <div>Sin dato: <strong>{totales.sinDato.unidades}</strong> u.</div>}
        <div style={{ fontWeight: 700 }}>Total: {totales.total.unidades} u. · {formatearCentavos(totales.total.costoCentavos)}</div>
        <div style={{ color: 'var(--text3)', fontSize: 12, marginTop: 4 }}>Los costos cargados en otros dispositivos se ven después de “Bajar de otros dispositivos” en Proveedores.</div>
      </div>
      <button className="btn btn-ghost btn-sm" style={{ width: 'auto', marginBottom: 12 }} onClick={exportar}>Exportar a PDF</button>

      {filas.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 14, textAlign: 'center', padding: 16 }}>{ingresos.length === 0 ? 'Todavía no hay ingresos' : 'No hay ingresos con esos filtros'}</div>}
      {filas.map(f => {
        const i = ingresoById.get(f.id);
        if (!i) return null;
        const r = resumen(f.subtotales);
        return (
          <div key={i.id} style={{ borderBottom: '1px solid var(--border)', padding: '10px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setAbierto(abierto === i.id ? null : i.id)}>
              <div>
                <div style={{ fontWeight: 600 }}>Fact. {i.facturaProveedor} · {i.proveedorNombre}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{fechaCorta(i.fecha)} · {i.usuario || '—'} · {i.items?.length || 0} producto(s)</div>
                {r && <div style={{ fontSize: 12 }} data-testid="resumen-ingreso">{r}</div>}
              </div>
              <span>{abierto === i.id ? '▲' : '▼'}</span>
            </div>
            {abierto === i.id && (
              <table style={{ width: '100%', fontSize: 12, marginTop: 8 }}>
                <thead><tr style={{ textAlign: 'left', color: 'var(--text3)' }}><th>Código</th><th>Descripción</th><th>Stock actual</th><th>Ingreso</th><th>Stock total</th></tr></thead>
                <tbody>
                  {(i.items || []).map(r2 => (
                    <tr key={r2.productoId}><td>{r2.codigo}</td><td>{r2.descripcion}</td><td>{r2.stockActual}</td><td>+{r2.ingreso}</td><td>{r2.stockTotal}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      <div style={{ marginTop: 16 }} data-testid="historial-producto">
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Por producto: qué entró en A y qué en B</div>
        <input className="input" type="search" aria-label="Buscar producto del historial" placeholder="Producto..." value={qProducto} onChange={e => { setQProducto(e.target.value); setProductoId(''); }} />
        {sugeridos.map(p => (
          <div key={p.id} className="list-item" style={{ cursor: 'pointer' }} onClick={() => { setProductoId(String(p.id)); setQProducto(p.nombre); }}>
            <div className="list-item-name">{p.nombre}</div>
          </div>
        ))}
        {productoId && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 13, marginBottom: 4 }}>{producto?.nombre}</div>
            {porProducto.length === 0 && <div style={{ fontSize: 13, color: 'var(--text3)' }}>Nunca ingresó.</div>}
            {porProducto.map(x => (
              <div key={x.ingresoId} className="list-item" data-testid="fila-ingreso-producto">
                <div>
                  <div className="list-item-name">{x.tipo ? (ETIQUETA_TIPO_COMPRA[x.tipo] || `Factura ${x.tipo}`) : 'Sin dato'} · +{x.unidades} u.</div>
                  <div className="list-item-sub">{fechaCorta(x.fecha)} · {x.proveedorNombre} · Fact. {x.factura}</div>
                </div>
                <div style={{ fontSize: 13 }}>{x.costoUnitario !== null ? `$${x.costoUnitario.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default HistorialIngresos;
