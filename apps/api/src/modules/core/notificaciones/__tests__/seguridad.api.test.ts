import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
  TENANT_B,
} from '../../../../../test/support/entorno-clientes';

/**
 * Invariantes de seguridad de notificaciones (T18, T19, T20 → R14, R15).
 */
describe('Invariantes de seguridad de #10 (T18-T20)', () => {
  let entorno: EntornoClientes;
  let idProgramadaB: string;

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
    const servidor = () => entorno.app.getHttpServer();

    const creada = await request(servidor())
      .post('/notificaciones/programadas')
      .set('Authorization', `Bearer ${entorno.adminB.token}`)
      .set('x-tenant-id', TENANT_B)
      .send({
        programada_para: new Date(Date.now() + 86_400_000).toISOString(),
        destinatario: 'b@example.com',
        canal: 'CORREO',
      });
    expect(creada.status).toBe(201);
    idProgramadaB = creada.body.id;
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();

  // ─── T18 — aislamiento (R14) ────────────────────────────────────────────

  describe('aislamiento por tenant (R14)', () => {
    it('el listado de A no muestra filas de B (SELECT) y el DELETE de una programada de B es 404', async () => {
      const listado = await request(servidor())
        .get('/notificaciones')
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);
      expect(listado.status).toBe(200);
      const serializado = JSON.stringify(listado.body);
      expect(serializado).not.toContain('b@example.com');

      const baja = await request(servidor())
        .delete(`/notificaciones/programadas/${idProgramadaB}`)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);
      expect(baja.status).toBe(404);

      // Nada se escribió: la programada de B sigue PENDIENTE.
      const { rows } = await entorno.poolAdmin.query<{ estado: string }>(
        'SELECT estado FROM notificacion_programada WHERE id = $1',
        [idProgramadaB],
      );
      expect(rows[0]?.estado).toBe('PENDIENTE');
    });

    it('POST con tenant ajeno no puede escribir fuera de su tenant (RLS)', async () => {
      // El header x-tenant-id= B con el token de A es rechazado por el guard
      // (403) antes de escribir; el RLS es la barrera del motor.
      const respuesta = await request(servidor())
        .post('/notificaciones')
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_B)
        .send({ destinatario: 'x@example.com', contenido: {} });
      expect(respuesta.status).toBe(403);
    });
  });

  // ─── T19 — RBAC (R14) ───────────────────────────────────────────────────

  describe('RBAC (R14)', () => {
    const rutas = (): Array<
      ['post' | 'get' | 'delete', string, Record<string, unknown> | undefined]
    > => [
      ['post', '/notificaciones', { destinatario: 'r@example.com', contenido: {} }],
      ['get', '/notificaciones', undefined],
      ['post', '/notificaciones/programadas', { programada_para: new Date(Date.now() + 86400000).toISOString(), destinatario: 'r@example.com', canal: 'CORREO' }],
      ['get', '/notificaciones/programadas', undefined],
      ['delete', '/notificaciones/programadas/ffffffff-ffff-ffff-ffff-ffffffffffff', undefined],
    ];

    for (const rol of ['propietario', 'inquilino'] as const) {
      it(`${rol}: 403 en las 5 rutas`, async () => {
        const token =
          rol === 'propietario' ? entorno.propietarioA.token : entorno.inquilinoA.token;
        for (const [metodo, ruta, cuerpo] of rutas()) {
          const peticion = request(servidor())
            [metodo](ruta)
            .set('Authorization', `Bearer ${token}`)
            .set('x-tenant-id', TENANT_A);
          const respuesta = cuerpo ? await peticion.send(cuerpo) : await peticion;
          expect(respuesta.status, `${metodo.toUpperCase()} ${ruta}`).toBe(403);
        }
      });
    }

    it('sin token → 401', async () => {
      for (const [metodo, ruta, cuerpo] of rutas()) {
        const peticion = request(servidor())
          [metodo](ruta)
          .set('x-tenant-id', TENANT_A);
        const respuesta = cuerpo ? await peticion.send(cuerpo) : await peticion;
        expect(respuesta.status, `${metodo.toUpperCase()} ${ruta}`).toBe(401);
      }
    });

    it('empleado → 200/201', async () => {
      const enviada = await request(servidor())
        .post('/notificaciones')
        .set('Authorization', `Bearer ${entorno.empleadoA.token}`)
        .set('x-tenant-id', TENANT_A)
        .send({ destinatario: 'emp@example.com', contenido: {} });
      expect(enviada.status).toBe(201);
    });
  });

  // ─── T20 — PII (R15) ────────────────────────────────────────────────────

  describe('PII fuera de logs y auditoría (R15)', () => {
    it('el contenido y el destinatario no aparecen en audit_log ni en logs', async () => {
      const PII = { correo: 'pii-notif@example.com', dato: 'PII-ASUNTO-9911' };
      const capturado: string[] = [];
      const espiaStdout = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk: unknown) => {
          capturado.push(String(chunk));
          return true;
        });
      const espiaStderr = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation((chunk: unknown) => {
          capturado.push(String(chunk));
          return true;
        });

      try {
        await request(servidor())
          .post('/notificaciones')
          .set('Authorization', `Bearer ${entorno.adminA.token}`)
          .set('x-tenant-id', TENANT_A)
          .send({ destinatario: PII.correo, contenido: { asunto: PII.dato } });
      } finally {
        espiaStdout.mockRestore();
        espiaStderr.mockRestore();
      }

      const { rows } = await entorno.poolAdmin.query(
        `SELECT to_jsonb(audit_log) AS fila FROM audit_log`,
      );
      const auditoria = JSON.stringify(rows);
      for (const valor of Object.values(PII)) {
        expect(auditoria).not.toContain(valor);
      }

      const salida = capturado.join('');
      for (const valor of Object.values(PII)) {
        expect(salida).not.toContain(valor);
      }
    });
  });
});
