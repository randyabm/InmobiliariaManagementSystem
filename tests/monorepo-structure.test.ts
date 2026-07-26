import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ejecutar, leerJson, rutaRepo } from './support/repo';

interface ManifiestoRaiz {
  private: boolean;
  workspaces: string[];
  engines: { node: string };
  scripts: Record<string, string>;
}

interface ManifiestoWorkspace {
  name: string;
  scripts?: Record<string, string>;
}

const raiz = leerJson<ManifiestoRaiz>('package.json');

/** Workspaces exigidos por R1. */
const WORKSPACES = [
  { ruta: 'apps/api', nombre: '@inmobiliaria/api' },
  { ruta: 'apps/web', nombre: '@inmobiliaria/web' },
  { ruta: 'packages/types', nombre: '@inmobiliaria/types' },
] as const;

/** Scripts exigidos por R6, R10 y R19 (design.md §6). */
const SCRIPTS_REQUERIDOS = [
  'lint',
  'format:check',
  'typecheck',
  'test',
  'test:db',
  'build',
  'dev',
  'db:migrate',
  'db:generate',
] as const;

describe('Estructura del monorepo (R1)', () => {
  it('el manifiesto raíz es privado y declara los workspaces', () => {
    expect(raiz.private).toBe(true);
    expect(raiz.workspaces).toEqual(['apps/*', 'packages/*']);
    expect(raiz.engines.node).toBe('>=20');
  });

  it.each(WORKSPACES)(
    'el workspace $ruta existe y se llama $nombre',
    ({ ruta, nombre }) => {
      const manifiesto = leerJson<ManifiestoWorkspace>(ruta, 'package.json');
      expect(manifiesto.name).toBe(nombre);
    },
  );

  it('el gestor de paquetes resuelve los tres workspaces', () => {
    // No basta con que estén declarados: `npm query` lee el árbol realmente
    // instalado, así que falla si un workspace no quedó enlazado.
    const salida = ejecutar('npm', ['query', '.workspace', '--json']);
    const instalados = (JSON.parse(salida) as { name: string }[]).map(
      (paquete) => paquete.name,
    );

    for (const { nombre } of WORKSPACES) {
      expect(instalados).toContain(nombre);
    }
  });

  it('apps/api organiza el dominio bajo src/modules/ con core/ presente (R2)', () => {
    expect(existsSync(rutaRepo('apps/api/src/modules'))).toBe(true);
    expect(
      existsSync(rutaRepo('apps/api/src/modules/core/core.module.ts')),
    ).toBe(true);
    expect(existsSync(rutaRepo('apps/api/src/app.module.ts'))).toBe(true);
    expect(existsSync(rutaRepo('apps/api/src/main.ts'))).toBe(true);
  });

  it('apps/web tiene el shell de React y su script de build (R3)', () => {
    const manifiesto = leerJson<ManifiestoWorkspace>(
      'apps/web',
      'package.json',
    );
    expect(manifiesto.scripts?.build).toBeDefined();
    expect(existsSync(rutaRepo('apps/web/src/App.tsx'))).toBe(true);
    expect(existsSync(rutaRepo('apps/web/src/main.tsx'))).toBe(true);
  });
});

describe('Scripts de la raíz (R6, R10, R19)', () => {
  it.each(SCRIPTS_REQUERIDOS)('define el script "%s"', (script) => {
    expect(raiz.scripts[script]).toBeTypeOf('string');
    expect(raiz.scripts[script]).not.toBe('');
  });

  it('el script test no invoca la suite de base de datos (R19)', () => {
    expect(raiz.scripts.test).not.toContain('test:db');
    expect(raiz.scripts.test).not.toContain('vitest.db');
  });
});
