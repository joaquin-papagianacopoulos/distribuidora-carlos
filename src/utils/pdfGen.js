// src/utils/pdfGen.js - Generacion de PDFs
import { getOrdenEntrega } from './ordenEntrega';
import { isPedidoVisible, normalizePedidoFecha } from './pedidos';
import { filasPdfCierre } from '../domain/comisiones';
import { filasBoleta } from '../domain/gruposFactura';
import { totalesBoleta } from '../domain/precios';
import { layoutPieBoleta, encabezadoTipoFactura } from '../domain/boletaLayout';

const alpha = (a, b) =>
  String(a || '').localeCompare(String(b || ''), 'es', { sensitivity: 'base' });

// Lista simple para repartidor/armador: nombre del cliente y un casillero en
// blanco al lado para anotar un numero a mano (orden de entrega, bulto, etc.).
// Puede combinar varios dias juntos (por eso recibe la lista de fechas).
const buildListaClientesDoc = async (pedidos, fechas) => {
  const { jsPDF } = await import('jspdf');
  // jspdf-autotable 5.x ya no se auto-registra al importarse (S-06).
  const { applyPlugin } = await import('jspdf-autotable');
  applyPlugin(jsPDF);

  const doc = new jsPDF();
  const fechasOrdenadas = [...(fechas || [])].sort();
  const multiDia = fechasOrdenadas.length > 1;
  const fmtFecha = (f) => String(f || '').split('-').reverse().join('/');

  const filas = [...(pedidos || [])]
    .sort((a, b) => alpha(a.clienteNombre, b.clienteNombre) || alpha(a.fecha, b.fecha))
    .map(p => [
      '',
      multiDia ? `${p.clienteNombre}  (${fmtFecha(normalizePedidoFecha(p.fecha))})` : p.clienteNombre,
    ]);

  const titulo = multiDia
    ? `Lista de clientes - ${fmtFecha(fechasOrdenadas[0])} a ${fmtFecha(fechasOrdenadas[fechasOrdenadas.length - 1])}`
    : `Lista de clientes - ${fmtFecha(fechasOrdenadas[0])}`;

  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(titulo, 14, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Clientes: ${filas.length}`, 14, 18);

  doc.autoTable({
    startY: 24,
    head: [['N°', 'Cliente']],
    body: filas,
    theme: 'grid',
    styles: { fontSize: 11, cellPadding: 4, minCellHeight: 10, lineColor: [80, 80, 80], lineWidth: 0.35 },
    headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: 'bold' },
    tableLineColor: [60, 60, 60],
    tableLineWidth: 0.45,
    columnStyles: {
      0: { cellWidth: 22, halign: 'center' },
      1: { cellWidth: 158 },
    },
  });

  const filename = multiDia
    ? `lista_clientes_${fechasOrdenadas[0]}_a_${fechasOrdenadas[fechasOrdenadas.length - 1]}.pdf`
    : `lista_clientes_${fechasOrdenadas[0]}.pdf`;
  return { doc, filename };
};

export const generarListaClientesFile = async (pedidos, fechas) => {
  const { doc, filename } = await buildListaClientesDoc(pedidos, fechas);
  const blob = doc.output('blob');
  return new File([blob], filename, { type: 'application/pdf' });
};

const buildResumenDoc = async ({ pedidos, desde, hasta }) => {
  const { jsPDF } = await import('jspdf');
  // jspdf-autotable 5.x ya no se auto-registra al importarse (S-06).
  const { applyPlugin } = await import('jspdf-autotable');
  applyPlugin(jsPDF);

  const doc = new jsPDF();
  const totalesPorProducto = {};

  (pedidos || []).forEach(pedido => {
    if (!isPedidoVisible(pedido)) return;
    (pedido.items || []).forEach(item => {
      const key = item.productoId ?? item.nombre;
      if (!totalesPorProducto[key]) {
        totalesPorProducto[key] = { nombre: item.nombre, cantidad: 0, subtotal: 0 };
      }
      totalesPorProducto[key].cantidad += Number(item.cantidad);
      totalesPorProducto[key].subtotal += Number(item.cantidad) * Number(item.precio);
    });
  });

  const totalGeneral = Object.values(totalesPorProducto).reduce((acc, p) => acc + p.subtotal, 0);
  const pedidosCount = (pedidos || []).filter(isPedidoVisible).length;

  const rows = Object.values(totalesPorProducto)
    .sort((a, b) => alpha(a.nombre, b.nombre))
    .map(p => [p.nombre, p.cantidad, `$${p.subtotal.toLocaleString('es-AR')}`]);

  const titulo =
    hasta && hasta !== desde
      ? `Resumen ${desde.split('-').reverse().join('/')} a ${hasta.split('-').reverse().join('/')}`
      : `Resumen ${desde.split('-').reverse().join('/')}`;

  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(titulo, 14, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Pedidos: ${pedidosCount}`, 14, 18);
  doc.text(`Total vendido: $${totalGeneral.toLocaleString('es-AR')}`, 70, 18);

  doc.autoTable({
    startY: 24,
    head: [['Producto', 'Cantidad', 'Subtotal']],
    body: rows,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    columnStyles: {
      0: { cellWidth: 100 },
      1: { cellWidth: 40, halign: 'center' },
      2: { cellWidth: 40, halign: 'right' },
    },
    foot: [['', 'TOTAL', `$${totalGeneral.toLocaleString('es-AR')}`]],
    footStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: 'bold' },
  });

  const filename =
    hasta && hasta !== desde ? `resumen_${desde}_a_${hasta}.pdf` : `resumen_dia_${desde}.pdf`;

  return { doc, filename };
};

export const generarResumenDia = async (pedidos, fecha) => {
  const { doc, filename } = await buildResumenDoc({ pedidos, desde: fecha, hasta: null });
  doc.save(filename);
};

export const generarResumenDiaFile = async (pedidos, fecha) => {
  const { doc, filename } = await buildResumenDoc({ pedidos, desde: fecha, hasta: null });
  const blob = doc.output('blob');
  return new File([blob], filename, { type: 'application/pdf' });
};

export const generarResumenRango = async (pedidos, desde, hasta) => {
  const { doc, filename } = await buildResumenDoc({ pedidos, desde, hasta });
  doc.save(filename);
};

// modo:
//  - 'producto': una fila por registro, ordenado por producto (default).
//  - 'cliente': una fila por registro, ordenado por cliente (asi se ve agrupado por cliente).
//  - 'lista_compras': suma las cantidades de cada producto (sin importar el cliente),
//    para saber de un vistazo cuanto hay que reponer/comprar de cada uno.
const buildFaltantesDiaDoc = async (faltantesDelDia, fecha, modo = 'producto') => {
  const { jsPDF } = await import('jspdf');
  // jspdf-autotable 5.x ya no se auto-registra al importarse (S-06).
  const { applyPlugin } = await import('jspdf-autotable');
  applyPlugin(jsPDF);

  const doc = new jsPDF();
  const fechaFmt = String(fecha || '').split('-').reverse().join('/');
  const totalUnidades = (faltantesDelDia || []).reduce((acc, f) => acc + Number(f.cantidadFaltante || 0), 0);

  let titulo, head, rows, columnStyles;

  if (modo === 'lista_compras') {
    const map = new Map();
    for (const f of (faltantesDelDia || [])) {
      const k = f.productoId || f.productoNombre;
      const prev = map.get(k);
      if (prev) prev.cantidad += Number(f.cantidadFaltante || 0);
      else map.set(k, { nombre: f.productoNombre, cantidad: Number(f.cantidadFaltante || 0) });
    }
    const agrupado = [...map.values()].sort((a, b) => alpha(a.nombre, b.nombre));

    titulo = `Lista de compras - faltantes del dia ${fechaFmt}`;
    head = [['Producto', 'Cantidad']];
    rows = agrupado.map(a => [a.nombre, a.cantidad]);
    columnStyles = { 0: { cellWidth: 140 }, 1: { cellWidth: 30, halign: 'center' } };
  } else {
    const sorted = [...(faltantesDelDia || [])].sort((a, b) =>
      modo === 'cliente'
        ? (alpha(a.clienteNombre, b.clienteNombre) || alpha(a.productoNombre, b.productoNombre))
        : (alpha(a.productoNombre, b.productoNombre) || alpha(a.clienteNombre, b.clienteNombre))
    );
    titulo = `Faltantes del dia ${fechaFmt} (por ${modo === 'cliente' ? 'cliente' : 'producto'})`;
    head = [['Producto', 'Cliente', 'Cantidad']];
    rows = sorted.map(f => [f.productoNombre, f.clienteNombre, f.cantidadFaltante]);
    columnStyles = { 0: { cellWidth: 100 }, 1: { cellWidth: 60 }, 2: { cellWidth: 22, halign: 'center' } };
  }

  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(titulo, 14, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Registros: ${rows.length}  ·  Unidades faltantes: ${totalUnidades}`, 14, 18);

  doc.autoTable({
    startY: 24,
    head,
    body: rows,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2, lineColor: [80, 80, 80], lineWidth: 0.35 },
    headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [232, 232, 232] },
    tableLineColor: [60, 60, 60],
    tableLineWidth: 0.45,
    columnStyles,
  });

  const sufijo = modo === 'lista_compras' ? '_lista_compras' : modo === 'cliente' ? '_por_cliente' : '';
  const filename = `faltantes_${fecha}${sufijo}.pdf`;
  return { doc, filename };
};

export const generarFaltantesDiaFile = async (faltantesDelDia, fecha, modo = 'producto') => {
  const { doc, filename } = await buildFaltantesDiaDoc(faltantesDelDia, fecha, modo);
  const blob = doc.output('blob');
  return new File([blob], filename, { type: 'application/pdf' });
};

// opciones (todas opcionales, retrocompatible):
//   tipoFactura: 'A' | 'B' => muestra "FACTURA A/B" en el encabezado (REQ-FAB, AC-FAB-4).
//   modoGrupos: 'detalle' | 'solo_grupos' => como se imprimen los grupos (REQ-AGR, AC-AGR-3).
const buildFacturaDoc = async (pedido, cliente, vendedor, deudaPendiente = 0, ordenOverride = null, opciones = {}) => {
  const { jsPDF } = await import('jspdf');
  // jspdf-autotable 5.x ya no se auto-registra al importarse (S-06).
  const { applyPlugin } = await import('jspdf-autotable');
  applyPlugin(jsPDF);

  const doc = new jsPDF();
  const pageH = doc.internal.pageSize.getHeight();
  const numero = String(pedido.id).padStart(6, '0');
  const fechaPedido = normalizePedidoFecha(pedido.fecha);
  const fecha = fechaPedido.split('-').reverse().join('/');

  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('DISTRIBUIDORA APP', 14, 9);
  doc.setFontSize(7);
  doc.text(`BOLETA N° ${numero}`, 14, 13);
  const encabezadoFactura = encabezadoTipoFactura(opciones?.tipoFactura ?? pedido.tipoFactura);
  if (encabezadoFactura) {
    doc.setFontSize(11);
    doc.text(encabezadoFactura, 112, 9, { align: 'center' });
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Fecha: ${fecha}`, 150, 10);

  // El numero override viene de "Orden de entrega": se calcula al imprimir
  // (renumerando segun quien tiene pedido en su zona), no queda guardado en el pedido.
  const ordenEntrega = ordenOverride ?? getOrdenEntrega(pedido);
  if (ordenEntrega) {
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.8);
    doc.rect(174, 13, 22, 15);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.text('ORDEN', 185, 17, { align: 'center' });
    doc.setFontSize(16);
    doc.text(String(ordenEntrega), 185, 26, { align: 'center' });
  }

  // Cliente grande (prioridad visual)
  const clienteNombreBig = pedido.clienteNombre || cliente?.nombre || 'Sin nombre';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(clienteNombreBig, 14, 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Vendedor: ${vendedor?.nombre || pedido.vendedorNombre || pedido.vendedor || '-'}`, 14, 23);

  // Filas de la tabla: renglones sueltos y grupos (REQ-AGR). Los totales salen siempre
  // de los items, nunca de las filas (no hay doble conteo).
  const sortedItems = [...(pedido.items || [])].sort((a, b) => alpha(a.nombre, b.nombre));
  const filas = filasBoleta(pedido.items || [], pedido.grupos, { modo: opciones?.modoGrupos === 'solo_grupos' ? 'solo_grupos' : 'detalle' });
  const rows = filas.map(f => [f.nombre, f.cantidadTexto, f.precioTexto, `$${Number(f.subtotal).toLocaleString('es-AR')}`]);

  // REQ-FRB: el precio de bulto no se muestra como descuento (base = precioBaseRenglon).
  const { total, totalSinDescuento: totalSinDesc, descuento: descuentoTotal, descuentoPct } = totalesBoleta(sortedItems);

  doc.autoTable({
    startY: 28,
    // El pie (totales, deuda, obs y troquel) lo ubica layoutPieBoleta; la tabla solo deja un margen chico.
    margin: { left: 14, right: 14, bottom: 14 },
    head: [['Producto', 'Cant.', 'Precio Unit.', 'Subtotal']],
    body: rows,
    theme: 'grid',
    // Mas contraste para impresoras: gris mas marcado + bordes mas gruesos.
    styles: { fontSize: 9, cellPadding: 2, lineColor: [80, 80, 80], lineWidth: 0.35 },
    headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [232, 232, 232] },
    tableLineColor: [60, 60, 60],
    tableLineWidth: 0.45,
    columnStyles: {
      // A4 ancho 210mm, con margenes 14/14 => 182mm max para que no se pase del borde.
      0: { cellWidth: 90 },
      1: { cellWidth: 28, halign: 'center' },
      2: { cellWidth: 32, halign: 'right' },
      3: { cellWidth: 32, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const tipo = filas[data.row.index]?.tipo;
      if (tipo === 'grupo') { data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = [210, 210, 210]; }
      else if (tipo === 'detalle') { data.cell.styles.fontStyle = 'italic'; data.cell.styles.textColor = [70, 70, 70]; data.cell.styles.fillColor = [255, 255, 255]; }
    },
  });

  const finalY = doc.lastAutoTable.finalY + 6;
  const hayDescuento = descuentoTotal > 0.001;
  const hayDeuda = deudaPendiente > 0.001;
  // REQ-REN (AC-REN-3): saldo a favor del cliente (ya neteado con la deuda por cuentaParaBoleta).
  // Va en el mismo lugar que la deuda (nunca aparecen las dos).
  const saldoAFavor = !hayDeuda && Number(opciones?.saldoAFavor) > 0.001 ? Number(opciones.saldoAFavor) : 0;
  const obsLineas = pedido.observaciones ? doc.splitTextToSize(`Obs: ${pedido.observaciones}`, 175).slice(0, 3) : [];
  const pie = layoutPieBoleta({ finalY, pageH, hayDescuento, hayDeuda: hayDeuda || saldoAFavor > 0, hayObs: obsLineas.length > 0, lineasObs: obsLineas.length || 1 });
  // Si totales/deuda/obs no entran arriba del corte, van a una hoja nueva (el troquel queda en la ultima).
  if (pie.nuevaPagina) doc.addPage();
  const base = pie.baseY;

  // Totales: mostrar "Total sin descuento", luego "TOTAL", y luego el descuento aplicado.
  // (Si no hay descuento, solo mostrar TOTAL).
  if (hayDescuento) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Total sin descuento:', 150, base + 4);
    doc.text(`$${totalSinDesc.toLocaleString('es-AR')}`, 195, base + 4, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('TOTAL:', 150, base + 10);
    doc.text(`$${total.toLocaleString('es-AR')}`, 195, base + 10, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Descuento (${descuentoPct}%): -$${descuentoTotal.toLocaleString('es-AR')}`, 150, base + 16);
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('TOTAL:', 150, pie.totalesY);
    doc.text(`$${total.toLocaleString('es-AR')}`, 195, pie.totalesY, { align: 'right' });
  }

  // Deuda pendiente (clientes "boleta contra boleta" u otras deudas anotadas):
  // bien visible abajo de todo, para que no se confunda con el total de esta boleta.
  if (hayDeuda) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(200, 0, 0);
    doc.text(`Deuda pendiente: $${deudaPendiente.toLocaleString('es-AR')}`, 195, pie.deudaY, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  } else if (saldoAFavor > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(0, 140, 60);
    doc.text(`Saldo a favor: $${saldoAFavor.toLocaleString('es-AR')}`, 195, pie.deudaY, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  }

  if (obsLineas.length) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.text(obsLineas, 14, pie.obsY);
  }

  // Seccion inferior para recorte/entrega (solo en la ultima pagina)
  doc.setDrawColor(80, 80, 80);
  doc.setLineWidth(0.8);
  doc.setLineDash([2, 2], 0);
  doc.line(14, pie.corteY, 196, pie.corteY);
  doc.setLineDash([], 0);

  const clienteNombre = pedido.clienteNombre || cliente?.nombre || 'Sin nombre';
  const vendedorNombreFinal = vendedor?.nombre || pedido.vendedorNombre || pedido.vendedor || '-';
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Cliente: ${clienteNombre}`, 14, pie.clienteY);
  doc.text(`Vendedor: ${vendedorNombreFinal}`, 14, pie.vendedorY);
  doc.text(`Total: $${total.toLocaleString('es-AR')}`, 14, pie.totalTroquelY);
  if (hayDescuento) {
    doc.text(`Desc (${descuentoPct}%): -$${descuentoTotal.toLocaleString('es-AR')}`, 90, pie.totalTroquelY);
  }

  const box = (x, y, label) => {
    doc.setLineWidth(0.6);
    doc.rect(x, y - 4, 4, 4);
    doc.text(label, x + 6, y);
  };
  for (const c of pie.casillas) box(140, c.y, c.label);
  // REQ-TRQ (AC-TRQ-1): linea para anotar el proveedor de la transferencia.
  doc.text(pie.proveedorTexto, 140, pie.proveedorY);

  const filename = `factura_${numero}_${fechaPedido}.pdf`;
  return { doc, filename };
};

export const generarFactura = async (pedido, cliente, vendedor, deudaPendiente = 0, ordenOverride = null, opciones = {}) => {
  const { doc, filename } = await buildFacturaDoc(pedido, cliente, vendedor, deudaPendiente, ordenOverride, opciones);
  doc.save(filename);
};

export const generarFacturaFile = async (pedido, cliente, vendedor, deudaPendiente = 0, ordenOverride = null, opciones = {}) => {
  const { doc, filename } = await buildFacturaDoc(pedido, cliente, vendedor, deudaPendiente, ordenOverride, opciones);
  const blob = doc.output('blob');
  return new File([blob], filename, { type: 'application/pdf' });
};

// ---- REQ-COM (AC-COM-14): PDF de un cierre de comisiones ----
// Resumen por vendedor + detalle vendedor/cliente/pedido. Las filas salen del
// dominio (filasPdfCierre) para que el contenido este testeado sin jsPDF.
const buildCierreComisionesDoc = async (cierre) => {
  const { jsPDF } = await import('jspdf');
  const { applyPlugin } = await import('jspdf-autotable');
  applyPlugin(jsPDF);

  const f = filasPdfCierre(cierre);
  const doc = new jsPDF({ orientation: 'landscape' });
  const estilo = {
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.6, lineColor: [80, 80, 80], lineWidth: 0.3 },
    headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [235, 235, 235] },
  };

  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(f.titulo, 14, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(f.subtitulo, 14, 18);
  let y = 22;
  if (f.anulado) {
    doc.setTextColor(200, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.text(f.anulado.slice(0, 160), 14, 24);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    y = 28;
  }

  doc.autoTable({ ...estilo, startY: y, head: [f.headResumen], body: f.resumen });
  doc.autoTable({
    ...estilo,
    startY: (doc.lastAutoTable?.finalY || y) + 8,
    head: [f.headDetalle],
    body: f.detalle,
  });

  return { doc, filename: f.filename };
};

export const generarCierreComisionesFile = async (cierre) => {
  const { doc, filename } = await buildCierreComisionesDoc(cierre);
  const blob = doc.output('blob');
  return new File([blob], filename, { type: 'application/pdf' });
};

// REQ-HPR (AC-HPR-2/3): PDF de cambios de precio. `filas` viene de resumirCambiosPrecio
// (completo) o de filasPdfSoloPrecioNuevo (lista para pasar a clientes/vendedores).
const fmtPesosPdf = (n) => (n === null || n === undefined ? '' : `$${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fmtFechaPdf = (f) => String(f || '').split('-').reverse().join('/');

export const generarCambiosPrecioFile = async (filas, { desde, hasta, soloNuevo = false } = {}) => {
  const { jsPDF } = await import('jspdf');
  const { applyPlugin } = await import('jspdf-autotable');
  applyPlugin(jsPDF);
  const doc = new jsPDF();
  const periodo = !desde || desde === hasta ? fmtFechaPdf(desde || hasta) : `${fmtFechaPdf(desde)} a ${fmtFechaPdf(hasta)}`;
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(soloNuevo ? 'Lista de precios nuevos' : 'Cambios de precio', 14, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Período: ${periodo} · Productos: ${(filas || []).length}`, 14, 20);

  const head = soloNuevo
    ? [['Código', 'Producto', 'Precio por unidad', 'Llevando bulto']]
    : [['Código', 'Producto', 'Rubro', 'Anterior', 'Nuevo', 'Var. %']];
  const body = (filas || []).map(f => (soloNuevo
    ? [f.codigo, f.nombre, fmtPesosPdf(f.precio), fmtPesosPdf(f.precioBulto)]
    : [
      f.codigo, f.nombre, f.rubro,
      f.precioAnterior === null ? 'Nuevo' : fmtPesosPdf(f.precioAnterior),
      fmtPesosPdf(f.precioNuevo),
      f.variacionPct === null ? '' : `${f.variacionPct > 0 ? '+' : ''}${String(f.variacionPct).replace('.', ',')}%`,
    ]));
  doc.autoTable({
    startY: 25,
    head,
    body,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [40, 40, 40] },
  });
  const filename = `${soloNuevo ? 'precios_nuevos' : 'cambios_precio'}_${String(desde || '').replace(/[^0-9-]/g, '')}${hasta && hasta !== desde ? `_${String(hasta).replace(/[^0-9-]/g, '')}` : ''}.pdf`;
  const blob = doc.output('blob');
  return new File([blob], filename, { type: 'application/pdf' });
};

// REQ-FAB (AC-FAB-3): PDF "Facturas a emitir" para el contador. `reporte` viene de
// armarReporteFacturas (grupos A/B con filas y subtotales). El nombre del archivo no
// lleva CUIT ni datos del cliente.
export const generarFacturasAEmitirFile = async (reporte, { desde, hasta, filtro = 'todas' } = {}) => {
  const { jsPDF } = await import('jspdf');
  const { applyPlugin } = await import('jspdf-autotable');
  applyPlugin(jsPDF);
  const doc = new jsPDF({ orientation: 'landscape' });
  const periodo = !desde || desde === hasta ? fmtFechaPdf(desde || hasta) : `${fmtFechaPdf(desde)} a ${fmtFechaPdf(hasta)}`;
  const nFilas = (reporte?.grupos || []).reduce((s, g) => s + g.filas.length, 0);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('Facturas a emitir', 14, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Período: ${periodo} · Filtro: ${filtro === 'todas' ? 'A y B' : `Factura ${filtro}`} · Pedidos: ${nFilas}`, 14, 20);

  let y = 25;
  for (const g of reporte?.grupos || []) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`Factura ${g.tipo}`, 14, y + 4);
    doc.autoTable({
      startY: y + 6,
      head: [['Cliente', 'CUIT', 'Tipo de IVA', 'Factura', 'Pedido', 'Fecha', 'Monto']],
      body: g.filas.map(f => [
        f.clienteNombre, f.cuit || '-', f.tipoIva || '-', `${f.tipo}${f.sugerido ? ' (sugerido)' : ''}`,
        f.pedidoId, fmtFechaPdf(f.fecha), fmtPesosPdf(f.total),
      ]),
      foot: [['', '', '', '', '', `Subtotal ${g.tipo}`, fmtPesosPdf(g.subtotal)]],
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [40, 40, 40] },
      footStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold' },
      columnStyles: { 6: { halign: 'right' } },
    });
    y = (doc.lastAutoTable?.finalY || y) + 8;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`TOTAL GENERAL: ${fmtPesosPdf(reporte?.total || 0)}`, 14, y + 4);

  const filename = `facturas_a_emitir_${String(desde || '').replace(/[^0-9-]/g, '')}${hasta && hasta !== desde ? `_${String(hasta).replace(/[^0-9-]/g, '')}` : ''}.pdf`;
  const blob = doc.output('blob');
  return new File([blob], filename, { type: 'application/pdf' });
};

// ---- REQ-INA / REQ-CPR: PDFs de compras (importes en centavos enteros) ----
const fmtCentPdf = (c) => {
  const n = Math.round(Number(c) || 0);
  const abs = Math.abs(n);
  const ent = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${n < 0 ? '-' : ''}$${ent},${String(abs % 100).padStart(2, '0')}`;
};
const fmtDiaPdf = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fmtFechaPdf(iso);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const sufijoPeriodo = (desde, hasta) =>
  `${String(desde || '').replace(/[^0-9-]/g, '')}${hasta && hasta !== desde ? `_${String(hasta).replace(/[^0-9-]/g, '')}` : ''}`;

const nuevoDocConTabla = async (opciones) => {
  const { jsPDF } = await import('jspdf');
  const { applyPlugin } = await import('jspdf-autotable');
  applyPlugin(jsPDF);
  return new jsPDF(opciones);
};

const filaSubtotales = (s) => [
  ['Factura A', s.A.unidades, fmtCentPdf(s.A.costoCentavos)],
  ['Factura B', s.B.unidades, fmtCentPdf(s.B.costoCentavos)],
  // REQ-NEG: compras sin factura.
  ...(s.N?.unidades ? [['En negro', s.N.unidades, fmtCentPdf(s.N.costoCentavos)]] : []),
  ['Sin dato', s.sinDato.unidades, ''],
];

// AC-INA-2: comprobante de UN ingreso con subtotales de unidades y costo por Factura A, B y total.
export const generarComprobanteIngresoFile = async (ingreso, subtotales) => {
  const doc = await nuevoDocConTabla();
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('Ingreso de mercadería', 14, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`${ingreso?.proveedorNombre || ''} · Factura ${ingreso?.facturaProveedor || ''} · ${fmtDiaPdf(ingreso?.fecha)}`, 14, 20);
  doc.autoTable({
    startY: 25,
    head: [['Código', 'Producto', 'Ingreso']],
    body: (ingreso?.items || []).map(i => [i.codigo || '', i.descripcion || '', i.ingreso]),
    theme: 'grid', styles: { fontSize: 9, cellPadding: 2 }, headStyles: { fillColor: [40, 40, 40] },
  });
  if (subtotales) {
    doc.autoTable({
      startY: (doc.lastAutoTable?.finalY || 25) + 6,
      head: [['Subtotales', 'Unidades', 'Costo']],
      body: filaSubtotales(subtotales),
      foot: [['TOTAL', subtotales.total.unidades, fmtCentPdf(subtotales.total.costoCentavos)]],
      theme: 'grid', styles: { fontSize: 9, cellPadding: 2 }, headStyles: { fillColor: [40, 40, 40] },
      footStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold' },
    });
  }
  const blob = doc.output('blob');
  return new File([blob], `ingreso_${String(ingreso?.id || '').replace(/[^0-9a-zA-Z-]/g, '').slice(0, 12)}.pdf`, { type: 'application/pdf' });
};

// AC-INA-3: historial de ingresos filtrado, con totales A vs B. filas = filtrarHistorial, totales = totalesHistorial.
export const generarIngresosFile = async (filas, totales, { desde, hasta, tipo = 'todas', proveedor = '' } = {}) => {
  const doc = await nuevoDocConTabla({ orientation: 'landscape' });
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('Ingresos de mercadería', 14, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const periodo = !desde && !hasta ? 'todo el historial' : (!desde || desde === hasta ? fmtFechaPdf(desde || hasta) : `${fmtFechaPdf(desde)} a ${fmtFechaPdf(hasta)}`);
  doc.text(`Período: ${periodo} · Tipo: ${tipo === 'todas' ? 'Todas' : tipo === 'sinDato' ? 'Sin dato' : tipo === 'N' ? 'En negro' : `Factura ${tipo}`}${proveedor ? ` · Proveedor: ${proveedor}` : ''} · Ingresos: ${(filas || []).length}`, 14, 20);
  doc.autoTable({
    startY: 25,
    head: [['Fecha', 'Proveedor', 'Factura', 'Fact. A', 'Fact. B', 'Un. A', 'Costo A', 'Un. B', 'Costo B', 'Un. negro', 'Costo negro', 'Sin dato', 'Total un.']],
    body: (filas || []).map(f => [
      fmtDiaPdf(f.fecha), f.proveedorNombre, f.factura, f.facturaA || '-', f.facturaB || '-',
      f.subtotales.A.unidades, fmtCentPdf(f.subtotales.A.costoCentavos),
      f.subtotales.B.unidades, fmtCentPdf(f.subtotales.B.costoCentavos),
      f.subtotales.N?.unidades || 0, fmtCentPdf(f.subtotales.N?.costoCentavos || 0),
      f.subtotales.sinDato.unidades, f.subtotales.total.unidades,
    ]),
    foot: totales ? [['TOTAL', '', '', '', '', totales.A.unidades, fmtCentPdf(totales.A.costoCentavos), totales.B.unidades, fmtCentPdf(totales.B.costoCentavos), totales.N?.unidades || 0, fmtCentPdf(totales.N?.costoCentavos || 0), totales.sinDato.unidades, totales.total.unidades]] : undefined,
    theme: 'grid', styles: { fontSize: 8, cellPadding: 1.5 }, headStyles: { fillColor: [40, 40, 40] },
    footStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold' },
  });
  const blob = doc.output('blob');
  return new File([blob], `ingresos_${sufijoPeriodo(desde, hasta) || 'historial'}.pdf`, { type: 'application/pdf' });
};

// AC-CPR-3: estado de cuenta de un proveedor. `estado` viene de estadoDeCuenta (centavos enteros).
export const generarEstadoCuentaFile = async (estado, { proveedor = '', desde, hasta } = {}) => {
  const doc = await nuevoDocConTabla();
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(`Estado de cuenta${proveedor ? ` - ${proveedor}` : ''}`, 14, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const periodo = !desde && !hasta ? 'todo el historial' : `${fmtFechaPdf(desde) || 'inicio'} a ${fmtFechaPdf(hasta) || 'hoy'}`;
  doc.text(`Período: ${periodo} · Saldo inicial: ${fmtCentPdf(estado?.saldoInicial)}`, 14, 20);
  const etiqueta = { compra: 'Compra', cargo: 'Cargo', pago: 'Pago' };
  const medios = { efectivo: 'Efectivo', transferencia: 'Transferencia', directa: 'Transf. directa del cliente' };
  doc.autoTable({
    startY: 25,
    head: [['Fecha', 'Concepto', 'Medio', 'Detalle', 'Importe', 'Saldo']],
    body: (estado?.filas || []).map(f => [
      fmtFechaPdf(f.fecha),
      `${etiqueta[f.tipo] || f.tipo}${f.anulado ? ' (ANULADO)' : ''}`,
      medios[f.medio] || '',
      f.anulado ? `Anulado: ${f.anulado.motivo}` : (f.referencia || ''),
      `${f.tipo === 'pago' ? '-' : ''}${fmtCentPdf(f.montoCentavos)}`,
      fmtCentPdf(f.saldoAcumulado),
    ]),
    theme: 'grid', styles: { fontSize: 9, cellPadding: 2 }, headStyles: { fillColor: [40, 40, 40] },
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' } },
  });
  const t = estado?.totalesPorMedio || { efectivo: 0, transferencia: 0, directa: 0, total: 0 };
  doc.autoTable({
    startY: (doc.lastAutoTable?.finalY || 25) + 6,
    head: [['Pagos por medio', 'Total']],
    body: [['Efectivo', fmtCentPdf(t.efectivo)], ['Transferencia', fmtCentPdf(t.transferencia)], ['Transf. directa del cliente', fmtCentPdf(t.directa)]],
    foot: [['Total pagos', fmtCentPdf(t.total)]],
    theme: 'grid', styles: { fontSize: 9, cellPadding: 2 }, headStyles: { fillColor: [40, 40, 40] },
    footStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold' },
  });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`SALDO: ${fmtCentPdf(estado?.saldoFinal)}`, 14, (doc.lastAutoTable?.finalY || 25) + 10);
  const blob = doc.output('blob');
  return new File([blob], `estado_cuenta_${sufijoPeriodo(desde, hasta) || 'completo'}.pdf`, { type: 'application/pdf' });
};

// AC-CPR-4: pedido al proveedor (sin precios ni costos). items = [{ codigo, nombre, cantidad, unidad, unidades }].
export const generarPedidoProveedorFile = async (items, { proveedor = '', fecha = '' } = {}) => {
  const doc = await nuevoDocConTabla();
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(`Pedido${proveedor ? ` para ${proveedor}` : ''}`, 14, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`${fecha ? `${fmtDiaPdf(fecha)} · ` : ''}Productos: ${(items || []).length}`, 14, 20);
  doc.autoTable({
    startY: 25,
    head: [['Código', 'Producto', 'Cantidad', 'Unidades']],
    body: (items || []).map(i => [i.codigo || '', i.nombre || '', i.unidad === 'bulto' ? `${i.cantidad} ${i.cantidad === 1 ? 'bulto' : 'bultos'}` : `${i.cantidad} u.`, i.unidades]),
    theme: 'grid', styles: { fontSize: 9, cellPadding: 2 }, headStyles: { fillColor: [40, 40, 40] },
  });
  const blob = doc.output('blob');
  return new File([blob], `pedido_proveedor_${String(proveedor).replace(/[^0-9a-zA-Z]/g, '').slice(0, 20) || 'sin_nombre'}.pdf`, { type: 'application/pdf' });
};
// ---- REQ-REN (AC-REN-4): PDF de la rendicion del dia. `resumen` viene de resumenRendicionDia
// (importes en centavos). Las anuladas se listan marcadas y no suman. Sin motivos de anulacion
// largos ni datos del cliente en el nombre del archivo.
export const generarRendicionDiaFile = async (resumen, { fecha } = {}) => {
  const doc = await nuevoDocConTabla({ orientation: 'landscape' });
  const dia = fecha || resumen?.fecha || '';
  const t = resumen?.totales || {};
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(`Rendición del día ${fmtFechaPdf(dia)}`, 14, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Movimientos: ${(resumen?.filas || []).length} · Anuladas: ${t.anuladas || 0}`, 14, 20);
  doc.autoTable({
    startY: 25,
    head: [['#', 'Cliente', 'Pedido', 'Tipo', 'Detalle', 'Motivo', 'Crédito', 'Estado']],
    body: (resumen?.filas || []).map(f => [
      f.idCorto, f.clienteNombre, String(f.pedidoId ?? ''), `${f.tipoLabel}${f.nroNc ? ` ${f.tipoFactura ? `${f.tipoFactura} ` : ''}N.º ${f.nroNc}` : ''}`,
      String(f.detalle || '').slice(0, 200), String(f.motivo || '').slice(0, 120), fmtCentPdf(f.creditoCents),
      f.anulada ? `ANULADA${f.motivoAnulacion ? `: ${String(f.motivoAnulacion).slice(0, 60)}` : ''}` : (f.rechazada ? 'RECHAZADA' : (f.pendiente ? 'Sin subir' : 'Vigente')),
    ]),
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.6 },
    headStyles: { fillColor: [40, 40, 40] },
    columnStyles: { 6: { halign: 'right' } },
  });
  const y = (doc.lastAutoTable?.finalY || 25) + 8;
  doc.autoTable({
    startY: y,
    head: [['Devuelto', 'Notas de crédito', 'Cambios (neto)', 'Mermas']],
    body: [[fmtCentPdf(t.devueltoCents), fmtCentPdf(t.ncCents), fmtCentPdf(t.cambiosCents), `${t.mermaUnidades || 0} u. · ${fmtCentPdf(t.mermaCents)}`]],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold' },
  });
  const blob = doc.output('blob');
  return new File([blob], `rendicion_${String(dia).replace(/[^0-9-]/g, '')}.pdf`, { type: 'application/pdf' });
};
