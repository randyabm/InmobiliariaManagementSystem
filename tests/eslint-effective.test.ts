import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import { RAIZ, rutaRepo } from './support/repo';

/**
 * R7: `lint` tiene que ser capaz de FALLAR.
 *
 * Un `eslint .` que no analiza nada (por un `ignores` demasiado amplio o una
 * config vacía) devolvería 0 siempre y produciría un verde falso. Este test
 * ejecuta ESLint programáticamente sobre código que viola reglas activas y
 * exige al menos un error de severidad 2.
 */
const eslint = new ESLint({ cwd: RAIZ });

async function erroresDe(codigo: string, rutaVirtual: string) {
  const [resultado] = await eslint.lintText(codigo, {
    filePath: rutaRepo(rutaVirtual),
  });
  return (resultado?.messages ?? []).filter(
    (mensaje) => mensaje.severity === 2,
  );
}

describe('El lint analiza de verdad (R7)', () => {
  it('reporta error de severidad 2 ante una comparación laxa', async () => {
    const errores = await erroresDe(
      'export const x = (a: number, b: number): boolean => a == b;\n',
      'apps/api/src/__fixture-eqeqeq.ts',
    );

    expect(errores.length).toBeGreaterThan(0);
    expect(errores.map((e) => e.ruleId)).toContain('eqeqeq');
  });

  it('reporta error ante `console.log` de debug (CHECKPOINTS §C3)', async () => {
    const errores = await erroresDe(
      'export function f(): void { console.log("debug"); }\n',
      'apps/api/src/__fixture-console.ts',
    );

    expect(errores.map((e) => e.ruleId)).toContain('no-console');
  });

  it('reporta error ante `any` explícito (docs/conventions.md)', async () => {
    const errores = await erroresDe(
      'export function f(v: any): any { return v; }\n',
      'apps/api/src/__fixture-any.ts',
    );

    expect(errores.map((e) => e.ruleId)).toContain(
      '@typescript-eslint/no-explicit-any',
    );
  });

  it('no reporta errores sobre código válido (el lint no es ruido)', async () => {
    const errores = await erroresDe(
      'export const saludo: string = "hola";\n',
      'apps/api/src/__fixture-ok.ts',
    );

    expect(errores).toEqual([]);
  });
});

describe('Frontera entre paquetes (R4, docs/architecture.md)', () => {
  it('prohíbe importar otro paquete por ruta relativa', async () => {
    const errores = await erroresDe(
      "import type { HealthStatus } from '../../../packages/types/src/index';\n" +
        'export type S = HealthStatus;\n',
      'apps/api/src/__fixture-cross-package.ts',
    );

    expect(errores.map((e) => e.ruleId)).toContain('no-restricted-imports');
  });

  it('permite el alias del workspace', async () => {
    const errores = await erroresDe(
      "import type { HealthStatus } from '@inmobiliaria/types';\n" +
        'export type S = HealthStatus;\n',
      'apps/api/src/__fixture-alias.ts',
    );

    expect(errores).toEqual([]);
  });
});
