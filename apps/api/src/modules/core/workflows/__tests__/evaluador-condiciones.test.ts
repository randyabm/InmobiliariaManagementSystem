import { describe, expect, it } from 'vitest';

import { cumpleCondicion } from '../evaluador-condiciones';

/**
 * **T7 — R3.** El evaluador whitelisted: seis operadores, ruta anidada,
 * tipos y fail closed. Una condición que no se puede evaluar es FALSA, no
 * lanzada ni verdadera por defecto (PA-7-2).
 */
describe('cumpleCondicion (T7: R3)', () => {
  const contexto = {
    entrega_ok: true,
    puntaje: 72,
    candidato: { nombre: 'Ana', puntaje: 85 },
    nada: null,
  };

  it('la condición vacía es siempre verdadera', () => {
    expect(cumpleCondicion([], contexto)).toBe(true);
    expect(cumpleCondicion(null, contexto)).toBe(true);
    expect(cumpleCondicion(undefined, contexto)).toBe(true);
  });

  it('igual y distinto sobre booleanos y números', () => {
    expect(cumpleCondicion([{ campo: 'entrega_ok', operador: 'igual', valor: true }], contexto)).toBe(true);
    expect(cumpleCondicion([{ campo: 'entrega_ok', operador: 'igual', valor: false }], contexto)).toBe(false);
    expect(cumpleCondicion([{ campo: 'puntaje', operador: 'distinto', valor: 71 }], contexto)).toBe(true);
  });

  it('es_nulo y no_nulo', () => {
    expect(cumpleCondicion([{ campo: 'nada', operador: 'es_nulo' }], contexto)).toBe(true);
    expect(cumpleCondicion([{ campo: 'puntaje', operador: 'es_nulo' }], contexto)).toBe(false);
    expect(cumpleCondicion([{ campo: 'puntaje', operador: 'no_nulo' }], contexto)).toBe(true);
    // Un campo ausente: es_nulo = verdadero, no_nulo = falso.
    expect(cumpleCondicion([{ campo: 'ausente', operador: 'es_nulo' }], contexto)).toBe(true);
    expect(cumpleCondicion([{ campo: 'ausente', operador: 'no_nulo' }], contexto)).toBe(false);
  });

  it('mayor_que y menor_que sobre números', () => {
    expect(cumpleCondicion([{ campo: 'puntaje', operador: 'mayor_que', valor: 60 }], contexto)).toBe(true);
    expect(cumpleCondicion([{ campo: 'puntaje', operador: 'menor_que', valor: 60 }], contexto)).toBe(false);
    expect(cumpleCondicion([{ campo: 'puntaje', operador: 'menor_que', valor: 100 }], contexto)).toBe(true);
  });

  it('la ruta de puntos lee objetos anidados', () => {
    expect(cumpleCondicion([{ campo: 'candidato.puntaje', operador: 'mayor_que', valor: 80 }], contexto)).toBe(true);
    expect(cumpleCondicion([{ campo: 'candidato.nombre', operador: 'igual', valor: 'Ana' }], contexto)).toBe(true);
  });

  it('mayor_que sobre no-número es falso, no error', () => {
    expect(cumpleCondicion([{ campo: 'candidato.nombre', operador: 'mayor_que', valor: 1 }], contexto)).toBe(false);
    expect(cumpleCondicion([{ campo: 'nada', operador: 'menor_que', valor: 1 }], contexto)).toBe(false);
  });

  it('fail closed: operador desconocido, campo vacío o forma inválida → falso', () => {
    expect(cumpleCondicion([{ campo: 'puntaje', operador: 'contiene', valor: 7 }], contexto)).toBe(false);
    expect(cumpleCondicion([{ campo: '', operador: 'igual', valor: 1 }], contexto)).toBe(false);
    expect(cumpleCondicion([{ operador: 'igual', valor: 1 }], contexto)).toBe(false);
    expect(cumpleCondicion('no-es-array', contexto)).toBe(false);
    expect(cumpleCondicion([null], contexto)).toBe(false);
  });

  it('todas las cláusulas deben cumplirse (AND)', () => {
    const condicion = [
      { campo: 'puntaje', operador: 'mayor_que', valor: 60 },
      { campo: 'entrega_ok', operador: 'igual', valor: true },
    ];
    expect(cumpleCondicion(condicion, contexto)).toBe(true);
    expect(
      cumpleCondicion(
        [
          { campo: 'puntaje', operador: 'mayor_que', valor: 60 },
          { campo: 'entrega_ok', operador: 'igual', valor: false },
        ],
        contexto,
      ),
    ).toBe(false);
  });
});
