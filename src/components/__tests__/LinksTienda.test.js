// REQ-WEB AC-WEB-7: Configuración -> Vendedores: generar, copiar y regenerar el link de tienda.
import React from 'react';
import { montar, flush, click, escribir, porTexto } from '../../testUtils/ui';

jest.mock('../../services/tiendaLinksService', () => ({ listarLinks: jest.fn(), obtenerLink: jest.fn() }));
import { listarLinks, obtenerLink } from '../../services/tiendaLinksService';
import LinksTienda from '../LinksTienda';

const VENDEDORES = [{ id: 1, remoteId: 'v-1', nombre: 'Juan' }, { id: 2, remoteId: null, nombre: 'Sin sync' }];
let m;

beforeEach(() => {
  listarLinks.mockResolvedValue({ ok: true, links: {} });
  obtenerLink.mockResolvedValue({ ok: true, link: 'https://x.com/tienda?v=TOKEN1' });
});
afterEach(async () => { if (m) { await m.desmontar(); m = null; } jest.restoreAllMocks(); });

describe('links de tienda por vendedor', () => {
  it('AC-WEB-7 genera el link de un vendedor con el PIN y lo muestra', async () => {
    m = await montar(<LinksTienda vendedores={VENDEDORES} />);
    await escribir(m.cont.querySelector('[data-testid="pin-links"]'), '1234');
    await click(porTexto(m.cont, 'button', 'Generar link'));
    await flush();
    expect(obtenerLink).toHaveBeenCalledWith('1234', 'v-1', { regenerar: false });
    expect(m.cont.querySelector('input[aria-label="Link de Juan"]').value).toBe('https://x.com/tienda?v=TOKEN1');
  });

  it('AC-WEB-7 copiar usa el portapapeles', async () => {
    const writeText = jest.fn(async () => undefined);
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } });
    m = await montar(<LinksTienda vendedores={VENDEDORES} />);
    await click(porTexto(m.cont, 'button', 'Generar link'));
    await flush();
    await click(porTexto(m.cont, 'button', 'Copiar'));
    expect(writeText).toHaveBeenCalledWith('https://x.com/tienda?v=TOKEN1');
  });

  it('AC-WEB-7 regenerar pide confirmación, invalida el anterior y reemplaza el link', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    m = await montar(<LinksTienda vendedores={VENDEDORES} />);
    await click(porTexto(m.cont, 'button', 'Generar link'));
    await flush();
    obtenerLink.mockResolvedValue({ ok: true, link: 'https://x.com/tienda?v=TOKEN2' });
    await click(porTexto(m.cont, 'button', 'Regenerar'));
    await flush();
    expect(obtenerLink).toHaveBeenLastCalledWith('', 'v-1', { regenerar: true });
    expect(m.cont.querySelector('input[aria-label="Link de Juan"]').value).toContain('TOKEN2');
    expect(m.cont.querySelector('[data-testid="links-msg"]').textContent).toContain('el anterior ya no funciona');
  });

  it('AC-WEB-7 si el admin cancela la confirmación no se regenera', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    m = await montar(<LinksTienda vendedores={VENDEDORES} />);
    await click(porTexto(m.cont, 'button', 'Generar link'));
    await flush();
    obtenerLink.mockClear();
    await click(porTexto(m.cont, 'button', 'Regenerar'));
    expect(obtenerLink).not.toHaveBeenCalled();
  });

  it('AC-WEB-7 un PIN incorrecto muestra el error y no deja ningún link; vendedor sin sincronizar no genera', async () => {
    obtenerLink.mockResolvedValue({ ok: false, mensaje: 'PIN incorrecto o sin permiso de admin.' });
    m = await montar(<LinksTienda vendedores={VENDEDORES} />);
    await click(porTexto(m.cont, 'button', 'Generar link'));
    await flush();
    expect(m.cont.querySelector('[data-testid="links-msg"]').textContent).toContain('PIN incorrecto');
    expect(m.cont.querySelector('input[aria-label="Link de Juan"]')).toBeNull();
    expect(m.cont.querySelector('[data-testid="link-2"]').textContent).toContain('Sincronizá');
  });
});
