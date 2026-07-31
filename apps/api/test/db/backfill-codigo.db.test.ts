import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveMigrationsFolder } from '../../src/database/migrations-folder';
import { runMigrations } from '../../src/database/run-migrations';

/**
 * **T73 (parte de datos) — R76**: el backfill de `tenant.codigo` es determinista.
 *
 * ## Por qué este archivo existe y no bastaba `migrations.db.test.ts`
 *
 * El backfill solo hace algo si **ya hay inmobiliarias** cuando la migración se
 * aplica. En un contenedor recién levantado la base está vacía, así que la
 * suite de migraciones ejerce el `CHECK`, la `UNIQUE` y `tenant_por_codigo`,
 * pero **nunca ve derivarse un solo código**. Afirmar sobre el backfill sin
 * datos previos sería un verde vacío, que es justo el defecto que hundió esta
 * feature en la primera revisión.
 *
 * Así que aquí se reproduce la situación real: se aplican las migraciones
 * **hasta 0006**, se siembran inmobiliarias como las habría en producción, y
 * solo entonces se aplica `0007`. Nada se fabrica a mano —la derivación la hace
 * la migración de verdad—; lo único que se construye es una carpeta de
 * migraciones con el journal recortado, que es la forma de decirle a Drizzle
 * "párate aquí".
 *
 * Determinista importa (R76): el mismo dato de partida tiene que producir el
 * mismo código en desarrollo, en CI y en producción, o los tests dependerían
 * del orden de inserción.
 */
describe('Backfill determinista de tenant.codigo (#5 R76, D-12)', () => {
  let contenedor: StartedPostgreSqlContainer;
  let pool: Pool;

  const CARPETA_COMPLETA = resolveMigrationsFolder(process.cwd());

  /** Ids fijos para que el orden de siembra no dependa del azar. */
  const IDS = {
    sion: '10000000-0000-0000-0000-000000000001',
    sionRepetida: '10000000-0000-0000-0000-000000000002',
    sionTercera: '10000000-0000-0000-0000-000000000003',
    reservada: '10000000-0000-0000-0000-000000000004',
    impronunciable: '10000000-0000-0000-0000-000000000005',
  };

  /**
   * Copia las migraciones `0000..hasta` a una carpeta temporal con el journal
   * recortado. Drizzle identifica cada migración por el hash del archivo, así
   * que aplicar después la carpeta completa continúa donde esta lo dejó.
   */
  function carpetaHasta(hasta: number): string {
    const journal = JSON.parse(
      readFileSync(join(CARPETA_COMPLETA, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> };

    const destino = mkdtempSync(join(tmpdir(), 'migraciones-parciales-'));
    mkdirSync(join(destino, 'meta'), { recursive: true });

    const entradas = journal.entries.filter((e) => e.idx <= hasta);
    for (const entrada of entradas) {
      copyFileSync(
        join(CARPETA_COMPLETA, `${entrada.tag}.sql`),
        join(destino, `${entrada.tag}.sql`),
      );
    }
    writeFileSync(
      join(destino, 'meta', '_journal.json'),
      JSON.stringify({ ...journal, entries: entradas }),
    );
    return destino;
  }

  beforeAll(async () => {
    contenedor = await new PostgreSqlContainer('postgres:16.4-alpine').start();
    const connectionString = contenedor.getConnectionUri();
    pool = new Pool({ connectionString });

    // 1) El estado "antes de D-12": `tenant` todavía sin columna `codigo`.
    await runMigrations(connectionString, carpetaHasta(6));

    const { rows } = await pool.query<{ existe: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_name = 'tenant' AND column_name = 'codigo'
       ) AS existe`,
    );
    expect(rows[0]?.existe, 'la carpeta parcial no debía incluir 0007').toBe(false);

    // 2) Inmobiliarias como las que habría en producción. Tres comparten
    //    nombre a propósito (colisión), una deriva en un nombre reservado y
    //    otra no deja nada utilizable.
    await pool.query(
      `INSERT INTO tenant (id, nombre, nit, created_at) VALUES
         ($1, 'Arrendamientos Sión',  '900000001', '2020-01-01T00:00:00Z'),
         ($2, 'Arrendamientos Sion',  '900000002', '2020-01-02T00:00:00Z'),
         ($3, 'ARRENDAMIENTOS  SIÓN', '900000003', '2020-01-03T00:00:00Z'),
         ($4, 'API',                  '900000004', '2020-01-04T00:00:00Z'),
         ($5, '¡!¿?',                 '900000005', '2020-01-05T00:00:00Z')`,
      [IDS.sion, IDS.sionRepetida, IDS.sionTercera, IDS.reservada, IDS.impronunciable],
    );

    // 3) Y ahora sí, la migración de D-8/D-12 sobre datos que ya existen.
    await runMigrations(connectionString, CARPETA_COMPLETA);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await contenedor?.stop();
  });

  async function codigoDe(id: string): Promise<string> {
    const { rows } = await pool.query<{ codigo: string }>(
      'SELECT codigo FROM tenant WHERE id = $1',
      [id],
    );
    return rows[0]!.codigo;
  }

  it('deriva el código del nombre: minúsculas, sin tildes, separadores a guiones (R76)', async () => {
    // "Sión" → "sion", no "sin": las tildes se transliteran, no se borran.
    expect(await codigoDe(IDS.sion)).toBe('arrendamientos-sion');
  });

  it('resuelve las colisiones con el sufijo numérico MÁS BAJO disponible (R76)', async () => {
    // Los tres nombres derivan en el mismo `arrendamientos-sion`. El orden es
    // `created_at, id`, así que el resultado no depende del azar.
    expect(await codigoDe(IDS.sionRepetida)).toBe('arrendamientos-sion-2');
    expect(await codigoDe(IDS.sionTercera)).toBe('arrendamientos-sion-3');
  });

  it('un nombre que deriva en un código reservado recibe sufijo, no el reservado (R75)', async () => {
    expect(await codigoDe(IDS.reservada)).toBe('api-2');
  });

  it('un nombre sin nada utilizable recibe un código válido, no uno vacío (R73)', async () => {
    const codigo = await codigoDe(IDS.impronunciable);
    expect(codigo.length).toBeGreaterThanOrEqual(3);
    expect(codigo).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('todos los códigos generados cumplen el CHECK y son únicos (R73, R76)', async () => {
    const { rows } = await pool.query<{ codigo: string }>('SELECT codigo FROM tenant');

    // Si alguno no cumpliera, el `ADD CONSTRAINT` de la propia migración habría
    // fallado: que estemos aquí ya lo demuestra. Se afirma igualmente porque un
    // día alguien podría añadir el CHECK con `NOT VALID`.
    for (const { codigo } of rows) {
      expect(codigo).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(codigo.length).toBeGreaterThanOrEqual(3);
      expect(codigo.length).toBeLessThanOrEqual(63);
    }
    expect(new Set(rows.map((r) => r.codigo)).size).toBe(rows.length);
  });

  it('la derivación es determinista: dos llamadas dan lo mismo (R76)', async () => {
    const nombres = [
      'Arrendamientos Sión',
      'INMOBILIARIA  La Compañía',
      'Gestión & Renta S.A.S.',
    ];

    for (const nombre of nombres) {
      const { rows: a } = await pool.query<{ c: string }>(
        'SELECT tenant_codigo_desde_nombre($1) AS c',
        [nombre],
      );
      const { rows: b } = await pool.query<{ c: string }>(
        'SELECT tenant_codigo_desde_nombre($1) AS c',
        [nombre],
      );
      expect(a[0]?.c).toBe(b[0]?.c);
      expect(a[0]?.c).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }

    const { rows } = await pool.query<{ c: string }>(
      'SELECT tenant_codigo_desde_nombre($1) AS c',
      ['Gestión & Renta S.A.S.'],
    );
    expect(rows[0]?.c).toBe('gestion-renta-s-a-s');
  });

  it('reaplicar la migración no reescribe los códigos ya asignados (R76)', async () => {
    const antes = await codigoDe(IDS.sionRepetida);
    await runMigrations(contenedor.getConnectionUri(), CARPETA_COMPLETA);
    expect(await codigoDe(IDS.sionRepetida)).toBe(antes);
  });
});
