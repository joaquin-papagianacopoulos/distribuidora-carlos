// src/pages/Configuracion.js
import React, { useState, useRef } from 'react';
import { useApp } from '../hooks/useAppContext';
import {
  addProductoLocal, updateProducto, deleteProducto,
  addCliente, deleteCliente,
  getProductos,
  updateCliente, putProveedor, deleteProveedor,
} from '../db';
import ClienteForm from '../components/ClienteForm';
import ProductoForm from '../components/ProductoForm';
import ProveedorForm from '../components/ProveedorForm';
import { ajustarStock } from '../services/stockService';
import { puedeBorrarProveedor } from '../domain/proveedores';
import { nuevoId } from '../domain/validacion';
import { stockDe } from '../domain/stock';
import { planificarImportacion, resumirEntradas, textoResumen } from '../domain/plantillas';
import { descargarPlantilla } from '../services/plantillaExcel';
import { syncProductos, buscarImagenesFaltantes } from '../sync/syncService';
import { guardarVendedorAdmin, darDeBajaVendedorAdmin } from '../services/vendedoresService';
import { filtrarActivos, vendedoresParaSelector, MSG_BAJA_SIN_CONEXION } from '../domain/vendedores';
import { supabase } from '../lib/supabase';
import { isImageSearchConfigured } from '../services/imageSearch';
import { normalize } from '../utils/fuzzy';
import { detectarMarca } from '../utils/brands';
const TABS = ['productos', 'clientes', 'proveedores', 'vendedores'];


const parseCSVLine = (line) => {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if ((ch === ',' || ch === ';') && !inQuotes) { result.push(current.trim()); current = ''; }
    else { current += ch; }
  }
  result.push(current.trim());
  return result;
};

// S-07: xlsx 0.18.5 tiene CVEs de prototype pollution / ReDoS al PARSEAR
// archivos. Mitigacion hasta actualizar a la version de cdn.sheetjs.com:
// solo admin importa, y se rechazan archivos grandes.
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

// Lee un CSV/XLSX y devuelve las filas crudas (primera hoja). Las lineas en
// blanco se conservan para que el numero de fila del resumen coincida con el
// del archivo (AC-PLA-5).
const leerFilas = async (file) => {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('El archivo supera 5 MB.');
  const name = String(file.name || '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await import('xlsx');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const hoja = wb.SheetNames?.[0];
    if (!hoja) throw new Error('El archivo XLSX no tiene hojas.');
    return XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, raw: false, defval: '', blankrows: true });
  }
  const contenido = await file.text();
  return String(contenido).split('\n').map(l => l.trim()).map(l => (l ? parseCSVLine(l) : []));
};

// REQ-PLA / AC-PROD-5: la decision (crear / actualizar / rechazar) la toma el
// dominio (planificarImportacion); aca solo se ejecuta el plan.
const importarProductos = async (rows, { proveedores, usuario }) => {
  const plan = planificarImportacion(rows, 'productos', { existentes: await getProductos(), proveedores });
  if (!plan.ok) return { tipo: 'error', msg: plan.error };
  // Archivos viejos (nombre/precio/...) suben solo columnas basicas; la
  // plantilla nueva marca extrasDirty como el formulario (AC-PROD-5 / AC-PLA-3).
  const extras = plan.modo === 'plantilla' ? { extrasDirty: true } : {};
  const entradas = [];
  for (const e of plan.entradas) {
    try {
      if (e.accion === 'crear') {
        const p = e.valor.producto;
        const id = await addProductoLocal({ ...p, marca: detectarMarca(p.nombre), ...extras });
        // AC-PROD-3: stock inicial por el mismo camino que el alta manual.
        if (e.valor.stock) await ajustarStock(id, e.valor.stock, { usuario, inicial: true });
      } else if (e.accion === 'actualizar') {
        const p = e.valor.producto;
        await updateProducto({ ...e.existente, ...p, marca: detectarMarca(p.nombre) || e.existente.marca || '', ...extras });
      }
      entradas.push(e);
    } catch (err) {
      entradas.push({ ...e, accion: 'rechazar', errores: [`No se pudo guardar: ${err?.message || String(err)}`] });
    }
  }
  const resumen = resumirEntradas(entradas);
  return { tipo: 'success', msg: textoResumen(resumen), resumen };
};

// AC-PLA-4: mismas altas/ediciones que ClienteForm (extrasDirty => AC-CLI-5).
const importarClientes = async (rows, { existentes, vendedores }) => {
  const plan = planificarImportacion(rows, 'clientes', { existentes, vendedores });
  if (!plan.ok) return { tipo: 'error', msg: plan.error };
  const entradas = [];
  for (const e of plan.entradas) {
    try {
      if (e.accion === 'crear') await addCliente({ ...e.valor, boletaContraBoleta: false, extrasDirty: true });
      else if (e.accion === 'actualizar') await updateCliente({ ...e.existente, ...e.valor, extrasDirty: true });
      entradas.push(e);
    } catch (err) {
      entradas.push({ ...e, accion: 'rechazar', errores: [`No se pudo guardar: ${err?.message || String(err)}`] });
    }
  }
  const resumen = resumirEntradas(entradas);
  return { tipo: 'success', msg: textoResumen(resumen), resumen };
};

// AC-PLA-5: resumen con lista de rechazos (fila + motivo).
const ResultadoImport = ({ r, testId }) => {
  if (!r) return null;
  const ok = r.tipo === 'success';
  return (
    <div data-testid={testId} style={{
      marginTop: 10, padding: '10px 12px', borderRadius: 8, fontSize: 13,
      background: ok ? 'rgba(46,204,113,0.1)' : 'rgba(231,76,60,0.1)',
      color: ok ? 'var(--success)' : 'var(--danger)',
      border: `1px solid ${ok ? 'var(--success)' : 'var(--danger)'}`,
    }}>
      <div>{r.msg}</div>
      {r.resumen && (
        <div data-testid={`${testId}-resumen`} style={{ marginTop: 6, color: 'var(--text2)' }}>
          Creados: {r.resumen.creados} · Actualizados: {r.resumen.actualizados} · Rechazados: {r.resumen.rechazados}
          {r.resumen.stockIgnorado > 0 && ` · Stock ignorado en ${r.resumen.stockIgnorado} producto(s) existente(s)`}
        </div>
      )}
      {r.resumen?.rechazos?.length > 0 && (
        <ul data-testid={`${testId}-rechazos`} style={{ margin: '6px 0 0', paddingLeft: 18, maxHeight: 200, overflowY: 'auto', color: 'var(--danger)' }}>
          {r.resumen.rechazos.map(x => <li key={x.fila}>Fila {x.fila}: {x.motivo}</li>)}
        </ul>
      )}
    </div>
  );
};


const Configuracion = () => {
  const { productos, clientes, vendedores, vendedorActual, seleccionarVendedor, recargar, proveedores = [], stockMap } = useApp();
  const isAdmin = Number(vendedorActual?.permiso || 2) === 1;
  const [tab, setTab] = useState('productos');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({});
  const [resultadoCSV, setResultadoCSV] = useState(null);
  const [cargandoCSV, setCargandoCSV] = useState(false);
  const [progresoImagenes, setProgresoImagenes] = useState(null);
  const [buscar, setBuscar] = useState('');
  const [borrandoId, setBorrandoId] = useState(null);
  // REQ-VEN: baja de vendedor pendiente de confirmar con el PIN del admin.
  // El PIN vive solo en este estado y se limpia antes de llamar al servidor.
  const [bajaItem, setBajaItem] = useState(null);
  const [bajaPin, setBajaPin] = useState('');
  const csvRef = useRef(null);
  // REQ-PLA
  const [resultadoClientes, setResultadoClientes] = useState(null);
  const [cargandoClientes, setCargandoClientes] = useState(false);
  const [descargando, setDescargando] = useState(null);
  const clientesRef = useRef(null);

  if (!isAdmin) {
    return (
      <div className="page">
        <h1 className="page-title">ConfiguraciÃ³n</h1>
        <div className="empty-state">
          <div className="empty-icon">{'\u26D4'}</div>
          <div className="empty-text">No tenÃ©s permisos para acceder a ConfiguraciÃ³n</div>
        </div>
      </div>
    );
  }

  const openAdd = () => {
    setEditItem(null);
    setForm(tab === 'vendedores' ? { permiso: 2 } : {});
    setShowForm(true);
  };

  const openEdit = (item) => {
    setEditItem(item);
    // S-COM-13: el PIN nunca se precarga (no esta en el dispositivo).
    setForm({ ...item, permiso: Number(item?.permiso || 2), pin: '', clearPin: false, adminPin: '' });
    setShowForm(true);
  };

  const cerrarForm = () => { setShowForm(false); setForm({}); setEditItem(null); };
  const usuarioActual = vendedorActual?.nombre || '';

  // REQ-CLI: alta/edicion con validacion de dominio (ClienteForm ya valido).
  const guardarCliente = async (data) => {
    // extrasDirty: solo los clientes editados ACA suben los campos nuevos
    // (codigo, CUIT, etc.). Otros guardados (p. ej. Orden de entrega) suben
    // solo lo basico y no pisan con NULL lo que cargo el admin (revisor, bloqueante 1).
    if (editItem) await updateCliente({ ...editItem, ...data, extrasDirty: true });
    else await addCliente({ ...data, extrasDirty: true });
    await recargar();
    cerrarForm();
  };

  // REQ-PROD: el stock no se guarda en el producto; se registra como movimiento.
  const guardarProducto = async (data, stock, stockMostrado) => {
    try {
      if (editItem) {
        await updateProducto({ ...editItem, ...data, marca: editItem.marca || detectarMarca(data.nombre), extrasDirty: true });
        if (stock !== null && stock !== undefined) await ajustarStock(editItem.id, stock, { usuario: usuarioActual, base: stockMostrado });
      } else {
        const id = await addProductoLocal({ ...data, unidad: 'unidad', marca: detectarMarca(data.nombre), extrasDirty: true });
        if (stock) await ajustarStock(id, stock, { usuario: usuarioActual, inicial: true });
      }
    } catch (e) {
      alert('No se pudo guardar el producto:\n' + (e?.message || String(e)));
      return;
    }
    await recargar();
    cerrarForm();
  };

  // REQ-PROV
  const guardarProveedor = async (data) => {
    await putProveedor({ ...(editItem || {}), id: editItem?.id || nuevoId(), ...data });
    await recargar();
    cerrarForm();
  };

  const handleSave = async () => {
    if (tab === 'vendedores') {
      // S-COM-13: alta/edicion SOLO por la RPC admin_guardar_vendedor (002),
      // autorizada con el PIN del admin. Nunca se manda ni se guarda "pin" en
      // texto plano; el PIN nuevo y el del admin viven solo en este formulario
      // y se borran del estado antes de llamar al servidor.
      const adminPin = form.adminPin;
      const formSinSecretos = { ...form, pin: '', adminPin: '' };
      setForm(formSinSecretos);
      const r = await guardarVendedorAdmin({
        admin: vendedorActual,
        adminPin,
        form,
        previo: editItem,
        online: navigator.onLine,
      });
      if (!r.ok) {
        alert('No se pudo guardar el vendedor:\n' + r.mensaje);
        return;
      }
    }
    await recargar();
    setShowForm(false);
    setForm({});
    setEditItem(null);
  };

  // Borra el producto en Supabase y recien despues en este dispositivo.
  // Antes solo se borraba local: en la siguiente sincronizacion
  // downloadMaestros lo volvia a bajar de Supabase y el producto "revivia".
  const borrarProductoRemoto = async (id) => {
    const { error } = await supabase.from('productos').delete().eq('id', id);
    if (error) throw error;
    // Si RLS no permite borrar, Supabase no devuelve error: simplemente no
    // borra nada. Por eso se verifica que la fila ya no exista.
    const { data, error: errCheck } = await supabase.from('productos').select('id').eq('id', id);
    if (errCheck) throw errCheck;
    if (data && data.length > 0) {
      throw new Error('Supabase no permitio borrar el producto (revisar las politicas RLS de la tabla productos).');
    }
  };

  // REQ-VEN (AC-VEN-1..5): baja logica por RPC con el PIN del admin.
  // Antes se borraba solo de IndexedDB y el pull lo volvia a bajar.
  const confirmarBajaVendedor = async () => {
    const item = bajaItem;
    if (!item) return;
    const adminPin = bajaPin;
    setBajaPin('');
    setBorrandoId(item.id);
    let r;
    try {
      r = await darDeBajaVendedorAdmin({
        admin: vendedorActual,
        adminPin,
        vendedor: item,
        vendedores,
        online: navigator.onLine,
      });
    } finally {
      setBorrandoId(null);
    }
    if (!r.ok) {
      alert('No se pudo dar de baja al vendedor:\n' + r.mensaje);
      return;
    }
    setBajaItem(null);
    // AC-VEN-4: si era la sesion abierta en este dispositivo, se cierra.
    const eraSesion = vendedorActual && (vendedorActual.id === item.id
      || (item.remoteId != null && String(vendedorActual.remoteId) === String(item.remoteId)));
    if (eraSesion) seleccionarVendedor(null);
    await recargar();
  };

  const handleDelete = async (item) => {
    if (tab === 'vendedores') {
      // Requiere conexion: sin servidor no se toca nada (AC-VEN-1).
      if (!navigator.onLine) {
        alert(MSG_BAJA_SIN_CONEXION);
        return;
      }
      setBajaPin('');
      setBajaItem(item);
      return;
    }
    if (!window.confirm(`¿Eliminar "${item.nombre}"?`)) return;
    if (tab === 'productos') {
      if (!navigator.onLine) {
        alert('Para borrar un producto tenés que tener internet. Si no, vuelve a aparecer al sincronizar.');
        return;
      }
      setBorrandoId(item.id);
      try {
        await borrarProductoRemoto(item.id);
        await deleteProducto(item.id);
      } catch (e) {
        alert('No se pudo borrar el producto:\n' + (e?.message || String(e)));
        return;
      } finally {
        setBorrandoId(null);
      }
    }
    else if (tab === 'clientes') await deleteCliente(item.id);
    else if (tab === 'proveedores') {
      // AC-PROV-3: no borrar si tiene productos asociados.
      const chk = puedeBorrarProveedor(item.id, productos);
      if (!chk.ok) {
        alert(`No se puede borrar: el proveedor tiene ${chk.asociados} producto(s) asociado(s).`);
        return;
      }
      if (!navigator.onLine) {
        alert('Para borrar un proveedor tenés que tener internet. Si no, vuelve a aparecer al sincronizar.');
        return;
      }
      try {
        const { error } = await supabase.from('proveedores').delete().eq('id', item.id);
        if (error) throw error;
        await deleteProveedor(item.id);
      } catch (e) {
        alert('No se pudo borrar el proveedor:\n' + (e?.message || String(e)));
        return;
      }
    }
    await recargar();
  };

  const listaBase = tab === 'productos' ? productos
    : tab === 'clientes' ? clientes
      : tab === 'proveedores' ? proveedores
        : filtrarActivos(vendedores); // AC-VEN-3: los dados de baja no se listan
  const q = normalize(buscar.trim());
  const lista = !q || tab === 'vendedores'
    ? listaBase
    : tab === 'proveedores'
      ? listaBase.filter(p => normalize(p.descripcion || '').includes(q) || normalize(String(p.codigo || '')).includes(q))
    : tab === 'productos'
      ? listaBase.filter(p =>
          normalize(p.nombre || '').includes(q)
          || normalize(String(p.codigo || '')).includes(q)
          || normalize(p.categoria || '').includes(q)
          || normalize(p.marca || '').includes(q))
      : listaBase.filter(c =>
          normalize(c.nombre || '').includes(q)
          || normalize(c.direccion || '').includes(q)
          || normalize(c.telefono || '').includes(q)
          || normalize(c.alias || '').includes(q)
          || normalize(String(c.codigo || '')).includes(q)
          || normalize(String(c.cuit || '')).includes(q));

  const handleCSV = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setCargandoCSV(true);
    setResultadoCSV(null);
    let r = null;
    try {
      const rows = await leerFilas(file);
      r = await importarProductos(rows, { proveedores, usuario: usuarioActual });
    } catch (err) {
      r = { tipo: 'error', msg: 'Error leyendo el archivo: ' + err.message };
    }
    setResultadoCSV(r);
    if (r.tipo === 'success') {
      await recargar();
      // Sincronizar productos actualizados a Supabase
      if (navigator.onLine) {
        try {
          await syncProductos();
          setResultadoCSV({ ...r, msg: `${r.msg} Sincronizado ✓` });
        } catch (err) {
          setResultadoCSV({ ...r, msg: `${r.msg} (Sin internet, se sincronizará luego)` });
        }
      }
    }
    setCargandoCSV(false);
    if (csvRef.current) csvRef.current.value = '';

    if (isImageSearchConfigured() && navigator.onLine) {
      await buscarFotos();
    }
  };

  // AC-PLA-4: importacion de clientes (solo admin: la pantalla entera lo es).
  const handleImportClientes = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setCargandoClientes(true);
    setResultadoClientes(null);
    let r;
    try {
      const rows = await leerFilas(file);
      r = await importarClientes(rows, { existentes: clientes, vendedores });
      if (r.tipo === 'success') await recargar();
    } catch (err) {
      r = { tipo: 'error', msg: 'Error leyendo el archivo: ' + err.message };
    }
    setResultadoClientes(r);
    setCargandoClientes(false);
    if (clientesRef.current) clientesRef.current.value = '';
  };

  // AC-PLA-1 / AC-PLA-2
  const bajarPlantilla = async (entidad) => {
    setDescargando(entidad);
    try {
      await descargarPlantilla(entidad, { proveedores, vendedores });
    } catch (err) {
      alert('No se pudo generar la plantilla:\n' + (err?.message || String(err)));
    } finally {
      setDescargando(null);
    }
  };

  const buscarFotos = async () => {
    setProgresoImagenes({ procesados: 0, total: 0 });
    try {
      const r = await buscarImagenesFaltantes(setProgresoImagenes);
      await recargar();
      if (r.total === 0) {
        setProgresoImagenes(null);
      } else {
        setProgresoImagenes({
          ...r,
          done: true,
          msg: `📷 ${r.encontrados} foto${r.encontrados !== 1 ? 's' : ''} encontrada${r.encontrados !== 1 ? 's' : ''}${r.agotado ? ' (se alcanzó el límite diario gratuito, el resto se busca en la próxima importación)' : ''}.`,
        });
      }
    } catch (err) {
      setProgresoImagenes({ done: true, msg: 'Error buscando fotos: ' + err.message, error: true });
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">Configuración</h1>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {TABS.map(t => (
          <button
            key={t}
            className={`btn btn-sm ${tab === t ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => { setTab(t); setShowForm(false); setBuscar(''); setBajaItem(null); setBajaPin(''); }}
            style={{ flex: 1, textTransform: 'capitalize' }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Cambiar vendedor activo */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 600 }}>
          Vendedor activo
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600 }}>{vendedorActual?.nombre || '—'}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => seleccionarVendedor(null)}>
            Cambiar
          </button>
        </div>
      </div>

      {/* Importacion de productos (CSV/XLSX + plantilla) — solo pestaña productos */}
      {tab === 'productos' && (
        <div className="card" style={{ marginBottom: 16 }} data-testid="import-productos">
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 600 }}>
            Importar / Actualizar desde CSV
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12, lineHeight: 1.5 }}>
            Bajá la <strong style={{ color: 'var(--text2)' }}>plantilla Excel</strong>: trae una columna por cada campo del alta de productos y una hoja de instrucciones.
            Si un producto ya existe (mismo código, o mismo nombre si no tiene código) se actualiza; el stock solo se carga en productos nuevos.
            También sigue funcionando el CSV viejo con columnas <strong style={{ color: 'var(--text2)' }}>nombre</strong> y <strong style={{ color: 'var(--text2)' }}>precio</strong> (opcional: código, unidad, categoría). Separá columnas con coma o punto y coma.
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--bg3)', padding: '8px 10px', borderRadius: 6, fontFamily: 'monospace', marginBottom: 12 }}>
            nombre;precio;codigo;unidad;categoria{'\n'}
            Coca Cola 500ml;350;CC500;unidad;Bebidas
          </div>
          <input
            ref={csvRef}
            type="file"
            accept=".csv,.txt,.xlsx,.xls"
            style={{ display: 'none' }}
            onChange={handleCSV}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-ghost btn-sm"
              style={{ width: 'auto' }}
              onClick={() => bajarPlantilla('productos')}
              disabled={descargando === 'productos'}
              data-testid="plantilla-productos"
            >
              {descargando === 'productos' ? 'Generando...' : 'Descargar plantilla Excel'}
            </button>
            <button
              className={`btn ${cargandoCSV ? 'btn-ghost' : 'btn-primary'} btn-sm`}
              style={{ width: 'auto' }}
              onClick={() => csvRef.current?.click()}
              disabled={cargandoCSV}
            >
              {cargandoCSV ? '⏳ Importando...' : '📂 Seleccionar archivo CSV/XLSX'}
            </button>
          </div>
          <ResultadoImport r={resultadoCSV} testId="resultado-productos" />

          {progresoImagenes && !progresoImagenes.done && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text3)' }}>
              Buscando fotos... {progresoImagenes.procesados}/{progresoImagenes.total}
            </div>
          )}
          {progresoImagenes?.done && (
            <div style={{
              marginTop: 10, padding: '10px 12px', borderRadius: 8, fontSize: 13,
              background: progresoImagenes.error ? 'rgba(231,76,60,0.1)' : 'rgba(46,204,113,0.1)',
              color: progresoImagenes.error ? 'var(--danger)' : 'var(--success)',
              border: `1px solid ${progresoImagenes.error ? 'var(--danger)' : 'var(--success)'}`,
            }}>
              {progresoImagenes.msg}
            </div>
          )}
        </div>
      )}

      {/* REQ-PLA (AC-PLA-2/4/5): importacion de clientes — solo pestaña clientes */}
      {tab === 'clientes' && (
        <div className="card" style={{ marginBottom: 16 }} data-testid="import-clientes">
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 600 }}>
            Importar / Actualizar clientes
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12, lineHeight: 1.5 }}>
            Bajá la <strong style={{ color: 'var(--text2)' }}>plantilla Excel</strong> (los 17 campos del alta de clientes, con instrucciones), completala y subila como XLSX o CSV.
            Si el código de cliente ya existe se actualiza ese cliente. Las filas con error se informan y no frenan al resto.
          </div>
          <input
            ref={clientesRef}
            type="file"
            accept=".csv,.txt,.xlsx,.xls"
            style={{ display: 'none' }}
            onChange={handleImportClientes}
            data-testid="input-import-clientes"
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-ghost btn-sm"
              style={{ width: 'auto' }}
              onClick={() => bajarPlantilla('clientes')}
              disabled={descargando === 'clientes'}
              data-testid="plantilla-clientes"
            >
              {descargando === 'clientes' ? 'Generando...' : 'Descargar plantilla Excel'}
            </button>
            <button
              className={`btn ${cargandoClientes ? 'btn-ghost' : 'btn-primary'} btn-sm`}
              style={{ width: 'auto' }}
              onClick={() => clientesRef.current?.click()}
              disabled={cargandoClientes}
            >
              {cargandoClientes ? '⏳ Importando...' : '📂 Seleccionar archivo CSV/XLSX'}
            </button>
          </div>
          <ResultadoImport r={resultadoClientes} testId="resultado-clientes" />
        </div>
      )}

      {/* Lista */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{lista.length} {tab}</span>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Agregar</button>
        </div>

        {tab !== 'vendedores' && (
          <input
            className="input"
            type="search"
            value={buscar}
            onChange={e => setBuscar(e.target.value)}
            placeholder={tab === 'productos'
              ? 'Buscar producto por nombre, código, categoría o marca...'
              : 'Buscar cliente por nombre, dirección o teléfono...'}
            autoComplete="off"
            style={{ marginBottom: 12 }}
          />
        )}

        {lista.length === 0 && (
          <div style={{ color: 'var(--text3)', fontSize: 14, textAlign: 'center', padding: '20px 0' }}>
            {tab !== 'vendedores' && buscar.trim() ? 'Sin resultados para la búsqueda' : `No hay ${tab} cargados`}
          </div>
        )}

        {lista.map(item => (
          <div key={item.id} className="list-item">
            <div>
              <div className="list-item-name">
                {tab === 'proveedores' ? item.descripcion : item.nombre}
                {tab === 'clientes' && item.syncConflicto && (
                  <span title={item.syncConflicto} style={{
                    marginLeft: 6, fontSize: 10, fontWeight: 700, color: 'var(--danger)',
                  }}>
                    ⚠ CÓDIGO REPETIDO
                  </span>
                )}
                {tab === 'clientes' && item.boletaContraBoleta && (
                  <span style={{
                    marginLeft: 6, fontSize: 10, fontWeight: 700, color: 'var(--accent)',
                    background: 'var(--accent-dim)', borderRadius: 6, padding: '2px 6px',
                  }}>
                    BOLETA x BOLETA
                  </span>
                )}
              </div>
              <div className="list-item-sub">
                {tab === 'productos' && `$${item.precio?.toLocaleString('es-AR')} · ${item.unidad || ''} ${item.codigo ? `· ${item.codigo}` : ''} · Stock: ${stockDe(stockMap, item.id)}`}
                {tab === 'clientes' && `${item.codigo ? `${item.codigo} · ` : ''}${item.direccion || ''} ${item.telefono ? `· ${item.telefono}` : ''}`}
                {tab === 'proveedores' && `Código ${item.codigo} · ${productos.filter(p => p.proveedorId === item.id).length} producto(s)`}
                {tab === 'vendedores' && (item.zona ? `Zona: ${item.zona}` : '')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {tab !== 'vendedores' && (
                <button className="btn-icon" onClick={() => openEdit(item)} style={{ fontSize: 14 }}>✏</button>
              )}
              <button
                className="btn-icon"
                style={{ color: 'var(--danger)', borderColor: 'var(--danger)', fontSize: 16 }}
                onClick={() => handleDelete(item)}
                disabled={borrandoId === item.id}
              >{borrandoId === item.id ? '⏳' : '×'}</button>
            </div>
          </div>
        ))}
      </div>

      {/* REQ-VEN: confirmar baja de vendedor con el PIN del admin */}
      {bajaItem && tab === 'vendedores' && (
        <div className="card" style={{ marginTop: 16 }} data-testid="baja-vendedor">
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Dar de baja a "{bajaItem.nombre}"</div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
            No va a poder ingresar más y deja de aparecer en los listados. Sus pedidos, clientes e historial de comisiones no cambian.
          </div>
          <div className="input-group">
            <label className="input-label">Tu PIN de admin (para confirmar)</label>
            <input
              className="input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              data-testid="admin-pin-baja"
              value={bajaPin}
              onChange={e => setBajaPin(e.target.value)}
              placeholder="Se verifica en el servidor; necesitás conexión"
              autoFocus
            />
          </div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 80 }}>
            <button className="btn btn-ghost" onClick={() => { setBajaItem(null); setBajaPin(''); }}>Cancelar</button>
            <button
              className="btn btn-primary"
              style={{ flex: 1, background: 'var(--danger)', borderColor: 'var(--danger)' }}
              onClick={confirmarBajaVendedor}
              disabled={borrandoId === bajaItem.id}
              data-testid="confirmar-baja"
            >{borrandoId === bajaItem.id ? 'Dando de baja...' : 'Dar de baja'}</button>
          </div>
        </div>
      )}

      {/* FORMULARIOS DE ALTA (REQ-CLI / REQ-PROD / REQ-PROV) */}
      {showForm && tab === 'clientes' && (
        <ClienteForm
          key={editItem?.id ?? 'nuevo'}
          inicial={editItem}
          existentes={clientes}
          vendedores={vendedoresParaSelector(vendedores, editItem?.vendedor)}
          onGuardar={guardarCliente}
          onCancelar={cerrarForm}
        />
      )}
      {showForm && tab === 'productos' && (
        <ProductoForm
          key={editItem?.id ?? 'nuevo'}
          inicial={editItem}
          existentes={productos}
          proveedores={proveedores}
          stockActual={editItem ? stockDe(stockMap, editItem.id) : 0}
          onGuardar={guardarProducto}
          onCancelar={cerrarForm}
        />
      )}
      {showForm && tab === 'proveedores' && (
        <ProveedorForm
          key={editItem?.id ?? 'nuevo'}
          inicial={editItem}
          existentes={proveedores}
          onGuardar={guardarProveedor}
          onCancelar={cerrarForm}
        />
      )}

      {/* FORM VENDEDORES */}
      {showForm && tab === 'vendedores' && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>
            {editItem ? 'Editar' : 'Nuevo'} {tab.slice(0, -1)}
          </div>

          <div className="input-group">
            <label className="input-label">Nombre *</label>
            <input className="input" value={form.nombre || ''} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} autoFocus />
          </div>

          {tab === 'vendedores' && (
            <div className="input-group">
              <label className="input-label">Zona</label>
              <input className="input" value={form.zona || ''} onChange={e => setForm(f => ({ ...f, zona: e.target.value }))} />
            </div>
          )}

          {tab === 'vendedores' && (
            <>
              <div className="input-group">
                <label className="input-label">Permiso</label>
                <select className="input" value={Number(form.permiso || 2)} onChange={e => setForm(f => ({ ...f, permiso: Number(e.target.value) }))}>
                  <option value={1}>1 - Admin (acceso total)</option>
                  <option value={2}>2 - Vendedor (solo pedidos)</option>
                  <option value={3}>3 - Armador (solo armado de pedidos)</option>
                </select>
              </div>
              <div className="input-group">
                <label className="input-label">PIN (opcional)</label>
                <input
                  className="input"
                  type="password"
                  inputMode="numeric"
                  value={form.pin || ''}
                  onChange={e => setForm(f => ({ ...f, pin: e.target.value }))}
                  placeholder={editItem ? 'Dejar vacio para no cambiar' : '4 a 8 digitos (obligatorio para admin)'}
                  autoComplete="new-password"
                />
                {editItem && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13, color: 'var(--text2)' }}>
                    <input
                      type="checkbox"
                      checked={!!form.clearPin}
                      onChange={e => setForm(f => ({ ...f, clearPin: e.target.checked }))}
                    />
                    Quitar PIN
                  </label>
                )}
              </div>
            </>
          )}

          {tab === 'vendedores' && (
            <div className="input-group">
              <label className="input-label">Tu PIN de admin (para confirmar)</label>
              <input
                className="input"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                data-testid="admin-pin-vendedor"
                value={form.adminPin || ''}
                onChange={e => setForm(f => ({ ...f, adminPin: e.target.value }))}
                placeholder="Se verifica en el servidor; necesitás conexión"
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginBottom: 80 }}>
            <button className="btn btn-ghost" onClick={() => { setShowForm(false); setForm({}); }}>Cancelar</button>
            <button className="btn btn-primary" onClick={handleSave} style={{ flex: 1 }}>Guardar</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Configuracion;
