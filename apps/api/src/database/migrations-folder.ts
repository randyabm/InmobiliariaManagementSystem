import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Ruta absoluta de `apps/api/drizzle/`.
 *
 * Se resuelve subiendo desde este archivo hasta encontrar la carpeta, porque
 * el runner se ejecuta tanto desde `src/` (tsx) como desde `dist/` (build) y
 * la profundidad relativa cambia entre ambos.
 */
export function defaultMigrationsSearchStart(): string {
  // `__dirname` existe cuando el código corre como CommonJS (tsx y `dist/`),
  // que es como se ejecuta `db:migrate`. Bajo un runner ESM no está definido;
  // ahí se cae al directorio de trabajo.
  return typeof __dirname === 'string' ? __dirname : process.cwd();
}

export function resolveMigrationsFolder(desde: string): string {
  let actual = resolve(desde);

  for (let i = 0; i < 6; i += 1) {
    const candidato = join(actual, 'drizzle');
    if (existsSync(join(candidato, 'meta', '_journal.json'))) {
      return candidato;
    }
    actual = resolve(actual, '..');
  }

  throw new Error(
    'No se encontró la carpeta de migraciones (drizzle/meta/_journal.json).',
  );
}
