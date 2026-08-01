import { MinioContainer } from '@testcontainers/minio';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
  CODIGO_TENANT_A,
  CLAVE_DE_PRUEBA,
} from '../../../../../test/support/entorno-clientes';

/**
 * Firma electrónica y PDF (T12–T16 → R1, R2, R3, R4, R5, R6, R7, R11).
 * Contra PostgreSQL y MinIO reales. El flujo completo por la API:
 * inventario → invitación → registro → revisión completa → acuerdo →
 * PDF → firma del empleado → OTP FIRMA → firma del inquilino → CERRADO.
 */
describe('Firma y PDF del inventario (#14)', () => {
  let entorno: EntornoClientes;
  let minio: Awaited<ReturnType<MinioContainer['start']>>;
  let envOriginal: NodeJS.ProcessEnv;

  let idInventario: string;
  let idPropiedad: string;
  let tokenInquilino: string;
  let hashPdf: string;
  let items: Array<{ id: string }>;

  const sufijo = () => Date.now().toString().slice(-6);

  beforeAll(async () => {
    envOriginal = { ...process.env };
    minio = await new MinioContainer('minio/minio:RELEASE.2024-09-13T20-26-02Z').start();
    Object.assign(process.env, {
      MINIO_ENDPOINT: minio.getHost(),
      MINIO_PORT: String(minio.getMappedPort(9000)),
      MINIO_ACCESS_KEY: minio.getUsername(),
      MINIO_SECRET_KEY: minio.getPassword(),
      MINIO_USE_SSL: 'false',
      MINIO_BUCKET: 'firma-test',
    });
    entorno = await levantarEntornoClientes();
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
  const comoAdminA = (metodo: 'post' | 'get' | 'patch' | 'delete', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);

  // ─── Preparación: inventario EN_REVISION con revisión completa ─────────

  beforeAll(async () => {
    const suf = sufijo();
    const propietario = await comoAdminA('post', '/propietarios').send({
      nombre: `P Firma ${suf}`,
      tipo_documento: 'CC',
      documento: `PF-${suf}`,
    });
    const propiedad = await comoAdminA('post', '/propiedades').send({
      direccion: `Calle Firma ${suf}`,
      tipo: 'APARTAMENTO',
      area: '60.00',
      canon: '1000000.00',
      propietario_principal_id: propietario.body.id,
    });
    idPropiedad = propiedad.body.id;

    const creado = await comoAdminA('post', '/inventarios').send({
      propiedad_id: idPropiedad,
      tipo_evento: 'ENTREGA',
    });
    idInventario = creado.body.id;
    items = creado.body.zonas.flatMap((z: { items: Array<{ id: string }> }) => z.items);

    // Inquilino objetivo + invitación + registro + login.
    const email = `firmante-${suf}@example.com`;
    const doc = `FIR-${suf}`;
    const inquilino = await comoAdminA('post', '/inquilinos').send({
      nombre: `Firmante ${suf}`,
      tipo_documento: 'CC',
      documento: doc,
      email,
      celular: `304${suf}`,
      medio_preferido_contacto: 'CORREO',
    });
    const invitacion = await comoAdminA(
      'post',
      `/inventarios/${idInventario}/invitaciones`,
    ).send({ perfil_inquilino_id: inquilino.body.id });
    const token = invitacion.body.url_invitacion.split('/').pop();

    await request(servidor()).post(`/invitaciones/${token}/registro`).send({
      nombre: `Firmante ${suf}`,
      tipo_documento: 'CC',
      documento: doc,
      password: CLAVE_DE_PRUEBA,
      email,
    });
    const login = await request(servidor())
      .post('/auth/login')
      .send({ codigo: CODIGO_TENANT_A, email, password: CLAVE_DE_PRUEBA });
    tokenInquilino = login.body.access_token;

    // Revisión completa de todos los ítems (R7 de #13).
    for (const item of items) {
      const revision = await request(servidor())
        .post(`/inquilino/inventarios/${idInventario}/items/${item.id}/revision`)
        .set('Authorization', `Bearer ${tokenInquilino}`)
        .set('x-tenant-id', TENANT_A)
        .send({ respuesta: 'ACEPTADO' });
      expect(revision.status).toBe(201);
    }
  });

  // ─── T13 — acuerdo (R6) ─────────────────────────────────────────────────

  describe('T13 — confirmar el acuerdo (R6)', () => {
    it('revisión incompleta → 409 ACUERDO_INCOMPLETO sin cambiar', async () => {
      // Un inventario nuevo SIN revisión.
      const creado = await comoAdminA('post', '/inventarios').send({
        propiedad_id: idPropiedad,
        tipo_evento: 'DEVOLUCION',
      });
      await entorno.poolAdmin.query(
        `UPDATE inventario SET estado = 'EN_REVISION' WHERE id = $1`,
        [creado.body.id],
      );
      const respuesta = await comoAdminA(
        'post',
        `/inventarios/${creado.body.id}/confirmar-acuerdo`,
      );
      expect(respuesta.status).toBe(409);
      expect(respuesta.body.error).toBe('ACUERDO_INCOMPLETO');

      const { rows } = await entorno.poolAdmin.query<{ estado: string }>(
        `SELECT estado FROM inventario WHERE id = $1`,
        [creado.body.id],
      );
      expect(rows[0]?.estado).toBe('EN_REVISION');
      await comoAdminA('delete', `/inventarios/${creado.body.id}`);
    });

    it('revisión completa → ACORDADO (R6)', async () => {
      const respuesta = await comoAdminA(
        'post',
        `/inventarios/${idInventario}/confirmar-acuerdo`,
      );
      expect(respuesta.status).toBe(201);
      const { rows } = await entorno.poolAdmin.query<{ estado: string }>(
        `SELECT estado FROM inventario WHERE id = $1`,
        [idInventario],
      );
      expect(rows[0]?.estado).toBe('ACORDADO');
    });
  });

  // ─── T12 — PDF (R1, R11) ────────────────────────────────────────────────

  describe('T12 — generar el PDF (R1, R11)', () => {
    it('POST /inventarios/:id/pdf genera el PDF con hash SHA-256', async () => {
      const respuesta = await comoAdminA('post', `/inventarios/${idInventario}/pdf`);
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.hash_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(respuesta.body.tamano_bytes).toBeGreaterThan(100);
      hashPdf = respuesta.body.hash_sha256;

      // El documento quedó en el repositorio documental con el hash (R2).
      const { rows } = await entorno.poolAdmin.query<{
        tipo_documento: string;
        hash_sha256: string;
        entidad_tipo: string;
      }>(
        `SELECT tipo_documento, hash_sha256, entidad_tipo FROM propiedad_documento
          WHERE entidad_tipo = 'inventario' AND entidad_id = $1`,
        [idInventario],
      );
      expect(rows[0]?.tipo_documento).toBe('inventario_firmado');
      expect(rows[0]?.hash_sha256).toBe(hashPdf);
    });

    it('regenerar el mismo documento → 409 (un solo documento por inventario)', async () => {
      const respuesta = await comoAdminA('post', `/inventarios/${idInventario}/pdf`);
      expect(respuesta.status).toBe(409);
      expect(respuesta.body.error).toBe('DOCUMENTO_NO_FIRMABLE');
    });
  });

  // ─── T14 — firma del empleado (R3, R5) ──────────────────────────────────

  describe('T14 — firma del empleado (R3, R5)', () => {
    it('firma con el hash del documento → 201 y evidencia en la base', async () => {
      const respuesta = await comoAdminA(
        'post',
        `/inventarios/${idInventario}/firmas/empleado`,
      ).send({ hash_documento: hashPdf });
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.firmante_tipo).toBe('EMPLEADO');
      expect(respuesta.body.ip).toBeTruthy();

      const { rows } = await entorno.poolAdmin.query<{
        hash_documento: string;
        otp_verificado_en: Date | null;
      }>(
        `SELECT hash_documento, otp_verificado_en FROM inventario_firma
          WHERE inventario_id = $1 AND firmante_tipo = 'EMPLEADO'`,
        [idInventario],
      );
      expect(rows[0]?.hash_documento).toBe(hashPdf);
      expect(rows[0]?.otp_verificado_en).toBeNull();
    });

    it('repetir la firma del empleado → 409 (una firma por parte)', async () => {
      const respuesta = await comoAdminA(
        'post',
        `/inventarios/${idInventario}/firmas/empleado`,
      ).send({ hash_documento: hashPdf });
      expect(respuesta.status).toBe(409);
    });

    it('hash que no coincide con el documento → 409 (R5: ambas firmas el MISMO)', async () => {
      const respuesta = await comoAdminA(
        'post',
        `/inventarios/${idInventario}/firmas/empleado`,
      ).send({ hash_documento: 'b'.repeat(64) });
      expect(respuesta.status).toBe(409);
      expect(respuesta.body.error).toBe('DOCUMENTO_NO_FIRMABLE');
    });
  });

  // ─── T15 — firma del inquilino con OTP (R4, R5) ─────────────────────────

  describe('T15 — firma del inquilino (R4, R5)', () => {
    const comoInquilino = (metodo: 'post', ruta: string) =>
      request(servidor())
        [metodo](ruta)
        .set('Authorization', `Bearer ${tokenInquilino}`)
        .set('x-tenant-id', TENANT_A);

    it('sin OTP de FIRMA reciente → 401 FIRMA_SIN_OTP (R4)', async () => {
      const respuesta = await comoInquilino(
        'post',
        `/inventarios/${idInventario}/firmas/inquilino`,
      ).send({ hash_documento: hashPdf });
      expect(respuesta.status).toBe(401);
      expect(respuesta.body.error).toBe('FIRMA_SIN_OTP');
    });

    it('con OTP de FIRMA verificado → 201, evidencia con otp_verificado_en', async () => {
      // Solicitar y verificar un OTP de FIRMA (infraestructura de #13).
      const solicitar = await comoInquilino('post', '/auth/otp/solicitar').send({
        proposito: 'FIRMA',
      });
      expect(solicitar.status).toBe(201);
      const { rows: entregas } = await entorno.poolAdmin.query<{ contenido: unknown }>(
        `SELECT contenido FROM notificacion_pendiente
          WHERE contenido::text LIKE '%FIRMA%' ORDER BY created_at DESC LIMIT 1`,
      );
      const codigo = (entregas[0]?.contenido as { codigo?: string }).codigo ?? '';
      expect(codigo).toMatch(/^\d{6}$/);

      const verificar = await comoInquilino('post', '/auth/otp/verificar').send({
        codigo,
        proposito: 'FIRMA',
      });
      expect(verificar.status).toBe(201);

      const firma = await comoInquilino(
        'post',
        `/inventarios/${idInventario}/firmas/inquilino`,
      ).send({ hash_documento: hashPdf });
      expect(firma.status).toBe(201);
      expect(firma.body.firmante_tipo).toBe('INQUILINO');

      const { rows } = await entorno.poolAdmin.query<{ otp_verificado_en: Date | null }>(
        `SELECT otp_verificado_en FROM inventario_firma
          WHERE inventario_id = $1 AND firmante_tipo = 'INQUILINO'`,
        [idInventario],
      );
      expect(rows[0]?.otp_verificado_en).not.toBeNull();
    });

    it('ambas firmas del MISMO hash → CERRADO (R5, R2)', async () => {
      const { rows } = await entorno.poolAdmin.query<{ estado: string }>(
        `SELECT estado FROM inventario WHERE id = $1`,
        [idInventario],
      );
      expect(rows[0]?.estado).toBe('CERRADO');
    });
  });

  // ─── T16 — descarga e integridad (R7, R11) ──────────────────────────────

  describe('T16 — descargar el PDF firmado (R7, R11)', () => {
    it('GET /inventarios/:id/pdf devuelve el binario con hash verificado', async () => {
      const respuesta = await comoAdminA('get', `/inventarios/${idInventario}/pdf`);
      expect(respuesta.status).toBe(200);
      expect(respuesta.headers['content-type']).toContain('application/pdf');
      expect(respuesta.headers['x-hash-sha256']).toBe(hashPdf);

      const binario = Buffer.from(respuesta.body);
      const hashReal = createHash('sha256').update(binario).digest('hex');
      expect(hashReal).toBe(hashPdf); // R11: integridad verificada
      expect(binario.subarray(0, 4).toString('ascii')).toBe('%PDF');
    });
  });
});
