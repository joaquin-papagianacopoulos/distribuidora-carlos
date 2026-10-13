// src/components/ProveedorForm.js — REQ-PROV (AC-PROV-1, AC-PROV-2)
import React, { useState } from 'react';
import CamposForm from './CamposForm';
import { CAMPOS_PROVEEDOR, validarProveedor } from '../domain/proveedores';

const ProveedorForm = ({ inicial = null, existentes = [], onGuardar, onCancelar }) => {
  const [valores, setValores] = useState({ codigo: inicial?.codigo || '', descripcion: inicial?.descripcion || '' });
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    const r = validarProveedor(valores, existentes, { editId: inicial?.id ?? null });
    if (!r.ok) { setErrores(r.errores); return; }
    setGuardando(true);
    try { await onGuardar(r.proveedor); } finally { setGuardando(false); }
  };

  return (
    <div className="card" style={{ marginTop: 16 }} data-testid="proveedor-form">
      <div style={{ fontWeight: 700, marginBottom: 14 }}>{inicial ? 'Editar' : 'Alta de'} proveedor</div>
      <CamposForm
        campos={CAMPOS_PROVEEDOR}
        valores={valores}
        errores={errores}
        onChange={(k, v) => { setValores(p => ({ ...p, [k]: v })); setErrores(p => ({ ...p, [k]: undefined })); }}
      />
      <div style={{ display: 'flex', gap: 10, marginBottom: 80 }}>
        <button className="btn btn-ghost" onClick={onCancelar} disabled={guardando}>Cancelar</button>
        <button className="btn btn-primary" onClick={guardar} style={{ flex: 1 }} disabled={guardando}>
          {guardando ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </div>
  );
};

export default ProveedorForm;
