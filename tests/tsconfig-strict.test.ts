import { describe, expect, it } from 'vitest';

import { ejecutar, rutaRepo } from './support/repo';

/**
 * R5: TODO workspace compila con `strict: true`.
 *
 * Se lee la configuración **efectiva** (`tsc --showConfig`), no el JSON del
 * archivo: así el test sigue siendo válido si `strict` llega por herencia
 * desde `tsconfig.base.json`, y falla si un workspace lo desactiva localmente.
 */
const TSCONFIGS = [
  'tsconfig.json',
  'apps/api/tsconfig.json',
  'apps/api/tsconfig.build.json',
  'apps/web/tsconfig.json',
  'packages/types/tsconfig.json',
  'packages/types/tsconfig.build.json',
] as const;

const TSC = rutaRepo('node_modules', 'typescript', 'bin', 'tsc');

function configuracionEfectiva(ruta: string): {
  compilerOptions: Record<string, unknown>;
} {
  const salida = ejecutar('node', [TSC, '--showConfig', '-p', rutaRepo(ruta)]);
  return JSON.parse(salida) as { compilerOptions: Record<string, unknown> };
}

describe('TypeScript estricto en todos los workspaces (R5)', () => {
  it.each(TSCONFIGS)('%s resuelve a strict: true', (ruta) => {
    const config = configuracionEfectiva(ruta);
    expect(config.compilerOptions.strict).toBe(true);
  });
});

describe('Alias del workspace para los tipos compartidos (R4)', () => {
  it('tsconfig.base.json mapea @inmobiliaria/types al paquete compartido', () => {
    const config = configuracionEfectiva('tsconfig.json');
    const paths = config.compilerOptions.paths as Record<string, string[]>;

    expect(paths['@inmobiliaria/types']).toBeDefined();
    expect(paths['@inmobiliaria/types']?.[0]).toContain(
      'packages/types/src/index.ts',
    );
  });
});
