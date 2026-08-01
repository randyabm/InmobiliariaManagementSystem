import { describe, expect, it } from 'vitest';

import { leerTexto } from './support/repo';

/**
 * **R26** (deuda D6 del review #2 de la #5): el spec de `owner_tenant_profiles`
 * no puede afirmar que la identidad de un cliente es "**siempre nueva**".
 *
 * Por qué es un defecto y no una minucia de estilo: leído al pie de la letra,
 * ese titular **prohíbe** lo que la feature #26 construye —reutilizar la
 * identidad dentro de la misma inmobiliaria (RF-C2, `design.md` §7.4)— y
 * contradice al cuerpo del propio R62, que siempre acotó la prohibición a
 * "de otro tenant". El código nunca estuvo mal; el texto sí, y un spec que se
 * contradice es el que produce la siguiente implementación equivocada.
 *
 * Se fija con un test y no con la atención del revisor: es una afirmación
 * sobre el contenido de dos archivos, comprobable de forma determinista.
 */

const REQUIREMENTS = 'specs/owner_tenant_profiles/requirements.md';
const TASKS = 'specs/owner_tenant_profiles/tasks.md';

/** "siempre nueva" con cualquier énfasis Markdown y cualquier espaciado. */
const SIEMPRE_NUEVA = /siempre\s*\**\s*nueva/i;

function titularDeR62(): string {
  const texto = leerTexto(REQUIREMENTS);
  const linea = texto
    .split('\n')
    .find((l) => /^###\s+R62\s+—/.test(l));
  expect(linea, `No se encontró el titular de R62 en ${REQUIREMENTS}`).toBeTruthy();
  return linea!;
}

function enunciadoDeT58(): string {
  const texto = leerTexto(TASKS);
  const linea = texto.split('\n').find((l) => /^- \[[ x]\] T58 —/.test(l));
  expect(linea, `No se encontró el enunciado de T58 en ${TASKS}`).toBeTruthy();
  return linea!;
}

describe('El spec de la #5 no se contradice a sí mismo (R26)', () => {
  it('el titular de R62 no afirma que la identidad sea "siempre nueva"', () => {
    expect(titularDeR62()).not.toMatch(SIEMPRE_NUEVA);
  });

  it('el titular de R62 acota la prohibición a otra inmobiliaria', () => {
    // No basta con quitar la frase: el titular tiene que decir qué prohíbe.
    expect(titularDeR62()).toMatch(/otra inmobiliaria|otro tenant/i);
  });

  it('el enunciado de T58 no afirma que la identidad sea "siempre nueva"', () => {
    expect(enunciadoDeT58()).not.toMatch(SIEMPRE_NUEVA);
  });

  it('T58 sigue marcada como hecha: se corrige el texto, no se reabre', () => {
    // R26 corrige **texto**. Si esta task apareciera sin marcar, alguien habría
    // reabierto una feature ya cerrada y aprobada, que es justo lo que el
    // requirement prohíbe.
    expect(enunciadoDeT58()).toMatch(/^- \[x\] T58 —/);
  });

  it('ningún resumen de bloques de la #5 repite la afirmación sin acotar', () => {
    // Las tablas-resumen de `tasks.md` y `design.md` llevaban la misma frase.
    // Dejarlas ahí reintroduciría la contradicción por la puerta de atrás.
    for (const archivo of [TASKS, 'specs/owner_tenant_profiles/design.md']) {
      const lineas = leerTexto(archivo)
        .split('\n')
        .filter((l) => /identidad\s+siempre\s*\**\s*nueva/i.test(l));
      expect(lineas, `${archivo} sigue diciendo "identidad siempre nueva"`).toEqual(
        [],
      );
    }
  });
});
