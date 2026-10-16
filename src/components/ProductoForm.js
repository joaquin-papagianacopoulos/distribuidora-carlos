// src/components/ProductoForm.js — REQ-PROD (AC-PROD-1..3)
import React, { useMemo, useState } from 'react';
import CamposForm from './CamposForm';
import SelectorRubro from './SelectorRubro';
import SelectorMarca from './SelectorMarca';
import { ventaPorEfectivo, normalizarBultoNombre } from '../domain/unidadVenta';
import { CAMPOS_PRODUCTO, calcularPrecioVenta, validarProducto } from '../domain/productos';
import { validarImagen } from '../domain/tiendaPortada';
import { avisoPrecioBulto } from '../domain/precios';

const str = (v, def = '') => (v === undefined || v === null ? def : String(v));

// rubros (REQ-COMR, AC-COMR-3/4): rubros existentes para el selector de Rubro.
// subirFoto (REQ-FOT): async (pin, file) => { ok, url, mensaje }. Sin ella no se muestra el bloque de foto.
const ProductoForm = ({ inicial = null, existentes = [], proveedores = [], rubros = [], marcas = [], stockActual = 0, onGuardar, onCancelar, subirFoto = null }) => {
  const [valores, setValores] = useState(() => ({
    codigo: str(inicial?.codigo),
    nombre: str(inicial?.nombre),
    categoria: str(inicial?.categoria),
    marca: str(inicial?.marca),
    proveedorId: str(inicial?.proveedorId),
    costoFinal: str(inicial?.costoFinal),
    descuento1: str(inicial?.descuento1),
    descuento2: str(inicial?.descuento2),
    ganancia: str(inicial?.ganancia),
    precio: str(inicial?.precio),
    precioBulto: str(inicial?.precioBulto),
    precioVenta2: str(inicial?.precioVenta2),
    bultoX: str(inicial?.bultoX, '1'),
    // AC-VTA-1: productos viejos sin estos campos arrancan con los defaults derivados.
    ventaPor: ventaPorEfectivo(inicial || {}),
    bultoNombre: normalizarBultoNombre(inicial?.bultoNombre),
    visibleTienda: inicial?.visibleTienda !== false,
    minimoVenta: str(inicial?.minimoVenta, '1'),
    stockMinimo: str(inicial?.stockMinimo),
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
  // REQ-FOT: foto del producto (bucket "tienda"). El PIN solo vive en este estado.
  const [foto, setFoto] = useState(() => inicial?.imagen_url || '');
  const [fotoPin, setFotoPin] = useState('');
  const [fotoMsg, setFotoMsg] = useState('');
  const [subiendoFoto, setSubiendoFoto] = useState(false);

  const elegirFoto = async (file) => {
    const v = validarImagen(file);
    if (!v.ok) { setFotoMsg(v.error); return; }
    if (!fotoPin) { setFotoMsg('Ingresá tu PIN de admin para subir la foto.'); return; }
    setSubiendoFoto(true); setFotoMsg('Subiendo foto...');
    const r = await subirFoto(fotoPin, file);
    setSubiendoFoto(false);
    if (!r || !r.ok) { setFotoMsg(r?.mensaje || 'No se pudo subir la foto.'); return; }
    setFoto(r.url);
    setFotoMsg('Foto subida. Guardá el producto para que quede.');
  };

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
    const r = validarProducto(valores, { existentes, proveedores, editId: inicial?.id ?? null, rubros: Array.isArray(rubros) ? rubros : [], marcas: Array.isArray(marcas) ? marcas : [] });
    if (!r.ok) { setErrores(r.errores); return; }
    setGuardando(true);
    // Revisor (bloqueante 2): el stock solo se ajusta si el usuario TOCO el
    // campo, y la diferencia se calcula contra el valor que se le mostro (no
    // contra el ledger actual, que el sync pudo haber cambiado mientras tanto).
    const base = inicial ? stockMostrado : 0;
    const cambioStock = inicial ? String(valores.stock).trim() !== String(stockMostrado) : r.stock !== null;
    const producto = subirFoto ? { ...r.producto, imagen_url: foto || null } : r.producto;
    // REQ-FOT: con el PIN cargado, Configuración sube el producto a Supabase al guardar
    // (si no, queda solo en el dispositivo y la tienda no ve la foto nueva).
    const extra = subirFoto ? [{ pin: fotoPin }] : [];
    try { await onGuardar(producto, cambioStock ? r.stock : null, base, ...extra); } finally { setGuardando(false); }
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
        renderCampo={{
          categoria: (props) => <SelectorRubro {...props} rubros={rubros} />,
          marca: (props) => <SelectorMarca {...props} marcas={marcas} />,
          // AC-VTA-1: casilla "Mostrar en tienda" (el label del campo apunta a su id).
          visibleTienda: ({ id, value, onChange: set, disabled }) => (
            <input id={id} name="visibleTienda" type="checkbox" checked={value === true || value === 'true'} onChange={e => set(e.target.checked)} disabled={disabled} />
          ),
        }}
        ayudas={{
          // AC-PBU-1: si el precio por bulto supera al unitario se avisa, no se bloquea.
          precioBulto: avisoPrecioBulto(valores.precio, valores.precioBulto) || 'Opcional. Precio por unidad cuando se lleva al menos un bulto completo.',
          ventaPor: 'El precio es por unidad. "Bulto" exige Bulto x mayor que 1.',
          precio: `Costo neto ${fmt(costoNeto)} · sugerido ${fmt(precioVenta1)}${precioManual ? ' (precio cargado a mano)' : ''}`,
          stock: inicial
            ? `Stock actual: ${stockActual}. Si lo cambiás se registra un ajuste de inventario.`
            : 'Stock inicial (opcional). Después se suma con "Ingreso de mercadería".',
        }}
      />
      {subirFoto && (
        <div className="input-group" data-testid="foto-producto">
          <label className="input-label">Foto del producto</label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {/^https?:\/\//i.test(foto)
              ? <img src={foto} alt="" style={{ width: 72, height: 72, objectFit: 'contain', borderRadius: 8, background: 'var(--bg3)' }} data-testid="foto-preview" />
              : <div style={{ width: 72, height: 72, borderRadius: 8, background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--text3)' }}>Sin foto</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 180 }}>
              <input type="file" accept="image/jpeg,image/png,image/webp" disabled={subiendoFoto} data-testid="foto-input"
                onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) elegirFoto(f); }} />
              {foto && <button type="button" className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => { setFoto(''); setFotoMsg('Foto quitada. Guardá para confirmar.'); }}>Quitar foto</button>}
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }} data-testid="foto-msg">{fotoMsg || 'JPG, PNG o WEBP, hasta 2 MB. Para subirla, poné tu PIN de admin abajo.'}</div>
        </div>
      )}
      {precioManual && (
        <button className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }}
          onClick={() => { setPrecioManual(false); setValores(v => ({ ...v, precio: String(precioVenta1) })); }}>
          Usar precio calculado ({fmt(precioVenta1)})
        </button>
      )}
      {subirFoto && (
        // Cualquier cambio (precio, mínimo, foto...) queda solo en este dispositivo hasta subirlo
        // con el PIN (migración 007): con el PIN acá, Guardar lo sube a Supabase y la tienda lo ve.
        <div className="input-group" data-testid="pin-producto">
          <label className="input-label" htmlFor="pin-producto">Tu PIN de admin (para publicar el cambio)</label>
          <input id="pin-producto" className="input" type="password" inputMode="numeric" autoComplete="off" placeholder="Tu PIN de admin" aria-label="Tu PIN de admin"
            value={fotoPin} onChange={e => setFotoPin(e.target.value)} data-testid="foto-pin" />
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
            Con el PIN, al guardar el cambio se sube y se ve en la tienda y en los otros dispositivos. Sin PIN queda en este dispositivo hasta que toques "Subir productos".
          </div>
        </div>
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
