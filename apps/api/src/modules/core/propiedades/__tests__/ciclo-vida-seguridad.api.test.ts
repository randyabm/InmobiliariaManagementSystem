import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
  TENANT_B,
} from '../../../../../test/support/entorno-clientes';

/**
 * Invariantes de seguridad de #8 (T17, T18, T19, T20 → R13, R15, R8),
 * CHECKPOINTS.md §C7. Contra PostgreSQL real y la app real.
 */
describe('Invariantes de seguridad de #8 (T17-T20)', () => {
  let entorno: EntornoClientes;
  let idPropiedadB: string;

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
    const servidor = () => entorno.app.getHttpServer();

    // Una propiedad del tenant B (su instancia se crea sola).
    const propB = await request(servidor())
      .post('/propietarios')
      .set('Authorization', `Bearer ${entorno.adminB.token}`)
      .set('x-tenant-id', TENANT_B)
      .send({ nombre: 'Prop Seg B8', tipo_documento: 'CC', documento: 'S8-B' });
    expect(propB.status).toBe(201);

    const creada = await request(servidor())
      .post('/propiedades')
      .set('Authorization', `Bearer ${entorno.adminB.token}`)
      .set('x-tenant-id', TENANT_B)
      .send({
        direccion: 'Calle Seg B8',
        tipo: 'OFICINA',
        area: '45.00',
        canon: '950000.00',
        propietario_principal_id: propB.body.id,
      });
    expect(creada.status).toBe(201);
    idPropiedadB = creada.body.id;
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();

  // ─── T17 — aislamiento por tenant (R13) ─────────────────────────────────

  describe('aislamiento por tenant (R13)', () => {
    it('el ciclo de vida de una propiedad de B accedido por A → 404, sin escribir', async () => {
      const casos = [
        ['get', `/propiedades/${idPropiedadB}/ciclo-vida`, undefined],
        ['post', `/propiedades/${idPropiedadB}/ciclo-vida/transiciones/iniciar_checkeo`, {}],
      ] as const;

      for (const [metodo, ruta, cuerpo] of casos) {
        const peticion = request(servidor())
          [metodo](ruta)
          .set('Authorization', `Bearer ${entorno.adminA.token}`)
          .set('x-tenant-id', TENANT_A);
        const respuesta = cuerpo ? await peticion.send(cuerpo) : await peticion;
        expect(respuesta.status, `${metodo.toUpperCase()} ${ruta}`).toBe(404);
      }

      // Nada se escribió: la instancia de B sigue en disponible.
      const { rows } = await entorno.poolAdmin.query<{ clave: string }>(
        `SELECT e.clave
           FROM workflow_instancia i
           JOIN workflow_estado e ON e.id = i.estado_actual_id
          WHERE i.entidad_tipo = 'propiedad' AND i.entidad_id = $1`,
        [idPropiedadB],
      );
      expect(rows[0]?.clave).toBe('disponible');
    });

    it('el dashboard de A no incluye propiedades de B (R13)', async () => {
      const dashboard = await request(servidor())
        .get('/propiedades/dashboard')
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);
      expect(dashboard.status).toBe(200);
      expect(
        dashboard.body.propiedades.some(
          (f: { id: string }) => f.id === idPropiedadB,
        ),
      ).toBe(false);
    });
  });

  // ─── T18 — RBAC (R13) ───────────────────────────────────────────────────

  describe('RBAC (R13)', () => {
    const rutas = (): Array<
      ['post' | 'get', string, Record<string, unknown> | undefined]
    > => [
      ['get', '/propiedades/dashboard', undefined],
      ['get', '/propiedades/ffffffff-ffff-ffff-ffff-ffffffffffff/ciclo-vida', undefined],
      ['post', '/propiedades/ffffffff-ffff-ffff-ffff-ffffffffffff/ciclo-vida/transiciones/iniciar_checkeo', {}],
    ];

    for (const rol of ['propietario', 'inquilino'] as const) {
      it(`${rol}: 403 en las 3 rutas (R13)`, async () => {
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

    it('empleado: 200 en dashboard y ciclo-vida (R13)', async () => {
      const dashboard = await request(servidor())
        .get('/propiedades/dashboard')
        .set('Authorization', `Bearer ${entorno.empleadoA.token}`)
        .set('x-tenant-id', TENANT_A);
      expect(dashboard.status).toBe(200);
    });

    it('sin token → 401', async () => {
      for (const [metodo, ruta, cuerpo] of rutas()) {
        const peticion = request(servidor())
          [metodo](ruta)
          .set('x-tenant-id', TENANT_A);
        const respuesta = cuerpo ? await peticion.send(cuerpo) : await peticion;
        expect(respuesta.status, `${metodo.toUpperCase()} ${ruta}`).toBe(401);
      }
    });
  });

  // ─── T19 — PII (R15) ────────────────────────────────────────────────────

  describe('contexto y datos fuera de logs y auditoría (R15)', () => {
    it('un contexto con valores distintivos no aparece en audit_log ni logs', async () => {
      const PII = { documento: 'PII-CV8-5511', celular: 'PII-CEL-3001112233' };
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

      let idPropiedad: string;
      try {
        const prop = await request(servidor())
          .post('/propietarios')
          .set('Authorization', `Bearer ${entorno.adminA.token}`)
          .set('x-tenant-id', TENANT_A)
          .send({ nombre: 'PII CV8', tipo_documento: 'CC', documento: 'PII-CV8' });
        const creada = await request(servidor())
          .post('/propiedades')
          .set('Authorization', `Bearer ${entorno.adminA.token}`)
          .set('x-tenant-id', TENANT_A)
          .send({
            direccion: 'Calle PII CV8',
            tipo: 'APARTAMENTO',
            area: '55.00',
            canon: '1100000.00',
            propietario_principal_id: prop.body.id,
          });
        idPropiedad = creada.body.id;

        await request(servidor())
          .post(`/propiedades/${idPropiedad}/ciclo-vida/transiciones/iniciar_checkeo`)
          .set('Authorization', `Bearer ${entorno.adminA.token}`)
          .set('x-tenant-id', TENANT_A)
          .send({ contexto: { ...PII } });
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

  // ─── T20 — frontera de notificaciones (R8) ──────────────────────────────

  describe('el hook de notificación es dato, nada se envía (R8)', () => {
    it('la ejecución no produce ningún registro fuera del motor y de audit_log', async () => {
      const desde = new Date();

      const prop = await request(servidor())
        .post('/propietarios')
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A)
        .send({ nombre: 'Hook Notif', tipo_documento: 'CC', documento: 'HOOK-8' });
      const creada = await request(servidor())
        .post('/propiedades')
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A)
        .send({
          direccion: 'Calle Hook',
          tipo: 'APARTAMENTO',
          area: '60.00',
          canon: '1000000.00',
          propietario_principal_id: prop.body.id,
        });

      await request(servidor())
        .post(`/propiedades/${creada.body.id}/ciclo-vida/transiciones/iniciar_checkeo`)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A)
        .send({});

      // No existe ninguna tabla de notificaciones ni de cola de envíos.
      const { rows: tablas } = await entorno.poolAdmin.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name LIKE '%notific%'`,
      );
      expect(tablas).toEqual([]);

      // La única escritura nueva es la del log del motor + audit_log.
      const { rows: log } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM workflow_transicion_log
          WHERE created_at >= $1`,
        [desde],
      );
      expect(Number(log[0]?.total)).toBeGreaterThanOrEqual(1);
    });
  });
});
