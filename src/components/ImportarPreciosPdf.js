// src/components/ImportarPreciosPdf.js — REQ-PDF: actualizar precios desde el PDF
// de la lista de precios de un proveedor. Lee el PDF, muestra una vista previa
// (producto, precio actual -> nuevo, variación, avisos) y aplica SOLO lo tildado.
// Nunca crea productos ni toca stock (AC-PDF-3).
import React, { useMemo, useRef, useState } from 'react';
import { leerItemsPdf } from '../services/lectorPdf';
import {
  agruparRenglones, filasDesdeRenglones, columnasDePrecio, planificarPreciosPdf, cambiosAplicables,
} from '../domain/importacionPdf';

const fmt = (n) => `$${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ImportarPreciosPdf = ({ productos = [], onAplicar }) => {
  const ref = useRef(null);
  const [filas, setFilas] = useState(null);
  const [archivo, setArchivo] = useState('');
  const [modo, setModo] = useState(null);
  const [columna, setColumna] = useState('ultima');
  const [seleccion, setSeleccion] = useState(null);
  const [msg, setMsg] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const plan = useMemo(
    () => (filas && modo ? planificarPreciosPdf(filas, productos, { modo, columna }) : null),
    [filas, modo, columna, productos],
  );
  // Al cambiar el plan, la selección vuelve a lo sugerido (solo lo seguro).
  const sel = useMemo(() => seleccion || new Set((plan?.entradas || []).map((e, i) => (e.seleccionado ? i : -1)).filter(i => i >= 0)), [plan, seleccion]);
  const cambios = plan ? cambiosAplicables(plan, sel) : [];

  const cerrar = () => { setFilas(null); setModo(null); setSeleccion(null); setColumna('ultima'); setArchivo(''); };

  const elegir = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (ref.current) ref.current.value = '';
    if (!file) return;
    setOcupado(true); setMsg('Leyendo PDF...'); cerrar();
    const r = await leerItemsPdf(file);
    setOcupado(false);
    if (!r.ok) { setMsg(r.mensaje); return; }
    const f = filasDesdeRenglones(agruparRenglones(r.items));
    if (f.length === 0) { setMsg('No encontramos renglones con precio en el PDF.'); return; }
    setArchivo(file.name || 'PDF');
    setFilas(f);
    setMsg('');
  };

  const alternar = (i) => {
    const s = new Set(sel);
    if (s.has(i)) s.delete(i); else s.add(i);
    setSeleccion(s);
  };

  const aplicar = async () => {
    if (cambios.length === 0) return;
    setOcupado(true);
    try {
      await onAplicar(cambios, plan.modo);
      setMsg(`${cambios.length} precio${cambios.length === 1 ? '' : 's'} actualizado${cambios.length === 1 ? '' : 's'}.`);
      cerrar();
    } catch (err) {
      setMsg(`No se pudieron guardar los precios: ${err?.message || String(err)}`);
    } finally {
      setOcupado(false);
    }
  };

  const nCols = filas ? columnasDePrecio(filas) : 0;

  return (
    <div style={{ marginTop: 10 }} data-testid="importar-pdf">
      <input ref={ref} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={elegir} data-testid="input-pdf" />
      <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto' }} disabled={ocupado} onClick={() => ref.current && ref.current.click()}>
        {ocupado && !filas ? 'Leyendo PDF...' : '📄 Actualizar precios desde PDF'}
      </button>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
        Lista de precios del proveedor en PDF (con texto, no escaneado). Solo actualiza productos que ya existen, buscándolos por código.
      </div>

      {filas ? (
        <div className="card" style={{ marginTop: 10 }} data-testid="preview-pdf">
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{archivo}: {filas.length} renglones con precio</div>
          <div style={{ fontSize: 14, marginBottom: 6 }}>¿Qué precio trae el PDF?</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            <button type="button" className={`btn btn-sm ${modo === 'costo' ? 'btn-primary' : 'btn-ghost'}`} style={{ width: 'auto' }}
              onClick={() => { setModo('costo'); setSeleccion(null); }} data-testid="modo-costo">
              Costo (recalcula el precio de venta con la ganancia)
            </button>
            <button type="button" className={`btn btn-sm ${modo === 'venta' ? 'btn-primary' : 'btn-ghost'}`} style={{ width: 'auto' }}
              onClick={() => { setModo('venta'); setSeleccion(null); }} data-testid="modo-venta">
              Precio de venta 1
            </button>
          </div>
          {nCols > 1 ? (
            <div className="input-group">
              <label className="input-label">El PDF tiene {nCols} columnas de precio. Usar:</label>
              <select className="input" value={String(columna)} data-testid="columna-pdf"
                onChange={e => { setColumna(e.target.value === 'ultima' ? 'ultima' : Number(e.target.value)); setSeleccion(null); }}>
                <option value="ultima">La última de cada renglón</option>
                {Array.from({ length: nCols }, (_, i) => <option key={i} value={i}>Columna {i + 1}</option>)}
              </select>
            </div>
          ) : null}

          {plan ? (
            <>
              <div style={{ fontSize: 13, marginBottom: 6 }} data-testid="resumen-pdf">
                {plan.resumen.actualizar} para actualizar · {plan.resumen.sinCambios} sin cambios · {plan.resumen.sinProducto} sin producto
                {plan.resumen.duplicados ? ` · ${plan.resumen.duplicados} repetidos` : ''}{plan.resumen.invalidos ? ` · ${plan.resumen.invalidos} con problemas` : ''}
              </div>
              <div style={{ maxHeight: 360, overflow: 'auto', borderTop: '1px solid var(--border)' }}>
                {plan.entradas.map((e, i) => (
                  <label key={i} data-testid="fila-pdf" data-estado={e.estado}
                    style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13, opacity: e.estado === 'actualizar' ? 1 : 0.6 }}>
                    <input type="checkbox" disabled={e.estado !== 'actualizar'} checked={sel.has(i)} onChange={() => alternar(i)} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <strong>{e.fila.codigo || '—'}</strong> {e.fila.descripcion}
                      {e.producto ? <span style={{ color: 'var(--text2)' }}> → {e.producto.nombre}</span> : null}
                      {e.estado === 'actualizar' || e.estado === 'sin_cambios' ? (
                        <div>
                          {fmt(e.precioActual)} → <strong>{fmt(e.precioNuevo)}</strong>
                          {e.variacion !== null && e.variacion !== undefined ? ` (${e.variacion > 0 ? '+' : ''}${e.variacion}%)` : ''}
                          {plan.modo === 'costo' ? <span style={{ color: 'var(--text3)' }}> · costo {fmt(e.cambios.costoFinal)}</span> : null}
                        </div>
                      ) : null}
                      {e.aviso ? <div style={{ color: e.estado === 'actualizar' ? 'var(--warning, #b45309)' : 'var(--text3)' }}>{e.aviso}</div> : null}
                    </span>
                  </label>
                ))}
              </div>
            </>
          ) : null}

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={cerrar} disabled={ocupado}>Cancelar</button>
            <button type="button" className="btn btn-primary btn-sm" style={{ width: 'auto' }} disabled={!plan || cambios.length === 0 || ocupado}
              onClick={aplicar} data-testid="aplicar-pdf">
              Actualizar {cambios.length} precio{cambios.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      ) : null}
      {msg ? <div role="status" style={{ fontSize: 13, marginTop: 6 }} data-testid="pdf-msg">{msg}</div> : null}
    </div>
  );
};

export default ImportarPreciosPdf;
