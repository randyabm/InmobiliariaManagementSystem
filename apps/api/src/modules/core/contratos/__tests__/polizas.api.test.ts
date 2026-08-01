import { MinioContainer } from '@testcontainers/minio';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
  TENANT_B,
} from '../../../../../test/support/entorno-clientes';

/**
 * Pólizas (T8–T10 → R1, R2, R3).
 */
describe('Pólizas (#20)', () => {
  let entorno: EntornoClientes;
  let minio: Awaited<ReturnType<MinioContainer['start']>>;
  let envOriginal: NodeJS.ProcessEnv;

  let idPropiedad: string;
  let idPoliza: string;

  beforeAll(async () => {
    envOriginal = { ...process.env };
    minio = await new MinioContainer('minio/minio:RELEASE.2024-09-13T20-26-02Z').start();
    Object.assign(process.env, {
      MINIO_ENDPOINT: minio.getHost(),
      MINIO_PORT: String(minio.getMappedPort(9000)),
      MINIO_ACCESS_KEY: minio.getUsername(),
      MINIO_SECRET_KEY: minio.getPassword(),
      MINIO_USE_SSL: 'false',
      MINIO_BUCKET: 'polizas-test',
    });
    entorno = await levantarEntornoClientes();
    const servidor = () => entorno.app.getHttpServer();
    const comoAdminA = (metodo: 'post' | 'get' | 'patch', ruta: string) =>
      request(servidor())
        [metodo](ruta)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);

    const suf = Date.now().toString().slice(-6);
    const propietario = await comoAdminA('post', '/propietarios').send({
      nombre: `P Pol ${suf}`,
      tipo_documento: 'CC',
      documento: `PPO-${suf}`,
    });
    const propiedad = await comoAdminA('post', '/propiedades').send({
      direccion: `Calle Pol ${suf}`,
      tipo: 'APARTAMENTO',
      area: '60.00',
      canon: '1000000.00',
      propietario_principal_id: propietario.body.id,
    });
    idPropiedad = propiedad.body.id;
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
  const comoAdminA = (metodo: 'post' | 'get' | 'patch', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);

  // ─── R1 — crear en_estudio ──────────────────────────────────────────────

  describe('R1 — crear (RF-PI7)', () => {
    it('201 con estado en_estudio; propiedad ajena → 404', async () => {
      const respuesta = await comoAdminA('post', `/propiedades/${idPropiedad}/polizas`).send({
        aseguradora: 'Suramericana',
        observaciones: 'Candidato enviado el 2026-08-01.',
      });
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.estado).toBe('en_estudio');
      expect(respuesta.body.aseguradora).toBe('Suramericana');
      idPoliza = respuesta.body.id;

      const ajena = await comoAdminA('post', '/propiedades/00000000-0000-0000-0000-000000000000/polizas').send({
        aseguradora: 'X',
      });
      expect(ajena.status).toBe(404);
    });
  });

  // ─── R2 — aprobar y capturar el documento ───────────────────────────────

  describe('R2 — resultado y documento (RF-PI8)', () => {
    it('PATCH aprobada con número/vigencia/valor; CHECK de vigencia en el motor', async () => {
      const respuesta = await comoAdminA('patch', `/polizas/${idPoliza}`).send({
        estado: 'aprobada',
        numero_poliza: 'POL-2026-001',
        vigencia_desde: '2026-08-01',
        vigencia_hasta: '2027-08-01',
        valor_cobertura: 50000000,
      });
      expect(respuesta.status).toBe(200);
      expect(respuesta.body.estado).toBe('aprobada');
      expect(respuesta.body.numero_poliza).toBe('POL-2026-001');

      // Vigencia inválida → el CHECK del motor rechaza (500 → se ve como 400
      // de negocio en una póliza sana; aquí se verifica el motor).
      const invalida = await comoAdminA('patch', `/polizas/${idPoliza}`).send({
        vigencia_desde: '2027-01-01',
        vigencia_hasta: '2026-01-01',
      });
      expect([400, 500]).toContain(invalida.status);
    });

    it('subir el PDF de la póliza → hash en propiedad_documento', async () => {
      const binario = Buffer.from('%PDF-1.4 póliza de prueba');
      const respuesta = await comoAdminA('post', `/polizas/${idPoliza}/documento`)
        .attach('archivo', binario, { filename: 'poliza.pdf', contentType: 'application/pdf' });
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.hash_sha256).toMatch(/^[0-9a-f]{64}$/);

      const { rows } = await entorno.poolAdmin.query<{ tipo_documento: string; hash_sha256: string }>(
        `SELECT tipo_documento, hash_sha256 FROM propiedad_documento
          WHERE entidad_tipo = 'poliza' AND entidad_id = $1`,
        [idPoliza],
      );
      expect(rows[0]?.tipo_documento).toBe('poliza');
      expect(rows[0]?.hash_sha256).toBe(respuesta.body.hash_sha256);
    });

    it('rechazada también se registra', async () => {
      const nueva = await comoAdminA('post', `/propiedades/${idPropiedad}/polizas`).send({
        aseguradora: 'Mapfre',
      });
      const rechazada = await comoAdminA('patch', `/polizas/${nueva.body.id}`).send({
        estado: 'rechazada',
        observaciones: 'Perfil de riesgo alto.',
      });
      expect(rechazada.status).toBe(200);
      expect(rechazada.body.estado).toBe('rechazada');
    });
  });

  // ─── R3 — consulta y aislamiento ────────────────────────────────────────

  describe('R3 — consulta y aislamiento', () => {
    it('listar por propiedad; 404 cross-tenant; 401 sin token', async () => {
      const lista = await comoAdminA('get', `/propiedades/${idPropiedad}/polizas`);
      expect(lista.status).toBe(200);
      expect(lista.body.map((p: { id: string }) => p.id)).toContain(idPoliza);

      const propB = await request(servidor())
        .post('/propietarios')
        .set('Authorization', `Bearer ${entorno.adminB.token}`)
        .set('x-tenant-id', TENANT_B)
        .send({ nombre: 'P B', tipo_documento: 'CC', documento: `PB-${Date.now()}` });
      const propiedadB = await request(servidor())
        .post('/propiedades')
        .set('Authorization', `Bearer ${entorno.adminB.token}`)
        .set('x-tenant-id', TENANT_B)
        .send({
          direccion: 'Calle B Pol',
          tipo: 'APARTAMENTO',
          area: '60.00',
          canon: '1000000.00',
          propietario_principal_id: propB.body.id,
        });
      const polizaB = await request(servidor())
        .post(`/propiedades/${propiedadB.body.id}/polizas`)
        .set('Authorization', `Bearer ${entorno.adminB.token}`)
        .set('x-tenant-id', TENANT_B)
        .send({ aseguradora: 'B' });

      const enA = await comoAdminA('get', `/polizas/${polizaB.body.id}`);
      expect(enA.status).toBe(404);

      const sinToken = await request(servidor())
        .get(`/polizas/${idPoliza}`)
        .set('x-tenant-id', TENANT_A);
      expect(sinToken.status).toBe(401);
    });
  });
});
