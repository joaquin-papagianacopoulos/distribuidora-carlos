// src/components/SelectorMarca.js — REQ-VTA (AC-VTA-1).
// "Marca" del producto: mismo selector que el Rubro (marcas existentes +
// "Agregar marca nueva…") con la misma normalización y dedupe (AC-COMR-4).
import React from 'react';
import SelectorRubro from './SelectorRubro';

const SelectorMarca = ({ id = 'campo-marca', marcas = [], ...resto }) => (
  <SelectorRubro
    {...resto}
    id={id}
    rubros={marcas}
    name="marca"
    etiqueta="marca"
    testId="selector-marca"
    errorTestId="marca-error"
    avisoTestId="marca-aviso"
  />
);

export default SelectorMarca;
