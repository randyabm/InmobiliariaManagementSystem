import { MinioContainer } from '@testcontainers/minio';
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
 * Invitación, registro y OTP (T16, T17, T18 → R1, R2, R3, R4, R5, R12).
 * Contra PostgreSQL y MinIO reales.
 */
describe('Invitación y OTP (#13)', () => {
  let entorno: EntornoClientes;
  let minio: Awaited<ReturnType<MinioContainer['start']>>;
  let envOriginal: NodeJS.ProcessEnv;

  let idPropiedad: string;
  let idInventario: string;
  let idPerfilInquilino: string;
  let tokenInvitacion: string;
  let emailInquilino: string;
  let documentoInquilino: string;
  let nombreInquilino: string;

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
      MINIO_BUCKET: 'invitaciones-test',
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

  // ─── T16 — generar la invitación (R1, R2, R12) ───────────────────────────

  describe('T16 — generar la invitación (R1, R2, R12)', () => {
    it('genera el token, guarda SOLO el hash y transiciona BORRADOR→ENVIADO', async () => {
      const suf = sufijo();
      const propietario = await comoAdminA('post', '/propietarios').send({
        nombre: `P Inv ${suf}`,
        tipo_documento: 'CC',
        documento: `P-INV-${suf}`,
      });
      const propiedad = await comoAdminA('post', '/propiedades').send({
        direccion: `Calle Invitación ${suf}`,
        tipo: 'APARTAMENTO',
        area: '60.00',
        canon: '1000000.00',
        propietario_principal_id: propietario.body.id,
      });
      idPropiedad = propiedad.body.id;

      // El inquilino objetivo (perfil del cliente, #5).
      emailInquilino = `invitado-${suf}@example.com`;
      documentoInquilino = `CC-INVITADO-${suf}`;
      nombreInquilino = `Invitado ${suf}`;
      const inquilino = await comoAdminA('post', '/inquilinos').send({
        nombre: nombreInquilino,
        tipo_documento: 'CC',
        documento: documentoInquilino,
        email: emailInquilino,
        celular: `300${suf}`,
        medio_preferido_contacto: 'CORREO',
      });
      expect(inquilino.status).toBe(201);
      idPerfilInquilino = inquilino.body.id;

      const creado = await comoAdminA('post', '/inventarios').send({
        propiedad_id: idPropiedad,
        tipo_evento: 'ENTREGA',
      });
      expect(creado.status).toBe(201);
      idInventario = creado.body.id;

      const invitacion = await comoAdminA('post', `/inventarios/${idInventario}/invitaciones`).send({
        perfil_inquilino_id: idPerfilInquilino,
      });
      expect(invitacion.status).toBe(201);
      expect(invitacion.body.url_invitacion).toMatch(/^\/invitaciones\/[A-Za-z0-9_-]{64}$/);
      tokenInvitacion = invitacion.body.url_invitacion.split('/').pop();

      // Inventario ENVIADO y asignado al perfil (R2, R9).
      const { rows } = await entorno.poolAdmin.query<{
        estado: string;
        perfil_inquilino_id: string;
      }>(`SELECT estado, perfil_inquilino_id FROM inventario WHERE id = $1`, [idInventario]);
      expect(rows[0]?.estado).toBe('ENVIADO');
      expect(rows[0]?.perfil_inquilino_id).toBe(idPerfilInquilino);

      // La base guarda el hash (64 hex), nunca el token en claro (R12).
      const { rows: inv } = await entorno.poolAdmin.query<{ token_hash: string }>(
        `SELECT token_hash FROM invitacion_inventario WHERE inventario_id = $1`,
        [idInventario],
      );
      expect(inv[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(inv[0]?.token_hash).not.toBe(tokenInvitacion);
    });

    it('repetir la invitación con el inventario ya ENVIADO → 409 sin cambiar nada (R2)', async () => {
      const repetida = await comoAdminA('post', `/inventarios/${idInventario}/invitaciones`).send({
        perfil_inquilino_id: idPerfilInquilino,
      });
      expect(repetida.status).toBe(409);
      expect(repetida.body.error).toBe('INVENTARIO_NO_ENVIABLE');

      const { rows } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM invitacion_inventario WHERE inventario_id = $1`,
        [idInventario],
      );
      expect(Number(rows[0]?.total)).toBe(1);
    });

    it('perfil de otro tenant o inexistente → 404 (R9)', async () => {
      const creado = await comoAdminA('post', '/inventarios').send({
        propiedad_id: idPropiedad,
        tipo_evento: 'DEVOLUCION',
      });
      expect(creado.status).toBe(201);
      const respuesta = await comoAdminA('post', `/inventarios/${creado.body.id}/invitaciones`).send({
        perfil_inquilino_id: '00000000-0000-0000-0000-000000000000',
      });
      expect(respuesta.status).toBe(404);
      await comoAdminA('delete', `/inventarios/${creado.body.id}`);
    });
  });

  // ─── T17 — bootstrap (R3, R12) ───────────────────────────────────────────

  describe('T17 — bootstrap (R3, R12)', () => {
    it('GET /invitaciones/:token devuelve el mínimo sin datos sensibles', async () => {
      const respuesta = await request(servidor()).get(`/invitaciones/${tokenInvitacion}`);
      expect(respuesta.status).toBe(200);
      expect(respuesta.body.inventario_id).toBe(idInventario);
      expect(respuesta.body.propiedad_direccion).toMatch(/^Calle Invitación/);
      expect(respuesta.body.estado).toBe('ENVIADO');
      expect(respuesta.body.inquilino_nombre).toBe(nombreInquilino);
      // Sin tokens, sin hashes, sin datos de cuenta.
      expect(JSON.stringify(respuesta.body)).not.toMatch(/token|hash|password|sesion/i);
    });

    it('token inexistente → 401 uniforme', async () => {
      const respuesta = await request(servidor()).get('/invitaciones/token-inexistente-0000000000000000000000000000000000000000');
      expect(respuesta.status).toBe(401);
      expect(respuesta.body.error).toBe('INVITACION_INVALIDA');
    });

    it('invitación expirada → 401 uniforme (R12: sin distinguir motivo)', async () => {
      await entorno.poolAdmin.query(
        `UPDATE invitacion_inventario SET expira_en = now() - interval '1 hour'
          WHERE inventario_id = $1`,
        [idInventario],
      );
      const respuesta = await request(servidor()).get(`/invitaciones/${tokenInvitacion}`);
      expect(respuesta.status).toBe(401);

      // Restaurar para el resto de la suite.
      await entorno.poolAdmin.query(
        `UPDATE invitacion_inventario SET expira_en = now() + interval '72 hours'
          WHERE inventario_id = $1`,
        [idInventario],
      );
    });
  });

  // ─── T18 — registro y OTP (R3, R4, R5) ───────────────────────────────────

  describe('T18 — registro con OTP (R3, R4, R5, PA-13-1)', () => {
    let tokenAcceso: string;

    it('registro con documento de OTRO inquilino → 401 uniforme (R3)', async () => {
      const respuesta = await request(servidor())
        .post(`/invitaciones/${tokenInvitacion}/registro`)
        .send({
          nombre: nombreInquilino,
          tipo_documento: 'CC',
          documento: 'CC-AJENO-99999',
          password: CLAVE_DE_PRUEBA,
          email: emailInquilino,
        });
      expect(respuesta.status).toBe(401);
    });

    it('registro con documento correcto crea la cuenta persistente y solicita OTP', async () => {
      const respuesta = await request(servidor())
        .post(`/invitaciones/${tokenInvitacion}/registro`)
        .send({
          nombre: nombreInquilino,
          tipo_documento: 'CC',
          documento: documentoInquilino,
          password: CLAVE_DE_PRUEBA,
          email: emailInquilino,
        });
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.otp_solicitado).toBe(true);

      // Cuenta persistente: user con hash, rol inquilino (SELECT).
      const { rows: usuario } = await entorno.poolAdmin.query<{
        email: string | null;
        password_hash: string | null;
      }>(`SELECT email, password_hash FROM "user" WHERE email = $1`, [emailInquilino]);
      expect(usuario).toHaveLength(1);
      expect(usuario[0]?.password_hash).toMatch(/^\$2[aby]\$/);

      const { rows: rol } = await entorno.poolAdmin.query<{ rol: string }>(
        `SELECT rol FROM user_role
          WHERE user_id = (SELECT id FROM "user" WHERE email = $1) AND rol = 'inquilino'`,
        [emailInquilino],
      );
      expect(rol).toHaveLength(1);

      // La invitación quedó usada (una sola vez, R3).
      const { rows: inv } = await entorno.poolAdmin.query<{ usada_en: Date | null }>(
        `SELECT usada_en FROM invitacion_inventario WHERE inventario_id = $1`,
        [idInventario],
      );
      expect(inv[0]?.usada_en).not.toBeNull();

      // El OTP está en la base SOLO como hash (R12) y la entrega en el outbox
      // lleva el código en claro (PA-13-3).
      const { rows: otp } = await entorno.poolAdmin.query<{ codigo_hash: string }>(
        `SELECT codigo_hash FROM codigo_otp
          WHERE user_id = (SELECT id FROM "user" WHERE email = $1)`,
        [emailInquilino],
      );
      expect(otp[0]?.codigo_hash).toMatch(/^[0-9a-f]{64}$/);

      const { rows: entregas } = await entorno.poolAdmin.query<{ contenido: unknown }>(
        `SELECT contenido FROM notificacion_pendiente
          WHERE destinatario = $1 ORDER BY created_at DESC LIMIT 1`,
        [emailInquilino],
      );
      const contenido = entregas[0]?.contenido as { codigo?: string };
      expect(contenido?.codigo).toMatch(/^\d{6}$/);
    });

    it('login estándar funciona con la contraseña (#27) y el OTP se verifica', async () => {
      const login = await request(servidor())
        .post('/auth/login')
        .send({ codigo: CODIGO_TENANT_A, email: emailInquilino, password: CLAVE_DE_PRUEBA });
      expect(login.status).toBe(201);
      tokenAcceso = login.body.access_token;
      expect(tokenAcceso).toBeTruthy();

      // Solicitar un OTP de REGISTRO desde la sesión (R4).
      const solicitar = await request(servidor())
        .post('/auth/otp/solicitar')
        .set('Authorization', `Bearer ${tokenAcceso}`)
        .set('x-tenant-id', TENANT_A)
        .send({ proposito: 'REGISTRO' });
      expect(solicitar.status).toBe(201);

      const { rows: otp } = await entorno.poolAdmin.query<{ codigo_hash: string }>(
        `SELECT codigo_hash FROM codigo_otp
          WHERE user_id = (SELECT id FROM "user" WHERE email = $1)
          ORDER BY created_at DESC LIMIT 1`,
        [emailInquilino],
      );
      const { rows: entregas } = await entorno.poolAdmin.query<{ contenido: unknown }>(
        `SELECT contenido FROM notificacion_pendiente
          WHERE destinatario = $1 ORDER BY created_at DESC LIMIT 1`,
        [emailInquilino],
      );
      const codigoClaro = (entregas[0]?.contenido as { codigo?: string }).codigo ?? '';

      // Código MALO → 401 uniforme, sin distinguir (R5, R12).
      const malo = await request(servidor())
        .post('/auth/otp/verificar')
        .set('Authorization', `Bearer ${tokenAcceso}`)
        .set('x-tenant-id', TENANT_A)
        .send({ codigo: '000000', proposito: 'REGISTRO' });
      expect(malo.status).toBe(401);
      expect(malo.body.error).toBe('OTP_INVALIDO');

      // El OTP malo no marcó nada.
      const { rows: sinVerificar } = await entorno.poolAdmin.query<{ verificado_en: Date | null }>(
        `SELECT verificado_en FROM codigo_otp WHERE codigo_hash = $1`,
        [otp[0]?.codigo_hash],
      );
      expect(sinVerificar[0]?.verificado_en).toBeNull();

      // Código BUENO → 200 y marcado como verificado (R5).
      const bueno = await request(servidor())
        .post('/auth/otp/verificar')
        .set('Authorization', `Bearer ${tokenAcceso}`)
        .set('x-tenant-id', TENANT_A)
        .send({ codigo: codigoClaro, proposito: 'REGISTRO' });
      expect(bueno.status).toBe(201);

      const { rows: verificado } = await entorno.poolAdmin.query<{ verificado_en: Date | null }>(
        `SELECT verificado_en FROM codigo_otp WHERE codigo_hash = $1`,
        [otp[0]?.codigo_hash],
      );
      expect(verificado[0]?.verificado_en).not.toBeNull();
    });
  });
});
