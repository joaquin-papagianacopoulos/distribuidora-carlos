// REQ-POR: dominio de portada y personalización (src/domain/tiendaPortada.js).
import {
  normalizarHex, contraste, colorLegible, oscurecer, urlSegura, linkWhatsapp, hoyArgentina, estaVigente,
  normalizarConfigTienda, bannersVigentes, destinoHref, aplicarOfertas, armarPortada, validarImagen,
  validarConfigTienda, catalogoDesdeLocales, COLOR_DEFAULT, MAX_IMAGEN_BYTES,
} from '../tiendaPortada';
import { calcularCarrito, filtrarCatalogo, filtrosDesdeQuery, filtrosAQuery } from '../tienda';
import { dosCorazones, gaseosa, alfajor, ofertaBorde } from '../__fixtures__/tiendaCasos';

const IMG = 'https://x.supabase.co/storage/v1/object/public/tienda/img/a.png';

describe('portada (AC-POR-1)', () => {
  it('AC-POR-1 banners vigentes ordenados, sin inactivos, vencidos ni imágenes inseguras', () => {
    const banners = [
      { imagen: IMG, titulo: 'B', orden: 2, destino: { tipo: 'ofertas' } },
      { imagen: IMG, titulo: 'A', orden: 1, destino: { tipo: 'rubro', valor: 'Golosinas' }, desde: '2026-10-14', hasta: '2026-10-14' },
      { imagen: IMG, titulo: 'vencido', orden: 0, hasta: '2026-10-13', destino: { tipo: 'ofertas' } },
      { imagen: IMG, titulo: 'inactivo', orden: 0, activo: false, destino: { tipo: 'ofertas' } },
      { imagen: 'javascript:alert(1)', titulo: 'malo', orden: 0, destino: { tipo: 'ofertas' } },
    ];
    expect(bannersVigentes(banners, '2026-10-14').map(b => b.titulo)).toEqual(['A', 'B']);
    expect(bannersVigentes(null, '2026-10-14')).toEqual([]);
  });

  it('AC-POR-1 destino del banner: rubro, marca, producto y ofertas (conserva el token)', () => {
    expect(destinoHref({ tipo: 'rubro', valor: 'Golosinas' })).toBe('/tienda?rubro=Golosinas');
    expect(destinoHref({ tipo: 'marca', valor: 'Cola' }, 'TK')).toBe('/tienda?v=TK&marca=Cola');
    expect(destinoHref({ tipo: 'producto', valor: 'p-1' }, 'TK')).toBe('/tienda/p/p-1?v=TK');
    expect(destinoHref({ tipo: 'ofertas' })).toBe('/tienda?ofertas=1');
    expect(destinoHref({ tipo: 'rubro', valor: '' })).toBe('/tienda');
    expect(destinoHref(null)).toBe('/tienda');
  });

  it('AC-POR-1 el filtro de ofertas viaja en la URL y filtra el catálogo', () => {
    const f = filtrosDesdeQuery('?ofertas=1&rubro=Golosinas');
    expect(f.ofertas).toBe(true);
    expect(filtrosAQuery(f)).toBe('?rubro=Golosinas&ofertas=1');
    expect(filtrosDesdeQuery('?q=x').ofertas).toBeUndefined();
    const cat = [{ ...dosCorazones, enOferta: true }, gaseosa];
    expect(filtrarCatalogo(cat, { ofertas: true }).items.map(p => p.id)).toEqual([dosCorazones.id]);
  });

  it('AC-POR-1 armarPortada: fila de ofertas, destacados por rubro y todos los rubros con contador', () => {
    const cat = [{ ...dosCorazones, enOferta: true }, gaseosa, alfajor];
    const p = armarPortada(cat, {
      config: { destacados: ['Golosinas', 'Inexistente'] },
      ofertas: [{ productoId: gaseosa.id, precio: null, desde: '2026-10-01', hasta: '2026-10-31' }],
      banners: [{ imagen: IMG, destino: { tipo: 'producto', valor: 'borrado' } }, { imagen: IMG, destino: { tipo: 'ofertas' } }],
    }, '2026-10-14');
    expect(p.ofertas.map(x => x.id).sort()).toEqual([dosCorazones.id, gaseosa.id].sort());
    expect(p.destacados).toHaveLength(1);
    expect(p.destacados[0].rubro).toBe('Golosinas');
    expect(p.destacados[0].productos[0].disponible).toBe(true); // disponibles primero
    expect(p.rubros).toEqual([{ rubro: 'Bebidas', cantidad: 1 }, { rubro: 'Golosinas', cantidad: 2 }]);
    expect(p.banners).toHaveLength(1); // el banner a un producto que no está se descarta
    expect(armarPortada(null).rubros).toEqual([]);
  });
});

describe('config de la tienda (AC-POR-2)', () => {
  it('AC-POR-2 contraste WCAG del color principal con el texto blanco', () => {
    expect(normalizarHex('#ABC')).toBe('#aabbcc');
    expect(normalizarHex('zzz')).toBeNull();
    expect(contraste('#000000', '#ffffff')).toBe(21);
    expect(contraste('#ffffff', 'nope')).toBeNull();
    expect(colorLegible(COLOR_DEFAULT)).toBe(true);
    expect(colorLegible('#ffff00')).toBe(false);
    expect(oscurecer('#ffffff', 0.5)).toBe('#808080');
    expect(oscurecer('x')).toBeNull();
  });

  it('AC-POR-2 normaliza la config pública con defaults y descarta color ilegible y logo no https', () => {
    const c = normalizarConfigTienda({ nombre: '  Mi  Tienda ', color: '#ffff00', logo: 'http://x/l.png', whatsapp: '+54 9 11 1234-5678', destacados: ['A', 'A', ''], limitePorHora: 0 });
    expect(c.nombre).toBe('Mi Tienda');
    expect(c.color).toBe(COLOR_DEFAULT);
    expect(c.logo).toBeNull();
    expect(c.whatsapp).toBe('5491112345678');
    expect(c.destacados).toEqual(['A']);
    expect(c.limitePorHora).toBe(5);
    expect(normalizarConfigTienda(null).nombre).toBe('Tienda');
    expect(linkWhatsapp(c.whatsapp)).toBe('https://wa.me/5491112345678');
    expect(linkWhatsapp('123')).toBeNull();
  });

  it('AC-POR-2 validarConfigTienda marca errores por campo (nombre, contraste, límite, banners)', () => {
    const v = validarConfigTienda({
      config: { nombre: '', color: '#ffff00', limitePorHora: 0, whatsapp: '12', logo: 'ftp://x' },
      banners: [{ imagen: '', destino: { tipo: 'rubro', valor: '' }, desde: '2026-10-20', hasta: '2026-10-10' }],
    });
    expect(v.ok).toBe(false);
    expect(Object.keys(v.errores)).toEqual(expect.arrayContaining(['nombre', 'color', 'limitePorHora', 'whatsapp', 'logo', 'bannersDetalle']));
    expect(v.errores.color).toMatch(/contraste/);
    expect(v.errores.bannersDetalle[0]).toEqual({ imagen: expect.any(String), destino: expect.any(String), vigencia: expect.any(String) });
  });

  it('AC-POR-2 una config válida devuelve datos limpios, con el orden de los banners por posición', () => {
    const v = validarConfigTienda({
      config: { nombre: 'Jorge', color: '#0F766E', limitePorHora: 5, destacados: ['Golosinas'] },
      banners: [{ imagen: IMG, destino: { tipo: 'ofertas', valor: 'ignorar' } }, { imagen: IMG, destino: { tipo: 'marca', valor: 'Cola' } }],
      ofertas: [],
    });
    expect(v.ok).toBe(true);
    expect(v.datos.config.color).toBe('#0f766e');
    expect(v.datos.banners.map(b => [b.orden, b.destino.valor])).toEqual([[0, ''], [1, 'Cola']]);
    expect(validarConfigTienda(undefined).ok).toBe(false);
  });
});

describe('ofertas (AC-POR-3)', () => {
  it('AC-POR-3 oferta vigente: precio anterior tachado, vale en el borde del día y desaparece al vencer', () => {
    const [enBorde] = aplicarOfertas([dosCorazones], [ofertaBorde], '2026-10-14');
    expect(enBorde).toMatchObject({ precio: 800, precioAnterior: 900, enOferta: true });
    const [vencida] = aplicarOfertas([dosCorazones], [ofertaBorde], '2026-10-15');
    expect(vencida).toMatchObject({ precio: 900, precioAnterior: null, enOferta: false });
    const [sinPrecio] = aplicarOfertas([gaseosa], [{ productoId: gaseosa.id, precio: null, desde: '2026-10-01', hasta: '2026-10-31' }], '2026-10-14');
    expect(sinPrecio).toMatchObject({ precio: gaseosa.precio, precioAnterior: null, enOferta: true });
    expect(estaVigente(null, '2026-10-14')).toBe(false);
  });

  it('AC-POR-3 el carrito cobra el precio de oferta vigente (misma regla que el servidor)', () => {
    const prod = { ...dosCorazones, ofertas: [ofertaBorde] };
    const map = new Map([[prod.id, prod]]);
    const lineas = [{ productoId: prod.id, cantidad: 1, modo: 'bulto' }];
    expect(calcularCarrito(lineas, map, {}, '2026-10-14').total).toBe(12800);
    expect(calcularCarrito(lineas, map, {}, '2026-10-15').total).toBe(14400);
  });

  it('AC-POR-3 validación de ofertas: producto, precio opcional > 0 y vigencia obligatoria', () => {
    const base = { config: { nombre: 'T', color: COLOR_DEFAULT, limitePorHora: 5 } };
    const v = validarConfigTienda({ ...base, ofertas: [
      { productoId: '', precio: '-1', desde: '', hasta: '' },
      { productoId: 7, precio: '850,5', desde: '2026-10-01', hasta: '2026-10-31' },
      { productoId: 8, precio: '', desde: '2026-10-01', hasta: '2026-13-01' },
    ] });
    expect(v.errores.ofertasDetalle[0]).toEqual({ productoId: expect.any(String), precio: expect.any(String), vigencia: expect.any(String) });
    expect(v.errores.ofertasDetalle[1]).toBeUndefined();
    expect(v.datos.ofertas[1]).toMatchObject({ productoId: '7', precio: 850.5 });
    expect(v.errores.ofertasDetalle[2].vigencia).toMatch(/hasta/);
  });
});

describe('imágenes (AC-POR-4)', () => {
  it('AC-POR-4 solo jpg/png/webp y máx. 2 MB', () => {
    expect(validarImagen({ type: 'image/png', size: 1000 })).toEqual({ ok: true, ext: 'png' });
    expect(validarImagen({ type: 'image/webp', size: MAX_IMAGEN_BYTES }).ok).toBe(true);
    expect(validarImagen({ type: 'image/jpeg', size: MAX_IMAGEN_BYTES + 1 }).error).toMatch(/2 MB/);
    expect(validarImagen({ type: 'image/svg+xml', size: 10 }).ok).toBe(false);
    expect(validarImagen({ type: 'image/png', size: 0 }).ok).toBe(false);
    expect(validarImagen(null).ok).toBe(false);
    expect(urlSegura('https://a.b/c.png')).toBe('https://a.b/c.png');
    expect(urlSegura('data:image/png;base64,xx')).toBeNull();
  });
});

describe('vista previa (AC-POR-5)', () => {
  it('AC-POR-5 catálogo de vista previa desde productos locales: sin ocultos ni sin precio, disponibilidad por stock', () => {
    const locales = [
      { id: 1, nombre: 'A', precio: 100, categoria: 'R', imagen_url: IMG },
      { id: 2, nombre: 'B', precio: 0 },
      { id: 3, nombre: 'C', precio: 50, visibleTienda: false },
    ];
    const cat = catalogoDesdeLocales(locales, id => (id === 1 ? 3 : 0));
    expect(cat).toEqual([expect.objectContaining({ id: 1, rubro: 'R', imagen: IMG, disponible: true })]);
    expect(catalogoDesdeLocales([{ id: 9, precio: 10 }], () => 0, true)[0].disponible).toBe(true);
    expect(catalogoDesdeLocales(null)).toEqual([]);
  });

  it('AC-POR-5 hoy en hora de Argentina (UTC-3), igual que el servidor', () => {
    expect(hoyArgentina(new Date('2026-10-15T02:30:00Z'))).toBe('2026-10-14');
    expect(hoyArgentina(new Date('2026-10-15T03:30:00Z'))).toBe('2026-10-15');
  });
});
