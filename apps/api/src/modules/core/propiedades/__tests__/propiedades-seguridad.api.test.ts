import { MinioContainer } from '@testcontainers/minio';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
  TENANT_B,
} from '../../../../../test/support/entorno-clientes';

/**
 * Invariantes de seguridad de #6 (T20, T21, T22, T23 → R14, R15, R18, R20),
 * CHECKPOINTS.md §C7.
 *
 * Todo se comprueba de forma determinista contra PostgreSQL y MinIO reales
 * y la app real: códigos de estado y `SELECT`. El contenedor de MinIO se
 * levanta ANTES de crear la app (`AlmacenamientoService` lee `MINIO_*`).
 */
describe('Invariantes de seguridad de #6 (T20-T23)', () => {
  let entorno: EntornoClientes;
  let minio: Awaited<ReturnType<MinioContainer['start']>>;
  let envOriginal: NodeJS.ProcessEnv;

  let propiedadA = '';
  let propiedadB = '';
  let documentoB = '';

  beforeAll(async () => {
    envOriginal = { ...process.env };
    minio = await new MinioContainer('minio/minio:RELEASE.2024-09-13T20-26-02Z').start();
    Object.assign(process.env, {
      MINIO_ENDPOINT: minio.getHost(),
      MINIO_PORT: String(minio.getMappedPort(9000)),
      MINIO_ACCESS_KEY: minio.getUsername(),
      MINIO_SECRET_KEY: minio.getPassword(),
      MINIO_USE_SSL: 'false',
      MINIO_BUCKET: 'propiedades-test',
    });

    entorno = await levantarEntornoClientes();
    const servidor = () => entorno.app.getHttpServer();

    const crearPropiedad = async (token: string, tenantId: string, sufijo: string) => {
      const prop = await request(servidor())
        .post('/propietarios')
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', tenantId)
        .send({ nombre: `Prop Seg ${sufijo}`, tipo_documento: 'CC', documento: `SG-P-${sufijo}` })
        .expect(201);

      const creada = await request(servidor())
        .post('/propiedades')
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', tenantId)
        .send({
          direccion: `Calle Seg ${sufijo}`,
          tipo: 'OFICINA',
          area: '45.00',
          canon: '950000.00',
          propietario_principal_id: prop.body.id,
        })
        .expect(201);
      return creada.body.id as string;
    };

    propiedadA = await crearPropiedad(entorno.adminA.token, TENANT_A, 'A');
    propiedadB = await crearPropiedad(entorno.adminB.token, TENANT_B, 'B');

    const doc = await request(servidor())
      .post(`/propiedades/${propiedadB}/documentos`)
      .set('Authorization', `Bearer ${entorno.adminB.token}`)
      .set('x-tenant-id', TENANT_B)
      .field('nombre', 'doc-seg-b.pdf')
      .attach('archivo', Buffer.from('binario-seguridad-B'), {
        filename: 'doc.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    documentoB = doc.body.id;
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
    await minio?.stop();
    for (const clave of Object.keys(process.env)) {
      if (!(clave in envOriginal)) delete process.env[clave];
    }
    Object.assign(process.env, envOriginal);
  });

  const servidor = () => entorno.app.getHttpServer();

  // ─── T20 — aislamiento por tenant (R14) ─────────────────────────────────

  describe('aislamiento por tenant: 404, nunca 403 ni 200 (R14)', () => {
    it('GET, PATCH y DELETE de una propiedad del tenant B por el tenant A → 404', async () => {
      const casos = [
        ['get', `/propiedades/${propiedadB}`, undefined],
        ['patch', `/propiedades/${propiedadB}`, { canon: '1.00' }],
        ['delete', `/propiedades/${propiedadB}`, undefined],
      ] as const;

      for (const [metodo, ruta, cuerpo] of casos) {
        const peticion = request(servidor())
          [metodo](ruta)
          .set('Authorization', `Bearer ${entorno.adminA.token}`)
          .set('x-tenant-id', TENANT_A);
        const respuesta = cuerpo ? await peticion.send(cuerpo) : await peticion;

        expect(respuesta.status, `${metodo.toUpperCase()} ${ruta}`).toBe(404);
        expect(JSON.stringify(respuesta.body), `${metodo} ${ruta}`).not.toContain('Calle Seg B');
      }

      // Nada se escribió: la fila de B sigue con su canon original.
      const { rows } = await entorno.poolAdmin.query<{ canon: string }>(
        'SELECT canon::text AS canon FROM propiedad WHERE id = $1',
        [propiedadB],
      );
      expect(rows[0]?.canon).toBe('950000.00');
    });

    it('propietario adicional, inquilino actual y documento del tenant B → 404 (R14)', async () => {
      const inqB = await request(servidor())
        .post('/inquilinos')
        .set('Authorization', `Bearer ${entorno.adminB.token}`)
        .set('x-tenant-id', TENANT_B)
        .send({
          nombre: 'Inq Seg B',
          tipo_documento: 'CC',
          documento: 'SG-I-B',
          email: 'seg-b@example.com',
          celular: '3005556666',
          medio_preferido_contacto: 'SMS',
        })
        .expect(201);

      const casos = [
        ['post', `/propiedades/${propiedadB}/propietarios`, { perfil_propietario_id: entorno.adminB.id }],
        ['patch', `/propiedades/${propiedadB}/inquilino-actual`, { perfil_inquilino_id: inqB.body.id }],
        ['get', `/propiedades/${propiedadB}/documentos/${documentoB}`, undefined],
        ['delete', `/propiedades/${propiedadB}/documentos/${documentoB}`, undefined],
      ] as const;

      for (const [metodo, ruta, cuerpo] of casos) {
        const peticion = request(servidor())
          [metodo](ruta)
          .set('Authorization', `Bearer ${entorno.adminA.token}`)
          .set('x-tenant-id', TENANT_A);
        const respuesta = cuerpo ? await peticion.send(cuerpo) : await peticion;
        expect(respuesta.status, `${metodo.toUpperCase()} ${ruta}`).toBe(404);
      }
    });

    it('un recurso inexistente y uno ajeno son indistinguibles (R14)', async () => {
      const inexistente = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      const ajeno = await request(servidor())
        .get(`/propiedades/${propiedadB}`)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);
      const fantasma = await request(servidor())
        .get(`/propiedades/${inexistente}`)
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

  // ─── T21 — RBAC (R18) ───────────────────────────────────────────────────

  describe('RBAC: 403 en el backend, 401 sin token (R18)', () => {
    const rutas = (): Array<
      ['post' | 'get' | 'patch' | 'delete', string, Record<string, unknown> | undefined]
    > => [
      ['post', '/propiedades', { direccion: 'X', tipo: 'CASA', area: '10.00', canon: '1.00', propietario_principal_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }],
      ['get', '/propiedades', undefined],
      ['get', `/propiedades/${propiedadA}`, undefined],
      ['patch', `/propiedades/${propiedadA}`, { canon: '1.00' }],
      ['delete', `/propiedades/${propiedadA}`, undefined],
      ['post', `/propiedades/${propiedadA}/propietarios`, { perfil_propietario_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }],
      ['delete', `/propiedades/${propiedadA}/propietarios/ffffffff-ffff-ffff-ffff-ffffffffffff`, undefined],
      ['patch', `/propiedades/${propiedadA}/inquilino-actual`, { perfil_inquilino_id: null }],
      ['get', `/propiedades/${propiedadA}/historial-ocupacion`, undefined],
      ['post', `/propiedades/${propiedadA}/documentos`, undefined],
      ['get', `/propiedades/${propiedadA}/documentos`, undefined],
      ['delete', `/propiedades/${propiedadA}/documentos/ffffffff-ffff-ffff-ffff-ffffffffffff`, undefined],
      ['post', `/propiedades/${propiedadA}/fotos`, undefined],
      ['delete', `/propiedades/${propiedadA}/fotos`, { clave: 'x' }],
    ];

    for (const rol of ['propietario', 'inquilino'] as const) {
      it(`${rol}: 403 en las 14 rutas (R18)`, async () => {
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

    it('sin token → 401 en las 14 rutas', async () => {
      for (const [metodo, ruta, cuerpo] of rutas()) {
        const peticion = request(servidor())
          [metodo](ruta)
          .set('x-tenant-id', TENANT_A);
        const respuesta = cuerpo ? await peticion.send(cuerpo) : await peticion;
        expect(respuesta.status, `${metodo.toUpperCase()} ${ruta}`).toBe(401);
      }
    });
  });

  // ─── T22 — auditoría (R20) ──────────────────────────────────────────────

  describe('auditoría de las mutaciones (R20)', () => {
    it('cada mutación genera exactamente una fila de auditoría (R20)', async () => {
      const desde = new Date();
      const auth = (peticion: request.Test) =>
        peticion
          .set('Authorization', `Bearer ${entorno.adminA.token}`)
          .set('x-tenant-id', TENANT_A);

      // Crear propiedad
      const prop = await auth(request(servidor()).post('/propietarios')).send({
        nombre: 'Audit Prop',
        tipo_documento: 'CC',
        documento: 'AUD-P-6',
      });
      const propiedad = await auth(request(servidor()).post('/propiedades')).send({
        direccion: 'Calle Auditoria',
        tipo: 'BODEGA',
        area: '50.00',
        canon: '700000.00',
        propietario_principal_id: prop.body.id,
      });

      // Propietario adicional
      const segundo = await auth(request(servidor()).post('/propietarios')).send({
        nombre: 'Audit Adicional',
        tipo_documento: 'CE',
        documento: 'AUD-P2-6',
      });
      const asociacion = await auth(
        request(servidor()).post(`/propiedades/${propiedad.body.id}/propietarios`),
      ).send({ perfil_propietario_id: segundo.body.id });

      // Inquilino actual
      const inq = await auth(request(servidor()).post('/inquilinos')).send({
        nombre: 'Audit Inq',
        tipo_documento: 'CC',
        documento: 'AUD-I-6',
        email: 'aud-i6@example.com',
        celular: '3004445555',
        medio_preferido_contacto: 'SMS',
      });
      await auth(
        request(servidor()).patch(`/propiedades/${propiedad.body.id}/inquilino-actual`),
      ).send({ perfil_inquilino_id: inq.body.id });

      // Documento
      const doc = await auth(
        request(servidor()).post(`/propiedades/${propiedad.body.id}/documentos`),
      )
        .field('nombre', 'auditoria.pdf')
        .attach('archivo', Buffer.from('auditoria'), {
          filename: 'auditoria.pdf',
          contentType: 'application/pdf',
        });

      const esperadas: Array<[string, string, string]> = [
        ['crear', 'propiedad', propiedad.body.id],
        ['crear', 'propiedad_propietario', asociacion.body.id],
        ['actualizar', 'propiedad', propiedad.body.id],
        ['crear', 'propiedad_documento', doc.body.id],
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
  });

  // ─── T23 — PII y binarios fuera de logs y auditoría (R15) ───────────────

  describe('datos personales y binarios fuera de logs y auditoría (R15)', () => {
    const PII = {
      direccion: 'Calle PII Secreta 123',
      matricula: 'PII-MAT-998877',
      telefonoAdmin: 'PII-TEL-6045558899',
      correoAdmin: 'pii-admin@example.com',
    };

    it('direccion, matricula y contactos de administración no llegan a auditoría ni logs', async () => {
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
        const prop = await request(servidor())
          .post('/propietarios')
          .set('Authorization', `Bearer ${entorno.adminA.token}`)
          .set('x-tenant-id', TENANT_A)
          .send({ nombre: 'PII Prop', tipo_documento: 'CC', documento: 'PII-6' });

        await request(servidor())
          .post('/propiedades')
          .set('Authorization', `Bearer ${entorno.adminA.token}`)
          .set('x-tenant-id', TENANT_A)
          .send({
            direccion: PII.direccion,
            tipo: 'APARTAMENTO',
            area: '55.00',
            matricula_inmobiliaria: PII.matricula,
            canon: '1100000.00',
            contacto_admin_telefono: PII.telefonoAdmin,
            contacto_admin_correo: PII.correoAdmin,
            propietario_principal_id: prop.body.id,
          });
      } finally {
        espiaStdout.mockRestore();
        espiaStderr.mockRestore();
      }

      // 1) Auditoría: se serializa TODA la fila.
      const { rows } = await entorno.poolAdmin.query(
        `SELECT to_jsonb(audit_log) AS fila FROM audit_log`,
      );
      const auditoria = JSON.stringify(rows);

      for (const valor of Object.values(PII)) {
        expect(auditoria).not.toContain(valor);
      }

      // 2) Logs de la aplicación.
      const salida = capturado.join('');
      for (const valor of Object.values(PII)) {
        expect(salida).not.toContain(valor);
      }
    });

    it('el binario de un documento no aparece en la base ni en logs (R13, R15)', async () => {
      const binario = Buffer.from('BINARIO-TOP-SECRET-6');
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
        const doc = await request(servidor())
          .post(`/propiedades/${propiedadA}/documentos`)
          .set('Authorization', `Bearer ${entorno.adminA.token}`)
          .set('x-tenant-id', TENANT_A)
          .field('nombre', 'secreto.pdf')
          .attach('archivo', binario, {
            filename: 'secreto.pdf',
            contentType: 'application/pdf',
          });
        expect(doc.status).toBe(201);
      } finally {
        espiaStdout.mockRestore();
        espiaStderr.mockRestore();
      }

      // La base solo guarda el hash, nunca el binario ni su clave.
      const { rows } = await entorno.poolAdmin.query(
        `SELECT to_jsonb(propiedad_documento) AS fila FROM propiedad_documento`,
      );
      const serializado = JSON.stringify(rows);
      expect(serializado).not.toContain('BINARIO-TOP-SECRET-6');

      const salida = capturado.join('');
      expect(salida).not.toContain('BINARIO-TOP-SECRET-6');
      // La clave de storage tampoco debe filtrar el nombre del cliente.
      expect(salida).not.toContain('secreto.pdf');
    });
  });
});
