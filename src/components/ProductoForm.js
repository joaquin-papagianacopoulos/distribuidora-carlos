// src/components/ProductoForm.js — REQ-PROD (AC-PROD-1..3)
import React, { useMemo, useState } from 'react';
import CamposForm from './CamposForm';
import { CAMPOS_PRODUCTO, calcularPrecioVenta, validarProducto } from '../domain/productos';

const str = (v, def = '') => (v === undefined || v === null ? def : String(v));

const ProductoForm = ({ inicial = null, existentes = [], proveedores = [], stockActual = 0, onGuardar, onCancelar }) => {
  const [valores, setValores] = useState(() => ({
    codigo: str(inicial?.codigo),
    nombre: str(inicial?.nombre),
    categoria: str(inicial?.categoria),
    proveedorId: str(inicial?.proveedorId),
    costoFinal: str(inicial?.costoFinal),
    descuento1: str(inicial?.descuento1),
    descuento2: str(inicial?.descuento2),
    ganancia: str(inicial?.ganancia),
    precio: str(inicial?.precio),
    precioVenta2: str(inicial?.precioVenta2),
    bultoX: str(inicial?.bultoX, '1'),
    minimoVenta: str(inicial?.minimoVenta, '1'),
    stock: inicial ? String(stockActual) : '',
  }));
  // Si el usuario escribe el precio a mano, deja de recalcularse solo.
  const [precioManual, setPrecioManual] = useState(() => {
    if (!inicial) return false;
    const calc = calcularPrecioVenta(inicial).precioVenta1;
    return Number(inicial.precio || 0) !== calc;
  });
  // Valor de stock que se le MOSTRO al abrir (no cambia si el sync actualiza el ledger).
  const [stockMostrado] = useState(stockActual);
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);

  const { costoNeto, precioVenta1 } = useMemo(() => calcularPrecioVenta(valores), [valores]);

  const onChange = (k, v) => {
    setErrores(prev => ({ ...prev, [k]: undefined }));
    if (k === 'precio') setPrecioManual(v !== '');
    setValores(prev => {
      const next = { ...prev, [k]: v };
      if (!precioManual && k !== 'precio' && ['costoFinal', 'descuento1', 'descuento2', 'ganancia'].includes(k)) {
        next.precio = String(calcularPrecioVenta(next).precioVenta1);
      }
      return next;
    });
  };

  const guardar = async () => {
    const r = validarProducto(valores, { existentes, proveedores, editId: inicial?.id ?? null });
    if (!r.ok) { setErrores(r.errores); return; }
    setGuardando(true);
    // Revisor (bloqueante 2): el stock solo se ajusta si el usuario TOCO el
    // campo, y la diferencia se calcula contra el valor que se le mostro (no
    // contra el ledger actual, que el sync pudo haber cambiado mientras tanto).
    const base = inicial ? stockMostrado : 0;
    const cambioStock = inicial ? String(valores.stock).trim() !== String(stockMostrado) : r.stock !== null;
    try { await onGuardar(r.producto, cambioStock ? r.stock : null, base); } finally { setGuardando(false); }
  };

  const fmt = (n) => `$${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="card" style={{ marginTop: 16 }} data-testid="producto-form">
      <div style={{ fontWeight: 700, marginBottom: 14 }}>{inicial ? 'Editar' : 'Alta de'} producto</div>
      <CamposForm
        campos={CAMPOS_PRODUCTO}
        valores={valores}
        errores={errores}
        onChange={onChange}
        opcionesDinamicas={{ proveedor: proveedores.map(p => ({ value: p.id, label: `${p.codigo} — ${p.descripcion}` })) }}
        ayudas={{
          precio: `Costo neto ${fmt(costoNeto)} · sugerido ${fmt(precioVenta1)}${precioManual ? ' (precio cargado a mano)' : ''}`,
          stock: inicial
            ? `Stock actual: ${stockActual}. Si lo cambiás se registra un ajuste de inventario.`
            : 'Stock inicial (opcional). Después se suma con "Ingreso de mercadería".',
        }}
      />
      {precioManual && (
        <button className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }}
          onClick={() => { setPrecioManual(false); setValores(v => ({ ...v, precio: String(precioVenta1) })); }}>
          Usar precio calculado ({fmt(precioVenta1)})
        </button>
      )}
      <div style={{ display: 'flex', gap: 10, marginBottom: 80 }}>
        <button className="btn btn-ghost" onClick={onCancelar} disabled={guardando}>Cancelar</button>
        <button className="btn btn-primary" onClick={guardar} style={{ flex: 1 }} disabled={guardando}>
          {guardando ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </div>
  );
};

export default ProductoForm;
