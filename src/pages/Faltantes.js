// src/pages/Faltantes.js
import React, { useState, useMemo } from 'react';
import { useApp } from '../hooks/useAppContext';
import { deleteFaltante } from '../db';
import { supabase } from '../lib/supabase';
import { generarFaltantesDiaFile } from '../utils/pdfGen';
import { shareFiles, canShareFiles } from '../utils/share';
import { getTodayStr } from '../utils/fuzzy';

const getMesActual = () => {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
};

const getMesesDisponibles = (faltantes) => {
  const meses = [...new Set(faltantes.map(f => f.mes))].sort().reverse();
  return meses;
};

const NOMBRE_MES = {
  '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
  '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
  '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre'
};

const DIA_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];

const formatMes = (mesStr) => {
  if (!mesStr) return '';
  const [year, m] = mesStr.split('-');
  return `${NOMBRE_MES[m] || m} ${year}`;
};

const formatFechaLarga = (fechaStr) => {
  const raw = String(fechaStr || '');
  const [y, m, d] = raw.split('-').map(Number);
  if (!y || !m || !d) return raw;
  const dt = new Date(y, m - 1, d);
  const diaSemana = DIA_SEMANA[dt.getDay()] || '';
  return `${diaSemana} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
};

const VISTAS = [
  { id: 'dia', label: 'Linea de tiempo' },
  { id: 'producto', label: 'Por producto' },
  { id: 'cliente', label: 'Por cliente' },
];

// Como ordenar/armar la hoja impresa de un dia.
const MODOS_IMPRESION = [
  { id: 'producto', label: 'Por producto' },
  { id: 'cliente', label: 'Por cliente' },
  { id: 'lista_compras', label: 'Lista de compras' },
];

const Faltantes = () => {
  const { faltantes, vendedorActual, recargar, syncNow } = useApp();
  const isAdmin = Number(vendedorActual?.permiso || 2) === 1;
  const isArmador = Number(vendedorActual?.permiso || 2) === 3;
  const [mes, setMes] = useState(getMesActual());
  const [dia, setDia] = useState('');
  const [vista, setVista] = useState('dia');
  const [expandidoProducto, setExpandidoProducto] = useState(null);
  const [expandidoCliente, setExpandidoCliente] = useState(null);
  const [imprimiendoDia, setImprimiendoDia] = useState(null);
  const [modoImpresion, setModoImpresion] = useState('producto');

  if (!isAdmin && !isArmador) {
    return (
      <div className="page">
        <h1 className="page-title">Faltantes</h1>
        <div className="empty-state">
          <div className="empty-icon">{'⛔'}</div>
          <div className="empty-text">No tenes permisos para ver faltantes</div>
        </div>
      </div>
    );
  }

  const imprimirDia = async (diaGrupo, modo = modoImpresion) => {
    setImprimiendoDia(diaGrupo.fecha);
    try {
      const file = await generarFaltantesDiaFile(diaGrupo.items, diaGrupo.fecha, modo);

      if (canShareFiles()) {
        try {
          await shareFiles({ title: `Faltantes ${diaGrupo.fecha}`, files: [file] });
          return;
        } catch (e) {
          // Si cancela o el navegador lo rechaza, caemos al visor.
        }
      }

      const w = window.open('', '_blank');
      const url = URL.createObjectURL(file);
      if (w) w.location.href = url;
      else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      alert('No se pudo generar el PDF: ' + (e?.message || String(e)));
    } finally {
      setImprimiendoDia(null);
    }
  };

  // Vista del Armador: solo lo de hoy, sin montos de dinero, con opcion de imprimir.
  if (isArmador) {
    const hoy = getTodayStr();
    const faltantesHoy = (faltantes || []).filter(f => f.fecha === hoy);
    const totalUnidadesHoy = faltantesHoy.reduce((acc, f) => acc + f.cantidadFaltante, 0);
    const productosHoy = new Set(faltantesHoy.map(f => f.productoId || f.productoNombre)).size;

    return (
      <div className="page">
        <h1 className="page-title">Faltantes de hoy</h1>
        <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16, marginTop: -10, lineHeight: 1.5 }}>
          Productos que se sacaron o se redujo la cantidad hoy al facturar o armar un pedido.
        </p>

        <div className="stats-grid" style={{ marginBottom: 14 }}>
          <div className="stat-card">
            <div className="stat-value">{totalUnidadesHoy}</div>
            <div className="stat-label">Unidades faltantes</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{productosHoy}</div>
            <div className="stat-label">Productos afectados</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 10, overflowX: 'auto', paddingBottom: 2 }}>
          {MODOS_IMPRESION.map(m => (
            <button
              key={m.id}
              className={`btn btn-sm ${modoImpresion === m.id ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setModoImpresion(m.id)}
              style={{ whiteSpace: 'nowrap', flex: 'none' }}
            >
              {m.label}
            </button>
          ))}
        </div>

        <button
          className="btn btn-primary"
          style={{ marginBottom: 14 }}
          onClick={() => imprimirDia({ fecha: hoy, items: faltantesHoy })}
          disabled={faltantesHoy.length === 0 || imprimiendoDia === hoy}
        >
          {imprimiendoDia === hoy ? 'Generando...' : `${'\u{1F5A8}️'} Imprimir hoja de faltantes`}
        </button>

        {faltantesHoy.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon" style={{ fontSize: 40 }}>✅</div>
            <div className="empty-text" style={{ color: 'var(--success)', fontWeight: 600 }}>
              Sin faltantes hoy
            </div>
          </div>
        ) : (
          <div className="card" style={{ padding: '4px 14px' }}>
            {faltantesHoy.map((f, i) => (
              <div
                key={f.id}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 0',
                  borderBottom: i === faltantesHoy.length - 1 ? 'none' : '1px solid var(--border)',
                  gap: 10,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      minWidth: 24, height: 20, padding: '0 5px',
                      background: 'var(--bg4)', borderRadius: 5, fontSize: 12, fontWeight: 700,
                      color: 'var(--text2)', flex: 'none',
                    }}>
                      ×{f.cantidadFaltante}
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.productoNombre}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                    {f.clienteNombre}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const mesesDisponibles = getMesesDisponibles(faltantes);

  const faltantesMes = useMemo(() => {
    const base = faltantes.filter(f => f.mes === mes);
    if (!dia) return base;
    return base.filter(f => f.fecha === dia);
  }, [faltantes, mes, dia]);

  // Agrupar por producto
  const porProducto = useMemo(() => {
    const map = {};
    for (const f of faltantesMes) {
      const k = f.productoId || f.productoNombre;
      if (!map[k]) {
        map[k] = {
          productoId: f.productoId,
          productoNombre: f.productoNombre,
          totalUnidades: 0,
          totalDinero: 0,
          ocurrencias: [],
        };
      }
      map[k].totalUnidades += f.cantidadFaltante;
      map[k].totalDinero += f.dineroNoPercibido;
      map[k].ocurrencias.push(f);
    }
    return Object.values(map).sort((a, b) => b.totalDinero - a.totalDinero);
  }, [faltantesMes]);

  // Agrupar por cliente: a quien le tuvimos que sacar/reducir productos.
  const porCliente = useMemo(() => {
    const map = {};
    for (const f of faltantesMes) {
      const k = f.clienteNombre || '(Sin cliente)';
      if (!map[k]) {
        map[k] = {
          clienteNombre: k,
          totalUnidades: 0,
          totalDinero: 0,
          ocurrencias: [],
        };
      }
      map[k].totalUnidades += f.cantidadFaltante;
      map[k].totalDinero += f.dineroNoPercibido;
      map[k].ocurrencias.push(f);
    }
    return Object.values(map).sort((a, b) => b.totalDinero - a.totalDinero);
  }, [faltantesMes]);

  // Linea de tiempo: un dia por dia con lo que quedo sin vender ese dia.
  // Es la vista mas facil de leer: "el dia X, a estos clientes les faltaron estos productos".
  const porDia = useMemo(() => {
    const map = {};
    for (const f of faltantesMes) {
      const k = f.fecha;
      if (!map[k]) map[k] = { fecha: k, totalUnidades: 0, totalDinero: 0, items: [] };
      map[k].totalUnidades += f.cantidadFaltante;
      map[k].totalDinero += f.dineroNoPercibido;
      map[k].items.push(f);
    }
    return Object.values(map)
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
      .map(d => ({
        ...d,
        items: [...d.items].sort((a, b) => b.dineroNoPercibido - a.dineroNoPercibido),
      }));
  }, [faltantesMes]);

  const totalDineroMes = faltantesMes.reduce((acc, f) => acc + f.dineroNoPercibido, 0);
  const totalUnidadesMes = faltantesMes.reduce((acc, f) => acc + f.cantidadFaltante, 0);

  const handleEliminar = async (id) => {
    if (!window.confirm('¿Eliminar este registro de faltante?')) return;
    const f = (faltantes || []).find(x => x.id === id);
    if (f?.remoteId && navigator.onLine) {
      const { error } = await supabase.from('faltantes').delete().eq('id', f.remoteId);
      if (error) {
        alert('No se pudo borrar en la nube: ' + (error.message || String(error)));
        return;
      }
    }
    await deleteFaltante(id);
    await recargar();
    if (navigator.onLine) syncNow();
  };

  return (
    <div className="page">
      <h1 className="page-title">Faltantes</h1>
      <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16, marginTop: -10, lineHeight: 1.5 }}>
        Productos que se sacaron o se redujo la cantidad al facturar o al armar un pedido.
        Es lo que quedo pendiente de vender.
      </p>

      {/* Selector de mes */}
      <div className="card" style={{ padding: '12px 14px', marginBottom: 14 }}>
        <label className="input-label">Mes</label>
        <select
          className="input"
          value={mes}
          onChange={e => setMes(e.target.value)}
        >
          {/* Siempre mostrar el mes actual aunque no haya datos */}
          {!mesesDisponibles.includes(getMesActual()) && (
            <option value={getMesActual()}>{formatMes(getMesActual())} (sin datos)</option>
          )}
          {mesesDisponibles.map(m => (
            <option key={m} value={m}>{formatMes(m)}</option>
          ))}
        </select>
      </div>

      {/* Filtro por día (opcional) */}
      <div className="card" style={{ padding: '12px 14px', marginBottom: 14 }}>
        <label className="input-label">Día (opcional)</label>
        <input
          type="date"
          className="input"
          value={dia}
          onChange={e => setDia(e.target.value)}
        />
      </div>

      {/* Resumen del mes */}
      <div className="stats-grid" style={{ marginBottom: 14 }}>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--danger)' }}>
            ${totalDineroMes.toLocaleString('es-AR')}
          </div>
          <div className="stat-label">Se dejo de vender</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalUnidadesMes}</div>
          <div className="stat-label">Unidades faltantes</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{porProducto.length}</div>
          <div className="stat-label">Productos afectados</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{porCliente.length}</div>
          <div className="stat-label">Clientes afectados</div>
        </div>
      </div>

      {faltantesMes.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon" style={{ fontSize: 40 }}>✅</div>
          <div className="empty-text" style={{ color: 'var(--success)', fontWeight: 600 }}>
            Sin faltantes en {formatMes(mes)}
          </div>
          <div className="empty-text" style={{ marginTop: 8, fontSize: 12 }}>
            Cuando en Facturación o Armado se saquen o reduzcan productos de un pedido, aparecerán acá.
          </div>
        </div>
      ) : (
        <>
          {/* Toggle vista */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, overflowX: 'auto', paddingBottom: 2 }}>
            {VISTAS.map(v => (
              <button
                key={v.id}
                className={`btn btn-sm ${vista === v.id ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setVista(v.id)}
                style={{ flex: '1 0 auto', whiteSpace: 'nowrap' }}
              >
                {v.label}
              </button>
            ))}
          </div>

          {/* LINEA DE TIEMPO: dia por dia, lo mas facil de leer de un vistazo */}
          {vista === 'dia' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>Imprimir como:</span>
                {MODOS_IMPRESION.map(m => (
                  <button
                    key={m.id}
                    className={`btn btn-sm ${modoImpresion === m.id ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setModoImpresion(m.id)}
                    style={{ whiteSpace: 'nowrap', width: 'auto' }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {porDia.map(d => (
                <div key={d.fecha} style={{ marginBottom: 16 }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '4px 2px', marginBottom: 6, gap: 8,
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 14, textTransform: 'capitalize' }}>
                      {formatFechaLarga(d.fecha)}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 700 }}>
                        −${d.totalDinero.toLocaleString('es-AR')}
                      </div>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ width: 'auto' }}
                        onClick={() => imprimirDia(d)}
                        disabled={imprimiendoDia === d.fecha}
                      >
                        {imprimiendoDia === d.fecha ? 'Generando...' : `${'\u{1F5A8}️'} Imprimir`}
                      </button>
                    </div>
                  </div>
                  <div className="card" style={{ padding: '4px 14px' }}>
                    {d.items.map((f, i) => (
                      <div
                        key={f.id}
                        style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '10px 0',
                          borderBottom: i === d.items.length - 1 ? 'none' : '1px solid var(--border)',
                          gap: 10,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              minWidth: 24, height: 20, padding: '0 5px',
                              background: 'var(--bg4)', borderRadius: 5, fontSize: 12, fontWeight: 700,
                              color: 'var(--text2)', flex: 'none',
                            }}>
                              ×{f.cantidadFaltante}
                            </span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {f.productoNombre}
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                            {f.clienteNombre}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
                          <span style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 13 }}>
                            −${f.dineroNoPercibido.toLocaleString('es-AR')}
                          </span>
                          <button
                            className="btn-icon"
                            style={{ color: 'var(--text3)', fontSize: 14, width: 28, height: 28 }}
                            onClick={() => handleEliminar(f.id)}
                          >×</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* VISTA AGRUPADA POR PRODUCTO */}
          {vista === 'producto' && (
            <div>
              {porProducto.map((prod, idx) => (
                <div key={prod.productoId || prod.productoNombre}>
                  <div
                    className="card"
                    style={{
                      cursor: 'pointer',
                      borderLeft: `3px solid ${idx === 0 ? 'var(--danger)' : idx === 1 ? 'var(--warning)' : 'var(--border)'}`,
                    }}
                    onClick={() => setExpandidoProducto(
                      expandidoProducto === prod.productoNombre ? null : prod.productoNombre
                    )}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{prod.productoNombre}</div>
                        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>
                          {prod.ocurrencias.length} pedido{prod.ocurrencias.length !== 1 ? 's' : ''} afectado{prod.ocurrencias.length !== 1 ? 's' : ''} ·{' '}
                          {prod.totalUnidades} unidad{prod.totalUnidades !== 1 ? 'es' : ''} faltante{prod.totalUnidades !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, color: 'var(--danger)', fontSize: 16 }}>
                          −${prod.totalDinero.toLocaleString('es-AR')}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>no percibido</div>
                      </div>
                    </div>

                    {/* Barra visual de impacto */}
                    <div style={{ marginTop: 10, height: 4, background: 'var(--bg4)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.min(100, (prod.totalDinero / totalDineroMes) * 100)}%`,
                        background: idx === 0 ? 'var(--danger)' : idx === 1 ? 'var(--warning)' : 'var(--accent)',
                        borderRadius: 2,
                        transition: 'width 0.5s ease',
                      }} />
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
                      {Math.round((prod.totalDinero / totalDineroMes) * 100)}% del total perdido
                    </div>
                  </div>

                  {/* Detalle expandido */}
                  {expandidoProducto === prod.productoNombre && (
                    <div className="card" style={{ marginTop: -10, borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTop: 'none' }}>
                      <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Detalle de ocurrencias
                      </div>
                      {prod.ocurrencias.map(oc => (
                        <div key={oc.id} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '8px 0', borderBottom: '1px solid var(--border)'
                        }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 500 }}>{oc.clienteNombre}</div>
                            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                              {oc.fecha.split('-').reverse().join('/')} · ×{oc.cantidadFaltante} unidad{oc.cantidadFaltante !== 1 ? 'es' : ''} · ${oc.precioUnitario?.toLocaleString('es-AR')} c/u
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 13 }}>
                              −${oc.dineroNoPercibido.toLocaleString('es-AR')}
                            </span>
                            <button
                              className="btn-icon"
                              style={{ color: 'var(--text3)', fontSize: 14, width: 28, height: 28 }}
                              onClick={e => { e.preventDefault(); e.stopPropagation(); handleEliminar(oc.id); }}
                            >×</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* VISTA AGRUPADA POR CLIENTE */}
          {vista === 'cliente' && (
            <div>
              {porCliente.map((cli, idx) => (
                <div key={cli.clienteNombre}>
                  <div
                    className="card"
                    style={{
                      cursor: 'pointer',
                      borderLeft: `3px solid ${idx === 0 ? 'var(--danger)' : idx === 1 ? 'var(--warning)' : 'var(--border)'}`,
                    }}
                    onClick={() => setExpandidoCliente(
                      expandidoCliente === cli.clienteNombre ? null : cli.clienteNombre
                    )}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{cli.clienteNombre}</div>
                        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>
                          {cli.ocurrencias.length} producto{cli.ocurrencias.length !== 1 ? 's' : ''} afectado{cli.ocurrencias.length !== 1 ? 's' : ''} ·{' '}
                          {cli.totalUnidades} unidad{cli.totalUnidades !== 1 ? 'es' : ''} faltante{cli.totalUnidades !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, color: 'var(--danger)', fontSize: 16 }}>
                          −${cli.totalDinero.toLocaleString('es-AR')}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>no percibido</div>
                      </div>
                    </div>
                  </div>

                  {expandidoCliente === cli.clienteNombre && (
                    <div className="card" style={{ marginTop: -10, borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTop: 'none' }}>
                      <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Productos que le faltaron
                      </div>
                      {cli.ocurrencias.map(oc => (
                        <div key={oc.id} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '8px 0', borderBottom: '1px solid var(--border)'
                        }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 500 }}>{oc.productoNombre}</div>
                            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                              {oc.fecha.split('-').reverse().join('/')} · ×{oc.cantidadFaltante} unidad{oc.cantidadFaltante !== 1 ? 'es' : ''} · ${oc.precioUnitario?.toLocaleString('es-AR')} c/u
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 13 }}>
                              −${oc.dineroNoPercibido.toLocaleString('es-AR')}
                            </span>
                            <button
                              className="btn-icon"
                              style={{ color: 'var(--text3)', fontSize: 14, width: 28, height: 28 }}
                              onClick={e => { e.preventDefault(); e.stopPropagation(); handleEliminar(oc.id); }}
                            >×</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Total del mes sticky */}
          <div style={{
            position: 'sticky', bottom: 72,
            background: 'var(--bg2)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '14px 16px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginTop: 8, marginBottom: 80,
          }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 600 }}>
                Total perdido en {formatMes(mes)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                {totalUnidadesMes} unidades · {porProducto.length} productos
              </div>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--danger)' }}>
              −${totalDineroMes.toLocaleString('es-AR')}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Faltantes;
