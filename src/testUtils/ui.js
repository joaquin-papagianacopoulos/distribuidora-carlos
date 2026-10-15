// Utilidades de tests de UI sin Testing Library (S6: createRoot + act, sin dependencias nuevas).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act as actTestUtils } from 'react-dom/test-utils';

// React 18.3 deprecó act de test-utils: se usa React.act cuando existe.
const act = React.act || actTestUtils;

global.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom no implementa scrollTo.
window.scrollTo = () => {};

export const montar = async (elemento) => {
  const cont = document.createElement('div');
  document.body.appendChild(cont);
  const root = createRoot(cont);
  await act(async () => { root.render(elemento); });
  return {
    cont,
    desmontar: async () => { await act(async () => { root.unmount(); }); cont.remove(); },
  };
};

export const flush = async (ms = 0) => {
  await act(async () => { await new Promise(r => setTimeout(r, ms)); });
};

export const click = async (el) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
};

export const escribir = async (el, valor) => {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  await act(async () => {
    setter.call(el, valor);
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
};

export const marcar = async (el) => { await click(el); };

export const enviarForm = async (form) => {
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
};

export const porTexto = (cont, selector, texto) =>
  Array.from(cont.querySelectorAll(selector)).find(n => (n.textContent || '').includes(texto)) || null;

export { React, act };
