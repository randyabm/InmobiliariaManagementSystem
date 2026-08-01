import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveMigrationsFolder } from '../../src/database/migrations-folder';
import { runMigrations } from '../../src/database/run-migrations';

/**
 * **T6 — R5, R6**: la migración `0009_identidad_por_documento` sobre datos que
 * ya existen.
 *
 * ## Por qué no basta con `migrations.db.test.ts`
 *
 * El backfill solo hace algo si ya hay perfiles cuando la migración se aplica.
 * En un contenedor recién levantado la base está vacía: la suite general
 * ejerce columnas, `CHECK` e índice, pero **no ve copiarse un solo documento**.
 * Afirmar sobre el backfill sin datos previos sería un verde vacío. Así que se
 * aplican las migraciones **hasta 0008**, se siembra el estado real —incluido
 * el defecto que esta feature cierra: la misma persona como dos identidades— y
 * solo entonces se aplica `0009`.
 *
 * Mismo patrón y misma justificación que `backfill-codigo.db.test.ts` (#5 R76).
 * El test no fabrica ningún objeto de esquema: todo lo crea la migración.
 */
describe('Backfill del documento de la identidad (#26 R5, R6)', () => {
  let contenedor: StartedPostgreSqlContainer;
  let pool: Pool;
  let connectionString: string;

  const CARPETA_COMPLETA = resolveMigrationsFolder(process.cwd());

  const TENANT_A = '31111111-1111-1111-1111-111111111111';
  const TENANT_B = '32222222-2222-2222-2222-222222222222';

  /** Ids fijos: el resultado no puede depender del orden de inserción. */
  const IDS = {
    /** Propietaria del tenant A. El backfill toma su documento del perfil. */
    propietaria: '30000000-0000-0000-0000-000000000001',
    /** Inquilino del tenant A, con documento propio. */
    inquilino: '30000000-0000-0000-0000-000000000002',
    /** Empleado sin perfil ni documento: debe quedar en NULL. */
    empleado: '30000000-0000-0000-0000-000000000003',
    /** Duplicada: MISMA persona que `propietaria`, segunda fila de `user`. */
    duplicada: '30000000-0000-0000-0000-000000000004',
    /** Misma persona en OTRA inmobiliaria: NO es una colisión (D-8). */
    mismaEnB: '30000000-0000-0000-0000-000000000005',
  };

  const DOC_PROPIETARIA = '52000001';

  function carpetaHasta(hasta: number): string {
    const journal = JSON.parse(
      readFileSync(join(CARPETA_COMPLETA, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> };

    const destino = mkdtempSync(join(tmpdir(), 'migraciones-0009-'));
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
    connectionString = contenedor.getConnectionUri();
    pool = new Pool({ connectionString });

    // 1) El estado "antes de #26": `user` todavía sin columna `documento`.
    await runMigrations(connectionString, carpetaHasta(8));

    const { rows: previas } = await pool.query<{ existe: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_name = 'user' AND column_name = 'documento'
       ) AS existe`,
    );
    expect(previas[0]?.existe, 'la carpeta parcial no debía incluir 0009').toBe(
      false,
    );

    await pool.query(
      `INSERT INTO tenant (id, nombre, nit, codigo) VALUES
         ($1, 'Inmobiliaria A', '900300001', 'backfill-doc-a'),
         ($2, 'Inmobiliaria B', '900300002', 'backfill-doc-b')`,
      [TENANT_A, TENANT_B],
    );

    // 2) Identidades como las que dejó la #5: clientes con `email` NULL.
    //    `created_at` explícito porque el desempate de colisiones lo usa.
    await pool.query(
      `INSERT INTO "user" (id, tenant_id, email, password_hash, nombre, created_at) VALUES
         ($1, $6, NULL, NULL, 'María Pérez',   '2020-01-01T00:00:00Z'),
         ($2, $6, NULL, NULL, 'Carlos Gómez',  '2020-01-02T00:00:00Z'),
         ($3, $6, 'empleado@example.com', 'hash-inerte-de-test', 'Empleada A', '2020-01-03T00:00:00Z'),
         ($4, $6, NULL, NULL, 'María Pérez',   '2020-01-04T00:00:00Z'),
         ($5, $7, NULL, NULL, 'María Pérez',   '2020-01-05T00:00:00Z')`,
      [
        IDS.propietaria,
        IDS.inquilino,
        IDS.empleado,
        IDS.duplicada,
        IDS.mismaEnB,
        TENANT_A,
        TENANT_B,
      ],
    );

    // 3) Los perfiles. `duplicada` es el defecto que la feature cierra: la
    //    misma persona (mismo documento, mismo tenant) con una SEGUNDA fila de
    //    `user` porque en la #5 no había forma de reconocerla.
    await pool.query(
      `INSERT INTO perfil_propietario
         (tenant_id, user_id, tipo_documento, documento, email_contacto)
       VALUES ($1, $2, 'CC', $3, 'maria@example.com')`,
      [TENANT_A, IDS.propietaria, DOC_PROPIETARIA],
    );
    await pool.query(
      `INSERT INTO perfil_inquilino
         (tenant_id, user_id, tipo_documento, documento, celular,
          medio_preferido_contacto, email_contacto)
       VALUES ($1, $2, 'CC', '79000002', '3000000002', 'CORREO', 'carlos@example.com'),
              ($1, $3, 'CC', $4,         '3000000004', 'CORREO', 'maria.inq@example.com')`,
      [TENANT_A, IDS.inquilino, IDS.duplicada, DOC_PROPIETARIA],
    );
    await pool.query(
      `INSERT INTO perfil_propietario
         (tenant_id, user_id, tipo_documento, documento, email_contacto)
       VALUES ($1, $2, 'CC', $3, 'maria-b@example.com')`,
      [TENANT_B, IDS.mismaEnB, DOC_PROPIETARIA],
    );

    // 4) Y ahora sí, `0009` sobre datos que ya existen.
    await runMigrations(connectionString, CARPETA_COMPLETA);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await contenedor?.stop();
  });

  async function documentoDe(
    id: string,
  ): Promise<{ tipo_documento: string | null; documento: string | null }> {
    const { rows } = await pool.query<{
      tipo_documento: string | null;
      documento: string | null;
    }>('SELECT tipo_documento, documento FROM "user" WHERE id = $1', [id]);
    return rows[0]!;
  }

  describe('Las columnas y sus restricciones (R5)', () => {
    it('`user` gana `tipo_documento` y `documento`, ambas NULL-ables', async () => {
      const { rows } = await pool.query<{
        column_name: string;
        is_nullable: string;
        data_type: string;
      }>(
        `SELECT column_name, is_nullable, data_type
           FROM information_schema.columns
          WHERE table_name = 'user'
            AND column_name IN ('tipo_documento', 'documento')
          ORDER BY column_name`,
      );

      expect(rows.map((r) => r.column_name)).toEqual([
        'documento',
        'tipo_documento',
      ]);
      // NULL-ables a propósito: los empleados no tienen documento (R6).
      expect(rows.every((r) => r.is_nullable === 'YES')).toBe(true);
      expect(rows.every((r) => r.data_type === 'text')).toBe(true);
    });

    it('el CHECK de dominio rechaza un tipo de documento inventado', async () => {
      await expect(
        pool.query(
          `INSERT INTO "user" (tenant_id, nombre, tipo_documento, documento)
           VALUES ($1, 'Tipo Invalido', 'DNI', '99999999')`,
          [TENANT_A],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('el CHECK de coherencia rechaza el tipo sin número y el número sin tipo', async () => {
      await expect(
        pool.query(
          `INSERT INTO "user" (tenant_id, nombre, tipo_documento, documento)
           VALUES ($1, 'Solo Tipo', 'CC', NULL)`,
          [TENANT_A],
        ),
      ).rejects.toMatchObject({ code: '23514' });

      await expect(
        pool.query(
          `INSERT INTO "user" (tenant_id, nombre, tipo_documento, documento)
           VALUES ($1, 'Solo Numero', NULL, '99999998')`,
          [TENANT_A],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  describe('El backfill sobre datos sembrados (R5)', () => {
    it('copia el documento desde el perfil de propietario', async () => {
      expect(await documentoDe(IDS.propietaria)).toEqual({
        tipo_documento: 'CC',
        documento: DOC_PROPIETARIA,
      });
    });

    it('copia el documento desde el perfil de inquilino', async () => {
      expect(await documentoDe(IDS.inquilino)).toEqual({
        tipo_documento: 'CC',
        documento: '79000002',
      });
    });

    it('deja en NULL a quien no tiene perfil (empleados y admins, R6)', async () => {
      expect(await documentoDe(IDS.empleado)).toEqual({
        tipo_documento: null,
        documento: null,
      });
    });

    it('la misma persona en OTRA inmobiliaria conserva su documento (D-8)', async () => {
      // No es una colisión: la unicidad es por tenant. Que estas dos filas
      // convivan es exactamente lo que D-8 exige.
      expect(await documentoDe(IDS.mismaEnB)).toEqual({
        tipo_documento: 'CC',
        documento: DOC_PROPIETARIA,
      });
    });
  });

  describe('Identidades ya duplicadas: se avisan, no se fusionan (PA-2)', () => {
    it('la migración NO aborta: aplicó todas sus entradas', async () => {
      const journal = JSON.parse(
        readFileSync(join(CARPETA_COMPLETA, 'meta', '_journal.json'), 'utf8'),
      ) as { entries: unknown[] };

      const { rows } = await pool.query<{ total: string }>(
        'SELECT count(*)::text AS total FROM drizzle.__drizzle_migrations',
      );
      expect(Number(rows[0]?.total)).toBe(journal.entries.length);
    });

    it('la segunda identidad colisionante queda con documento NULL', async () => {
      // La más antigua conserva el documento; la más reciente lo pierde. Nada
      // se fusiona ni se borra: la fila, su perfil y su auditoría siguen ahí.
      expect(await documentoDe(IDS.duplicada)).toEqual({
        tipo_documento: null,
        documento: null,
      });

      const { rows } = await pool.query<{ total: string }>(
        'SELECT count(*)::text AS total FROM "user" WHERE id = $1',
        [IDS.duplicada],
      );
      expect(Number(rows[0]?.total)).toBe(1);
    });

    it('el perfil de la identidad duplicada sigue intacto', async () => {
      // "No fusionar" significa no tocar los datos, no solo no borrar la fila.
      const { rows } = await pool.query<{ documento: string }>(
        'SELECT documento FROM perfil_inquilino WHERE user_id = $1',
        [IDS.duplicada],
      );
      expect(rows[0]?.documento).toBe(DOC_PROPIETARIA);
    });
  });

  describe('El índice único parcial, que es quien sostiene R6', () => {
    it('existe, es único y es parcial', async () => {
      const { rows } = await pool.query<{
        indisunique: boolean;
        definicion: string;
      }>(
        `SELECT i.indisunique, pg_get_indexdef(i.indexrelid) AS definicion
           FROM pg_index i
           JOIN pg_class c ON c.oid = i.indexrelid
          WHERE c.relname = 'user_tenant_documento_key'`,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.indisunique).toBe(true);
      expect(rows[0]?.definicion).toMatch(/WHERE \(documento IS NOT NULL\)/i);
      expect(rows[0]?.definicion).toMatch(
        /\(tenant_id,\s*tipo_documento,\s*documento\)/i,
      );
    });

    it('dos identidades con el mismo documento en el mismo tenant colisionan (R6)', async () => {
      await expect(
        pool.query(
          `INSERT INTO "user" (tenant_id, nombre, tipo_documento, documento)
           VALUES ($1, 'María Pérez Bis', 'CC', $2)`,
          [TENANT_A, DOC_PROPIETARIA],
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('el mismo documento en OTRO tenant sí entra (D-8 intacta)', async () => {
      // Este es el requisito que la deduplicación no puede romper: el
      // invariante es por inmobiliaria, nunca global.
      await expect(
        pool.query(
          `INSERT INTO "user" (tenant_id, nombre, tipo_documento, documento)
           VALUES ($1, 'María Pérez en otra', 'CC', $2)`,
          [TENANT_B, '52000999'],
        ),
      ).resolves.toBeTruthy();
    });

    it('varias identidades sin documento conviven sin estorbarse (R6)', async () => {
      // Empleados y administradores: el índice es parcial justo por esto.
      await expect(
        pool.query(
          `INSERT INTO "user" (tenant_id, nombre) VALUES
             ($1, 'Empleado sin documento 1'),
             ($1, 'Empleado sin documento 2')`,
          [TENANT_A],
        ),
      ).resolves.toBeTruthy();
    });
  });

  it('reaplicar la migración es idempotente y no pisa los documentos (R5)', async () => {
    const antes = await documentoDe(IDS.propietaria);
    await runMigrations(connectionString, CARPETA_COMPLETA);
    expect(await documentoDe(IDS.propietaria)).toEqual(antes);
    // Y la que quedó en NULL sigue en NULL: no se rehidrata desde el perfil.
    expect(await documentoDe(IDS.duplicada)).toEqual({
      tipo_documento: null,
      documento: null,
    });
  });
});
