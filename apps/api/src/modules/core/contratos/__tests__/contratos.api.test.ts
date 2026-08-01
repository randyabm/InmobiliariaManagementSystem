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
 * Generación y firma de contratos (T9–T16 → R1–R6). Flujo completo:
 * base del tenant → plantilla de propiedad validada → inquilino → merge →
 * PDF → firmas → contrato firmado, con el anexo del inventario CERRADO.
 */
describe('Contratos — generación y firma (#17)', () => {
  let entorno: EntornoClientes;
  let minio: Awaited<ReturnType<MinioContainer['start']>>;
  let envOriginal: NodeJS.ProcessEnv;

  let idPropiedad: string;
  let idInquilino: string;
  let idContrato: string;
  let hashPdf: string;

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
      MINIO_BUCKET: 'contratos-test',
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
  const comoAdminA = (metodo: 'post' | 'get', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);

  // ─── Preparación: template validado + inquilino + inventario CERRADO ───

  beforeAll(async () => {
    const suf = sufijo();
    const propietario = await comoAdminA('post', '/propietarios').send({
      nombre: `P Contrato ${suf}`,
      tipo_documento: 'CC',
      documento: `PC-${suf}`,
    });
    const propiedad = await comoAdminA('post', '/propiedades').send({
      direccion: `Calle Contrato ${suf}`,
      tipo: 'APARTAMENTO',
      area: '60.00',
      canon: '1200000.00',
      propietario_principal_id: propietario.body.id,
    });
    idPropiedad = propiedad.body.id;

    // Base del tenant + validación + plantilla de propiedad validada.
    await comoAdminA('post', '/plantillas-contrato').send({
      nombre: 'Clausulado estándar',
      cuerpo:
        'Entre {arrendador} y {arrendatario}, se arrienda {direccion_propiedad} ' +
        'por un canon de {canon}. Fechas: {fecha_inicio} a {fecha_fin}.',
      merge_fields: {
        arrendador: '',
        arrendatario: '',
        direccion_propiedad: '',
        canon: '',
        fecha_inicio: '',
        fecha_fin: '',
      },
    });
    await comoAdminA('post', '/plantillas-contrato/validar');
    await comoAdminA('post', `/propiedades/${idPropiedad}/contrato/plantilla`);
    await comoAdminA('post', `/propiedades/${idPropiedad}/contrato/plantilla/validar`);

    // Inquilino con cuenta (login para firmar).
    const email = `arrendatario-${suf}@example.com`;
    const doc = `AR-${suf}`;
    const inquilino = await comoAdminA('post', '/inquilinos').send({
      nombre: `Arrendatario ${suf}`,
      tipo_documento: 'CC',
      documento: doc,
      email,
      celular: `306${suf}`,
      medio_preferido_contacto: 'CORREO',
    });
    idInquilino = inquilino.body.id;
    // El login real se hace en T12 (con hash real).

    // Un inventario CERRADO para el anexo (RF-I12): se siembra directo.
    const { rows: inventario } = await entorno.poolAdmin.query<{ id: string }>(
      `INSERT INTO inventario (tenant_id, propiedad_id, tipo_evento, estado)
       VALUES ($1, $2, 'ENTREGA', 'CERRADO') RETURNING id`,
      [TENANT_A, idPropiedad],
    );
    const binarioPdf = Buffer.from('%PDF-1.4 anexo de prueba');
    const hash = createHash('sha256').update(binarioPdf).digest('hex');
    await entorno.poolAdmin.query(
      `INSERT INTO propiedad_documento
         (tenant_id, propiedad_id, nombre, tipo_documento, clave_storage,
          hash_sha256, mime, tamano_bytes, entidad_tipo, entidad_id)
       VALUES ($1, $2, 'Inventario firmado', 'inventario_firmado',
               'anexo-${Date.now()}.pdf', $3, 'application/pdf', $4,
               'inventario', $5)`,
      [TENANT_A, idPropiedad, hash, binarioPdf.length, inventario[0]?.id],
    );
  });

  // ─── T9 — generar el contrato (R1, R2) ──────────────────────────────────

  describe('T9 — generar (R1, R2)', () => {
    it('merge del template validado + inquilino → 201 con contrato vigente', async () => {
      const respuesta = await comoAdminA('post', `/propiedades/${idPropiedad}/contratos`).send({
        inquilino_id: idInquilino,
        fecha_inicio: '2026-09-01',
        fecha_fin: '2027-09-01',
      });
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.estado).toBe('vigente');
      expect(respuesta.body.inquilino_id).toBe(idInquilino);
      idContrato = respuesta.body.id;

      const { rows } = await entorno.poolAdmin.query<{ estado: string }>(
        `SELECT estado FROM contract WHERE id = $1`,
        [idContrato],
      );
      expect(rows[0]?.estado).toBe('vigente');

      // El PDF quedó en el repositorio documental.
      const { rows: docs } = await entorno.poolAdmin.query<{ hash_sha256: string }>(
        `SELECT hash_sha256 FROM propiedad_documento
          WHERE entidad_tipo = 'contrato' AND entidad_id = $1 AND tipo_documento = 'contrato_generado'`,
        [idContrato],
      );
      expect(docs[0]?.hash_sha256).toMatch(/^[0-9a-f]{64}$/);
      hashPdf = docs[0]?.hash_sha256 ?? '';
    });

    it('inquilino ajeno → 404 (R2)', async () => {
      const respuesta = await comoAdminA('post', `/propiedades/${idPropiedad}/contratos`).send({
        inquilino_id: '00000000-0000-0000-0000-000000000000',
        fecha_inicio: '2026-09-01',
        fecha_fin: '2027-09-01',
      });
      expect(respuesta.status).toBe(404);
    });

    it('template de la propiedad sin validar → 409 (R1)', async () => {
      // Otra propiedad con plantilla SOLO propuesta (sin validar).
      const suf = sufijo();
      const propietario = await comoAdminA('post', '/propietarios').send({
        nombre: `P NoValid ${suf}`,
        tipo_documento: 'CC',
        documento: `PNV-${suf}`,
      });
      const propiedad = await comoAdminA('post', '/propiedades').send({
        direccion: `Calle NoValid ${suf}`,
        tipo: 'APARTAMENTO',
        area: '60.00',
        canon: '1000000.00',
        propietario_principal_id: propietario.body.id,
      });
      await comoAdminA('post', `/propiedades/${propiedad.body.id}/contrato/plantilla`);

      const respuesta = await comoAdminA(
        'post',
        `/propiedades/${propiedad.body.id}/contratos`,
      ).send({
        inquilino_id: idInquilino,
        fecha_inicio: '2026-09-01',
        fecha_fin: '2027-09-01',
      });
      expect(respuesta.status).toBe(409);
      expect(respuesta.body.error).toBe('DOCUMENTO_NO_FIRMABLE');
    });
  });

  // ─── T10 — anexo del inventario CERRADO (R4, RF-I12) ────────────────────

  describe('T10 — anexo del inventario (R4)', () => {
    it('el inventario CERRADO quedó vinculado al contrato', async () => {
      const { rows } = await entorno.poolAdmin.query<{ anexo_de_contrato_id: string | null }>(
        `SELECT anexo_de_contrato_id FROM propiedad_documento
          WHERE entidad_tipo = 'inventario' AND tipo_documento = 'inventario_firmado'
            AND propiedad_id = $1`,
        [idPropiedad],
      );
      expect(rows[0]?.anexo_de_contrato_id).toBe(idContrato);
    });
  });

  // ─── T11 — firma del empleado (R3) ──────────────────────────────────────

  describe('T11 — firma del empleado (R3)', () => {
    it('firma → 201 con evidencia; re-firma → 409; hash ajeno → 409', async () => {
      const firma = await comoAdminA('post', `/contratos/${idContrato}/firmas/empleado`).send({
        hash_documento: hashPdf,
      });
      expect(firma.status).toBe(201);
      expect(firma.body.firmante_tipo).toBe('EMPLEADO');

      const { rows } = await entorno.poolAdmin.query<{ hash_documento: string }>(
        `SELECT hash_documento FROM contrato_firma
          WHERE contract_id = $1 AND firmante_tipo = 'EMPLEADO'`,
        [idContrato],
      );
      expect(rows[0]?.hash_documento).toBe(hashPdf);

      const repetida = await comoAdminA('post', `/contratos/${idContrato}/firmas/empleado`).send({
        hash_documento: hashPdf,
      });
      expect(repetida.status).toBe(409);

      const ajena = await comoAdminA('post', `/contratos/${idContrato}/firmas/empleado`).send({
        hash_documento: 'c'.repeat(64),
      });
      expect(ajena.status).toBe(409);
    });
  });

  // ─── T12 — firma del inquilino (R3, R5) ─────────────────────────────────

  describe('T12 — firma del inquilino (R3, R5)', () => {
    let token: string;

    beforeAll(async () => {
      // Login real: email del perfil (D-9) + hash válido de CLAVE_DE_PRUEBA.
      const hash = await import('bcrypt').then((b) =>
        b.hash(CLAVE_DE_PRUEBA, 10),
      );
      await entorno.poolAdmin.query(
        `UPDATE "user"
            SET password_hash = $2,
                email = (SELECT email_contacto FROM perfil_inquilino WHERE id = $1)
          WHERE id = (SELECT user_id FROM perfil_inquilino WHERE id = $1)`,
        [idInquilino, hash],
      );
      const email = (
        await entorno.poolAdmin.query<{ email_contacto: string }>(
          `SELECT email_contacto FROM perfil_inquilino WHERE id = $1`,
          [idInquilino],
        )
      ).rows[0]?.email_contacto;
      const login = await request(servidor())
        .post('/auth/login')
        .send({ codigo: CODIGO_TENANT_A, email, password: CLAVE_DE_PRUEBA });
      expect(login.status).toBe(201);
      token = login.body.access_token;
    });

    it('sin OTP de FIRMA → 401 (R5)', async () => {
      const respuesta = await request(servidor())
        .post(`/contratos/${idContrato}/firmas/inquilino`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', TENANT_A)
        .send({ hash_documento: hashPdf });
      expect(respuesta.status).toBe(401);
      expect(respuesta.body.error).toBe('FIRMA_SIN_OTP');
    });

    it('con OTP de FIRMA → 201 y el contrato queda firmado (R3)', async () => {
      const solicitar = await request(servidor())
        .post('/auth/otp/solicitar')
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', TENANT_A)
        .send({ proposito: 'FIRMA' });
      expect(solicitar.status).toBe(201);
      const { rows: entregas } = await entorno.poolAdmin.query<{ contenido: unknown }>(
        `SELECT contenido FROM notificacion_pendiente
          WHERE contenido::text LIKE '%FIRMA%' ORDER BY created_at DESC LIMIT 1`,
      );
      const codigo = (entregas[0]?.contenido as { codigo?: string }).codigo ?? '';
      await request(servidor())
        .post('/auth/otp/verificar')
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', TENANT_A)
        .send({ codigo, proposito: 'FIRMA' });

      const firma = await request(servidor())
        .post(`/contratos/${idContrato}/firmas/inquilino`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', TENANT_A)
        .send({ hash_documento: hashPdf });
      expect(firma.status).toBe(201);

      const { rows } = await entorno.poolAdmin.query<{ estado: string }>(
        `SELECT estado FROM contract WHERE id = $1`,
        [idContrato],
      );
      expect(rows[0]?.estado).toBe('firmado');
    });
  });

  // ─── T13/T16 — seguridad e integridad ───────────────────────────────────

  describe('T13/T16 — seguridad e integridad', () => {
    it('sin token → 401; descarga verifica el hash (R6)', async () => {
      const sinToken = await request(servidor())
        .get(`/contratos/${idContrato}/pdf`)
        .set('x-tenant-id', TENANT_A);
      expect(sinToken.status).toBe(401);

      const pdf = await comoAdminA('get', `/contratos/${idContrato}/pdf`);
      expect(pdf.status).toBe(200);
      expect(pdf.headers['x-hash-sha256']).toBe(hashPdf);
      const binario = Buffer.from(pdf.body);
      const hashReal = createHash('sha256').update(binario).digest('hex');
      expect(hashReal).toBe(hashPdf);
    });

    it('auditoría de generación y firmas con metadata vacío', async () => {
      const { rows } = await entorno.poolAdmin.query<{ entity_type: string; metadata: unknown }>(
        `SELECT entity_type, metadata FROM audit_log
          WHERE tenant_id = $1 AND entity_type IN ('contract', 'contrato_firma')`,
        [TENANT_A],
      );
      expect(rows.length).toBeGreaterThanOrEqual(3);
      for (const fila of rows) expect(fila.metadata).toBeNull();
    });
  });
});
