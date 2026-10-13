// src/utils/pdfGen.js - Generacion de PDFs
import { getOrdenEntrega } from './ordenEntrega';
import { isPedidoVisible, normalizePedidoFecha } from './pedidos';
import { filasPdfCierre } from '../domain/comisiones';

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

const buildFacturaDoc = async (pedido, cliente, vendedor, deudaPendiente = 0, ordenOverride = null) => {
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
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Fecha: ${fecha}`, 150, 10);

  // El numero override viene de "Orden de entrega": se calcula al imprimir
  // (renumerando segun quien tiene pedido ese dia), no queda guardado en el pedido.
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

  const sortedItems = [...(pedido.items || [])].sort((a, b) => alpha(a.nombre, b.nombre));

  const rows = sortedItems.map(item => [
    item.nombre,
    item.cantidad,
    `$${Number(item.precio).toLocaleString('es-AR')}`,
    `$${(Number(item.cantidad) * Number(item.precio)).toLocaleString('es-AR')}`,
  ]);

  const total = sortedItems.reduce((acc, i) => acc + Number(i.cantidad) * Number(i.precio), 0);
  const totalSinDesc = sortedItems.reduce((acc, i) => {
    const base = (i?.precioOriginal !== undefined && i?.precioOriginal !== null) ? Number(i.precioOriginal) : Number(i.precio);
    return acc + Number(i.cantidad) * Number(base);
  }, 0);
  const descuentoTotal = Math.max(0, totalSinDesc - total);
  const descuentoPct = totalSinDesc > 0 ? Math.round((descuentoTotal / totalSinDesc) * 100) : 0;

  doc.autoTable({
    startY: 28,
    // Reservar espacio para la seccion inferior de recorte para que no se superponga con la tabla.
    margin: { left: 14, right: 14, bottom: 58 },
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
      1: { cellWidth: 18, halign: 'center' },
      2: { cellWidth: 32, halign: 'right' },
      3: { cellWidth: 42, halign: 'right' },
    },
  });

  const finalY = doc.lastAutoTable.finalY + 6;
  // Totales: mostrar "Total sin descuento", luego "TOTAL", y luego el descuento aplicado.
  // (Si no hay descuento, solo mostrar TOTAL).
  let totalesY;
  if (descuentoTotal > 0.001) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Total sin descuento:', 150, finalY + 4);
    doc.text(`$${totalSinDesc.toLocaleString('es-AR')}`, 195, finalY + 4, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('TOTAL:', 150, finalY + 10);
    doc.text(`$${total.toLocaleString('es-AR')}`, 195, finalY + 10, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Descuento (${descuentoPct}%): -$${descuentoTotal.toLocaleString('es-AR')}`, 150, finalY + 16);
    totalesY = finalY + 16;
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('TOTAL:', 150, finalY + 6);
    doc.text(`$${total.toLocaleString('es-AR')}`, 195, finalY + 6, { align: 'right' });
    totalesY = finalY + 6;
  }

  // Deuda pendiente (clientes "boleta contra boleta" u otras deudas anotadas):
  // bien visible abajo de todo, para que no se confunda con el total de esta boleta.
  if (deudaPendiente > 0.001) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(200, 0, 0);
    doc.text(`Deuda pendiente: $${deudaPendiente.toLocaleString('es-AR')}`, 195, totalesY + 8, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  }

  if (pedido.observaciones) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.text(`Obs: ${pedido.observaciones}`, 14, finalY + 30);
  }

  // Seccion inferior para recorte/entrega
  const cutY = pageH - 12;
  doc.setDrawColor(80, 80, 80);
  doc.setLineWidth(0.8);
  doc.setLineDash([2, 2], 0);
  doc.line(14, cutY - 26, 196, cutY - 26);
  doc.setLineDash([], 0);

  const clienteNombre = pedido.clienteNombre || cliente?.nombre || 'Sin nombre';
  const vendedorNombreFinal = vendedor?.nombre || pedido.vendedorNombre || pedido.vendedor || '-';
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Cliente: ${clienteNombre}`, 14, cutY - 18);
  doc.text(`Vendedor: ${vendedorNombreFinal}`, 14, cutY - 13);
  doc.text(`Total: $${total.toLocaleString('es-AR')}`, 14, cutY - 8);
  if (descuentoTotal > 0.001) {
    doc.text(`Desc (${descuentoPct}%): -$${descuentoTotal.toLocaleString('es-AR')}`, 90, cutY - 8);
  }

  const box = (x, y, label) => {
    doc.setLineWidth(0.6);
    doc.rect(x, y - 4, 4, 4);
    doc.text(label, x + 6, y);
  };
  box(140, cutY - 18, 'Efectivo');
  box(140, cutY - 12, 'Transferencia');

  const filename = `factura_${numero}_${fechaPedido}.pdf`;
  return { doc, filename };
};

export const generarFactura = async (pedido, cliente, vendedor, deudaPendiente = 0, ordenOverride = null) => {
  const { doc, filename } = await buildFacturaDoc(pedido, cliente, vendedor, deudaPendiente, ordenOverride);
  doc.save(filename);
};

export const generarFacturaFile = async (pedido, cliente, vendedor, deudaPendiente = 0, ordenOverride = null) => {
  const { doc, filename } = await buildFacturaDoc(pedido, cliente, vendedor, deudaPendiente, ordenOverride);
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
