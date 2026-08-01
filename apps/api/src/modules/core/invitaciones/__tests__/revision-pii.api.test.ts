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
 * Auditoría y PII de #13 (T22 → R11, R12): cada acción crítica tiene su fila
 * en `audit_log` con `entity_id` y `metadata` vacío; los tokens, códigos OTP
 * y comentarios con valores distintivos NO aparecen en el serializado.
 */
describe('Auditoría y PII de #13 (T22: R11, R12)', () => {
  let entorno: EntornoClientes;
  let minio: Awaited<ReturnType<MinioContainer['start']>>;
  let envOriginal: NodeJS.ProcessEnv;

  const SUF = Date.now().toString().slice(-6);
  const DOCUMENTO = `PII-${SUF}`;
  const EMAIL = `pii-${SUF}@example.com`;
  const COMENTARIO_PII = `COMENTARIO-PII-${SUF}-humedad`;

  beforeAll(async () => {
    envOriginal = { ...process.env };
    minio = await new MinioContainer('minio/minio:RELEASE.2024-09-13T20-26-02Z').start();
    Object.assign(process.env, {
      MINIO_ENDPOINT: minio.getHost(),
      MINIO_PORT: String(minio.getMappedPort(9000)),
      MINIO_ACCESS_KEY: minio.getUsername(),
      MINIO_SECRET_KEY: minio.getPassword(),
      MINIO_USE_SSL: 'false',
      MINIO_BUCKET: 'pii-test',
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

  it('genera filas de auditoría con entity_id y metadata vacío, sin datos PII', async () => {
    const comoAdminA = (metodo: 'post' | 'get', ruta: string) =>
      request(servidor())
        [metodo](ruta)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);

    // Propiedad + inventario + perfil + invitación.
    const propietario = await comoAdminA('post', '/propietarios').send({
      nombre: 'P PII',
      tipo_documento: 'CC',
      documento: `P-PII-${SUF}`,
    });
    const propiedad = await comoAdminA('post', '/propiedades').send({
      direccion: 'Calle PII',
      tipo: 'APARTAMENTO',
      area: '60.00',
      canon: '1000000.00',
      propietario_principal_id: propietario.body.id,
    });
    const inquilino = await comoAdminA('post', '/inquilinos').send({
      nombre: 'Inquilino PII',
      tipo_documento: 'CC',
      documento: DOCUMENTO,
      email: EMAIL,
      celular: `303${SUF}`,
      medio_preferido_contacto: 'CORREO',
    });
    const creado = await comoAdminA('post', '/inventarios').send({
      propiedad_id: propiedad.body.id,
      tipo_evento: 'ENTREGA',
    });
    const invitacion = await comoAdminA(
      'post',
      `/inventarios/${creado.body.id}/invitaciones`,
    ).send({ perfil_inquilino_id: inquilino.body.id });
    expect(invitacion.status).toBe(201);
    const token = invitacion.body.url_invitacion.split('/').pop();

    // Registro con el documento correcto (cuenta persistente).
    await request(servidor())
      .post(`/invitaciones/${token}/registro`)
      .send({
        nombre: 'Inquilino PII',
        tipo_documento: 'CC',
        documento: DOCUMENTO,
        password: CLAVE_DE_PRUEBA,
        email: EMAIL,
      });

    const login = await request(servidor())
      .post('/auth/login')
      .send({ codigo: CODIGO_TENANT_A, email: EMAIL, password: CLAVE_DE_PRUEBA });
    const tokenInquilino = login.body.access_token;

    // OTP solicitado y verificado.
    await request(servidor())
      .post('/auth/otp/solicitar')
      .set('Authorization', `Bearer ${tokenInquilino}`)
      .set('x-tenant-id', TENANT_A)
      .send({ proposito: 'FIRMA' });
    const { rows: entregas } = await entorno.poolAdmin.query<{ contenido: unknown }>(
      `SELECT contenido FROM notificacion_pendiente
        WHERE destinatario = $1 ORDER BY created_at DESC LIMIT 1`,
      [EMAIL],
    );
    const codigoClaro = (entregas[0]?.contenido as { codigo?: string }).codigo ?? '';
    await request(servidor())
      .post('/auth/otp/verificar')
      .set('Authorization', `Bearer ${tokenInquilino}`)
      .set('x-tenant-id', TENANT_A)
      .send({ codigo: codigoClaro, proposito: 'FIRMA' });

    // Revisión de un ítem con comentario distintivo.
    const ficha = await request(servidor())
      .get(`/inquilino/inventarios/${creado.body.id}`)
      .set('Authorization', `Bearer ${tokenInquilino}`)
      .set('x-tenant-id', TENANT_A);
    const itemId = ficha.body.zonas[0].items[0].id;
    await request(servidor())
      .post(`/inquilino/inventarios/${creado.body.id}/items/${itemId}/revision`)
      .set('Authorization', `Bearer ${tokenInquilino}`)
      .set('x-tenant-id', TENANT_A)
      .send({ respuesta: 'OBJETADO', comentario: COMENTARIO_PII });

    // 1) Las tres acciones críticas tienen su fila de auditoría.
    const { rows: auditoria } = await entorno.poolAdmin.query<{
      accion: string;
      entity_type: string;
      entity_id: string;
      metadata: unknown;
    }>(
      `SELECT accion, entity_type, entity_id, metadata FROM audit_log
        WHERE tenant_id = $1
          AND entity_type IN ('invitacion_inventario', 'codigo_otp', 'inventario_item_revision')
        ORDER BY created_at`,
      [TENANT_A],
    );
    const tipos = auditoria.map((r) => r.entity_type);
    expect(tipos).toEqual(
      expect.arrayContaining([
        'invitacion_inventario',
        'codigo_otp',
        'inventario_item_revision',
      ]),
    );
    for (const fila of auditoria) {
      expect(fila.entity_id).toBeTruthy();
      expect(fila.metadata).toBeNull();
    }

    // 2) Nada de PII en el serializado completo de audit_log.
    const serializado = JSON.stringify(auditoria);
    expect(serializado).not.toContain(token);
    expect(serializado).not.toContain(codigoClaro);
    expect(serializado).not.toContain(COMENTARIO_PII);
    expect(serializado).not.toContain(EMAIL);
    expect(serializado).not.toContain(DOCUMENTO);

    // 3) El token y el código NO están en la base más que como hash (R12).
    const { rows: inv } = await entorno.poolAdmin.query<{ token_hash: string }>(
      `SELECT token_hash FROM invitacion_inventario WHERE inventario_id = $1`,
      [creado.body.id],
    );
    expect(inv[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(inv[0]?.token_hash).not.toBe(token);

    const { rows: otp } = await entorno.poolAdmin.query<{ codigo_hash: string }>(
      `SELECT codigo_hash FROM codigo_otp
        WHERE user_id = (SELECT id FROM "user" WHERE email = $1)
        ORDER BY created_at DESC LIMIT 1`,
      [EMAIL],
    );
    expect(otp[0]?.codigo_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(otp[0]?.codigo_hash).not.toBe(codigoClaro);
  });
});
