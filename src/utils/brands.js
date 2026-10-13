// Detección automática de marca a partir del nombre del producto.
// Los nombres suelen venir con la marca al principio en mayúsculas
// (ej. "MILKA ALF SUPER DDL CHOCOLATE NEGRO"), así que buscamos la
// primera marca conocida que aparezca como palabra completa en el texto.

// Lista de marcas de golosinas/alimentos más comunes en distribuidoras
// argentinas. Se puede seguir ampliando sin tocar el resto del código.
export const MARCAS_CONOCIDAS = [
  'ARCOR', 'BAGLEY', 'TERRABUSI', 'CADBURY', 'NESTLE', 'GEORGALOS',
  'MOGUL', 'FELFORT', 'MILKA', 'BONAFIDE', 'AGUILA', 'BALA', 'CABSHA',
  'RHODESIA', 'MANTECOL', 'JACK', 'BON O BON', 'BONOBON', 'TURRON',
  'SUGUS', 'MENTOPLUS', 'BILLIKEN', 'ROCKLETS', 'TWIST', 'PEPITOS',
  'CHOCOLINAS', 'TITA', 'TRAKINAS', 'OREO', 'MELTZ', 'BARCELONA',
  'SOLITA', 'GOAT', 'BARRIGON', 'GIGA', 'BABY', 'COFLER', 'AGUILUCHO',
  'TOFI', 'TOFFEE', 'MARROC', 'CAROZO', 'BABY COW', 'FANTOCHE',
  'TENTACION', 'PALITO', 'BUTTER TOFFEES', 'HALLS', 'BECK', 'FERRERO',
  'KINDER', 'NESQUIK', 'COCA COLA', 'PEPSI', 'SPRITE', 'FANTA',
  'QUATRO', 'SEVEN UP', 'PARAMOUNT', 'CUNAPIRU', 'CEPITA', 'BAGGIO',
  'ADES', 'KNORR', 'HELLMANNS', 'NATURA', 'ALA', 'SKIP', 'ARIEL',
  'MAGISTRAL', 'ODEX', 'DOVE', 'REXONA', 'AXE', 'SEDAL', 'PANTENE',
  'COLGATE', 'ORAL B',
];

const normalizar = (s) => String(s || '')
  .toUpperCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '') // sacar acentos
  .replace(/[^A-Z0-9\s]/g, ' ') // sacar *, /, . etc
  .replace(/\s+/g, ' ')
  .trim();

export const detectarMarca = (nombre) => {
  const texto = normalizar(nombre);
  if (!texto) return '';
  for (const marca of MARCAS_CONOCIDAS) {
    const marcaNorm = normalizar(marca);
    const re = new RegExp(`(^|\\s)${marcaNorm.replace(/\s+/g, '\\s+')}(\\s|$)`);
    if (re.test(texto)) return marca;
  }
  return '';
};
