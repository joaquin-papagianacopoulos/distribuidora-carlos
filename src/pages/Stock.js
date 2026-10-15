// src/pages/Stock.js — REQ-STK (AC-STK-7), REQ-ING (AC-ING-1..6), REQ-INA y REQ-STB. Solo admin.
// Las secciones viven en src/pages/stock/*. Este archivo las arma y re-exporta IngresoMercaderia.
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../hooks/useAppContext';
import { contarStockBajo } from '../domain/stockBajo';
import { vincularPedidoConIngreso } from '../services/comprasLocalService';
import ListadoStock from './stock/ListadoStock';
import IngresoMercaderia from './stock/IngresoMercaderia';
import HistorialIngresos from './stock/HistorialIngresos';
import Reponer from './stock/Reponer';

export { IngresoMercaderia };

/**
 * `precarga` (opcional): { proveedorId, pedidoProveedorId, items: [{ productoId, ingreso }] } cuando el
 * admin marcó "recibido" un pedido al proveedor (AC-CPR-4). Abre Ingreso de mercadería ya cargado.
 */
const Stock = ({ precarga = null, onPrecargaUsada }) => {
  const { productos, proveedores = [], ingresos = [], ingresosCostos = [], movimientosStock = [], stockMap, vendedorActual, recargar } = useApp();
  const [seccion, setSeccion] = useState(precarga ? 'ingreso' : 'stock');
  const isAdmin = Number(vendedorActual?.permiso || 2) === 1;
  const cantBajos = useMemo(() => contarStockBajo(productos || [], stockMap), [productos, stockMap]);

  useEffect(() => { if (precarga) setSeccion('ingreso'); }, [precarga]);

  // AC-SEC-4: solo admin.
  if (!isAdmin) {
    return (
      <div className="page">
        <h1 className="page-title">Stock</h1>
        <div className="empty-state"><div className="empty-text">No tenés permisos para ver el stock</div></div>
      </div>
    );
  }

  const SECCIONES = [
    { id: 'stock', label: 'Stock' },
    { id: 'reponer', label: `Reponer (${cantBajos})` },
    { id: 'ingreso', label: 'Ingreso de mercadería' },
    { id: 'historial', label: 'Historial' },
  ];

  const alConfirmar = async (r, pre) => {
    if (pre?.pedidoProveedorId && r?.ingreso?.id) {
      try { await vincularPedidoConIngreso(pre.pedidoProveedorId, r.ingreso.id); } catch { /* el vínculo es informativo */ }
    }
    if (pre && onPrecargaUsada) onPrecargaUsada();
  };

  return (
    <div className="page">
      <h1 className="page-title">Stock</h1>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {SECCIONES.map(s => (
          <button key={s.id} className={`btn btn-sm ${seccion === s.id ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1 }} onClick={() => setSeccion(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      {seccion === 'stock' && <ListadoStock productos={productos} stockMap={stockMap} movimientos={movimientosStock} proveedores={proveedores} />}
      {seccion === 'reponer' && <Reponer productos={productos} stockMap={stockMap} proveedores={proveedores} usuario={vendedorActual?.nombre || ''} onListo={recargar} />}
      {seccion === 'ingreso' && (
        proveedores.length === 0
          ? <div className="card" style={{ fontSize: 14 }}>Primero cargá al menos un proveedor en Config → Proveedores.</div>
          : <IngresoMercaderia key={precarga?.pedidoProveedorId || 'nuevo'} productos={productos} proveedores={proveedores} stockMap={stockMap} usuario={vendedorActual?.nombre || ''} onListo={recargar} precarga={precarga} onConfirmado={alConfirmar} />
      )}
      {seccion === 'historial' && <HistorialIngresos ingresos={ingresos} costos={ingresosCostos} productos={productos} proveedores={proveedores} />}
    </div>
  );
};

export default Stock;
