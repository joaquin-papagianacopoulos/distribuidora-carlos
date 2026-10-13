// src/services/leerPlanilla.worker.js — S-DEP-01 (RUN 20261012-2106, iteracion 2).
// Web Worker que parsea el .xlsx FUERA del hilo principal: un prototype
// pollution de xlsx@0.18.5 queda en el realm del worker (que se descarta
// despues de cada archivo) y un ReDoS o un zip bomb se corta con el timeout
// de lectorPlanillas.js. Al hilo principal vuelven solo strings.
/* eslint-disable no-restricted-globals */
import * as XLSX from 'xlsx';
import { filasDesdeLibro } from './planillaXlsx';

self.onmessage = (e) => {
  try {
    const r = filasDesdeLibro(XLSX, e.data);
    self.postMessage({ ok: true, filas: r.filas, truncado: r.truncado });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err?.message || err).slice(0, 300) });
  }
};
