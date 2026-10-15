// Salida real de pdfjs-dist (getTextContent) para una lista de precios de proveedor
// generada con pdf-lib: 4 columnas (Código, Descripción, Precio s/IVA, Precio c/IVA).
// Incluye los fragmentos " " que pdfjs intercala entre columnas.
const fila = (y, celdas) => celdas.flatMap(([str, x, w], i) => {
  const it = [{ str, x, y, w, pagina: 1 }];
  const sig = celdas[i + 1];
  if (sig) it.push({ str: ' ', x: x + w, y, w: sig[1] - (x + w), pagina: 1 });
  return it;
});

export const itemsListaProveedor = [
  { str: 'LISTA DE PRECIOS OCTUBRE 2026', x: 40, y: 800, w: 168.94, pagina: 1 },
  ...fila(782, [['Codigo', 40, 31.68], ['Descripcion', 110, 52.23], ['Precio s/IVA', 380, 55.02], ['Precio c/IVA', 480, 55.02]]),
  ...fila(764, [['DC', 40, 14.44], ['Dos Corazones x16', 110, 87.81], ['$ 743,80', 380, 38.92], ['$ 900,00', 480, 38.92]]),
  ...fila(746, [['G1', 40, 13.34], ['Gaseosa Cola 2.25 L', 110, 93.94], ['1.033,47', 380, 38.92], ['1.250,50', 480, 38.92]]),
  ...fila(728, [['A-77', 40, 21.12], ['Alfajor Triple Choc.', 110, 85.02], ['12.500', 380, 30.58], ['15.125', 480, 30.58]]),
];
