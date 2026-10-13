import { cambiosDeCantidad, fusionarCambiosArmado } from '../armado';

describe('REQ-BUL registro de cambios del armador', () => {
  test('AC-BUL-7 cambiosDeCantidad detecta 5 a 41 con diferencia 36', () => {
    const antes = [{ productoId: 'p1', nombre: 'Coca', cantidad: 5 }, { productoId: 'p2', nombre: 'Pepsi', cantidad: 3 }];
    const despues = [{ productoId: 'p1', nombre: 'Coca', cantidad: 41 }, { productoId: 'p2', nombre: 'Pepsi', cantidad: 3 }];
    expect(cambiosDeCantidad(antes, despues)).toEqual([
      { productoId: 'p1', nombre: 'Coca', antes: 5, despues: 41, diferencia: 36 },
    ]);
  });

  test('AC-BUL-7 agregado figura con antes 0; removido no figura; duplicados suman', () => {
    const antes = [
      { productoId: 1, nombre: 'A', cantidad: 2 },
      { productoId: 1, nombre: 'A', cantidad: 3 },
      { productoId: 'x', nombre: 'X', cantidad: 4 },
    ];
    const despues = [{ productoId: '1', nombre: 'A', cantidad: 5 }, { productoId: 'n', nombre: 'Nuevo', cantidad: 12 }];
    expect(cambiosDeCantidad(antes, despues)).toEqual([
      { productoId: 'n', nombre: 'Nuevo', antes: 0, despues: 12, diferencia: 12 },
    ]);
  });

  test('AC-BUL-7 entradas nulas o inválidas devuelven []', () => {
    expect(cambiosDeCantidad(null, undefined)).toEqual([]);
    expect(cambiosDeCantidad([{ productoId: 'a', cantidad: 'abc' }], [{ productoId: 'a', cantidad: NaN }])).toEqual([]);
  });

  test('AC-BUL-7 fusionarCambiosArmado conserva el antes más viejo y descarta los que vuelven a igual', () => {
    const previos = [
      { productoId: 'p1', nombre: 'Coca', antes: 5, despues: 17, diferencia: 12 },
      { productoId: 'p2', nombre: 'Pepsi', antes: 3, despues: 15, diferencia: 12 },
    ];
    const nuevos = [
      { productoId: 'p1', nombre: 'Coca', antes: 17, despues: 41, diferencia: 24 },
      { productoId: 'p2', nombre: 'Pepsi', antes: 15, despues: 3, diferencia: -12 },
    ];
    const copiaPrevios = JSON.parse(JSON.stringify(previos));
    expect(fusionarCambiosArmado(previos, nuevos)).toEqual([
      { productoId: 'p1', nombre: 'Coca', antes: 5, despues: 41, diferencia: 36 },
    ]);
    expect(previos).toEqual(copiaPrevios);
  });

  test('AC-BUL-7 fusionarCambiosArmado tolera previos no-array (dato viejo/corrupto)', () => {
    const nuevos = [{ productoId: 'p1', nombre: 'Coca', antes: 5, despues: 41, diferencia: 36 }];
    expect(fusionarCambiosArmado(undefined, nuevos)).toEqual(nuevos);
    expect(fusionarCambiosArmado('basura', nuevos)).toEqual(nuevos);
    expect(fusionarCambiosArmado({}, [])).toEqual([]);
  });
});
