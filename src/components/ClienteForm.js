// src/components/ClienteForm.js — REQ-CLI (AC-CLI-1..4)
import React, { useState } from 'react';
import CamposForm from './CamposForm';
import { CAMPOS_CLIENTE, clienteVacio, validarCliente, sugerirCodigoCliente } from '../domain/clientes';

const ClienteForm = ({ inicial = null, existentes = [], vendedores = [], onGuardar, onCancelar }) => {
  const [valores, setValores] = useState(() => {
    const base = clienteVacio();
    if (!inicial) return { ...base, codigo: sugerirCodigoCliente(existentes) };
    const v = { ...base };
    for (const c of CAMPOS_CLIENTE) if (inicial[c.key] !== undefined && inicial[c.key] !== null) v[c.key] = String(inicial[c.key]);
    // Cliente viejo sin codigo: se sugiere uno (el codigo ahora es obligatorio).
    if (!v.codigo) v.codigo = sugerirCodigoCliente(existentes);
    return v;
  });
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [boleta, setBoleta] = useState(!!inicial?.boletaContraBoleta);

  const onChange = (k, v) => { setValores(prev => ({ ...prev, [k]: v })); setErrores(prev => ({ ...prev, [k]: undefined })); };

  const guardar = async () => {
    const r = validarCliente(valores, existentes, { editId: inicial?.id ?? null });
    if (!r.ok) { setErrores(r.errores); return; }
    setGuardando(true);
    try { await onGuardar({ ...r.cliente, boletaContraBoleta: boleta }); }
    finally { setGuardando(false); }
  };

  const opcionesVendedor = vendedores.map(v => ({ value: v.nombre, label: v.nombre }));

  return (
    <div className="card" style={{ marginTop: 16 }} data-testid="cliente-form">
      <div style={{ fontWeight: 700, marginBottom: 14 }}>{inicial ? 'Editar' : 'Alta de'} cliente</div>
      <CamposForm
        campos={CAMPOS_CLIENTE}
        valores={valores}
        errores={errores}
        onChange={onChange}
        opcionesDinamicas={{ vendedor: opcionesVendedor }}
        ayudas={{ cuit: 'Opcional. Se guarda tal cual se escribe.' }}
      />
      <div className="input-group">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text)' }}>
          <input type="checkbox" checked={boleta} onChange={e => setBoleta(e.target.checked)} />
          Boleta contra boleta
        </label>
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 80 }}>
        <button className="btn btn-ghost" onClick={onCancelar} disabled={guardando}>Cancelar</button>
        <button className="btn btn-primary" onClick={guardar} style={{ flex: 1 }} disabled={guardando}>
          {guardando ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </div>
  );
};

export default ClienteForm;
