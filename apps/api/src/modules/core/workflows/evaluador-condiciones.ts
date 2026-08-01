import type { OperadorCondicion } from '@inmobiliaria/types';

/**
 * Evaluador whitelisted de condiciones (R3, PA-7-2).
 *
 * Una condición es un array de cláusulas `{campo, operador, valor}`; `campo`
 * es una ruta de puntos sobre el contexto (p. ej. `candidato.puntaje`).
 *
 * ## Fail closed, nunca fail open
 *
 * - Condición vacía (`[]` o `{}`) → siempre verdadera.
 * - Operador desconocido, campo mal formado o tipos incompatibles →
 *   **falsa**, sin lanzar. Una condición que no se puede evaluar no
 *   autoriza una transición (R7).
 * - **Nunca** `eval` de JavaScript ni SQL derivado de la condición: el
 *   evaluador solo lee el contexto con una ruta de puntos.
 */
export function cumpleCondicion(condicion: unknown, contexto: Record<string, unknown>): boolean {
  if (condicion === null || condicion === undefined) return true;
  if (Array.isArray(condicion) && condicion.length === 0) return true;
  if (!Array.isArray(condicion)) return false;

  return condicion.every((clausula) => {
    if (typeof clausula !== 'object' || clausula === null) return false;
    const { campo, operador } = clausula as { campo?: unknown; operador?: unknown };
    if (typeof campo !== 'string' || campo === '') return false;
    if (!esOperador(operador)) return false;

    const valorContexto = leerPorRuta(contexto, campo);
    if (!valorContexto.encontrado) {
      // `es_nulo` sobre un campo ausente es verdadero; el resto, falso.
      return operador === 'es_nulo';
    }

    return evaluar(operador, valorContexto.valor, (clausula as { valor?: unknown }).valor);
  });
}

function esOperador(valor: unknown): valor is OperadorCondicion {
  return (
    typeof valor === 'string' &&
    ['igual', 'distinto', 'es_nulo', 'no_nulo', 'mayor_que', 'menor_que'].includes(valor)
  );
}

function leerPorRuta(
  contexto: Record<string, unknown>,
  ruta: string,
): { encontrado: boolean; valor?: unknown } {
  let actual: unknown = contexto;
  for (const segmento of ruta.split('.')) {
    if (typeof actual !== 'object' || actual === null) return { encontrado: false };
    actual = (actual as Record<string, unknown>)[segmento];
    if (actual === undefined) return { encontrado: false };
  }
  return { encontrado: true, valor: actual };
}

function evaluar(
  operador: OperadorCondicion,
  valorContexto: unknown,
  valorEsperado: unknown,
): boolean {
  switch (operador) {
    case 'igual':
      return deepIgual(valorContexto, valorEsperado);
    case 'distinto':
      return !deepIgual(valorContexto, valorEsperado);
    case 'es_nulo':
      return valorContexto === null || valorContexto === undefined;
    case 'no_nulo':
      return valorContexto !== null && valorContexto !== undefined;
    case 'mayor_que':
      return esNumero(valorContexto) && esNumero(valorEsperado)
        ? Number(valorContexto) > Number(valorEsperado)
        : false;
    case 'menor_que':
      return esNumero(valorContexto) && esNumero(valorEsperado)
        ? Number(valorContexto) < Number(valorEsperado)
        : false;
  }
}

function esNumero(valor: unknown): boolean {
  return typeof valor === 'number' && Number.isFinite(valor);
}

function deepIgual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'string' && b.trim() !== '') {
    // Tolerancia documentada: `{ valor: "60" }` (JSON no distingue) contra
    // un número del contexto se compara numéricamente. Nada más.
    return Number(b) === a && Number.isFinite(Number(b));
  }
  if (typeof a === 'string' && typeof b === 'number' && a.trim() !== '') {
    return Number(a) === b && Number.isFinite(Number(a));
  }
  if (typeof a === 'boolean' && (b === true || b === false)) return a === b;
  return false;
}
