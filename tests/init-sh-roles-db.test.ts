import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { leerTexto, rutaRepo } from './support/repo';

/**
 * **R25** (deuda D4 del review #2 de la #5): `init.sh` **falla** —no advierte—
 * cuando `DATABASE_URL` y `DATABASE_MIGRATION_URL` son idénticas.
 *
 * Por qué importa: con las dos iguales, la API se conecta con el rol que migra
 * (dueño de las tablas o superusuario) y `FORCE ROW LEVEL SECURITY` deja de
 * aislar en ejecución. La puerta de calidad seguiría en verde midiendo un
 * aislamiento inerte, que es exactamente el defecto que hundió la #5.
 *
 * ## Por qué se ejecuta en un directorio de arena y no en el repo
 *
 * `init.sh` usa rutas relativas al directorio de trabajo, así que se le monta
 * un mínimo de arnés (los archivos base del paso 2 y un `feature_list.json`
 * válido) y **ningún `package.json`**: sin él, el paso 5 se salta limpiamente
 * y el código de salida depende **solo** del chequeo que este test verifica.
 * Ejecutarlo sobre el repo real recursaría lint + typecheck + ambas suites por
 * cada caso y el veredicto sería indistinguible del de cualquier otro fallo.
 *
 * El `.env` de arena lleva credenciales **inertes** de prueba, no secretos
 * (CHECKPOINTS.md §C7).
 */

const ARCHIVOS_BASE = [
  'AGENTS.md',
  'CLAUDE.md',
  'CHECKPOINTS.md',
  'progress/current.md',
  'docs/PRD.md',
  'docs/architecture.md',
  'docs/conventions.md',
  'docs/specs.md',
  'docs/verification.md',
];

const URL_APP = 'postgres://app_inmobiliaria@localhost:5432/inmobiliaria';
const URL_MIGRACION = 'postgres://migrador@localhost:5432/inmobiliaria';
const JWT_INERTE = 'valor-inerte-de-test-no-es-un-secreto';

const arenas: string[] = [];

function prepararArena(urlApp: string, urlMigracion: string): string {
  const raiz = mkdtempSync(join(tmpdir(), 'init-sh-r25-'));
  arenas.push(raiz);

  for (const archivo of ARCHIVOS_BASE) {
    const destino = join(raiz, archivo);
    mkdirSync(join(destino, '..'), { recursive: true });
    writeFileSync(destino, `# stub de test\n`);
  }
  writeFileSync(
    join(raiz, 'feature_list.json'),
    JSON.stringify({ features: [] }, null, 2),
  );
  writeFileSync(
    join(raiz, '.env'),
    [
      `JWT_SECRET=${JWT_INERTE}`,
      `DATABASE_URL=${urlApp}`,
      `DATABASE_MIGRATION_URL=${urlMigracion}`,
      'APP_DB_USER=app_inmobiliaria',
      'APP_DB_PASSWORD=clave-inerte-de-test',
      '',
    ].join('\n'),
  );
  return raiz;
}

function ejecutarInitEn(raiz: string): { status: number; salida: string } {
  const resultado = spawnSync('bash', [rutaRepo('init.sh')], {
    cwd: raiz,
    encoding: 'utf8',
    env: { ...process.env, TERM: 'dumb' },
  });
  return {
    status: resultado.status ?? -1,
    salida: `${resultado.stdout ?? ''}${resultado.stderr ?? ''}`,
  };
}

afterAll(() => {
  for (const arena of arenas) rmSync(arena, { recursive: true, force: true });
});

describe('init.sh y la separación de roles de base de datos (R25)', () => {
  it('falla con código distinto de cero si las dos URLs coinciden', () => {
    const { status, salida } = ejecutarInitEn(
      prepararArena(URL_APP, URL_APP),
    );

    expect(salida).toMatch(/\[FAIL\][^\n]*DATABASE_URL y DATABASE_MIGRATION_URL/);
    expect(status).not.toBe(0);
  });

  it('no falla por este motivo cuando las URLs difieren', () => {
    const { status, salida } = ejecutarInitEn(
      prepararArena(URL_APP, URL_MIGRACION),
    );

    expect(salida).not.toMatch(
      /\[FAIL\][^\n]*DATABASE_URL y DATABASE_MIGRATION_URL/,
    );
    expect(salida).toMatch(
      /\[OK\][^\n]*DATABASE_URL y DATABASE_MIGRATION_URL son distintas/,
    );
    // El arnés mínimo no tiene package.json: si el chequeo de R25 no dispara,
    // no queda nada que pueda ensuciar el código de salida.
    expect(status).toBe(0);
  });

  it('el chequeo sigue siendo un fail y no un warn en el script', () => {
    // Fija la forma, no solo el efecto: si alguien lo devolviera a `warn`, los
    // dos casos de arriba dejarían de distinguirse por el código de salida.
    const script = leerTexto('init.sh');
    const bloque = script.slice(script.indexOf('APP_URL=$(grep'));

    expect(bloque).toMatch(
      /fail "DATABASE_URL y DATABASE_MIGRATION_URL son idénticas/,
    );
    expect(bloque).not.toMatch(
      /warn "DATABASE_URL y DATABASE_MIGRATION_URL son idénticas/,
    );
  });

  it('las variables ausentes siguen siendo un warn (no se endurecen de más)', () => {
    // R25 acota el endurecimiento a UN chequeo. Los tres `warn` por variables
    // que faltan en `.env` son la elección correcta y el review lo confirmó.
    expect(leerTexto('init.sh')).toMatch(
      /warn "Falta \$\{var\} en \.env/,
    );
  });
});
