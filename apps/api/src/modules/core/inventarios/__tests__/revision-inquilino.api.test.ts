import { MinioContainer } from '@testcontainers/minio';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
  TENANT_B,
  CODIGO_TENANT_A,
  CLAVE_DE_PRUEBA,
} from '../../../../../test/support/entorno-clientes';

/**
 * Revisión del inquilino (T19, T20 → R6, R7, R9). Contra PostgreSQL y
 * MinIO reales. El inquilino se crea por el flujo real: invitación →
 * registro → login (R3-R5).
 */
describe('Revisión del inquilino (#13)', () => {
  let entorno: EntornoClientes;
  let minio: Awaited<ReturnType<MinioContainer['start']>>;
  let envOriginal: NodeJS.ProcessEnv;

  let idPropiedad: string;
  let idInventario = '';
  let tokenInvitacion = '';
  let tokenInquilino = '';
  let emailInquilino = '';
  let items: Array<{ id: string; nombre: string }> = [];

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
      MINIO_BUCKET: 'revision-test',
    });
    entorno = await levantarEntornoClientes();

    const servidor = () => entorno.app.getHttpServer();
    const comoAdminA = (metodo: 'post' | 'get', ruta: string) =>
      request(servidor())
        [metodo](ruta)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);

    // Propiedad + inventario BORRADOR.
    const suf = sufijo();
    const propietario = await comoAdminA('post', '/propietarios').send({
      nombre: `P Rev ${suf}`,
      tipo_documento: 'CC',
      documento: `P-REV-${suf}`,
    });
    const propiedad = await comoAdminA('post', '/propiedades').send({
      direccion: `Calle Revisión ${suf}`,
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
    items = creado.body.zonas.flatMap((z: { items: Array<{ id: string; nombre: string }> }) =>
      z.items,
    );

    // Perfil del inquilino + invitación.
    emailInquilino = `revisor-${suf}@example.com`;
    const inquilino = await comoAdminA('post', '/inquilinos').send({
      nombre: `Revisor ${suf}`,
      tipo_documento: 'CC',
      documento: `REV-${suf}`,
      email: emailInquilino,
      celular: `301${suf}`,
      medio_preferido_contacto: 'CORREO',
    });
    const invitacion = await comoAdminA('post', `/inventarios/${idInventario}/invitaciones`).send({
      perfil_inquilino_id: inquilino.body.id,
    });
    tokenInvitacion = invitacion.body.url_invitacion.split('/').pop();

    // Registro (cuenta persistente + OTP) y login estándar (#27).
    const registro = await request(servidor())
      .post(`/invitaciones/${tokenInvitacion}/registro`)
      .send({
        nombre: `Revisor ${suf}`,
        tipo_documento: 'CC',
        documento: `REV-${suf}`,
        password: CLAVE_DE_PRUEBA,
        email: emailInquilino,
      });
    expect(registro.status).toBe(201);

    const login = await request(servidor())
      .post('/auth/login')
      .send({ codigo: CODIGO_TENANT_A, email: emailInquilino, password: CLAVE_DE_PRUEBA });
    expect(login.status).toBe(201);
    tokenInquilino = login.body.access_token;
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

  const comoInquilino = (metodo: 'post' | 'get', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${tokenInquilino}`)
      .set('x-tenant-id', TENANT_A);

  // ─── T19 — revisión (R6, R7) ─────────────────────────────────────────────

  describe('T19 — revisión (R6, R7, PA-13-2)', () => {
    it('el inquilino lee SOLO su inventario (R9)', async () => {
      const respuesta = await comoInquilino('get', `/inquilino/inventarios/${idInventario}`);
      expect(respuesta.status).toBe(200);
      expect(respuesta.body.estado).toBe('ENVIADO');
      expect(respuesta.body.zonas.length).toBeGreaterThan(0);
    });

    it('aceptar un ítem → 201 y la fila queda con ACEPTADO (R6)', async () => {
      const respuesta = await comoInquilino(
        'post',
        `/inquilino/inventarios/${idInventario}/items/${items[0]!.id}/revision`,
      ).send({ respuesta: 'ACEPTADO' });
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.respuesta).toBe('ACEPTADO');

      const { rows } = await entorno.poolAdmin.query<{ respuesta: string }>(
        `SELECT respuesta FROM inventario_item_revision WHERE item_id = $1`,
        [items[0]!.id],
      );
      expect(rows[0]?.respuesta).toBe('ACEPTADO');
    });

    it('objetar SIN comentario → 400 sin escribir nada (R6)', async () => {
      const respuesta = await comoInquilino(
        'post',
        `/inquilino/inventarios/${idInventario}/items/${items[1]!.id}/revision`,
      ).send({ respuesta: 'OBJETADO' });
      expect(respuesta.status).toBe(400);
      expect(respuesta.body.error).toBe('REVISION_INVALIDA');

      const { rows } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM inventario_item_revision WHERE item_id = $1`,
        [items[1]!.id],
      );
      expect(Number(rows[0]?.total)).toBe(0);
    });

    it('objetar con comentario y foto → 201, autor INQUILINO y vínculo a la revisión (R6)', async () => {
      const binario = Buffer.from(
        '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
        'base64',
      );
      const respuesta = await comoInquilino(
        'post',
        `/inquilino/inventarios/${idInventario}/items/${items[1]!.id}/revision`,
      )
        .attach('archivo', binario, { filename: 'objeta.jpg', contentType: 'image/jpeg' })
        .field('respuesta', 'OBJETADO')
        .field('comentario', 'El techo presenta humedad visible.');
      expect(respuesta.status).toBe(201);

      const { rows } = await entorno.poolAdmin.query<{
        autor: string;
        revision_id: string | null;
      }>(
        `SELECT autor, revision_id FROM inventario_item_foto WHERE item_id = $1`,
        [items[1]!.id],
      );
      expect(rows[0]?.autor).toBe('INQUILINO');
      expect(rows[0]?.revision_id).not.toBeNull();
    });

    it('repetir el MISMO ítem → 400 por UNIQUE (PA-13-2)', async () => {
      const respuesta = await comoInquilino(
        'post',
        `/inquilino/inventarios/${idInventario}/items/${items[0]!.id}/revision`,
      ).send({ respuesta: 'ACEPTADO' });
      expect(respuesta.status).toBe(400);
    });

    it('revisar TODOS los ítems → revision_completada_en (R7)', async () => {
      for (const item of items.slice(2)) {
        const respuesta = await comoInquilino(
          'post',
          `/inquilino/inventarios/${idInventario}/items/${item.id}/revision`,
        ).send({ respuesta: 'ACEPTADO' });
        expect(respuesta.status).toBe(201);
      }

      const { rows } = await entorno.poolAdmin.query<{ revision_completada_en: Date | null }>(
        `SELECT revision_completada_en FROM inventario WHERE id = $1`,
        [idInventario],
      );
      expect(rows[0]?.revision_completada_en).not.toBeNull();

      // R7: el empleado (creador del inventario) recibe la notificación.
      const { rows: avisos } = await entorno.poolAdmin.query<{
        destinatario: string;
        canal: string;
      }>(
        `SELECT destinatario, canal FROM notificacion_pendiente
          WHERE contenido::text LIKE $1 ORDER BY created_at DESC LIMIT 1`,
        [`%${idInventario}%`],
      );
      expect(avisos).toHaveLength(1);
      expect(avisos[0]?.destinatario).toBe('admin-a@example.com');
      expect(avisos[0]?.canal).toBe('CORREO');
    });
  });

  // ─── T20 — scoping (R9) ──────────────────────────────────────────────────

  describe('T20 — scoping (R9)', () => {
    let tokenInquilinoB: string;
    let idInventarioB: string;

    beforeAll(async () => {
      // Un SEGUNDO inquilino del MISMO tenant con su propio inventario.
      const suf = sufijo();
      const propietarioB = await request(servidor())
        .post('/propietarios')
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A)
        .send({ nombre: `P2 ${suf}`, tipo_documento: 'CC', documento: `P2-${suf}` });
      const propiedadB = await request(servidor())
        .post('/propiedades')
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A)
        .send({
          direccion: `Calle Dos ${suf}`,
          tipo: 'APARTAMENTO',
          area: '60.00',
          canon: '1000000.00',
          propietario_principal_id: propietarioB.body.id,
        });
      const creadoB = await request(servidor())
        .post('/inventarios')
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A)
        .send({ propiedad_id: propiedadB.body.id, tipo_evento: 'ENTREGA' });
      idInventarioB = creadoB.body.id;

      const emailB = `revisor-b-${suf}@example.com`;
      const docB = `REV-B-${suf}`;
      const inquilinoB = await request(servidor())
        .post('/inquilinos')
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A)
        .send({
          nombre: `Revisor B ${suf}`,
          tipo_documento: 'CC',
          documento: docB,
          email: emailB,
          celular: `302${suf}`,
          medio_preferido_contacto: 'CORREO',
        });
      const invitacionB = await request(servidor())
        .post(`/inventarios/${idInventarioB}/invitaciones`)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A)
        .send({ perfil_inquilino_id: inquilinoB.body.id });
      const tokenB = invitacionB.body.url_invitacion.split('/').pop();

      await request(servidor()).post(`/invitaciones/${tokenB}/registro`).send({
        nombre: `Revisor B ${suf}`,
        tipo_documento: 'CC',
        documento: docB,
        password: CLAVE_DE_PRUEBA,
        email: emailB,
      });
      const loginB = await request(servidor())
        .post('/auth/login')
        .send({ codigo: CODIGO_TENANT_A, email: emailB, password: CLAVE_DE_PRUEBA });
      tokenInquilinoB = loginB.body.access_token;
    });

    it('inquilino B NO ve ni revisa el inventario de inquilino A → 404 (R9)', async () => {
      const lectura = await request(servidor())
        .get(`/inquilino/inventarios/${idInventario}`)
        .set('Authorization', `Bearer ${tokenInquilinoB}`)
        .set('x-tenant-id', TENANT_A);
      expect(lectura.status).toBe(404);

      const revision = await request(servidor())
        .post(`/inquilino/inventarios/${idInventario}/items/${items[0]!.id}/revision`)
        .set('Authorization', `Bearer ${tokenInquilinoB}`)
        .set('x-tenant-id', TENANT_A)
        .send({ respuesta: 'ACEPTADO' });
      expect(revision.status).toBe(404);

      // Nada se escribió.
      const { rows } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM inventario_item_revision r
          JOIN inventario_item i ON i.id = r.item_id
          JOIN inventario_zona z ON z.id = i.zona_id
         WHERE z.inventario_id = $1`,
        [idInventario],
      );
      expect(Number(rows[0]?.total)).toBe(items.length); // solo las de inquilino A
    });

    it('las rutas de invitación rechazan al inquilino (403, R9)', async () => {
      const respuesta = await request(servidor())
        .post(`/inventarios/${idInventarioB}/invitaciones`)
        .set('Authorization', `Bearer ${tokenInquilino}`)
        .set('x-tenant-id', TENANT_A)
        .send({ perfil_inquilino_id: '00000000-0000-0000-0000-000000000000' });
      expect(respuesta.status).toBe(403);
    });

    it('un token de otro tenant (admin B) no entra a las rutas de inquilino (403 por rol, R9)', async () => {
      const respuesta = await request(servidor())
        .get(`/inquilino/inventarios/${idInventario}`)
        .set('Authorization', `Bearer ${entorno.adminB.token}`)
        .set('x-tenant-id', TENANT_B);
      expect(respuesta.status).toBe(403);
    });

    it('sin token → 401 (R9)', async () => {
      const respuesta = await request(servidor())
        .get(`/inquilino/inventarios/${idInventario}`)
        .set('x-tenant-id', TENANT_A);
      expect(respuesta.status).toBe(401);
    });
  });
});
