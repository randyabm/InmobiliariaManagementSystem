import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
  TENANT_B,
} from '../../../../../test/support/entorno-clientes';

/**
 * Invariantes de seguridad del ingreso (T14, T15, T16, T17, T18 → R8, R10,
 * R12, R14), CHECKPOINTS.md §C7.
 */
describe('Invariantes de seguridad del ingreso (T14-T18)', () => {
  let entorno: EntornoClientes;
  let idPropietarioB: string;

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
    const servidor = () => entorno.app.getHttpServer();

    const propB = await request(servidor())
      .post('/propietarios')
      .set('Authorization', `Bearer ${entorno.adminB.token}`)
      .set('x-tenant-id', TENANT_B)
      .send({ nombre: 'Prop B Ingreso', tipo_documento: 'CC', documento: 'S9-B' });
    expect(propB.status).toBe(201);
    idPropietarioB = propB.body.id;
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();

  const comoAdminA = () =>
    request(servidor())
      .post('/propiedades/ingreso')
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);

  // ─── T14 — aislamiento (R10) ────────────────────────────────────────────

  describe('aislamiento por tenant (R10)', () => {
    it('un perfil_propietario_id del tenant B → 404 sin escribir nada', async () => {
      const respuesta = await comoAdminA().send({
        escenario: 'VACANTE',
        propietario: { perfil_id: idPropietarioB },
        propiedad: { direccion: 'Calle Aislada', tipo: 'CASA', area: '50.00', canon: '1000000.00' },
      });
      expect(respuesta.status).toBe(404);

      const { rows } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM propiedad WHERE direccion = 'Calle Aislada'`,
      );
      expect(Number(rows[0]?.total)).toBe(0);
    });

    it('un documento que solo existe en B crea el perfil en A (no reutiliza el de B)', async () => {
      const respuesta = await comoAdminA().send({
        escenario: 'VACANTE',
        propietario: {
          datos: {
            nombre: 'Prop B Ingreso',
            tipo_documento: 'CC',
            documento: 'S9-B',
          },
        },
        propiedad: { direccion: 'Calle Duplicada', tipo: 'CASA', area: '50.00', canon: '1000000.00' },
      });
      expect(respuesta.status).toBe(201);

      // Dos perfiles con el mismo documento: uno en cada tenant.
      const { rows } = await entorno.poolAdmin.query<{ total: string; tenant: string }>(
        `SELECT count(*)::text AS total, min(tenant_id::text) AS tenant
           FROM perfil_propietario WHERE documento = 'S9-B'`,
      );
      expect(Number(rows[0]?.total)).toBe(2);
    });
  });

  // ─── T15 — RBAC (R10) ───────────────────────────────────────────────────

  describe('RBAC (R10)', () => {
    const cuerpo = {
      escenario: 'VACANTE',
      propietario: { datos: { nombre: 'RBAC Ingreso', tipo_documento: 'CC', documento: 'RBAC-9' } },
      propiedad: { direccion: 'Calle RBAC', tipo: 'CASA', area: '50.00', canon: '1000000.00' },
    };

    for (const rol of ['propietario', 'inquilino'] as const) {
      it(`${rol}: 403`, async () => {
        const token =
          rol === 'propietario' ? entorno.propietarioA.token : entorno.inquilinoA.token;
        const respuesta = await request(servidor())
          .post('/propiedades/ingreso')
          .set('Authorization', `Bearer ${token}`)
          .set('x-tenant-id', TENANT_A)
          .send(cuerpo);
        expect(respuesta.status).toBe(403);
      });
    }

    it('sin token → 401', async () => {
      const respuesta = await request(servidor())
        .post('/propiedades/ingreso')
        .set('x-tenant-id', TENANT_A)
        .send(cuerpo);
      expect(respuesta.status).toBe(401);
    });

    it('empleado → 201', async () => {
      const respuesta = await request(servidor())
        .post('/propiedades/ingreso')
        .set('Authorization', `Bearer ${entorno.empleadoA.token}`)
        .set('x-tenant-id', TENANT_A)
        .send(cuerpo);
      expect(respuesta.status).toBe(201);
    });
  });

  // ─── T16 — auditoría del servicio (R8) ──────────────────────────────────

  describe('auditoría del servicio (R8)', () => {
    it('un ingreso B genera las entradas de cada mutación con entity_id correcto', async () => {
      const desde = new Date();

      const respuesta = await comoAdminA().send({
        escenario: 'ARRENDADA',
        propietario: {
          datos: { nombre: 'Audit Ingreso', tipo_documento: 'CC', documento: 'AUD-9' },
        },
        propiedad: { direccion: 'Calle Audit 9', tipo: 'CASA', area: '50.00', canon: '1000000.00' },
        inquilino: {
          datos: {
            nombre: 'Inq Audit 9',
            tipo_documento: 'CC',
            documento: 'AUDI-9',
            email: 'aud-9@example.com',
            celular: '3001112222',
            medio_preferido_contacto: 'SMS',
          },
        },
      });
      expect(respuesta.status).toBe(201);
      const idPropiedad = respuesta.body.id;

      const { rows: filas } = await entorno.poolAdmin.query<{
        accion: string;
        entity_type: string;
        entity_id: string;
        actor_id: string;
      }>(
        `SELECT accion, entity_type, entity_id::text AS entity_id, actor_id::text AS actor_id
           FROM audit_log
          WHERE created_at >= $1 AND actor_id = $2
          ORDER BY created_at`,
        [desde, entorno.adminA.id],
      );

      // 1 propietario + 1 propiedad + 1 inquilino + 3 transiciones.
      const esperadas: Array<[string, string, string]> = [
        ['crear', 'perfil_propietario', ''],
        ['crear', 'propiedad', idPropiedad],
        ['crear', 'perfil_inquilino', ''],
        ['actualizar', 'propiedad', idPropiedad],
        ['actualizar', 'propiedad', idPropiedad],
        ['actualizar', 'propiedad', idPropiedad],
      ];
      expect(filas.length).toBe(esperadas.length);

      const normales = filas.map((f) => `${f.accion}/${f.entity_type}`);
      expect(normales).toEqual(
        expect.arrayContaining([
          'crear/perfil_propietario',
          'crear/propiedad',
          'crear/perfil_inquilino',
          'actualizar/propiedad',
        ]),
      );
      // Las 3 transiciones apuntan a la propiedad.
      expect(
        filas.filter((f) => f.accion === 'actualizar').every((f) => f.entity_id === idPropiedad),
      ).toBe(true);
    });
  });

  // ─── T17 — PII (R12) ────────────────────────────────────────────────────

  describe('PII fuera de logs y auditoría (R12)', () => {
    it('documentos y correos del ingreso no aparecen en audit_log ni logs', async () => {
      const PII = { documento: 'PII-I9-8811', correo: 'pii-ingreso@example.com' };
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
        await comoAdminA().send({
          escenario: 'ARRENDADA',
          propietario: {
            datos: { nombre: 'PII Ingreso', tipo_documento: 'CC', documento: PII.documento },
          },
          propiedad: { direccion: 'Calle PII 9', tipo: 'CASA', area: '50.00', canon: '1000000.00' },
          inquilino: {
            datos: {
              nombre: 'Inq PII 9',
              tipo_documento: 'CE',
              documento: `${PII.documento}-I`,
              email: PII.correo,
              celular: '3009998877',
              medio_preferido_contacto: 'SMS',
            },
          },
        });
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

  // ─── T18 — frontera R14 ─────────────────────────────────────────────────

  describe('frontera R14: sin templates ni contratos', () => {
    it('el ingreso responde 201 sin exigir ni crear nada de contratos', async () => {
      // Las tablas `contract*` ya existen (#16/#17), pero el invariante se
      // mantiene: ninguna FK DE las tablas del ingreso las exige (las FKs
      // en sentido contrario —contrato → propiedad— son legítimas). Si
      // algún día el ingreso dependiera de un contrato, este test se pone
      // rojo.
      const { rows: dependencias } = await entorno.poolAdmin.query<{ conname: string }>(
        `SELECT conname
           FROM pg_constraint c
          WHERE c.contype = 'f'
            AND EXISTS (SELECT 1 FROM pg_class r
                         WHERE r.oid = c.conrelid
                           AND r.relname IN ('propiedad', 'perfil_propietario',
                                             'perfil_inquilino', 'historial_ocupacion'))
            AND EXISTS (SELECT 1 FROM pg_class r
                         WHERE r.oid = c.confrelid
                           AND r.relname LIKE 'contract%')`,
      );
      expect(dependencias).toEqual([]);

      const respuesta = await comoAdminA().send({
        escenario: 'VACANTE',
        propietario: {
          datos: { nombre: 'Frontera 9', tipo_documento: 'CC', documento: 'FR-9' },
        },
        propiedad: { direccion: 'Calle Frontera 9', tipo: 'CASA', area: '50.00', canon: '1000000.00' },
      });
      expect(respuesta.status).toBe(201);
    });
  });
});
