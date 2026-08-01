import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
  TENANT_B,
} from '../../../../../test/support/entorno-clientes';

/**
 * Invariantes de seguridad de la feature #25 (T23, T24, T25 → R19, R20, R21,
 * R23, R24), CHECKPOINTS.md §C7.
 *
 * Todo se comprueba de forma determinista contra PostgreSQL real y la app
 * real: códigos de estado y `SELECT`. Ningún invariante se valida con el
 * juicio de un modelo.
 */
describe('Invariantes de seguridad de #25 (T23, T24, T25)', () => {
  let entorno: EntornoClientes;

  let inquilinoA = '';
  let inquilinoB = '';
  let codeudorB = '';
  let referenciaB = '';

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
    const servidor = entorno.app.getHttpServer();

    const crearInquilino = async (token: string, tenantId: string, sufijo: string) => {
      const respuesta = await request(servidor)
        .post('/inquilinos')
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', tenantId)
        .send({
          nombre: `Inq Seg ${sufijo}`,
          tipo_documento: 'CC',
          documento: `SG-I-${sufijo}`,
          email: `seg-${sufijo}@example.com`,
          celular: '3008887766',
          medio_preferido_contacto: 'SMS',
        })
        .expect(201);
      return respuesta.body.id as string;
    };

    inquilinoA = await crearInquilino(entorno.adminA.token, TENANT_A, 'A');
    inquilinoB = await crearInquilino(entorno.adminB.token, TENANT_B, 'B');

    // Recursos del tenant B, que el tenant A nunca debe poder tocar.
    const codeudor = await request(servidor)
      .post(`/inquilinos/${inquilinoB}/codeudores`)
      .set('Authorization', `Bearer ${entorno.adminB.token}`)
      .set('x-tenant-id', TENANT_B)
      .send({
        tipo: 'CODEUDOR',
        nombre: 'Codeudor Seguro B',
        tipo_documento: 'CC',
        documento: 'SG-C-B',
      })
      .expect(201);
    codeudorB = codeudor.body.id;

    const referencia = await request(servidor)
      .post(`/inquilinos/${inquilinoB}/referencias`)
      .set('Authorization', `Bearer ${entorno.adminB.token}`)
      .set('x-tenant-id', TENANT_B)
      .send({ nombre: 'Referencia Segura B', telefono: '3157778899' })
      .expect(201);
    referenciaB = referencia.body.id;

    await request(servidor)
      .put('/configuracion/retencion/2026')
      .set('Authorization', `Bearer ${entorno.adminB.token}`)
      .set('x-tenant-id', TENANT_B)
      .send({ porcentaje: '7.25' })
      .expect(200);
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();

  // ─── T23 — aislamiento por tenant sobre HTTP (R19) ──────────────────────

  describe('aislamiento por tenant: 404 o lista propia, nunca la ajena (R19)', () => {
    it('GET, PATCH y DELETE de un codeudor del tenant B por el tenant A → 404', async () => {
      const casos = [
        ['get', `/inquilinos/${inquilinoB}/codeudores/${codeudorB}`, undefined],
        ['patch', `/inquilinos/${inquilinoB}/codeudores/${codeudorB}`, { nombre: 'Robado' }],
        ['delete', `/inquilinos/${inquilinoB}/codeudores/${codeudorB}`, undefined],
      ] as const;

      for (const [metodo, ruta, cuerpo] of casos) {
        const peticion = request(servidor())
          [metodo](ruta)
          .set('Authorization', `Bearer ${entorno.adminA.token}`)
          .set('x-tenant-id', TENANT_A);
        const respuesta = cuerpo
          ? await peticion.send(cuerpo)
          : await peticion;

        expect(respuesta.status, `${metodo.toUpperCase()} ${ruta}`).toBe(404);
        expect(JSON.stringify(respuesta.body), `${metodo} ${ruta}`).not.toContain('SG-C-B');
      }

      // Y nada se escribió: la fila del tenant B sigue intacta.
      const { rows } = await entorno.poolAdmin.query<{ nombre: string }>(
        'SELECT nombre FROM codeudor_inquilino WHERE id = $1',
        [codeudorB],
      );
      expect(rows[0]?.nombre).toBe('Codeudor Seguro B');
    });

    it('GET, PATCH y DELETE de una referencia del tenant B por el tenant A → 404', async () => {
      const casos = [
        ['get', `/inquilinos/${inquilinoB}/referencias/${referenciaB}`, undefined],
        ['patch', `/inquilinos/${inquilinoB}/referencias/${referenciaB}`, { telefono: '999' }],
        ['delete', `/inquilinos/${inquilinoB}/referencias/${referenciaB}`, undefined],
      ] as const;

      for (const [metodo, ruta, cuerpo] of casos) {
        const peticion = request(servidor())
          [metodo](ruta)
          .set('Authorization', `Bearer ${entorno.adminA.token}`)
          .set('x-tenant-id', TENANT_A);
        const respuesta = cuerpo
          ? await peticion.send(cuerpo)
          : await peticion;

        expect(respuesta.status, `${metodo.toUpperCase()} ${ruta}`).toBe(404);
      }
    });

    it('un codeudor inexistente y uno ajeno son indistinguibles (R19)', async () => {
      const inexistente = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      const ajeno = await request(servidor())
        .get(`/inquilinos/${inquilinoB}/codeudores/${codeudorB}`)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);
      const fantasma = await request(servidor())
        .get(`/inquilinos/${inquilinoA}/codeudores/${inexistente}`)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);

      expect(ajeno.status).toBe(404);
      expect(fantasma.status).toBe(404);
      // El cuerpo difiere solo en timestamp y path, que son cosméticos: el
      // error, el código y el mensaje son idénticos — un ajeno no se distingue
      // de un inexistente (R19).
      const nucleo = (cuerpo: request.Response) => ({
        statusCode: cuerpo.body.statusCode,
        error: cuerpo.body.error,
        message: cuerpo.body.message,
      });
      expect(nucleo(ajeno)).toEqual(nucleo(fantasma));
    });

    it('GET de la tarifa devuelve solo la del propio tenant (R19, R7)', async () => {
      const deA = await request(servidor())
        .get('/configuracion/retencion')
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);
      expect(deA.status).toBe(200);
      expect(deA.body).toEqual([]);

      const deB = await request(servidor())
        .get('/configuracion/retencion')
        .set('Authorization', `Bearer ${entorno.adminB.token}`)
        .set('x-tenant-id', TENANT_B);
      expect(deB.status).toBe(200);
      expect(deB.body).toHaveLength(1);
      expect(deB.body[0].tenant_id).toBe(TENANT_B);
    });

    it('PUT de la tarifa del tenant A no toca la fila del tenant B (R19)', async () => {
      const respuesta = await request(servidor())
        .put('/configuracion/retencion/2026')
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A)
        .send({ porcentaje: '3.50' });
      expect(respuesta.status).toBe(200);

      const { rows } = await entorno.poolAdmin.query<{
        tenant_id: string;
        porcentaje: string;
      }>(
        'SELECT tenant_id::text AS tenant_id, porcentaje::text AS porcentaje FROM tarifa_retencion WHERE anio = 2026 ORDER BY tenant_id',
      );
      expect(rows).toEqual([
        { tenant_id: TENANT_A, porcentaje: '3.50' },
        { tenant_id: TENANT_B, porcentaje: '7.25' },
      ]);
    });
  });

  // ─── T24 — RBAC en el backend (R20, R21) ────────────────────────────────

  describe('RBAC: 403 en el backend, 401 sin token (R20, R21)', () => {
    const rutas = (): Array<
      ['post' | 'get' | 'patch' | 'delete' | 'put', string, Record<string, unknown> | undefined]
    > => [
      ['post', `/inquilinos/${inquilinoA}/codeudores`, { tipo: 'CODEUDOR', nombre: 'X', tipo_documento: 'CC', documento: 'RBAC-1' }],
      ['get', `/inquilinos/${inquilinoA}/codeudores`, undefined],
      ['patch', `/inquilinos/${inquilinoA}/codeudores/ffffffff-ffff-ffff-ffff-ffffffffffff`, { nombre: 'Y' }],
      ['delete', `/inquilinos/${inquilinoA}/codeudores/ffffffff-ffff-ffff-ffff-ffffffffffff`, undefined],
      ['post', `/inquilinos/${inquilinoA}/referencias`, { nombre: 'X', telefono: '300' }],
      ['get', `/inquilinos/${inquilinoA}/referencias`, undefined],
      ['patch', `/inquilinos/${inquilinoA}/referencias/ffffffff-ffff-ffff-ffff-ffffffffffff`, { nombre: 'Y' }],
      ['delete', `/inquilinos/${inquilinoA}/referencias/ffffffff-ffff-ffff-ffff-ffffffffffff`, undefined],
      ['get', '/configuracion/retencion', undefined],
      ['put', '/configuracion/retencion/2030', { porcentaje: '3.00' }],
    ];

    for (const rol of ['propietario', 'inquilino'] as const) {
      it(`${rol}: 403 en las 10 rutas (R20)`, async () => {
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

    it('empleado: 403 en retención, 200/201 en codeudores y referencias (R21, R20)', async () => {
      const retencion = await request(servidor())
        .get('/configuracion/retencion')
        .set('Authorization', `Bearer ${entorno.empleadoA.token}`)
        .set('x-tenant-id', TENANT_A);
      expect(retencion.status).toBe(403);

      const retencionPut = await request(servidor())
        .put('/configuracion/retencion/2031')
        .set('Authorization', `Bearer ${entorno.empleadoA.token}`)
        .set('x-tenant-id', TENANT_A)
        .send({ porcentaje: '3.00' });
      expect(retencionPut.status).toBe(403);

      const codeudor = await request(servidor())
        .post(`/inquilinos/${inquilinoA}/codeudores`)
        .set('Authorization', `Bearer ${entorno.empleadoA.token}`)
        .set('x-tenant-id', TENANT_A)
        .send({
          tipo: 'CODEUDOR',
          nombre: 'Creado Por Empleado',
          tipo_documento: 'CC',
          documento: 'EMP-1',
        });
      expect(codeudor.status).toBe(201);

      const referencia = await request(servidor())
        .post(`/inquilinos/${inquilinoA}/referencias`)
        .set('Authorization', `Bearer ${entorno.empleadoA.token}`)
        .set('x-tenant-id', TENANT_A)
        .send({ nombre: 'Ref Empleado', telefono: '3110001111' });
      expect(referencia.status).toBe(201);
    });

    it('sin token → 401 en las 10 rutas', async () => {
      for (const [metodo, ruta, cuerpo] of rutas()) {
        const peticion = request(servidor())
          [metodo](ruta)
          .set('x-tenant-id', TENANT_A);
        const respuesta = cuerpo ? await peticion.send(cuerpo) : await peticion;
        expect(respuesta.status, `${metodo.toUpperCase()} ${ruta}`).toBe(401);
      }
    });
  });

  // ─── T25 — auditoría y datos personales (R23, R24) ──────────────────────

  describe('auditoría de las 7 mutaciones y datos personales (R23, R24)', () => {
    const PII = {
      documento: 'PII-CD-7711',
      celular: 'PII-CEL-3005554433',
      telefono: 'PII-TEL-3152221111',
      email: 'pii-codeudor@example.com',
    };

    it('cada una de las 7 mutaciones genera exactamente una fila de auditoría con sus campos (R23)', async () => {
      const desde = new Date();

      const auth = (peticion: request.Test) =>
        peticion
          .set('Authorization', `Bearer ${entorno.adminA.token}`)
          .set('x-tenant-id', TENANT_A);

      const tarifa = await auth(request(servidor()).put('/configuracion/retencion/2029')).send(
        { porcentaje: '2.00' },
      );
      expect(tarifa.status).toBe(200);

      const codeudor = await auth(
        request(servidor()).post(`/inquilinos/${inquilinoA}/codeudores`),
      ).send({
        tipo: 'CODEUDOR',
        nombre: 'Persona Auditable',
        tipo_documento: 'CC',
        documento: 'AUD-1',
      });
      expect(codeudor.status).toBe(201);
      await auth(
        request(servidor()).patch(`/inquilinos/${inquilinoA}/codeudores/${codeudor.body.id}`),
      ).send({ nombre: 'Persona Auditable 2' });
      await auth(
        request(servidor()).delete(`/inquilinos/${inquilinoA}/codeudores/${codeudor.body.id}`),
      );

      const referencia = await auth(
        request(servidor()).post(`/inquilinos/${inquilinoA}/referencias`),
      ).send({ nombre: 'Referencia Auditable', telefono: '3123334444' });
      expect(referencia.status).toBe(201);
      await auth(
        request(servidor()).patch(`/inquilinos/${inquilinoA}/referencias/${referencia.body.id}`),
      ).send({ relacion: 'Amistad' });
      await auth(
        request(servidor()).delete(`/inquilinos/${inquilinoA}/referencias/${referencia.body.id}`),
      );

      const esperadas: Array<[string, string, string]> = [
        ['actualizar', 'tarifa_retencion', tarifa.body.id],
        ['crear', 'codeudor_inquilino', codeudor.body.id],
        ['actualizar', 'codeudor_inquilino', codeudor.body.id],
        ['baja', 'codeudor_inquilino', codeudor.body.id],
        ['crear', 'referencia_inquilino', referencia.body.id],
        ['actualizar', 'referencia_inquilino', referencia.body.id],
        ['baja', 'referencia_inquilino', referencia.body.id],
      ];

      for (const [accion, entityType, entityId] of esperadas) {
        const { rows } = await entorno.poolAdmin.query<{
          total: string;
          tenant_id: string;
          actor_id: string;
        }>(
          `SELECT count(*)::text AS total,
                  min(tenant_id::text) AS tenant_id,
                  min(actor_id::text)  AS actor_id
             FROM audit_log
            WHERE accion = $1 AND entity_type = $2 AND entity_id = $3
              AND created_at >= $4`,
          [accion, entityType, entityId, desde],
        );

        expect(Number(rows[0]?.total), `${accion}/${entityType}/${entityId}`).toBe(1);
        expect(rows[0]?.tenant_id).toBe(TENANT_A);
        expect(rows[0]?.actor_id).toBe(entorno.adminA.id);
      }
    });

    it('documento, celular, telefono y email de codeudor y referencia no llegan a auditoría ni a logs (R24)', async () => {
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
        const auth = (peticion: request.Test) =>
          peticion
            .set('Authorization', `Bearer ${entorno.adminA.token}`)
            .set('x-tenant-id', TENANT_A);

        await auth(
          request(servidor()).post(`/inquilinos/${inquilinoA}/codeudores`),
        ).send({
          tipo: 'CODEUDOR',
          nombre: 'Persona Con PII',
          tipo_documento: 'CC',
          documento: PII.documento,
          email: PII.email,
          celular: PII.celular,
        });

        await auth(
          request(servidor()).post(`/inquilinos/${inquilinoA}/referencias`),
        ).send({
          nombre: 'Referencia Con PII',
          telefono: PII.telefono,
          email: PII.email,
        });
      } finally {
        espiaStdout.mockRestore();
        espiaStderr.mockRestore();
      }

      // 1) Auditoría: se serializa TODA la fila, no solo `metadata`.
      const { rows } = await entorno.poolAdmin.query(
        `SELECT to_jsonb(audit_log) AS fila FROM audit_log
          WHERE entity_type IN ('codeudor_inquilino', 'referencia_inquilino')`,
      );
      const auditoria = JSON.stringify(rows);

      for (const [campo, valor] of Object.entries(PII)) {
        expect(auditoria, `audit_log contiene ${campo}`).not.toContain(valor);
      }

      // 2) Logs de la aplicación.
      const salida = capturado.join('');
      for (const [campo, valor] of Object.entries(PII)) {
        expect(salida, `los logs contienen ${campo}`).not.toContain(valor);
      }
    });
  });
});
