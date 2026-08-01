import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NotificacionesProcesadorService } from '../notificaciones-procesador.service';
import { ResolverDestinatarioService } from '../resolver-destinatario.service';
import { ProveedorRegistro } from '../proveedor-registro';
import { resolveMigrationsFolder } from '../../../../database/migrations-folder';
import { closeDatabasePool } from '../../../../database/database.client';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '../../../../database/run-migrations';
import { asegurarRolDeAplicacion } from '../../../../database/rol-aplicacion';
import {
  CLAVE_APP_DE_PRUEBA,
  USUARIO_APP_DE_PRUEBA,
} from '../../../../../test/support/entorno-clientes';

/**
 * El procesador contra PostgreSQL real (T11, T12 → R3, R4, R7, R12, R14).
 *
 * Se ejercita SIN la app NestJS: el servicio se construye a mano con el
 * resolver y el proveedor reales, y el `DATABASE_URL` apunta al contenedor
 * con el rol de aplicación. El `setInterval` no arranca (NODE_ENV=test).
 */
describe('Procesador de notificaciones (T11, T12)', () => {
  let contenedor: StartedPostgreSqlContainer;
  let poolAdmin: Pool;
  let urlApp: string;
  const envOriginal = { ...process.env };

  const TENANT_A = '11111111-1111-1111-1111-111111111111';
  const TENANT_B = '22222222-2222-2222-2222-222222222222';

  function procesador(): NotificacionesProcesadorService {
    const resolver = new ResolverDestinatarioService({} as never, {} as never);
    const servicio = new NotificacionesProcesadorService(
      resolver,
      new ProveedorRegistro(),
    );
    return servicio;
  }

  beforeAll(async () => {
    contenedor = await new PostgreSqlContainer('postgres:16.4-alpine').start();
    const connectionString = contenedor.getConnectionUri();
    poolAdmin = new Pool({ connectionString });
    await runMigrations(connectionString, resolveMigrationsFolder(__dirname));
    await asegurarRolDeAplicacion(connectionString, {
      usuario: USUARIO_APP_DE_PRUEBA,
      clave: CLAVE_APP_DE_PRUEBA,
    });
    const url = new URL(connectionString);
    url.username = USUARIO_APP_DE_PRUEBA;
    url.password = CLAVE_APP_DE_PRUEBA;
    urlApp = url.toString();

    Object.assign(process.env, { DATABASE_URL: urlApp, NODE_ENV: 'test' });

    await poolAdmin.query(
      `INSERT INTO tenant (id, nombre, nit, codigo)
       VALUES ($1, 'A', '911111', 'notif-a'), ($2, 'B', '912222', 'notif-b')`,
      [TENANT_A, TENANT_B],
    );
  }, 180_000);

  afterAll(async () => {
    await closeDatabasePool();
    await poolAdmin?.end();
    await contenedor?.stop();
    for (const clave of Object.keys(process.env)) {
      if (!(clave in envOriginal)) delete process.env[clave];
    }
    Object.assign(process.env, envOriginal);
  });

  // ─── T11 — R3, R4, R14 ──────────────────────────────────────────────────

  describe('T11 — despacho del outbox (R3, R4, R14)', () => {
    it('procesa filas de dos tenants, cada una bajo SU tenant (R3, R14)', async () => {
      // Filas con destinatario DIRECTO (el resolver no necesita perfiles).
      await poolAdmin.query(
        `INSERT INTO notificacion_pendiente (tenant_id, canal, destinatario, contenido)
         VALUES ($1, 'CORREO', 'a@example.com', '{"x":1}'),
                ($2, 'SMS', '3001112222', '{"x":2}')`,
        [TENANT_A, TENANT_B],
      );

      const resultado = await procesador().procesarPendientes();

      expect(resultado.procesadas).toBe(2);
      expect(resultado.fallidas).toBe(0);

      // Las entregas quedaron en el tenant correcto.
      const { rows } = await poolAdmin.query<{ tenant_id: string; destinatario: string }>(
        `SELECT tenant_id::text AS tenant_id, destinatario FROM notificacion_enviada
          ORDER BY destinatario`,
      );
      expect(rows.map((r) => r.tenant_id).sort()).toEqual([TENANT_A, TENANT_B].sort());
      expect(rows.map((r) => r.destinatario).sort()).toEqual([
        '3001112222',
        'a@example.com',
      ]);

      // El outbox quedó PROCESADA.
      const { rows: outbox } = await poolAdmin.query<{ estado: string }>(
        `SELECT estado FROM notificacion_pendiente ORDER BY created_at`,
      );
      expect(outbox.map((r) => r.estado)).toEqual(['PROCESADA', 'PROCESADA']);
    });

    it('una fila sin destinatario falla con intentos acotados y sin PII (R4, R15)', async () => {
      await poolAdmin.query(
        `INSERT INTO notificacion_pendiente (tenant_id, canal, contenido)
         VALUES ($1, 'CORREO', '{"dato":"pii-secreto"}')`,
        [TENANT_A],
      );
      const { rows: fila } = await poolAdmin.query<{ id: string }>(
        `SELECT id FROM notificacion_pendiente WHERE canal = 'CORREO' AND destinatario IS NULL
          ORDER BY created_at DESC LIMIT 1`,
      );

      const servicio = procesador();
      for (let i = 1; i <= 3; i++) {
        await servicio.procesarPendientes();
      }

      const { rows: despues } = await poolAdmin.query<{
        estado: string;
        intentos: number;
        error: string | null;
      }>('SELECT estado, intentos, error FROM notificacion_pendiente WHERE id = $1', [
        fila[0]?.id,
      ]);
      expect(despues[0]?.estado).toBe('FALLIDA');
      expect(despues[0]?.intentos).toBe(3);
      // El error no contiene el contenido (R15).
      expect(despues[0]?.error).not.toContain('pii-secreto');
    });
  });

  // ─── T12 — recordatorios vencidos (R12) ─────────────────────────────────

  describe('T12 — programadas vencidas (R12)', () => {
    it('una vencida se despacha y queda EJECUTADA; una futura y una cancelada no', async () => {
      await poolAdmin.query(
        `INSERT INTO notificacion_programada
           (tenant_id, programada_para, estado, destinatario, canal)
         VALUES ($1, now() - interval '1 hour', 'PENDIENTE', 'vencida@example.com', 'CORREO'),
                ($1, now() + interval '1 day', 'PENDIENTE', 'futura@example.com', 'CORREO'),
                ($1, now() - interval '1 hour', 'CANCELADA', 'cancelada@example.com', 'CORREO')`,
        [TENANT_A],
      );

      await procesador().procesarPendientes();

      const { rows } = await poolAdmin.query<{ destinatario: string; estado: string }>(
        `SELECT destinatario, estado FROM notificacion_programada
          WHERE destinatario IN ('vencida@example.com', 'futura@example.com', 'cancelada@example.com')
          ORDER BY destinatario`,
      );
      expect(rows).toEqual([
        { destinatario: 'cancelada@example.com', estado: 'CANCELADA' },
        { destinatario: 'futura@example.com', estado: 'PENDIENTE' },
        { destinatario: 'vencida@example.com', estado: 'EJECUTADA' },
      ]);
    });
  });
});
