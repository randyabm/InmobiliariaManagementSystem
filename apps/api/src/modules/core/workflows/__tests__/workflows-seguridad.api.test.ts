import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
  TENANT_B,
} from '../../../../../test/support/entorno-clientes';

/**
 * Invariantes de seguridad del motor (T21, T22, T23, T24 → R14, R15, R16),
 * CHECKPOINTS.md §C7. Contra PostgreSQL real y la app real.
 */
describe('Invariantes de seguridad del motor (T21-T24)', () => {
  let entorno: EntornoClientes;
  let idDefinicion: string;
  let idInstanciaB: string;
  let idTransicionDisponibleB: string;

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
    const servidor = () => entorno.app.getHttpServer();

    // La definición del sistema es legible por ambos tenants.
    const lista = await request(servidor())
      .get('/workflows')
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);
    idDefinicion = (
      lista.body.find((d: { tipo: string }) => d.tipo === 'ciclo_vida_propiedad') as {
        id: string;
      }
    ).id;

    const detalle = await request(servidor())
      .get(`/workflows/${idDefinicion}`)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);
    const transiciones = detalle.body.transiciones as Array<{ clave: string; id: string }>;
    idTransicionDisponibleB = transiciones.find(
      (t) => t.clave === 'iniciar_checkeo',
    )?.id ?? '';

    // Una instancia del tenant B.
    const creada = await request(servidor())
      .post(`/workflows/${idDefinicion}/instancias`)
      .set('Authorization', `Bearer ${entorno.adminB.token}`)
      .set('x-tenant-id', TENANT_B)
      .send({ entidad_tipo: 'propiedad', entidad_id: 'bbbbbbbb-0000-0000-0000-0000000000bb' });
    expect(creada.status).toBe(201);
    idInstanciaB = creada.body.id;
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();

  // ─── T21 — aislamiento por tenant (R14) ─────────────────────────────────

  describe('aislamiento por tenant: 404 indistinguible (R14)', () => {
    it('instancia del tenant B accedida por A → 404 (GET, transición, historial)', async () => {
      const casos = [
        ['get', `/workflows/instancias/${idInstanciaB}`, undefined],
        ['post', `/workflows/instancias/${idInstanciaB}/transiciones/${idTransicionDisponibleB}`, {}],
        ['get', `/workflows/instancias/${idInstanciaB}/historial`, undefined],
      ] as const;

      for (const [metodo, ruta, cuerpo] of casos) {
        const peticion = request(servidor())
          [metodo](ruta)
          .set('Authorization', `Bearer ${entorno.adminA.token}`)
          .set('x-tenant-id', TENANT_A);
        const respuesta = cuerpo ? await peticion.send(cuerpo) : await peticion;
        expect(respuesta.status, `${metodo.toUpperCase()} ${ruta}`).toBe(404);
      }

      // Nada se escribió: la instancia de B sigue en su estado.
      const { rows } = await entorno.poolAdmin.query<{ estado: string }>(
        'SELECT estado_actual_id::text AS estado FROM workflow_instancia WHERE id = $1',
        [idInstanciaB],
      );
      const { rows: estados } = await entorno.poolAdmin.query<{ id: string; clave: string }>(
        `SELECT e.id::text AS id, e.clave FROM workflow_estado e
          WHERE e.definicion_id = $1`,
        [idDefinicion],
      );
      const disponible = estados.find((e) => e.clave === 'disponible')?.id;
      expect(rows[0]?.estado).toBe(disponible);
    });

    it('una instancia inexistente y una ajena son indistinguibles (R14)', async () => {
      const inexistente = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      const ajeno = await request(servidor())
        .get(`/workflows/instancias/${idInstanciaB}`)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);
      const fantasma = await request(servidor())
        .get(`/workflows/instancias/${inexistente}`)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);

      expect(ajeno.status).toBe(404);
      expect(fantasma.status).toBe(404);
      const nucleo = (r: request.Response) => ({
        statusCode: r.body.statusCode,
        error: r.body.error,
        message: r.body.message,
      });
      expect(nucleo(ajeno)).toEqual(nucleo(fantasma));
    });
  });

  // ─── T22 — RBAC (R14) ───────────────────────────────────────────────────

  describe('RBAC: 403 en el backend, 401 sin token (R14)', () => {
    const rutas = (): Array<
      ['post' | 'get' | 'delete', string, Record<string, unknown> | undefined]
    > => [
      ['get', '/workflows', undefined],
      ['get', `/workflows/${idDefinicion}`, undefined],
      ['post', `/workflows/${idDefinicion}/clonar`, undefined],
      ['post', `/workflows/${idDefinicion}/transiciones`, { clave: 'x', origen_estado_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', destino_estado_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', tipo_ejecucion: 'HUMANA' }],
      ['delete', `/workflows/${idDefinicion}/transiciones/ffffffff-ffff-ffff-ffff-ffffffffffff`, undefined],
      ['post', `/workflows/${idDefinicion}/instancias`, { entidad_tipo: 'propiedad', entidad_id: 'aaaaaaaa-0000-0000-0000-0000000000aa' }],
      ['get', '/workflows/instancias/ffffffff-ffff-ffff-ffff-ffffffffffff', undefined],
      ['post', '/workflows/instancias/ffffffff-ffff-ffff-ffff-ffffffffffff/transiciones/ffffffff-ffff-ffff-ffff-ffffffffffff', {}],
      ['get', '/workflows/instancias/ffffffff-ffff-ffff-ffff-ffffffffffff/historial', undefined],
    ];

    for (const rol of ['propietario', 'inquilino'] as const) {
      it(`${rol}: 403 en las 9 rutas (R14)`, async () => {
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

    it('empleado: 403 en la gestión de definiciones y 200/201 en instancias (RF-W2)', async () => {
      const clonar = await request(servidor())
        .post(`/workflows/${idDefinicion}/clonar`)
        .set('Authorization', `Bearer ${entorno.empleadoA.token}`)
        .set('x-tenant-id', TENANT_A);
      expect(clonar.status).toBe(403);

      const instancia = await request(servidor())
        .post(`/workflows/${idDefinicion}/instancias`)
        .set('Authorization', `Bearer ${entorno.empleadoA.token}`)
        .set('x-tenant-id', TENANT_A)
        .send({ entidad_tipo: 'propiedad', entidad_id: 'aaaaaaaa-0000-0000-0000-0000000000cc' });
      expect(instancia.status).toBe(201);

      const lista = await request(servidor())
        .get('/workflows')
        .set('Authorization', `Bearer ${entorno.empleadoA.token}`)
        .set('x-tenant-id', TENANT_A);
      expect(lista.status).toBe(200);
    });

    it('sin token → 401 en las 9 rutas', async () => {
      for (const [metodo, ruta, cuerpo] of rutas()) {
        const peticion = request(servidor())
          [metodo](ruta)
          .set('x-tenant-id', TENANT_A);
        const respuesta = cuerpo ? await peticion.send(cuerpo) : await peticion;
        expect(respuesta.status, `${metodo.toUpperCase()} ${ruta}`).toBe(401);
      }
    });
  });

  // ─── T23 — auditoría (R15) ──────────────────────────────────────────────

  describe('auditoría de las mutaciones (R15)', () => {
    it('crear instancia y ejecutar transición generan una fila de auditoría cada una', async () => {
      const desde = new Date();
      const auth = (peticion: request.Test) =>
        peticion
          .set('Authorization', `Bearer ${entorno.adminA.token}`)
          .set('x-tenant-id', TENANT_A);

      const creada = await auth(
        request(servidor()).post(`/workflows/${idDefinicion}/instancias`),
      ).send({
        entidad_tipo: 'propiedad',
        entidad_id: 'aaaaaaaa-0000-0000-0000-0000000000dd',
        contexto: { secreto: 'PII-SECRETO' },
      });
      expect(creada.status).toBe(201);

      const detalle = await auth(request(servidor()).get(`/workflows/${idDefinicion}`));
      const transicion = (detalle.body.transiciones as Array<{ clave: string; id: string }>).find(
        (t) => t.clave === 'iniciar_checkeo',
      )?.id;

      const ejecutada = await auth(
        request(servidor()).post(
          `/workflows/instancias/${creada.body.id}/transiciones/${transicion}`,
        ),
      ).send({});
      expect(ejecutada.status).toBe(200);

      const esperadas: Array<[string, string]> = [
        ['crear', 'workflow_instancia'],
        ['actualizar', 'workflow_instancia'],
      ];

      for (const [accion, entityType] of esperadas) {
        const { rows } = await entorno.poolAdmin.query<{
          total: string;
          tenant_id: string;
          actor_id: string;
          entity_id: string;
        }>(
          `SELECT count(*)::text AS total,
                  min(tenant_id::text) AS tenant_id,
                  min(actor_id::text) AS actor_id,
                  min(entity_id::text) AS entity_id
             FROM audit_log
            WHERE accion = $1 AND entity_type = $2 AND created_at >= $3`,
          [accion, entityType, desde],
        );
        expect(Number(rows[0]?.total), accion).toBe(1);
        expect(rows[0]?.tenant_id).toBe(TENANT_A);
        expect(rows[0]?.actor_id).toBe(entorno.adminA.id);
        expect(rows[0]?.entity_id).toBe(creada.body.id);
      }
    });
  });

  // ─── T24 — PII (R16) ────────────────────────────────────────────────────

  describe('el contexto no llega a auditoría ni a logs (R16)', () => {
    it('un contexto con valores distintivos no aparece en audit_log ni en logs', async () => {
      const PII = { documento: 'PII-WF-7711', celular: 'PII-CEL-3009998877' };
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
          .post(`/workflows/${idDefinicion}/instancias`)
          .set('Authorization', `Bearer ${entorno.adminA.token}`)
          .set('x-tenant-id', TENANT_A)
          .send({
            entidad_tipo: 'propiedad',
            entidad_id: 'aaaaaaaa-0000-0000-0000-0000000000ee',
            contexto: { ...PII },
          });
      } finally {
        espiaStdout.mockRestore();
        espiaStderr.mockRestore();
      }

      // 1) audit_log serializado completo: sin PII.
      const { rows } = await entorno.poolAdmin.query(
        `SELECT to_jsonb(audit_log) AS fila FROM audit_log`,
      );
      const auditoria = JSON.stringify(rows);
      for (const valor of Object.values(PII)) {
        expect(auditoria).not.toContain(valor);
      }

      // 2) El log de DOMINIO sí conserva el contexto (dato de dominio, R16).
      const { rows: dominio } = await entorno.poolAdmin.query<{ contexto_tras: string }>(
        `SELECT contexto::text AS contexto_tras FROM workflow_instancia
          WHERE entidad_id = 'aaaaaaaa-0000-0000-0000-0000000000ee'`,
      );
      expect(dominio[0]?.contexto_tras).toContain('PII-WF-7711');

      // 3) Logs de la aplicación: sin PII.
      const salida = capturado.join('');
      for (const valor of Object.values(PII)) {
        expect(salida).not.toContain(valor);
      }
    });
  });
});
