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
 * Invariantes de aislamiento del motor contra **PostgreSQL real**
 * (Testcontainers) y con el rol de aplicación **sin BYPASSRLS** (T20 → R13,
 * R14, R15; CHECKPOINTS.md §C7). Incluye el test de la política del sistema
 * de PA-7-1 (T5).
 */
describe('Workflows — RLS real (T20: R13, R14, R15 + T5: PA-7-1)', () => {
  let contenedor: StartedPostgreSqlContainer;
  let poolAdmin: Pool;
  let poolApp: Pool;
  let urlApp: string;

  const carpetaMigraciones = resolveMigrationsFolder(__dirname);

  const TENANT_A = '11111111-1111-1111-1111-111111111111';
  const TENANT_B = '22222222-2222-2222-2222-222222222222';
  const TENANT_SISTEMA = '00000000-0000-0000-0000-000000000000';

  const TABLAS = [
    'workflow_definicion',
    'workflow_estado',
    'workflow_transicion',
    'workflow_instancia',
    'workflow_transicion_log',
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

    // Datos sembrados como admin (superusuario): bypassa RLS a propósito.
    await poolAdmin.query(
      `INSERT INTO tenant (id, nombre, nit, codigo)
       VALUES ($1, 'Inmobiliaria A', '907111', 'inmobiliaria-a'),
              ($2, 'Inmobiliaria B', '908222', 'inmobiliaria-b')`,
      [TENANT_A, TENANT_B],
    );
    // La definición del sistema ya existe (seed de 0013). Se clona una copia
    // para el tenant A y B como admin (con el RLS desactivado para el rol
    // admin de la siembra no aplica: poolAdmin es superusuario).
    for (const tenant of [TENANT_A, TENANT_B]) {
      const { rows } = await poolAdmin.query<{ id: string }>(
        `INSERT INTO workflow_definicion (tenant_id, nombre, tipo, origen)
         VALUES ($1, 'Copia RLS', 'ciclo_rls', 'TENANT') RETURNING id`,
        [tenant],
      );
      const defId = rows[0]?.id;

      const { rows: estado } = await poolAdmin.query<{ id: string }>(
        `INSERT INTO workflow_estado (definicion_id, clave, etiqueta, es_inicial)
         VALUES ($1, 'inicio', 'Inicio', true) RETURNING id`,
        [defId],
      );
      const estadoId = estado[0]?.id;

      const { rows: instancia } = await poolAdmin.query<{ id: string }>(
        `INSERT INTO workflow_instancia
           (tenant_id, definicion_id, entidad_tipo, entidad_id, estado_actual_id)
         VALUES ($1, $2, 'propiedad', gen_random_uuid(), $3) RETURNING id`,
        [tenant, defId, estadoId],
      );
      const instanciaId = instancia[0]?.id;

      await poolAdmin.query(
        `INSERT INTO workflow_transicion_log
           (tenant_id, instancia_id, desde_estado_id, hacia_estado_id)
         VALUES ($1, $2, $3, $3)`,
        [tenant, instanciaId, estadoId],
      );
    }
  }, 180_000);

  afterAll(async () => {
    await poolApp?.end();
    await poolAdmin?.end();
    await contenedor?.stop();
  });

  it.each(TABLAS)(
    'un SELECT * SIN WHERE sobre %s devuelve solo filas del tenant activo (R14)',
    async (tabla) => {
      const filasA = await comoTenant(TENANT_A, async (c) => {
        const { rows } = await c.query(`SELECT * FROM ${tabla}`);
        return rows;
      });
      expect(filasA.length, tabla).toBeGreaterThan(0);

      if (tabla === 'workflow_definicion') {
        // Incluye las del sistema (PA-7-1); nada más.
        const filas = filasA as Array<{ tenant_id: string }>;
        const ajenas = filas.filter(
          (f) => f.tenant_id !== TENANT_A && f.tenant_id !== TENANT_SISTEMA,
        );
        expect(ajenas).toEqual([]);
      } else if (tabla === 'workflow_estado' || tabla === 'workflow_transicion') {
        // No llevan tenant_id: la visibilidad es por definición visible
        // (propia o del sistema). Se verifica que toda fila visible cuelga
        // de una definición legible.
        const filas = filasA as Array<{ definicion_id: string }>;
        const ids = filas.map((f) => f.definicion_id);
        const { rows } = await poolAdmin.query<{ id: string }>(
          `SELECT id FROM workflow_definicion
            WHERE tenant_id = $1 OR tenant_id = $2`,
          [TENANT_A, TENANT_SISTEMA],
        );
        const legibles = new Set(rows.map((r) => r.id));
        expect(ids.every((id) => legibles.has(id))).toBe(true);
      } else {
        const filas = filasA as Array<{ tenant_id: string }>;
        expect(filas.every((f) => f.tenant_id === TENANT_A)).toBe(true);
      }
    },
  );

  it('T5 — un tenant lee la definición del sistema y NO puede escribirla (PA-7-1, R13)', async () => {
    // Lectura: la plantilla del sistema es visible bajo el contexto de A.
    const lectura = await comoTenant(TENANT_A, async (c) => {
      const { rows } = await c.query<{ tipo: string }>(
        `SELECT tipo FROM workflow_definicion WHERE tenant_id = $1`,
        [TENANT_SISTEMA],
      );
      return rows;
    });
    expect(lectura.map((f) => f.tipo)).toContain('ciclo_vida_propiedad');

    // Escritura: INSERTAR una fila del sistema desde el contexto de A es
    // rechazado por el WITH CHECK.
    await expect(
      comoTenant(TENANT_A, (c) =>
        c.query(
          `INSERT INTO workflow_definicion (tenant_id, nombre, tipo, origen)
           VALUES ($1, 'Intruso', 'intruso', 'SISTEMA')`,
          [TENANT_SISTEMA],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('un INSERT de estado o transición contra una definición del SISTEMA es rechazado (WITH CHECK de R13)', async () => {
    const { rows: sistema } = await poolAdmin.query<{ id: string }>(
      `SELECT id FROM workflow_definicion WHERE tipo = 'ciclo_vida_propiedad'`,
    );
    const sistemaId = sistema[0]?.id;
    expect(sistemaId).toBeDefined();

    await expect(
      comoTenant(TENANT_A, (c) =>
        c.query(
          `INSERT INTO workflow_estado (definicion_id, clave, etiqueta)
           VALUES ($1, 'hack', 'Hack')`,
          [sistemaId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('en una conexión virgen (GUC nunca fijado), SELECT sobre las tablas devuelve 0 filas (R15)', async () => {
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
});
