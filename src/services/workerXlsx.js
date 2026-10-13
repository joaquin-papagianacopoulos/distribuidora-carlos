// src/services/workerXlsx.js — S-DEP-01: crea el Web Worker del parser.
// Va en un modulo aparte porque usa import.meta (webpack 5 lo empaqueta como
// chunk propio). lectorPlanillas.js lo importa SOLO si existe Worker, asi
// los tests (jsdom, sin Worker) nunca lo cargan.
export const crearWorkerXlsx = () => new Worker(new URL('./leerPlanilla.worker.js', import.meta.url));
