import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  CLAVE_DE_PRUEBA,
  CODIGO_TENANT_A,
  type EntornoClientes,
  JWT_SECRET_DE_PRUEBA,
  levantarEntornoClientes,
  TENANT_A,
  TENANT_B,
} from '../../../../../test/support/entorno-clientes';

/**
 * Ciclo de vida de las sesiones y los invariantes de #27 contra PostgreSQL
 * real y la app real (T16, T17, T19, T20, T21, T22, T23 → R6, R7, R8, R9,
 * R10, R11, R12, R13, R14, R15, R17).
 *
 * Las aserciones sobre el efecto se hacen con `SELECT` independientes, no con
 * el código de respuesta.
 */

const credencialesA = {
  codigo: CODIGO_TENANT_A,
  email: 'admin-a@example.com',
  password: CLAVE_DE_PRUEBA,
};

describe('Sesiones y revocación (#27)', () => {
  let entorno: EntornoClientes;

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();

  async function iniciarSesion(): Promise<{
    access_token: string;
    refresh_token: string;
    user_id: string;
    sesion_id: string;
  }> {
    const login = await request(servidor()).post('/auth/login').send(credencialesA);
    expect(login.status).toBe(201);

    const { rows } = await entorno.poolAdmin.query<{ id: string }>(
      `SELECT id FROM sesion WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [login.body.user.id],
    );

    return {
      access_token: login.body.access_token,
      refresh_token: login.body.refresh_token,
      user_id: login.body.user.id,
      sesion_id: rows[0]?.id ?? '',
    };
  }

  // ─── T16 — ciclo de vida (R6, R7, R9, R11) ──────────────────────────────

  describe('login, refresh y logout (R6, R7, R9, R11)', () => {
    it('el login abre una sesión real: refresh en claro solo en la respuesta, hash en la base (R6, R10)', async () => {
      const sesion = await iniciarSesion();

      expect(sesion.access_token).toBeTruthy();
      expect(sesion.refresh_token).toBeTruthy();
      expect(sesion.sesion_id).toMatch(/^[0-9a-f-]{36}$/);

      const { rows } = await entorno.poolAdmin.query<{
        refresh_token_hash: string | null;
        revocada_at: Date | null;
        user_id: string;
      }>('SELECT refresh_token_hash, revocada_at, user_id FROM sesion WHERE id = $1', [
        sesion.sesion_id,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.user_id).toBe(sesion.user_id);
      expect(rows[0]?.revocada_at).toBeNull();
      // R10: el hash SHA-256 (64 hex) — el valor en claro jamás se guarda.
      expect(rows[0]?.refresh_token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0]?.refresh_token_hash).not.toContain(sesion.refresh_token);
    });

    it('el access token emitido por login funciona (R4)', async () => {
      const sesion = await iniciarSesion();
      const me = await request(servidor())
        .get('/auth/me')
        .set('Authorization', `Bearer ${sesion.access_token}`);
      expect(me.status).toBe(200);
      expect(me.body.id).toBe(sesion.user_id);
    });

    it('el refresh rota: el access nuevo funciona y el refresh viejo ya NO (R7)', async () => {
      const sesion = await iniciarSesion();

      const refrescado = await request(servidor())
        .post('/auth/refresh')
        .send({ refresh_token: sesion.refresh_token });
      expect(refrescado.status).toBe(200);
      expect(typeof refrescado.body.access_token).toBe('string');
      expect(typeof refrescado.body.refresh_token).toBe('string');
      expect(refrescado.body.refresh_token).not.toBe(sesion.refresh_token);

      const conNuevo = await request(servidor())
        .get('/auth/me')
        .set('Authorization', `Bearer ${refrescado.body.access_token}`);
      expect(conNuevo.status).toBe(200);

      // El refresh viejo ya no sirve: su hash quedó como huella (R8 lo trata
      // como reuso → revocación completa; el 401 es el mismo).
      const conViejo = await request(servidor())
        .post('/auth/refresh')
        .send({ refresh_token: sesion.refresh_token });
      expect(conViejo.status).toBe(401);
    });

    it('el logout revoca la sesión en el servidor y el access emitido pasa a 401 (R11)', async () => {
      const sesion = await iniciarSesion();

      const logout = await request(servidor())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${sesion.access_token}`);
      expect(logout.status).toBe(200);

      const { rows } = await entorno.poolAdmin.query<{ revocada_at: Date | null; motivo_revocacion: string | null }>(
        'SELECT revocada_at, motivo_revocacion FROM sesion WHERE id = $1',
        [sesion.sesion_id],
      );
      expect(rows[0]?.revocada_at).not.toBeNull();
      expect(rows[0]?.motivo_revocacion).toBe('cierre_de_sesion');

      const despues = await request(servidor())
        .get('/auth/me')
        .set('Authorization', `Bearer ${sesion.access_token}`);
      expect(despues.status).toBe(401);
    });

    it('el refresh de una sesión revocada responde el MISMO 401 (R9)', async () => {
      const sesion = await iniciarSesion();
      await request(servidor())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${sesion.access_token}`);

      const refrescado = await request(servidor())
        .post('/auth/refresh')
        .send({ refresh_token: sesion.refresh_token });
      expect(refrescado.status).toBe(401);
      expect(refrescado.body.error).toBe('SESION_INVALIDA');
    });

    it('un refresh inexistente y uno de sesión revocada son indistinguibles (R9)', async () => {
      const inexistente = await request(servidor())
        .post('/auth/refresh')
        .send({ refresh_token: 'token-que-nunca-existio' });
      expect(inexistente.status).toBe(401);

      const sesion = await iniciarSesion();
      await request(servidor())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${sesion.access_token}`);
      const revocada = await request(servidor())
        .post('/auth/refresh')
        .send({ refresh_token: sesion.refresh_token });

      expect(inexistente.body.error).toBe('SESION_INVALIDA');
      expect(revocada.body.error).toBe('SESION_INVALIDA');
      expect(inexistente.body).not.toHaveProperty('access_token');
      expect(revocada.body).not.toHaveProperty('access_token');
    });

    it('R5 — un token firmado válido pero SIN sesión (sin jti) es 401', async () => {
      const sinJti = jwt.sign(
        { sub: entorno.adminA.id, email: 'admin-a@example.com', roles: [{ tenant_id: TENANT_A, rol: 'admin' }] },
        JWT_SECRET_DE_PRUEBA,
        { expiresIn: '1h' },
      );
      const respuesta = await request(servidor())
        .get('/auth/me')
        .set('Authorization', `Bearer ${sinJti}`);
      expect(respuesta.status).toBe(401);
      expect(respuesta.body.error).toBe('SESION_INVALIDA');
    });
  });

  // ─── T17 — reuso de refresh rotado (R8, R13) ────────────────────────────

  describe('reuso de un refresh rotado (R8, R13)', () => {
    it('reenviar el refresh viejo revoca la sesión completa y queda auditado', async () => {
      const sesion = await iniciarSesion();

      // Rotación legítima: el refresh viejo pasa a ser la huella.
      const refrescado = await request(servidor())
        .post('/auth/refresh')
        .send({ refresh_token: sesion.refresh_token });
      expect(refrescado.status).toBe(200);

      // El atacante (o el cliente desincronizado) reenvía el refresh viejo.
      const reuso = await request(servidor())
        .post('/auth/refresh')
        .send({ refresh_token: sesion.refresh_token });
      expect(reuso.status).toBe(401);

      // La sesión completa queda revocada, con motivo.
      const { rows } = await entorno.poolAdmin.query<{
        revocada_at: Date | null;
        motivo_revocacion: string | null;
      }>('SELECT revocada_at, motivo_revocacion FROM sesion WHERE id = $1', [
        sesion.sesion_id,
      ]);
      expect(rows[0]?.revocada_at).not.toBeNull();
      expect(rows[0]?.motivo_revocacion).toBe('refresh_token_reutilizado');

      // Ni el access recién rotado sirve: la sesión entera murió (R8).
      const acceso = await request(servidor())
        .get('/auth/me')
        .set('Authorization', `Bearer ${refrescado.body.access_token}`);
      expect(acceso.status).toBe(401);

      // R13: revocación auditada con actor, motivo y timestamp.
      const { rows: auditoria } = await entorno.poolAdmin.query<{
        total: string;
        actor_id: string;
        metadata: Record<string, unknown> | null;
      }>(
        `SELECT count(*)::text AS total, min(actor_id::text) AS actor_id,
                min(metadata::text)::jsonb AS metadata
           FROM audit_log
          WHERE accion = 'auth.sesion_revocada_por_reuso' AND entity_id = $1`,
        [sesion.sesion_id],
      );
      expect(Number(auditoria[0]?.total)).toBe(1);
      expect(auditoria[0]?.actor_id).toBe(sesion.user_id);
      expect(auditoria[0]?.metadata).toEqual({ motivo: 'refresh_token_reutilizado' });
    });
  });

  // ─── T19 — frontera de tenant del refresh (R14) ─────────────────────────

  describe('frontera de tenant (R14)', () => {
    it('un refresh de A nunca abre contexto en B: la rotación ocurre en el tenant de la sesión', async () => {
      const sesion = await iniciarSesion();

      const refrescado = await request(servidor())
        .post('/auth/refresh')
        .send({ refresh_token: sesion.refresh_token });
      expect(refrescado.status).toBe(200);

      // La sesión sigue perteneciendo al tenant A y su rotación se registró
      // allí (SELECT independiente, sin depender del 200).
      const { rows } = await entorno.poolAdmin.query<{ tenant_id: string }>(
        'SELECT tenant_id::text AS tenant_id FROM sesion WHERE id = $1',
        [sesion.sesion_id],
      );
      expect(rows[0]?.tenant_id).toBe(TENANT_A);

      // Y el access emitido por el refresh sigue sin tocar recursos del
      // tenant B (regresión de la frontera de #5).
      const ajeno = await request(servidor())
        .get('/propietarios')
        .set('Authorization', `Bearer ${refrescado.body.access_token}`)
        .set('x-tenant-id', TENANT_B)
        .query({ tipo_documento: 'CC', documento: 'T19-1' });
      expect(ajeno.status).toBe(403);
    });

    it('un token o sesión de A nunca da acceso a recursos de B (R14)', async () => {
      const sesion = await iniciarSesion();
      const ajeno = await request(servidor())
        .get('/propietarios')
        .set('Authorization', `Bearer ${sesion.access_token}`)
        .set('x-tenant-id', TENANT_B)
        .query({ tipo_documento: 'CC', documento: 'T19-2' });
      expect(ajeno.status).toBe(403);
    });
  });

  // ─── T20 — RBAC intacto (R15) ───────────────────────────────────────────

  describe('la validación de sesión no sustituye al RBAC (R15)', () => {
    it('un propietario con sesión válida sigue recibiendo 403 en rutas de admin', async () => {
      const respuesta = await request(servidor())
        .get('/propietarios')
        .set('Authorization', `Bearer ${entorno.propietarioA.token}`)
        .set('x-tenant-id', TENANT_A)
        .query({ tipo_documento: 'CC', documento: 'T20-1' });
      expect(respuesta.status).toBe(403);
    });

    it('401 sin token, aunque la sesión exista', async () => {
      const respuesta = await request(servidor())
        .get('/propietarios')
        .set('x-tenant-id', TENANT_A);
      expect(respuesta.status).toBe(401);
    });
  });

  // ─── T21 — revocación de rol: inmediata (R12) ───────────────────────────

  describe('revocar un rol invalida los tokens emitidos de inmediato (R12, PA-3)', () => {
    it('la siguiente petición con el access ya emitido es 401 tras revocar el rol', async () => {
      const sesion = await iniciarSesion();

      // El token ya emitido funciona ANTES de la revocación.
      const antes = await request(servidor())
        .get('/auth/me')
        .set('Authorization', `Bearer ${sesion.access_token}`);
      expect(antes.status).toBe(200);

      // Revocación del rol + incremento de versión, en la MISMA transacción
      // (R12): es el estímulo, no la afirmación.
      const cliente = await entorno.poolAdmin.connect();
      try {
        await cliente.query('BEGIN');
        await cliente.query(
          `UPDATE user_role SET activo = false WHERE user_id = $1 AND rol = 'admin'`,
          [sesion.user_id],
        );
        await cliente.query(
          `UPDATE "user" SET token_version = token_version + 1 WHERE id = $1`,
          [sesion.user_id],
        );
        await cliente.query('COMMIT');
      } finally {
        cliente.release();
      }

      // La siguiente petición con el MISMO token ya emitido es rechazada.
      const despues = await request(servidor())
        .get('/auth/me')
        .set('Authorization', `Bearer ${sesion.access_token}`);
      expect(despues.status).toBe(401);
      expect(despues.body.error).toBe('SESION_INVALIDA');
    });

    it('tras un refresh legítimo, el access nuevo ya no lleva el rol revocado (R12)', async () => {
      const sesion = await iniciarSesion();

      // Versión antes de la revocación: el refresh debe emitir exactamente
      // versión + 1 (los tests comparten la misma identidad, así que el
      // conteo absoluto no es determinista; el incremento sí lo es).
      const { rows: antesRows } = await entorno.poolAdmin.query<{ token_version: number }>(
        'SELECT token_version FROM "user" WHERE id = $1',
        [sesion.user_id],
      );
      const versionAntes = antesRows[0]?.token_version ?? 0;

      const cliente = await entorno.poolAdmin.connect();
      try {
        await cliente.query('BEGIN');
        await cliente.query(
          `UPDATE user_role SET activo = false WHERE user_id = $1 AND rol = 'admin'`,
          [sesion.user_id],
        );
        await cliente.query(
          `UPDATE "user" SET token_version = token_version + 1 WHERE id = $1`,
          [sesion.user_id],
        );
        await cliente.query('COMMIT');
      } finally {
        cliente.release();
      }

      const refrescado = await request(servidor())
        .post('/auth/refresh')
        .send({ refresh_token: sesion.refresh_token });
      expect(refrescado.status).toBe(200);

      const payload = jwt.verify(
        refrescado.body.access_token,
        JWT_SECRET_DE_PRUEBA,
      ) as { roles: Array<{ rol: string }>; ver: number };
      expect(payload.roles.map((r) => r.rol)).not.toContain('admin');
      expect(payload.ver).toBe(versionAntes + 1);

      // Sin el rol, las rutas de admin vuelven a exigir 403.
      const rutas = await request(servidor())
        .get('/propietarios')
        .set('Authorization', `Bearer ${refrescado.body.access_token}`)
        .set('x-tenant-id', TENANT_A)
        .query({ tipo_documento: 'CC', documento: 'T21-1' });
      expect(rutas.status).toBe(403);
    });
  });

  // ─── T22, T23 — auditoría y PII (R13, R17) ──────────────────────────────

  describe('auditoría de sesiones y PII (R13, R17, R10)', () => {
    it('login, refresh y logout generan exactamente una fila de auditoría cada uno (R13)', async () => {
      const desde = new Date();
      const sesion = await iniciarSesion();

      await request(servidor())
        .post('/auth/refresh')
        .send({ refresh_token: sesion.refresh_token });
      await request(servidor())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${sesion.access_token}`);

      const esperadas = [
        ['auth.sesion_abierta', sesion.sesion_id],
        ['auth.refresh_emitido', sesion.sesion_id],
        ['auth.sesion_cerrada', sesion.sesion_id],
      ] as const;

      for (const [accion, entityId] of esperadas) {
        const { rows } = await entorno.poolAdmin.query<{
          total: string;
          tenant_id: string;
          actor_id: string;
          entity_type: string;
        }>(
          `SELECT count(*)::text AS total,
                  min(tenant_id::text) AS tenant_id,
                  min(actor_id::text) AS actor_id,
                  min(entity_type) AS entity_type
             FROM audit_log
            WHERE accion = $1 AND entity_id = $2 AND created_at >= $3`,
          [accion, entityId, desde],
        );
        expect(Number(rows[0]?.total), accion).toBe(1);
        expect(rows[0]?.tenant_id).toBe(TENANT_A);
        expect(rows[0]?.actor_id).toBe(sesion.user_id);
        expect(rows[0]?.entity_type).toBe('sesion');
      }
    });

    it('el refresh en claro no aparece en la base, en la respuesta ni en logs (R10, R17)', async () => {
      const capturado: string[] = [];
      const espiaStdout = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk: unknown) => {
          capturado.push(String(chunk));
          return true;
        });
      const espiaStderr = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation((chunk: unknown) => {
          capturado.push(String(chunk));
          return true;
        });

      let refresh: string;
      try {
        const login = await request(servidor()).post('/auth/login').send(credencialesA);
        expect(login.status).toBe(201);
        refresh = login.body.refresh_token;

        const refrescado = await request(servidor())
          .post('/auth/refresh')
          .send({ refresh_token: refresh });
        expect(refrescado.status).toBe(200);
        // La respuesta solo devuelve tokens nuevos; el viejo no se repite.
        expect(JSON.stringify(refrescado.body)).not.toContain(refresh);
      } finally {
        espiaStdout.mockRestore();
        espiaStderr.mockRestore();
      }

      // 1) La base solo guarda hashes SHA-256, nunca el valor en claro.
      const { rows } = await entorno.poolAdmin.query<{ refresh_token_hash: string | null; refresh_token_hash_anterior: string | null }>(
        'SELECT refresh_token_hash, refresh_token_hash_anterior FROM sesion WHERE refresh_token_hash IS NOT NULL ORDER BY created_at DESC LIMIT 1',
      );
      expect(rows[0]?.refresh_token_hash ?? '').toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0]?.refresh_token_hash_anterior ?? '').toMatch(/^[0-9a-f]{64}$/);

      // 2) Auditoría completa (se serializa toda la fila).
      const { rows: auditoria } = await entorno.poolAdmin.query(
        `SELECT to_jsonb(audit_log) AS fila FROM audit_log`,
      );
      const jsonAuditoria = JSON.stringify(auditoria);
      expect(jsonAuditoria).not.toContain(refresh);

      // 3) Logs de la aplicación.
      const salida = capturado.join('');
      expect(salida).not.toContain(refresh);
    });
  });
});
