// src/utils/pdfGen.js - Generacion de PDFs
import { getOrdenEntrega } from './ordenEntrega';
import { isPedidoVisible, normalizePedidoFecha } from './pedidos';
import { filasPdfCierre } from '../domain/comisiones';
import { filasBoleta, numerarFilasBoleta } from '../domain/gruposFactura';
import { totalesBoleta } from '../domain/precios';
import { layoutPieBoleta, encabezadoComprobante, ESTILO_TABLA_COMPACTA } from '../domain/boletaLayout';
import { desgloseTotalRemito } from '../domain/redondeo';

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
    styles: ESTILO_TABLA_COMPACTA,
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
    styles: ESTILO_TABLA_COMPACTA,
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

// REQ-RTO: el comprobante impreso es un REMITO (AC-RTO-1), con direccion, vendedor destacado,
// renglones numerados e "Items: N" (AC-RTO-2/3), tabla compacta (AC-RTO-4), saldo anterior y
// total a cobrar si hay deuda (AC-RTO-5), y sin troquel ni pie de pagina (AC-RTO-6).
// opciones (todas opcionales, retrocompatible):
//   modoGrupos: 'detalle' | 'solo_grupos' => como se imprimen los grupos (REQ-AGR, AC-AGR-3).
//   saldoAFavor: saldo a favor del cliente (REQ-REN).
//   redondeoVistaPrevia: multiplo (0/500/1000) para mostrar el redondeo de un pedido todavia pendiente (REQ-RED).
//   tipoFactura: se ignora en el impreso (el remito nunca dice FACTURA A/B).
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
  doc.setFontSize(8);
  doc.text(`REMITO N° ${numero}`, 14, 13);
  doc.setFontSize(14);
  doc.text(encabezadoComprobante(), 112, 9, { align: 'center' });
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

  // AC-RTO-2: direccion (y zona si hay) debajo del cliente.
  const direccion = String(cliente?.direccion || pedido.direccion || pedido.clienteDireccion || '').trim();
  const zona = String(cliente?.zona || pedido.zona || '').trim();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  if (direccion) doc.text(direccion.slice(0, 120), 14, 23);
  if (zona) doc.text(`Zona: ${zona.slice(0, 60)}`, 14, 27);

  // AC-RTO-2: vendedor destacado, con el mismo tamano que el cliente.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(`Vendedor: ${vendedor?.nombre || pedido.vendedorNombre || pedido.vendedor || '-'}`, 14, 34);

  // Filas de la tabla: renglones sueltos y grupos (REQ-AGR). Los totales salen siempre
  // de los items, nunca de las filas (no hay doble conteo).
  const sortedItems = [...(pedido.items || [])].sort((a, b) => alpha(a.nombre, b.nombre));
  const { filas, items: cantItems } = numerarFilasBoleta(
    filasBoleta(pedido.items || [], pedido.grupos, { modo: opciones?.modoGrupos === 'solo_grupos' ? 'solo_grupos' : 'detalle' }),
  );
  const rows = filas.map(f => [f.nro ?? '', f.nombre, f.cantidadTexto, f.precioTexto, `$${Number(f.subtotal).toLocaleString('es-AR')}`]);

  // REQ-FRB: el precio de bulto no se muestra como descuento (base = precioBaseRenglon).
  const { total: totalRenglones, totalSinDescuento: totalSinDesc, descuento: descuentoTotal, descuentoPct } = totalesBoleta(sortedItems);
  // REQ-RED: subtotal (renglones), ajuste de redondeo y total a cobrar de ESTE pedido.
  const { subtotal, redondeo, total } = desgloseTotalRemito(
    { ...pedido, total: totalRenglones },
    { multiploVistaPrevia: opciones?.redondeoVistaPrevia },
  );

  doc.autoTable({
    startY: 38,
    // El pie (totales, saldo y obs) lo ubica layoutPieBoleta; la tabla solo deja un margen chico.
    margin: { left: 14, right: 14, bottom: 14 },
    head: [['N°', 'Producto', 'Cant.', 'Precio Unit.', 'Subtotal']],
    body: rows,
    theme: 'grid',
    // AC-RTO-4: estilo compacto (mas renglones por hoja), con bordes marcados para impresoras.
    styles: ESTILO_TABLA_COMPACTA,
    headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [232, 232, 232] },
    tableLineColor: [60, 60, 60],
    tableLineWidth: 0.45,
    columnStyles: {
      // A4 ancho 210mm, con margenes 14/14 => 182mm max para que no se pase del borde.
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 80 },
      2: { cellWidth: 28, halign: 'center' },
      3: { cellWidth: 32, halign: 'right' },
      4: { cellWidth: 32, halign: 'right' },
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
  const hayRedondeo = Math.abs(redondeo) > 0.001;
  const hayDeuda = deudaPendiente > 0.001;
  // REQ-REN (AC-REN-3): saldo a favor del cliente (ya neteado con la deuda por cuentaParaBoleta).
  // Va en el mismo lugar que el saldo anterior (nunca aparecen los dos).
  const saldoAFavor = !hayDeuda && Number(opciones?.saldoAFavor) > 0.001 ? Number(opciones.saldoAFavor) : 0;
  const obsLineas = pedido.observaciones ? doc.splitTextToSize(`Obs: ${pedido.observaciones}`, 175).slice(0, 3) : [];
  const pie = layoutPieBoleta({
    finalY, pageH, hayDescuento, hayRedondeo, hayDeuda: hayDeuda || saldoAFavor > 0, hayObs: obsLineas.length > 0, lineasObs: obsLineas.length || 1,
  });
  // Si el pie no entra en la hoja, va a una hoja nueva.
  if (pie.nuevaPagina) doc.addPage();

  const pesos = (n) => `$${Number(n).toLocaleString('es-AR')}`;

  // AC-RTO-3: cantidad de renglones del pedido (grupo y linea de bulto cuentan 1).
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Ítems: ${cantItems}`, 14, pie.itemsY);

  if (hayDescuento) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Total sin descuento:', 150, pie.sinDescuentoY);
    doc.text(pesos(totalSinDesc), 195, pie.sinDescuentoY, { align: 'right' });
  }
  // AC-RTO-2 / REQ-RED: Subtotal / Redondeo / TOTAL (solo TOTAL si no hay ajuste).
  if (hayRedondeo) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Subtotal:', 150, pie.subtotalY);
    doc.text(pesos(subtotal), 195, pie.subtotalY, { align: 'right' });
    doc.text('Redondeo:', 150, pie.redondeoY);
    doc.text(`${redondeo > 0 ? '+' : '-'}${pesos(Math.abs(redondeo))}`, 195, pie.redondeoY, { align: 'right' });
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('TOTAL:', 150, pie.totalesY);
  doc.text(pesos(total), 195, pie.totalesY, { align: 'right' });
  if (hayDescuento) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Descuento (${descuentoPct}%): -${pesos(descuentoTotal)}`, 150, pie.descuentoY);
  }

  // AC-RTO-5: con deuda, "Saldo anterior" y "Total a cobrar" (total + saldo), bien visibles.
  if (hayDeuda) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(200, 0, 0);
    doc.text(`Saldo anterior: ${pesos(deudaPendiente)}`, 195, pie.saldoAnteriorY, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    doc.text(`Total a cobrar: ${pesos(Math.round((total + deudaPendiente) * 100) / 100)}`, 195, pie.totalCobrarY, { align: 'right' });
  } else if (saldoAFavor > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(0, 140, 60);
    doc.text(`Saldo a favor: ${pesos(saldoAFavor)}`, 195, pie.saldoAnteriorY, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  }

  if (obsLineas.length) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.text(obsLineas, 14, pie.obsY);
  }

  const filename = `remito_${numero}_${fechaPedido}.pdf`;
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
    styles: ESTILO_TABLA_COMPACTA,
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
    styles: ESTILO_TABLA_COMPACTA,
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
      styles: ESTILO_TABLA_COMPACTA,
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
    theme: 'grid', styles: ESTILO_TABLA_COMPACTA, headStyles: { fillColor: [40, 40, 40] },
  });
  if (subtotales) {
    doc.autoTable({
      startY: (doc.lastAutoTable?.finalY || 25) + 6,
      head: [['Subtotales', 'Unidades', 'Costo']],
      body: filaSubtotales(subtotales),
      foot: [['TOTAL', subtotales.total.unidades, fmtCentPdf(subtotales.total.costoCentavos)]],
      theme: 'grid', styles: ESTILO_TABLA_COMPACTA, headStyles: { fillColor: [40, 40, 40] },
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
    theme: 'grid', styles: ESTILO_TABLA_COMPACTA, headStyles: { fillColor: [40, 40, 40] },
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
    theme: 'grid', styles: ESTILO_TABLA_COMPACTA, headStyles: { fillColor: [40, 40, 40] },
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' } },
  });
  const t = estado?.totalesPorMedio || { efectivo: 0, transferencia: 0, directa: 0, total: 0 };
  doc.autoTable({
    startY: (doc.lastAutoTable?.finalY || 25) + 6,
    head: [['Pagos por medio', 'Total']],
    body: [['Efectivo', fmtCentPdf(t.efectivo)], ['Transferencia', fmtCentPdf(t.transferencia)], ['Transf. directa del cliente', fmtCentPdf(t.directa)]],
    foot: [['Total pagos', fmtCentPdf(t.total)]],
    theme: 'grid', styles: ESTILO_TABLA_COMPACTA, headStyles: { fillColor: [40, 40, 40] },
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
    theme: 'grid', styles: ESTILO_TABLA_COMPACTA, headStyles: { fillColor: [40, 40, 40] },
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
    styles: ESTILO_TABLA_COMPACTA,
    headStyles: { fillColor: [40, 40, 40] },
    columnStyles: { 6: { halign: 'right' } },
  });
  const y = (doc.lastAutoTable?.finalY || 25) + 8;
  doc.autoTable({
    startY: y,
    head: [['Devuelto', 'Notas de crédito', 'Cambios (neto)', 'Mermas']],
    body: [[fmtCentPdf(t.devueltoCents), fmtCentPdf(t.ncCents), fmtCentPdf(t.cambiosCents), `${t.mermaUnidades || 0} u. · ${fmtCentPdf(t.mermaCents)}`]],
    theme: 'grid',
    styles: ESTILO_TABLA_COMPACTA,
    headStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold' },
  });
  const blob = doc.output('blob');
  return new File([blob], `rendicion_${String(dia).replace(/[^0-9-]/g, '')}.pdf`, { type: 'application/pdf' });
};

// REQ-HRU (AC-HRU-1): hoja de ruta del repartidor. `resultado` viene de filasHojaRuta (cobranza.js):
// { filas: [{ zona, orden, clienteNombre, direccion, importe, saldoAnterior, totalACobrar }], totales }.
// Las columnas Efectivo / Transferencia / Transf. a proveedor / Observaciones salen vacias para anotar
// a mano (es el troquel de cobro que ya no va en el remito). Apaisada, agrupada por zona, totales al final.
export const generarHojaRutaFile = async (resultado, { fechas = [], zonas = [] } = {}) => {
  const doc = await nuevoDocConTabla({ orientation: 'landscape' });
  const filas = Array.isArray(resultado?.filas) ? resultado.filas : [];
  const t = resultado?.totales || { pedidos: filas.length, importe: 0, saldoAnterior: 0, totalACobrar: 0 };
  const ordenadas = [...(fechas || [])].filter(Boolean).sort();
  const periodo = ordenadas.length === 0
    ? ''
    : (ordenadas.length === 1 ? fmtFechaPdf(ordenadas[0]) : `${fmtFechaPdf(ordenadas[0])} a ${fmtFechaPdf(ordenadas[ordenadas.length - 1])}`);

  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(`Hoja de ruta${periodo ? ` - pedidos del ${periodo}` : ''}`, 10, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Pedidos: ${t.pedidos}${(zonas || []).length ? ` · Zonas: ${zonas.length}` : ' · Todas las zonas'}`, 10, 18);

  // Una fila "Zona: X" cada vez que cambia la zona.
  const body = [];
  let zonaActual = null;
  for (const f of filas) {
    const z = f.zona || 'Sin zona';
    if (z !== zonaActual) {
      zonaActual = z;
      body.push([{ content: `Zona: ${z}`, colSpan: 10, styles: { fontStyle: 'bold', fillColor: [210, 210, 210] } }]);
    }
    body.push([
      String(f.orden ?? ''), f.clienteNombre || '', f.direccion || '',
      fmtPesosPdf(f.importe), f.saldoAnterior > 0 ? fmtPesosPdf(f.saldoAnterior) : '', fmtPesosPdf(f.totalACobrar),
      '', '', '', '',
    ]);
  }

  doc.autoTable({
    startY: 22,
    margin: { left: 10, right: 10, bottom: 10 },
    head: [['Orden', 'Cliente', 'Dirección', 'Importe', 'Saldo ant.', 'Total a cobrar', 'Efectivo', 'Transf.', 'Transf. a proveedor', 'Observaciones']],
    body,
    foot: [['', 'TOTALES', `${t.pedidos} pedidos`, fmtPesosPdf(t.importe), fmtPesosPdf(t.saldoAnterior), fmtPesosPdf(t.totalACobrar), '', '', '', '']],
    showFoot: 'lastPage',
    theme: 'grid',
    styles: ESTILO_TABLA_COMPACTA,
    headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: 'bold' },
    footStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 12, halign: 'center' },
      1: { cellWidth: 48 },
      2: { cellWidth: 50 },
      3: { cellWidth: 24, halign: 'right' },
      4: { cellWidth: 24, halign: 'right' },
      5: { cellWidth: 26, halign: 'right', fontStyle: 'bold' },
      6: { cellWidth: 24 },
      7: { cellWidth: 24 },
      8: { cellWidth: 24 },
      9: { cellWidth: 21 },
    },
  });

  const blob = doc.output('blob');
  return new File([blob], `hoja_ruta_${sufijoPeriodo(ordenadas[0], ordenadas[ordenadas.length - 1]) || 'reparto'}.pdf`, { type: 'application/pdf' });
};
