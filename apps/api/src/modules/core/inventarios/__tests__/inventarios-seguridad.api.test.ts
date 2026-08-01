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
 * Invariantes de seguridad de #12 (T18, T19, T20 → R8, R9, R10).
 *
 * El MinIO se levanta antes de la app (igual que en `inventarios.api.test.ts`)
 * porque el servicio de almacenamiento lee `MINIO_*` al construirse.
 */
describe('Invariantes de seguridad de #12 (T18-T20)', () => {
  let entorno: EntornoClientes;
  let minio: Awaited<ReturnType<MinioContainer['start']>>;
  let envOriginal: NodeJS.ProcessEnv;
  let idInventarioB: string;

  beforeAll(async () => {
    envOriginal = { ...process.env };
    minio = await new MinioContainer('minio/minio:RELEASE.2024-09-13T20-26-02Z').start();
    Object.assign(process.env, {
      MINIO_ENDPOINT: minio.getHost(),
      MINIO_PORT: String(minio.getMappedPort(9000)),
      MINIO_ACCESS_KEY: minio.getUsername(),
      MINIO_SECRET_KEY: minio.getPassword(),
      MINIO_USE_SSL: 'false',
      MINIO_BUCKET: 'inventarios-seg-test',
    });

    entorno = await levantarEntornoClientes();
    const servidor = () => entorno.app.getHttpServer();

    // Un inventario BORRADOR en el tenant B.
    const propB = await request(servidor())
      .post('/propietarios')
      .set('Authorization', `Bearer ${entorno.adminB.token}`)
      .set('x-tenant-id', TENANT_B)
      .send({ nombre: 'P Seg B', tipo_documento: 'CC', documento: `PSB-${Date.now()}` });
    const propiedadB = await request(servidor())
      .post('/propiedades')
      .set('Authorization', `Bearer ${entorno.adminB.token}`)
      .set('x-tenant-id', TENANT_B)
      .send({
        direccion: 'Calle Seg B',
        tipo: 'APARTAMENTO',
        area: '60.00',
        canon: '1000000.00',
        propietario_principal_id: propB.body.id,
      });
    const inventarioB = await request(servidor())
      .post('/inventarios')
      .set('Authorization', `Bearer ${entorno.adminB.token}`)
      .set('x-tenant-id', TENANT_B)
      .send({ propiedad_id: propiedadB.body.id, tipo_evento: 'ENTREGA' });
    expect(inventarioB.status).toBe(201);
    idInventarioB = inventarioB.body.id;
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

  const peticionComo = (
    token: string,
    tenantId: string,
    metodo: 'post' | 'get' | 'patch' | 'delete',
    ruta: string,
  ) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', tenantId);

  // ─── T18 — aislamiento (R8) ─────────────────────────────────────────────

  describe('aislamiento por tenant (R8)', () => {
    it('el inventario de B accedido por A → 404 indistinguible, sin escribir', async () => {
      const zonaB = idInventarioB; // el id del inventario B vale como id de zona inexistente para A
      const casos = [
        ['get', `/inventarios/${idInventarioB}`, undefined],
        ['patch', `/inventarios/${idInventarioB}/zonas/${zonaB}`, { nombre: 'Intruso' }],
        ['delete', `/inventarios/${idInventarioB}`, undefined],
      ] as const;

      for (const [metodo, ruta, cuerpo] of casos) {
        const peticion = peticionComo(
          entorno.adminA.token,
          TENANT_A,
          metodo as 'get' | 'patch' | 'delete',
          ruta,
        );
        const respuesta = cuerpo ? await peticion.send(cuerpo) : await peticion;
        expect(respuesta.status, `${metodo.toUpperCase()} ${ruta}`).toBe(404);
      }

      // Nada se escribió en el inventario B.
      const { rows } = await entorno.poolAdmin.query<{ estado: string; activo: boolean }>(
        `SELECT estado, activo FROM inventario WHERE id = $1`,
        [idInventarioB],
      );
      expect(rows[0]?.estado).toBe('BORRADOR');
      expect(rows[0]?.activo).toBe(true);
    });

    it('un POST de inventario con propiedad inexistente/ajena → 404 (R8)', async () => {
      const respuesta = await peticionComo(
        entorno.adminA.token,
        TENANT_A,
        'post',
        '/inventarios',
      ).send({
        propiedad_id: '00000000-0000-0000-0000-000000000000',
        tipo_evento: 'ENTREGA',
      });
      expect(respuesta.status).toBe(404);
    });
  });

  // ─── T19 — RBAC (R8) ────────────────────────────────────────────────────

  describe('RBAC (R8)', () => {
    const rutas = (idB: string): Array<
      ['post' | 'get' | 'patch' | 'delete', string, Record<string, unknown> | undefined]
    > => [
      ['post', '/inventarios', { propiedad_id: idB, tipo_evento: 'ENTREGA' }],
      ['get', '/inventarios', undefined],
      ['get', `/inventarios/${idB}`, undefined],
      ['patch', `/inventarios/${idB}/zonas/ffffffff-ffff-ffff-ffff-ffffffffffff`, { nombre: 'X' }],
      ['patch', `/inventarios/${idB}/items/ffffffff-ffff-ffff-ffff-ffffffffffff`, { comentario: 'Y' }],
      ['delete', `/inventarios/${idB}`, undefined],
    ];

    for (const rol of ['propietario', 'inquilino'] as const) {
      it(`${rol}: 403 en las 6 rutas`, async () => {
        const token =
          rol === 'propietario' ? entorno.propietarioA.token : entorno.inquilinoA.token;
        for (const [metodo, ruta, cuerpo] of rutas(idInventarioB)) {
          const peticion = peticionComo(token, TENANT_A, metodo, ruta);
          const respuesta = cuerpo ? await peticion.send(cuerpo) : await peticion;
          expect(respuesta.status, `${metodo.toUpperCase()} ${ruta}`).toBe(403);
        }
      });
    }

    it('sin token → 401', async () => {
      const respuesta = await request(servidor())
        .get('/inventarios')
        .set('x-tenant-id', TENANT_A);
      expect(respuesta.status).toBe(401);
    });
  });

  // ─── T20 — auditoría y PII (R10) ────────────────────────────────────────

  describe('auditoría y PII (R10)', () => {
    it('crear inventario y subir foto registran audit_log con entity_id y metadata vacío', async () => {
      // Un inventario propio de A para no tocar el de B.
      const propA = await peticionComo(
        entorno.adminA.token,
        TENANT_A,
        'post',
        '/propietarios',
      ).send({ nombre: 'P Aud', tipo_documento: 'CC', documento: `PAU-${Date.now()}` });
      const propiedadA = await peticionComo(
        entorno.adminA.token,
        TENANT_A,
        'post',
        '/propiedades',
      ).send({
        direccion: 'Calle Aud',
        tipo: 'APARTAMENTO',
        area: '60.00',
        canon: '1000000.00',
        propietario_principal_id: propA.body.id,
      });

      const creado = await peticionComo(
        entorno.adminA.token,
        TENANT_A,
        'post',
        '/inventarios',
      ).send({ propiedad_id: propiedadA.body.id, tipo_evento: 'ENTREGA' });
      expect(creado.status).toBe(201);

      const binario = Buffer.from(
        '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
        'base64',
      );
      const itemId = creado.body.zonas[0].items[0].id;
      const foto = await peticionComo(
        entorno.adminA.token,
        TENANT_A,
        'post',
        `/inventarios/${creado.body.id}/items/${itemId}/fotos`,
      ).attach('archivo', binario, { filename: 'aud.jpg', contentType: 'image/jpeg' });
      expect(foto.status).toBe(201);

      const { rows } = await entorno.poolAdmin.query<{
        accion: string;
        entity_type: string;
        entity_id: string;
        metadata: unknown;
      }>(
        `SELECT accion, entity_type, entity_id, metadata FROM audit_log
          WHERE tenant_id = $1 AND entity_type IN ('inventario', 'inventario_item_foto')
          ORDER BY created_at`,
        [TENANT_A],
      );
      expect(rows.length).toBeGreaterThanOrEqual(2);

      const acciones = rows.map((r) => `${r.accion} ${r.entity_type}`);
      expect(acciones).toEqual(
        expect.arrayContaining(['crear inventario', 'crear inventario_item_foto']),
      );
      for (const fila of rows) {
        expect(fila.entity_id).toBeTruthy();
        expect(fila.metadata).toBeNull();
      }

      // La IP y los timestamps de la captura viven en el dominio, nunca en
      // audit_log.metadata ni en las columnas de la foto más allá del dominio.
      const { rows: fotos } = await entorno.poolAdmin.query<{
        autor: string;
        hash_sha256: string;
      }>(
        `SELECT autor, hash_sha256 FROM inventario_item_foto
          WHERE id = $1`,
        [foto.body.id],
      );
      expect(fotos[0]?.autor).toBe('EMPLEADO');
      expect(fotos[0]?.hash_sha256).toBe(foto.body.hash_sha256);
    });
  });
});
