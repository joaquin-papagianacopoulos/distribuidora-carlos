// src/components/GraficoBarras.js — REQ-PAN (AC-PAN-4). Grafico de barras simple en SVG, sin librerias.
// props: barras = [{ etiqueta, valorCents }], alto. Las barras negativas se dibujan bajo el eje.
import React from 'react';

const fmt = (c) => `$ ${(c / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;

export default function GraficoBarras({ barras = [], alto = 160, titulo = 'Gráfico de barras' }) {
  const n = barras.length;
  const ancho = Math.max(n, 1) * 44;
  const max = Math.max(0, ...barras.map(b => b.valorCents));
  const min = Math.min(0, ...barras.map(b => b.valorCents));
  const rango = max - min || 1;
  const area = alto - 36; // lugar para etiquetas
  const yEje = 8 + (max / rango) * area;
  return (
    <svg role="img" aria-label={titulo} viewBox={`0 0 ${ancho} ${alto}`} width="100%" style={{ maxWidth: ancho, display: 'block' }}>
      <title>{titulo}</title>
      <line x1="0" x2={ancho} y1={yEje} y2={yEje} stroke="#999" strokeWidth="1" />
      {barras.map((b, i) => {
        const h = Math.abs(b.valorCents) / rango * area;
        const neg = b.valorCents < 0;
        const y = neg ? yEje : yEje - h;
        return (
          <g key={`${b.etiqueta}-${i}`} data-testid="barra">
            <rect x={i * 44 + 6} y={y} width="32" height={Math.max(h, b.valorCents === 0 ? 0 : 1)} fill={neg ? '#c0392b' : '#2e86de'}>
              <title>{`${b.etiqueta}: ${fmt(b.valorCents)}`}</title>
            </rect>
            <text x={i * 44 + 22} y={alto - 4} fontSize="9" textAnchor="middle" fill="#555">{b.etiqueta}</text>
          </g>
        );
      })}
    </svg>
  );
}
