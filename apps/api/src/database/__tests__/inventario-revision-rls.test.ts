import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveMigrationsFolder } from '../../../src/database/migrations-folder';
import { asegurarRolDeAplicacion } from '../../../src/database/rol-aplicacion';
import { runMigrations } from '../../../src/database/run-migrations';
import {
  CLAVE_APP_DE_PRUEBA,
  USUARIO_APP_DE_PRUEBA,
} from '../../../test/support/entorno-clientes';

/**
 * Invariantes de aislamiento de la revisión del inquilino contra
 * **PostgreSQL real** (T21 → R9, R10, R12, PA-13-4). Mismo patrón que
 * `inventarios-rls.test.ts`: el rol de aplicación corre `SELECT *` SIN
 * `WHERE tenant_id` y la que filtra es la base, no el repositorio.
 */
describe('Inventario-revisión — RLS real (T21: R9, R10, R12, PA-13-4)', () => {
  let contenedor: StartedPostgreSqlContainer;
  let poolAdmin: Pool;
  let poolApp: Pool;
  let urlApp: string;

  const carpetaMigraciones = resolveMigrationsFolder(__dirname);

  const TENANT_A = '11111111-1111-1111-1111-111111111111';
  const TENANT_B = '22222222-2222-2222-2222-222222222222';

  const TABLAS = [
    'invitacion_inventario',
    'codigo_otp',
    'inventario_item_revision',
  ] as const;

  async function comoTenant<T>(
    tenantId: string | null,
    fn: (cliente: import('pg').PoolClient) => Promise<T>,
  ): Promise<T> {
    const cliente = await poolApp.connect();
    try {
      await cliente.query('BEGIN');
      if (tenantId !== null) {
        await cliente.query(`SET LOCAL app.current_tenant = '${tenantId}'`);
      }
      return await fn(cliente);
    } finally {
      await cliente.query('ROLLBACK').catch(() => undefined);
      cliente.release();
    }
  }

  /** Crea un inventario ENVIADO con invitación vigente para un tenant. */
  async function sembrarReunion(tenantId: string): Promise<{
    tokenHash: string;
    invitacionId: string;
  }> {
    const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const { rows: usuario } = await poolAdmin.query<{ id: string }>(
      `INSERT INTO "user" (tenant_id, email, nombre)
       VALUES ($1, $2, 'U Rev') RETURNING id`,
      [tenantId, `u-rev-${tenantId}-${sufijo}@example.com`],
    );
    const { rows: prop } = await poolAdmin.query<{ id: string }>(
      `INSERT INTO perfil_propietario (tenant_id, user_id, tipo_documento, documento)
       VALUES ($1, $2, 'CC', $3) RETURNING id`,
      [tenantId, usuario[0]?.id, `PP-${tenantId}-${sufijo}`],
    );
    const { rows: propiedad } = await poolAdmin.query<{ id: string }>(
      `INSERT INTO propiedad (tenant_id, direccion, tipo, area, canon, propietario_principal_id)
       VALUES ($1, 'Calle Rev', 'APARTAMENTO', '60.00', '1000000.00', $2) RETURNING id`,
      [tenantId, prop[0]?.id],
    );
    const { rows: perfil } = await poolAdmin.query<{ id: string }>(
      `INSERT INTO perfil_inquilino
         (tenant_id, user_id, tipo_documento, documento, email_contacto, celular, medio_preferido_contacto)
       VALUES ($1, $2, 'CC', $3, 'rev@example.com', '3001112233', 'CORREO') RETURNING id`,
      [tenantId, usuario[0]?.id, `PI-${tenantId}-${sufijo}`],
    );
    const { rows: inv } = await poolAdmin.query<{ id: string }>(
      `INSERT INTO inventario (tenant_id, propiedad_id, tipo_evento, estado, perfil_inquilino_id)
       VALUES ($1, $2, 'ENTREGA', 'ENVIADO', $3) RETURNING id`,
      [tenantId, propiedad[0]?.id, perfil[0]?.id],
    );
    const { rows: zona } = await poolAdmin.query<{ id: string }>(
      `INSERT INTO inventario_zona (tenant_id, inventario_id, nombre)
       VALUES ($1, $2, 'Zona') RETURNING id`,
      [tenantId, inv[0]?.id],
    );
    const { rows: item } = await poolAdmin.query<{ id: string }>(
      `INSERT INTO inventario_item (tenant_id, zona_id, nombre, field_type)
       VALUES ($1, $2, 'Item', 'estado') RETURNING id`,
      [tenantId, zona[0]?.id],
    );
    const tokenHash = `${tenantId.replaceAll('-', '')}${sufijo.replaceAll('-', '').padStart(32, '0')}${'0'.repeat(16)}`.slice(0, 64);
    const { rows: invitacion } = await poolAdmin.query<{ id: string }>(
      `INSERT INTO invitacion_inventario
         (tenant_id, inventario_id, perfil_inquilino_id, token_hash, expira_en)
       VALUES ($1, $2, $3, $4, now() + interval '72 hours') RETURNING id`,
      [tenantId, inv[0]?.id, perfil[0]?.id, tokenHash],
    );
    await poolAdmin.query(
      `INSERT INTO codigo_otp (tenant_id, user_id, proposito, codigo_hash, expira_en)
       VALUES ($1, $2, 'FIRMA', $3, now() + interval '10 minutes')`,
      [tenantId, usuario[0]?.id, tokenHash],
    );
    await poolAdmin.query(
      `INSERT INTO inventario_item_revision (tenant_id, item_id, perfil_inquilino_id, respuesta, comentario)
       VALUES ($1, $2, $3, 'ACEPTADO', NULL)`,
      [tenantId, item[0]?.id, perfil[0]?.id],
    );
    return { tokenHash, invitacionId: invitacion[0]!.id };
  }

  beforeAll(async () => {
    contenedor = await new PostgreSqlContainer('postgres:16.4-alpine').start();
    const connectionString = contenedor.getConnectionUri();
    poolAdmin = new Pool({ connectionString });

    await runMigrations(connectionString, carpetaMigraciones);
    await asegurarRolDeAplicacion(connectionString, {
      usuario: USUARIO_APP_DE_PRUEBA,
      clave: CLAVE_APP_DE_PRUEBA,
    });

    const url = new URL(connectionString);
    url.username = USUARIO_APP_DE_PRUEBA;
    url.password = CLAVE_APP_DE_PRUEBA;
    urlApp = url.toString();
    poolApp = new Pool({ connectionString: urlApp });

    await poolAdmin.query(
      `INSERT INTO tenant (id, nombre, nit, codigo)
       VALUES ($1, 'A', '919111', 'rev-a'), ($2, 'B', '920222', 'rev-b')`,
      [TENANT_A, TENANT_B],
    );
    await sembrarReunion(TENANT_A);
    await sembrarReunion(TENANT_B);
  }, 180_000);

  afterAll(async () => {
    await poolApp?.end();
    await poolAdmin?.end();
    await contenedor?.stop();
  });

  it('SELECT * SIN WHERE sobre las 3 tablas devuelve solo lo propio (R9)', async () => {
    for (const tabla of TABLAS) {
      const filas = await comoTenant(TENANT_A, async (c) => {
        const { rows } = await c.query<{ tenant_id: string }>(`SELECT * FROM ${tabla}`);
        return rows;
      });
      expect(filas.length, tabla).toBeGreaterThan(0);
      const ajenas = filas.filter((f) => f.tenant_id !== TENANT_A);
      expect(ajenas, tabla).toEqual([]);
    }
  });

  it('en una conexión virgen (GUC nunca fijado), SELECT devuelve 0 filas (R10)', async () => {
    const poolVirgen = new Pool({ connectionString: urlApp, max: 1 });
    try {
      const cliente = await poolVirgen.connect();
      try {
        await cliente.query('BEGIN');
        for (const tabla of TABLAS) {
          const { rows } = await cliente.query(`SELECT * FROM ${tabla}`);
          expect(rows, tabla).toHaveLength(0);
        }
        await cliente.query('ROLLBACK');
      } finally {
        cliente.release();
      }
    } finally {
      await poolVirgen.end();
    }
  });

  it('invitacion_por_token resuelve el bootstrap exacto y nada más (PA-13-4)', async () => {
    const { tokenHash } = await sembrarReunion(TENANT_A);
    const filas = await comoTenant(null, async (c) => {
      const { rows } = await c.query<{ tenant_id: string; inventario_id: string }>(
        'SELECT * FROM invitacion_por_token($1)',
        [tokenHash],
      );
      return rows;
    });
    expect(filas).toHaveLength(1);
    expect(filas[0]?.tenant_id).toBe(TENANT_A);

    // Un hash con UN carácter distinto no resuelve.
    const corrupto = `${tokenHash.slice(0, 63)}b`;
    const nada = await comoTenant(null, async (c) => {
      const { rows } = await c.query('SELECT * FROM invitacion_por_token($1)', [corrupto]);
      return rows;
    });
    expect(nada).toHaveLength(0);
  });

  it('INSERT ajeno → rechazado (WITH CHECK); baja de invitación ajena → 0 filas (R9)', async () => {
    const { rows: inventarioB } = await poolAdmin.query<{ id: string }>(
      `SELECT id FROM inventario WHERE tenant_id = $1 LIMIT 1`,
      [TENANT_B],
    );
    await expect(
      comoTenant(TENANT_A, (c) =>
        c.query(
          `INSERT INTO invitacion_inventario
             (tenant_id, inventario_id, perfil_inquilino_id, token_hash, expira_en)
           VALUES ($1, $2, (SELECT id FROM perfil_inquilino WHERE tenant_id = $1 LIMIT 1),
                   $3, now() + interval '72 hours')`,
          [TENANT_B, inventarioB[0]?.id, 'f'.repeat(64)],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);

    const { rows: invitacionB } = await poolAdmin.query<{ id: string }>(
      `SELECT id FROM invitacion_inventario WHERE tenant_id = $1 LIMIT 1`,
      [TENANT_B],
    );
    const afectadas = await comoTenant(TENANT_A, async (c) => {
      const { rowCount } = await c.query(
        `UPDATE invitacion_inventario SET usada_en = now() WHERE id = $1`,
        [invitacionB[0]?.id],
      );
      return rowCount ?? 0;
    });
    expect(afectadas).toBe(0);
  });
});
