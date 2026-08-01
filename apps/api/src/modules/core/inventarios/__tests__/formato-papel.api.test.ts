import { MinioContainer } from '@testcontainers/minio';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
} from '../../../../../test/support/entorno-clientes';

/**
 * Formato en papel (T5–T7 → R1, R2, R3, §10.5).
 */
describe('Formato en papel (#29)', () => {
  let entorno: EntornoClientes;
  let minio: Awaited<ReturnType<MinioContainer['start']>>;
  let envOriginal: NodeJS.ProcessEnv;

  let idPropiedad: string;
  let idInventario: string;
  let itemParedes: { id: string };

  beforeAll(async () => {
    envOriginal = { ...process.env };
    minio = await new MinioContainer('minio/minio:RELEASE.2024-09-13T20-26-02Z').start();
    Object.assign(process.env, {
      MINIO_ENDPOINT: minio.getHost(),
      MINIO_PORT: String(minio.getMappedPort(9000)),
      MINIO_ACCESS_KEY: minio.getUsername(),
      MINIO_SECRET_KEY: minio.getPassword(),
      MINIO_USE_SSL: 'false',
      MINIO_BUCKET: 'papel-test',
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
      nombre: `P Papel ${suf}`,
      tipo_documento: 'CC',
      documento: `PPA-${suf}`,
    });
    const propiedad = await comoAdminA('post', '/propiedades').send({
      direccion: `Calle Papel ${suf}`,
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
    itemParedes = creado.body.zonas[0].items[0];
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

  // ─── R1 — formato en papel ──────────────────────────────────────────────

  describe('R1 — formato (RF-I19)', () => {
    it('genera un PDF imprimible con el vínculo del inventario', async () => {
      const respuesta = await comoAdminA('post', `/inventarios/${idInventario}/formato-papel`);
      expect(respuesta.status).toBe(201);
      const binario = Buffer.from(respuesta.body);
      expect(binario.subarray(0, 4).toString('ascii')).toBe('%PDF');
      expect(respuesta.headers['x-vinculo-inventario']).toBe(idInventario);
    });

    it('fuera de BORRADOR → 409', async () => {
      await entorno.poolAdmin.query(
        `UPDATE inventario SET estado = 'ENVIADO' WHERE id = $1`,
        [idInventario],
      );
      const respuesta = await comoAdminA('post', `/inventarios/${idInventario}/formato-papel`);
      expect(respuesta.status).toBe(409);
      // Restaurar para el resto de la suite.
      await entorno.poolAdmin.query(
        `UPDATE inventario SET estado = 'BORRADOR' WHERE id = $1`,
        [idInventario],
      );
    });

    it('inventario ajeno → 404', async () => {
      const respuesta = await comoAdminA(
        'post',
        '/inventarios/00000000-0000-0000-0000-000000000000/formato-papel',
      );
      expect(respuesta.status).toBe(404);
    });
  });

  // ─── R2 — reconstrucción ────────────────────────────────────────────────

  describe('R2 — reconstrucción (RF-I20)', () => {
    it('transcribe notas, etiqueta fotos sueltas y adjunta el escaneo', async () => {
      const foto = Buffer.from(
        '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
        'base64',
      );
      const escaneo = Buffer.from('%PDF-1.4 papel firmado a mano');

      const respuesta = await comoAdminA('post', `/inventarios/${idInventario}/reconstruir`)
        .field(
          'notas',
          JSON.stringify([
            { item_id: itemParedes.id, nota_agente: 'Entrega sin daños', nota_inquilino: 'OK' },
          ]),
        )
        .attach('fotos', foto, { filename: `${itemParedes.id}.jpg`, contentType: 'image/jpeg' })
        .attach('escaneo_papel', escaneo, { filename: 'papel.pdf', contentType: 'application/pdf' });
      expect(respuesta.status).toBe(201);

      // Notas transcritas al comentario del ítem (SELECT).
      const { rows: item } = await entorno.poolAdmin.query<{ comentario: string | null }>(
        `SELECT comentario FROM inventario_item WHERE id = $1`,
        [itemParedes.id],
      );
      expect(item[0]?.comentario).toContain('Entrega sin daños');
      expect(item[0]?.comentario).toContain('OK');

      // Foto etiquetada con autor EMPLEADO y hash real en MinIO.
      const { rows: fotoFila } = await entorno.poolAdmin.query<{
        clave_storage: string;
        autor: string;
        hash_sha256: string;
      }>(`SELECT clave_storage, autor, hash_sha256 FROM inventario_item_foto WHERE item_id = $1`, [
        itemParedes.id,
      ]);
      expect(fotoFila[0]?.autor).toBe('EMPLEADO');
      expect(fotoFila[0]?.hash_sha256).toBe(createHash('sha256').update(foto).digest('hex'));
      const cliente = new (await import('minio')).Client({
        endPoint: minio.getHost(),
        port: minio.getMappedPort(9000),
        useSSL: false,
        accessKey: minio.getUsername(),
        secretKey: minio.getPassword(),
      });
      const objeto = await cliente.getObject('papel-test', fotoFila[0]?.clave_storage ?? '');
      const chunks: Buffer[] = [];
      for await (const c of objeto) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      expect(Buffer.concat(chunks).equals(foto)).toBe(true);

      // Escaneo adjunto como evidencia (SELECT).
      const { rows: escaneoFila } = await entorno.poolAdmin.query<{
        tipo_documento: string;
        hash_sha256: string;
      }>(
        `SELECT tipo_documento, hash_sha256 FROM propiedad_documento
          WHERE entidad_tipo = 'inventario' AND entidad_id = $1
            AND tipo_documento = 'inventario_papel'`,
        [idInventario],
      );
      expect(escaneoFila[0]?.tipo_documento).toBe('inventario_papel');
      expect(escaneoFila[0]?.hash_sha256).toBe(createHash('sha256').update(escaneo).digest('hex'));
    });

    it('fuera de BORRADOR → 409 sin transcribir nada', async () => {
      // Un ítem que ningún otro test ha tocado.
      const { rows: otros } = await entorno.poolAdmin.query<{ id: string }>(
        `SELECT id FROM inventario_item
          WHERE zona_id = (SELECT id FROM inventario_zona
                            WHERE inventario_id = $1 ORDER BY orden LIMIT 1)
          ORDER BY created_at LIMIT 1 OFFSET 1`,
        [idInventario],
      );
      const itemLimpio = otros[0]?.id ?? itemParedes.id;

      await entorno.poolAdmin.query(
        `UPDATE inventario SET estado = 'ENVIADO' WHERE id = $1`,
        [idInventario],
      );
      const respuesta = await comoAdminA('post', `/inventarios/${idInventario}/reconstruir`)
        .field('notas', JSON.stringify([{ item_id: itemLimpio, nota_agente: 'X' }]));
      // Restaurar ANTES de las aserciones: un fallo aquí no debe ensuciar R3.
      await entorno.poolAdmin.query(
        `UPDATE inventario SET estado = 'BORRADOR' WHERE id = $1`,
        [idInventario],
      );

      expect(respuesta.status).toBe(409);
      const { rows } = await entorno.poolAdmin.query<{ comentario: string | null }>(
        `SELECT comentario FROM inventario_item WHERE id = $1`,
        [itemLimpio],
      );
      expect(rows[0]?.comentario).toBeNull();
    });
  });

  // ─── R3 — confirmación del papel ────────────────────────────────────────

  describe('R3 — confirmación (RF-I21)', () => {
    it('BORRADOR → ENVIADO con el perfil asignado', async () => {
      const suf = Date.now().toString().slice(-6);
      const inquilino = await comoAdminA('post', '/inquilinos').send({
        nombre: `Inq Papel ${suf}`,
        tipo_documento: 'CC',
        documento: `IPA-${suf}`,
        email: `papel-${suf}@example.com`,
        celular: `309${suf}`,
        medio_preferido_contacto: 'CORREO',
      });
      const respuesta = await comoAdminA('post', `/inventarios/${idInventario}/confirmar-papel`).send({
        perfil_inquilino_id: inquilino.body.id,
      });
      expect(respuesta.status).toBe(201);

      const { rows } = await entorno.poolAdmin.query<{ estado: string; perfil_inquilino_id: string }>(
        `SELECT estado, perfil_inquilino_id::text AS perfil_inquilino_id FROM inventario WHERE id = $1`,
        [idInventario],
      );
      expect(rows[0]?.estado).toBe('ENVIADO');
      expect(rows[0]?.perfil_inquilino_id).toBe(inquilino.body.id);
    });
  });
});
