// REQ-FOT: foto de cada producto en el formulario (AC-FOT-1, AC-FOT-2).
import React from 'react';
import { montar, flush, click, escribir, porTexto, act } from '../../testUtils/ui';
import ProductoForm from '../ProductoForm';

const URL_OK = 'https://x.supabase.co/storage/v1/object/public/tienda/img/a.png';
const INICIAL = { id: 7, codigo: 'DC', nombre: 'Dos Corazones', precio: 900, costoFinal: 0, bultoX: 16, minimoVenta: 1, imagen_url: 'https://google.com/foto-vieja.jpg' };

let m;
afterEach(async () => { if (m) { await m.desmontar(); m = null; } });

const elegir = async (file) => {
  const input = m.cont.querySelector('[data-testid="foto-input"]');
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await flush();
};
const guardar = async () => { await click(porTexto(m.cont, 'button', 'Guardar')); await flush(); };

describe('foto del producto', () => {
  it('AC-FOT-1 sube la foto con el PIN, muestra la miniatura y la guarda en imagen_url', async () => {
    const subirFoto = jest.fn(async () => ({ ok: true, url: URL_OK }));
    const onGuardar = jest.fn(async () => {});
    m = await montar(<ProductoForm inicial={INICIAL} onGuardar={onGuardar} onCancelar={() => {}} subirFoto={subirFoto} />);
    await elegir(new File(['x'], 'a.png', { type: 'image/png' }));
    expect(subirFoto).not.toHaveBeenCalled(); // sin PIN no sube
    expect(m.cont.querySelector('[data-testid="foto-msg"]').textContent).toMatch(/PIN/);
    await escribir(m.cont.querySelector('[data-testid="foto-pin"]'), '1234');
    await elegir(new File(['x'], 'a.png', { type: 'image/png' }));
    expect(subirFoto).toHaveBeenCalledWith('1234', expect.any(File));
    expect(m.cont.querySelector('[data-testid="foto-preview"]').getAttribute('src')).toBe(URL_OK);
    await guardar();
    expect(onGuardar.mock.calls[0][0].imagen_url).toBe(URL_OK);
  });

  it('AC-FOT-1 rechaza en el navegador archivos que no son jpg/png/webp o pasan los 2 MB', async () => {
    const subirFoto = jest.fn();
    m = await montar(<ProductoForm inicial={INICIAL} onGuardar={jest.fn()} onCancelar={() => {}} subirFoto={subirFoto} />);
    await escribir(m.cont.querySelector('[data-testid="foto-pin"]'), '1234');
    await elegir(new File(['x'], 'a.gif', { type: 'image/gif' }));
    expect(m.cont.querySelector('[data-testid="foto-msg"]').textContent).toMatch(/JPG, PNG o WEBP/);
    const grande = new File(['x'], 'b.jpg', { type: 'image/jpeg' });
    Object.defineProperty(grande, 'size', { value: 3 * 1024 * 1024 });
    await elegir(grande);
    expect(m.cont.querySelector('[data-testid="foto-msg"]').textContent).toMatch(/2 MB/);
    expect(subirFoto).not.toHaveBeenCalled();
  });

  it('AC-FOT-2 sin tocar la foto se conserva la que tenía; "Quitar foto" la borra', async () => {
    const onGuardar = jest.fn(async () => {});
    m = await montar(<ProductoForm inicial={INICIAL} onGuardar={onGuardar} onCancelar={() => {}} subirFoto={jest.fn()} />);
    await guardar();
    expect(onGuardar.mock.calls[0][0].imagen_url).toBe(INICIAL.imagen_url);
    await click(porTexto(m.cont, 'button', 'Quitar foto'));
    await guardar();
    expect(onGuardar.mock.calls[1][0].imagen_url).toBeNull();
  });

  it('AC-FOT-2 sin subirFoto el formulario no cambia (no manda imagen_url)', async () => {
    const onGuardar = jest.fn(async () => {});
    m = await montar(<ProductoForm inicial={INICIAL} onGuardar={onGuardar} onCancelar={() => {}} />);
    expect(m.cont.querySelector('[data-testid="foto-producto"]')).toBeNull();
    await guardar();
    expect('imagen_url' in onGuardar.mock.calls[0][0]).toBe(false);
  });
});
