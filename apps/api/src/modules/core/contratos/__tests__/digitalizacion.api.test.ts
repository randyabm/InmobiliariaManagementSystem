import { MinioContainer } from '@testcontainers/minio';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
  TENANT_B,
} from '../../../../../test/support/entorno-clientes';

/**
 * Digitalización (T10–T13 → R1, R2, R3). Contra PostgreSQL y MinIO reales.
 */
describe('Digitalización de contratos (#18)', () => {
  let entorno: EntornoClientes;
  let minio: Awaited<ReturnType<MinioContainer['start']>>;
  let envOriginal: NodeJS.ProcessEnv;

  let idPropiedad: string;
  let idInquilino: string;
  let idContrato: string;
  let idDocumento: string;
  let hashPdf: string;

  const BINARIO = Buffer.from('%PDF-1.4 escaneo de prueba #18\n');

  beforeAll(async () => {
    envOriginal = { ...process.env };
    minio = await new MinioContainer('minio/minio:RELEASE.2024-09-13T20-26-02Z').start();
    Object.assign(process.env, {
      MINIO_ENDPOINT: minio.getHost(),
      MINIO_PORT: String(minio.getMappedPort(9000)),
      MINIO_ACCESS_KEY: minio.getUsername(),
      MINIO_SECRET_KEY: minio.getPassword(),
      MINIO_USE_SSL: 'false',
      MINIO_BUCKET: 'digitalizacion-test',
    });
    entorno = await levantarEntornoClientes();
    const servidor = () => entorno.app.getHttpServer();
    const comoAdminA = (metodo: 'post' | 'get', ruta: string) =>
      request(servidor())
        [metodo](ruta)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);

    const suf = Date.now().toString().slice(-6);
    const propietario = await comoAdminA('post', '/propietarios').send({
      nombre: `P Dig ${suf}`,
      tipo_documento: 'CC',
      documento: `PD-${suf}`,
    });
    const propiedad = await comoAdminA('post', '/propiedades').send({
      direccion: `Calle Dig ${suf}`,
      tipo: 'APARTAMENTO',
      area: '60.00',
      canon: '1000000.00',
      propietario_principal_id: propietario.body.id,
    });
    idPropiedad = propiedad.body.id;

    const inquilino = await comoAdminA('post', '/inquilinos').send({
      nombre: `Inq Dig ${suf}`,
      tipo_documento: 'CC',
      documento: `ID-${suf}`,
      email: `dig-${suf}@example.com`,
      celular: `307${suf}`,
      medio_preferido_contacto: 'CORREO',
    });
    idInquilino = inquilino.body.id;
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

  // ─── R1 — subir el escaneo ──────────────────────────────────────────────

  describe('R1 — subir el escaneo con metadatos', () => {
    it('201 con hash; el contrato se crea con los metadatos (PA-18-1)', async () => {
      const respuesta = await comoAdminA('post', '/contratos/digitalizados')
        .attach('archivo', BINARIO, { filename: 'escaneo.pdf', contentType: 'application/pdf' })
        .field('nombre', 'Contrato físico 2019')
        .field('propiedad_id', idPropiedad)
        .field('inquilino_id', idInquilino)
        .field('fecha_inicio', '2019-01-01')
        .field('fecha_fin', '2020-01-01')
        .field('canon', '900000.00');
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.origen).toBe('digitalizado');
      expect(respuesta.body.hash_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(respuesta.body.contract_id).toBeTruthy();
      idDocumento = respuesta.body.id;
      idContrato = respuesta.body.contract_id;
      hashPdf = respuesta.body.hash_sha256;

      // El binario existe en MinIO y el hash coincide.
      const { rows } = await entorno.poolAdmin.query<{ clave_storage: string }>(
        `SELECT clave_storage FROM contract_document WHERE id = $1`,
        [idDocumento],
      );
      const objeto = await new (await import('minio')).Client({
        endPoint: minio.getHost(),
        port: minio.getMappedPort(9000),
        useSSL: false,
        accessKey: minio.getUsername(),
        secretKey: minio.getPassword(),
      }).getObject('digitalizacion-test', rows[0]?.clave_storage ?? '');
      const chunks: Buffer[] = [];
      for await (const c of objeto) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      const binario = Buffer.concat(chunks);
      expect(createHash('sha256').update(binario).digest('hex')).toBe(hashPdf);
      expect(binario.equals(BINARIO)).toBe(true);

      // El contrato quedó con los metadatos.
      const { rows: contrato } = await entorno.poolAdmin.query<{ estado: string }>(
        `SELECT estado FROM contract WHERE id = $1`,
        [idContrato],
      );
      expect(contrato[0]?.estado).toBe('vigente');
    });

    it('propiedad ajena → 404 (R2)', async () => {
      const respuesta = await comoAdminA('post', '/contratos/digitalizados')
        .attach('archivo', BINARIO, { filename: 'x.pdf', contentType: 'application/pdf' })
        .field('nombre', 'X')
        .field('propiedad_id', '00000000-0000-0000-0000-000000000000');
      expect(respuesta.status).toBe(404);
    });

    it('sin archivo → 400', async () => {
      const respuesta = await comoAdminA('post', '/contratos/digitalizados')
        .field('propiedad_id', idPropiedad);
      expect(respuesta.status).toBe(400);
    });
  });

  // ─── R2 — listado ───────────────────────────────────────────────────────

  describe('R2 — listado', () => {
    it('GET /contratos/:id/documentos lista el digitalizado', async () => {
      const respuesta = await comoAdminA('get', `/contratos/${idContrato}/documentos`);
      expect(respuesta.status).toBe(200);
      expect(respuesta.body.map((d: { id: string }) => d.id)).toContain(idDocumento);
    });

    it('GET /propiedades/:id/contratos/documentos también lo lista', async () => {
      const respuesta = await comoAdminA('get', `/propiedades/${idPropiedad}/contratos/documentos`);
      expect(respuesta.status).toBe(200);
      expect(respuesta.body.map((d: { id: string }) => d.id)).toContain(idDocumento);
    });
  });

  // ─── R3 — descarga e integridad ─────────────────────────────────────────

  describe('R3 — descarga e integridad', () => {
    it('el binario descargado coincide con el subido (hash verificado)', async () => {
      const respuesta = await comoAdminA(
        'get',
        `/contratos/${idContrato}/documentos/${idDocumento}/pdf`,
      );
      expect(respuesta.status).toBe(200);
      expect(respuesta.headers['x-hash-sha256']).toBe(hashPdf);
      const binario = Buffer.from(respuesta.body);
      expect(binario.equals(BINARIO)).toBe(true);
    });

    it('un objeto CORRUPTO en MinIO se rechaza en la descarga (R3)', async () => {
      const { rows } = await entorno.poolAdmin.query<{ clave_storage: string }>(
        `SELECT clave_storage FROM contract_document WHERE id = $1`,
        [idDocumento],
      );
      const cliente = new (await import('minio')).Client({
        endPoint: minio.getHost(),
        port: minio.getMappedPort(9000),
        useSSL: false,
        accessKey: minio.getUsername(),
        secretKey: minio.getPassword(),
      });
      // Sobrescribir el objeto con otro binario: el hash ya no coincide.
      await cliente.putObject(
        'digitalizacion-test',
        rows[0]?.clave_storage ?? '',
        Buffer.from('%PDF-1.4 CORRUPTO'),
        Buffer.from('%PDF-1.4 CORRUPTO').length,
      );

      const respuesta = await comoAdminA(
        'get',
        `/contratos/${idContrato}/documentos/${idDocumento}/pdf`,
      );
      expect(respuesta.status).toBe(404);
    });

    it('aislamiento: los documentos de B no existen para A (404)', async () => {
      const propB = await request(servidor())
        .post('/propietarios')
        .set('Authorization', `Bearer ${entorno.adminB.token}`)
        .set('x-tenant-id', TENANT_B)
        .send({ nombre: 'P B', tipo_documento: 'CC', documento: `PDB-${Date.now()}` });
      const propiedadB = await request(servidor())
        .post('/propiedades')
        .set('Authorization', `Bearer ${entorno.adminB.token}`)
        .set('x-tenant-id', TENANT_B)
        .send({
          direccion: 'Calle B Dig',
          tipo: 'APARTAMENTO',
          area: '60.00',
          canon: '1000000.00',
          propietario_principal_id: propB.body.id,
        });
      const subidoB = await request(servidor())
        .post('/contratos/digitalizados')
        .set('Authorization', `Bearer ${entorno.adminB.token}`)
        .set('x-tenant-id', TENANT_B)
        .attach('archivo', BINARIO, { filename: 'b.pdf', contentType: 'application/pdf' })
        .field('propiedad_id', propiedadB.body.id)
        .field('nombre', 'B');
      expect(subidoB.status).toBe(201);

      const enA = await comoAdminA(
        'get',
        `/contratos/${subidoB.body.contract_id}/documentos/${subidoB.body.id}/pdf`,
      );
      expect(enA.status).toBe(404);

      const sinToken = await request(servidor())
        .get(`/contratos/${idContrato}/documentos`)
        .set('x-tenant-id', TENANT_A);
      expect(sinToken.status).toBe(401);
    });
  });
});
