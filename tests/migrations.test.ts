import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { leerJson, leerTexto, rutaRepo } from './support/repo';

interface EntradaJournal {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: EntradaJournal[];
}

const CARPETA = 'apps/api/drizzle';
const journal = leerJson<Journal>(CARPETA, 'meta', '_journal.json');

const archivosSql = readdirSync(rutaRepo(CARPETA))
  .filter((nombre) => nombre.endsWith('.sql'))
  .sort();

/**
 * Tablas cuya creación se permite en la migración inicial.
 *
 * Está VACÍA a propósito (R11): la primera tabla de negocio (`tenant`) y su
 * `ENABLE`/`FORCE ROW LEVEL SECURITY` pertenecen a la feature #2
 * `multitenancy_rls`. Crear aquí una tabla sin RLS sería un defecto aunque los
 * tests pasaran (docs/conventions.md).
 */
const TABLAS_PERMITIDAS: readonly string[] = [];

describe('Migración inicial (R10, R11)', () => {
  it('existe el archivo de migración inicial', () => {
    expect(archivosSql).toContain('0000_init.sql');
  });

  it('el script db:migrate está definido en la raíz y en apps/api', () => {
    const raiz = leerJson<{ scripts: Record<string, string> }>('package.json');
    const api = leerJson<{ scripts: Record<string, string> }>(
      'apps/api',
      'package.json',
    );

    expect(raiz.scripts['db:migrate']).toBeDefined();
    expect(api.scripts['db:migrate']).toBeDefined();
  });

  it('ninguna migración de esta feature crea tablas de negocio', () => {
    for (const archivo of archivosSql) {
      const sql = leerTexto(CARPETA, archivo)
        // Se descartan los comentarios: la migración explica en prosa por qué
        // NO crea tablas, y esa explicación no debe disparar el test.
        .replace(/--.*$/gm, '')
        .toLowerCase();

      const creaciones = [
        ...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/g),
      ].map((coincidencia) => coincidencia[1] ?? '');

      for (const tabla of creaciones) {
        expect(
          TABLAS_PERMITIDAS,
          `${archivo} crea la tabla "${tabla}" fuera de la lista permitida: ` +
            'las tablas de negocio y su RLS son de la feature #2',
        ).toContain(tabla);
      }
    }
  });

  it('la migración inicial se limita a preparar el esquema base', () => {
    const sql = leerTexto(CARPETA, '0000_init.sql')
      .replace(/--.*$/gm, '')
      .toLowerCase();

    expect(sql).toContain('create extension');
    expect(sql).not.toContain('row level security');
    expect(sql).not.toContain('create policy');
  });
});

describe('Registro de migraciones (R12)', () => {
  it('el journal está ordenado, sin huecos ni duplicados', () => {
    const indices = journal.entries.map((entrada) => entrada.idx);

    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(new Set(indices).size).toBe(indices.length);
    indices.forEach((idx, posicion) => {
      expect(idx).toBe(posicion);
    });
  });

  it('cada entrada del journal corresponde a un archivo .sql existente', () => {
    for (const entrada of journal.entries) {
      expect(archivosSql, `entrada ${entrada.tag}`).toContain(
        `${entrada.tag}.sql`,
      );
    }
  });

  it('ningún archivo .sql queda sin registrar en el journal', () => {
    const registrados = new Set(
      journal.entries.map((entrada) => `${entrada.tag}.sql`),
    );

    for (const archivo of archivosSql) {
      expect(registrados, `archivo ${archivo}`).toContain(archivo);
    }
  });

  it('los tags no se repiten y el dialecto es postgresql', () => {
    const tags = journal.entries.map((entrada) => entrada.tag);
    expect(new Set(tags).size).toBe(tags.length);
    expect(journal.dialect).toBe('postgresql');
  });
});
