import { MinioContainer } from '@testcontainers/minio';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
  TENANT_B,
  CODIGO_TENANT_A,
  CODIGO_TENANT_B,
  CLAVE_DE_PRUEBA,
} from '../../../../../test/support/entorno-clientes';

/**
 * Invariantes de seguridad de #14 (T18, T19, T20 → R8, R9, R10, R11).
 */
describe('Invariantes de seguridad de #14 (T18-T20)', () => {
  let entorno: EntornoClientes;
  let minio: Awaited<ReturnType<MinioContainer['start']>>;
  let envOriginal: NodeJS.ProcessEnv;

  let idInventarioA: string;
  let idInventarioB: string;
  let hashPdfA: string;
  let hashPdfB: string;
  let tokenInquilinoA: string;
  let tokenInquilinoB: string;

  const sufijo = () => Date.now().toString().slice(-6);

  /** Crea un inventario ENVIADO con revisión completa (estado ACORDADO). */
  async function inventarioAcordado(
    tenantId: string,
    adminToken: string,
    codigoTenant: string,
    prefijo: string,
  ): Promise<{ id: string; hash: string; tokenInquilino: string }> {
    const servidor = () => entorno.app.getHttpServer();
    const comoAdmin = (metodo: 'post' | 'get', ruta: string) =>
      request(servidor())
        [metodo](ruta)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-tenant-id', tenantId);

    const suf = sufijo();
    const propietario = await comoAdmin('post', '/propietarios').send({
      nombre: `P ${prefijo} ${suf}`,
      tipo_documento: 'CC',
      documento: `P-${prefijo}-${suf}`,
    });
    const propiedad = await comoAdmin('post', '/propiedades').send({
      direccion: `Calle ${prefijo} ${suf}`,
      tipo: 'APARTAMENTO',
      area: '60.00',
      canon: '1000000.00',
      propietario_principal_id: propietario.body.id,
    });
    const creado = await comoAdmin('post', '/inventarios').send({
      propiedad_id: propiedad.body.id,
      tipo_evento: 'ENTREGA',
    });
    const id = creado.body.id;
    const items = creado.body.zonas.flatMap((z: { items: Array<{ id: string }> }) => z.items);

    const email = `${prefijo}-${suf}@example.com`;
    const doc = `DOC-${prefijo}-${suf}`;
    const inquilino = await comoAdmin('post', '/inquilinos').send({
      nombre: `Inq ${prefijo} ${suf}`,
      tipo_documento: 'CC',
      documento: doc,
      email,
      celular: `305${suf}`,
      medio_preferido_contacto: 'CORREO',
    });
    const invitacion = await comoAdmin('post', `/inventarios/${id}/invitaciones`).send({
      perfil_inquilino_id: inquilino.body.id,
    });
    const token = invitacion.body.url_invitacion.split('/').pop();
    await request(servidor()).post(`/invitaciones/${token}/registro`).send({
      nombre: `Inq ${prefijo} ${suf}`,
      tipo_documento: 'CC',
      documento: doc,
      password: CLAVE_DE_PRUEBA,
      email,
    });
    const login = await request(servidor())
      .post('/auth/login')
      .send({ codigo: codigoTenant, email, password: CLAVE_DE_PRUEBA });
    const tokenInquilino = login.body.access_token;

    for (const item of items) {
      await request(servidor())
        .post(`/inquilino/inventarios/${id}/items/${item.id}/revision`)
        .set('Authorization', `Bearer ${tokenInquilino}`)
        .set('x-tenant-id', tenantId)
        .send({ respuesta: 'ACEPTADO' });
    }
    await comoAdmin('post', `/inventarios/${id}/confirmar-acuerdo`);
    const pdf = await comoAdmin('post', `/inventarios/${id}/pdf`);
    expect(pdf.status).toBe(201);
    return { id, hash: pdf.body.hash_sha256, tokenInquilino };
  }

  beforeAll(async () => {
    envOriginal = { ...process.env };
    minio = await new MinioContainer('minio/minio:RELEASE.2024-09-13T20-26-02Z').start();
    Object.assign(process.env, {
      MINIO_ENDPOINT: minio.getHost(),
      MINIO_PORT: String(minio.getMappedPort(9000)),
      MINIO_ACCESS_KEY: minio.getUsername(),
      MINIO_SECRET_KEY: minio.getPassword(),
      MINIO_USE_SSL: 'false',
      MINIO_BUCKET: 'firma-seg-test',
    });
    entorno = await levantarEntornoClientes();

    const a = await inventarioAcordado(TENANT_A, entorno.adminA.token, CODIGO_TENANT_A, 'A');
    idInventarioA = a.id;
    hashPdfA = a.hash;
    tokenInquilinoA = a.tokenInquilino;

    const b = await inventarioAcordado(TENANT_B, entorno.adminB.token, CODIGO_TENANT_B, 'B');
    idInventarioB = b.id;
    hashPdfB = b.hash;
    tokenInquilinoB = b.tokenInquilino;
  }, 240_000);

  afterAll(async () => {
    await entorno?.cerrar();
    await minio?.stop();
    for (const clave of Object.keys(process.env)) {
      if (!(clave in envOriginal)) delete process.env[clave];
    }
    Object.assign(process.env, envOriginal);
  });

  const servidor = () => entorno.app.getHttpServer();

  // ─── T18 — aislamiento (R8) ─────────────────────────────────────────────

  describe('aislamiento por tenant (R8)', () => {
    it('el inventario de B accedido por A → 404 indistinguible en las 5 rutas', async () => {
      const casos = [
        ['post', `/inventarios/${idInventarioB}/confirmar-acuerdo`, undefined],
        ['post', `/inventarios/${idInventarioB}/pdf`, undefined],
        ['get', `/inventarios/${idInventarioB}/pdf`, undefined],
        ['post', `/inventarios/${idInventarioB}/firmas/empleado`, { hash_documento: hashPdfB }],
      ] as const;

      for (const [metodo, ruta, cuerpo] of casos) {
        const peticion = request(servidor())
          [metodo](ruta)
          .set('Authorization', `Bearer ${entorno.adminA.token}`)
          .set('x-tenant-id', TENANT_A);
        const respuesta = cuerpo ? await peticion.send(cuerpo) : await peticion;
        expect(respuesta.status, `${metodo.toUpperCase()} ${ruta}`).toBe(404);
      }

      // Nada se escribió en el inventario B (sigue ACORDADO, sin firmas).
      const { rows } = await entorno.poolAdmin.query<{ estado: string; total: string }>(
        `SELECT i.estado,
                (SELECT count(*)::text FROM inventario_firma f WHERE f.inventario_id = i.id) AS total
           FROM inventario i WHERE i.id = $1`,
        [idInventarioB],
      );
      expect(rows[0]?.estado).toBe('ACORDADO');
      expect(Number(rows[0]?.total)).toBe(0);
    });

    it('la firma del inquilino de A sobre el inventario de B → 404 (scoping)', async () => {
      const respuesta = await request(servidor())
        .post(`/inventarios/${idInventarioB}/firmas/inquilino`)
        .set('Authorization', `Bearer ${tokenInquilinoA}`)
        .set('x-tenant-id', TENANT_A)
        .send({ hash_documento: hashPdfB });
      expect(respuesta.status).toBe(404);
    });
  });

  // ─── T19 — RBAC (R8) ────────────────────────────────────────────────────

  describe('RBAC (R8)', () => {
    it('inquilino → 403 en las rutas de empleado', async () => {
      const respuesta = await request(servidor())
        .post(`/inventarios/${idInventarioA}/firmas/empleado`)
        .set('Authorization', `Bearer ${tokenInquilinoB}`)
        .set('x-tenant-id', TENANT_A)
        .send({ hash_documento: 'a'.repeat(64) });
      expect(respuesta.status).toBe(403);
    });

    it('empleado/propietario → 403 en la firma del inquilino', async () => {
      const respuesta = await request(servidor())
        .post(`/inventarios/${idInventarioA}/firmas/inquilino`)
        .set('Authorization', `Bearer ${entorno.empleadoA.token}`)
        .set('x-tenant-id', TENANT_A)
        .send({ hash_documento: 'a'.repeat(64) });
      expect(respuesta.status).toBe(403);
    });

    it('sin token → 401', async () => {
      const respuesta = await request(servidor())
        .get(`/inventarios/${idInventarioA}/pdf`)
        .set('x-tenant-id', TENANT_A);
      expect(respuesta.status).toBe(401);
    });
  });

  // ─── T20 — auditoría y PII (R10, R11) ───────────────────────────────────

  describe('auditoría y PII (R10)', () => {
    it('las firmas y el PDF generan auditoría con metadata vacío; la IP vive en el dominio', async () => {
      // La firma del empleado de A genera la fila de auditoría de la firma.
      const firma = await request(servidor())
        .post(`/inventarios/${idInventarioA}/firmas/empleado`)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A)
        .send({ hash_documento: hashPdfA });
      expect(firma.status).toBe(201);

      const { rows } = await entorno.poolAdmin.query<{
        accion: string;
        entity_type: string;
        entity_id: string;
        metadata: unknown;
      }>(
        `SELECT accion, entity_type, entity_id, metadata FROM audit_log
          WHERE tenant_id = $1 AND entity_type IN ('inventario_firma', 'propiedad_documento')
          ORDER BY created_at`,
        [TENANT_A],
      );
      expect(rows.length).toBeGreaterThanOrEqual(2);
      for (const fila of rows) {
        expect(fila.entity_id).toBeTruthy();
        expect(fila.metadata).toBeNull();
      }

      // La IP NO está en audit_log: vive en inventario_firma (R3, R10).
      const serializado = JSON.stringify(rows);
      const { rows: firmas } = await entorno.poolAdmin.query<{ ip: string }>(
        `SELECT ip FROM inventario_firma WHERE inventario_id = $1`,
        [idInventarioA],
      );
      for (const firma of firmas) {
        expect(firma.ip).toBeTruthy();
        expect(serializado).not.toContain(firma.ip);
      }
    });

    it('el hash del documento en la respuesta de descarga coincide con el de la base (R11)', async () => {
      const respuesta = await request(servidor())
        .get(`/inventarios/${idInventarioA}/pdf`)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);
      expect(respuesta.status).toBe(200);
      const { rows } = await entorno.poolAdmin.query<{ hash_sha256: string }>(
        `SELECT hash_sha256 FROM propiedad_documento
          WHERE entidad_tipo = 'inventario' AND entidad_id = $1`,
        [idInventarioA],
      );
      expect(respuesta.headers['x-hash-sha256']).toBe(rows[0]?.hash_sha256);
    });
  });
});
