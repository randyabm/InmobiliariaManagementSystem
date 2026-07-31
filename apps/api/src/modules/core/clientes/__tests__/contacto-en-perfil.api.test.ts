import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
} from '../../../../../test/support/entorno-clientes';

/**
 * **T71 y T72 — R68, R69, R71, R72**: el contacto vive en el perfil (D-9).
 *
 * ## Qué decidió el humano y por qué
 *
 * `user` conserva solo la **credencial de acceso**; el correo y el teléfono de
 * contacto son del perfil, porque son un dato *de la relación comercial* con
 * una inmobiliaria concreta. Dos inmobiliarias pueden tener datos de contacto
 * distintos del mismo propietario —uno le da su correo personal a una y el de
 * su empresa a otra— y ninguna debe pisar los de la otra. Con el contacto en
 * `user` eso era imposible de representar.
 *
 * Las aserciones sobre dónde quedó el dato se hacen con `SELECT` independientes:
 * que la respuesta HTTP traiga `email_contacto` no demuestra que `user.email`
 * haya quedado NULL, y es justamente eso lo que R71 exige.
 */
describe('El contacto vive en el perfil (#5 R68, R69, R71, R72, D-9)', () => {
  let entorno: EntornoClientes;

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const comoAdminA = (metodo: 'post' | 'get' | 'patch', ruta: string) =>
    request(entorno.app.getHttpServer())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);

  // ─── T71 — el traslado (R68, R69, R71) ──────────────────────────────────

  describe('propietario (R68, R71)', () => {
    it('el correo va a perfil_propietario.email_contacto y user.email queda NULL', async () => {
      const creado = await comoAdminA('post', '/propietarios').send({
        nombre: 'Olga Contacto',
        tipo_documento: 'CC',
        documento: 'D9-P-1',
        email: 'olga@example.com',
        telefono: '6041234567',
      });
      expect(creado.status).toBe(201);

      const { rows } = await entorno.poolAdmin.query<{
        email_contacto: string | null;
        telefono_contacto: string | null;
        email_user: string | null;
      }>(
        `SELECT p.email_contacto, p.telefono_contacto, u.email AS email_user
           FROM perfil_propietario p JOIN "user" u ON u.id = p.user_id
          WHERE p.id = $1`,
        [creado.body.id],
      );

      expect(rows[0]?.email_contacto).toBe('olga@example.com');
      expect(rows[0]?.telefono_contacto).toBe('6041234567');
      // R71: `user.email` es credencial, no contacto. Mientras el cliente no
      // tenga acceso al portal (RF-AU2/AU4) se queda NULL.
      expect(rows[0]?.email_user).toBeNull();
    });

    it('GET /propietarios/:id devuelve email_contacto y telefono_contacto', async () => {
      const creado = await comoAdminA('post', '/propietarios').send({
        nombre: 'Pablo Lectura',
        tipo_documento: 'CC',
        documento: 'D9-P-2',
        email: 'pablo@example.com',
        telefono: '6049876543',
      });

      const hoja = await comoAdminA('get', `/propietarios/${creado.body.id}`);

      expect(hoja.status).toBe(200);
      expect(hoja.body.email_contacto).toBe('pablo@example.com');
      expect(hoja.body.telefono_contacto).toBe('6049876543');
      // El contacto ya no se sirve desde `user`, así que estas claves no deben
      // reaparecer: si volvieran, habría dos fuentes de verdad.
      expect(hoja.body).not.toHaveProperty('email');
      expect(hoja.body).not.toHaveProperty('telefono');
    });

    it('un propietario SIN correo se crea con email_contacto NULL (D-5 sigue vigente)', async () => {
      const creado = await comoAdminA('post', '/propietarios').send({
        nombre: 'Quintin Sin Correo',
        tipo_documento: 'CC',
        documento: 'D9-P-3',
      });

      expect(creado.status).toBe(201);
      expect(creado.body.email_contacto).toBeNull();
      expect(creado.body.telefono_contacto).toBeNull();

      const { rows } = await entorno.poolAdmin.query<{ email_contacto: string | null }>(
        'SELECT email_contacto FROM perfil_propietario WHERE id = $1',
        [creado.body.id],
      );
      expect(rows[0]?.email_contacto).toBeNull();
    });

    it('el PATCH escribe el contacto en el perfil y NO toca `user`', async () => {
      const creado = await comoAdminA('post', '/propietarios').send({
        nombre: 'Rosa Patch',
        tipo_documento: 'CC',
        documento: 'D9-P-4',
        email: 'rosa@example.com',
      });

      const patch = await comoAdminA('patch', `/propietarios/${creado.body.id}`).send({
        email: 'rosa-nueva@example.com',
        telefono: '3001112233',
      });
      expect(patch.status).toBe(200);

      const { rows } = await entorno.poolAdmin.query<{
        email_contacto: string | null;
        telefono_contacto: string | null;
        email_user: string | null;
        telefono_user: string | null;
      }>(
        `SELECT p.email_contacto, p.telefono_contacto,
                u.email AS email_user, u.telefono AS telefono_user
           FROM perfil_propietario p JOIN "user" u ON u.id = p.user_id
          WHERE p.id = $1`,
        [creado.body.id],
      );

      expect(rows[0]?.email_contacto).toBe('rosa-nueva@example.com');
      expect(rows[0]?.telefono_contacto).toBe('3001112233');
      expect(rows[0]?.email_user).toBeNull();
      expect(rows[0]?.telefono_user).toBeNull();
    });
  });

  describe('inquilino (R69)', () => {
    const inquilinoValido = {
      nombre: 'Sara Inquilina',
      tipo_documento: 'CC' as const,
      documento: 'D9-I-1',
      email: 'sara@example.com',
      celular: '3005556677',
      medio_preferido_contacto: 'WHATSAPP' as const,
    };

    it('el correo va a perfil_inquilino.email_contacto y user.email queda NULL', async () => {
      const creado = await comoAdminA('post', '/inquilinos').send(inquilinoValido);
      expect(creado.status).toBe(201);
      expect(creado.body.email_contacto).toBe('sara@example.com');

      const { rows } = await entorno.poolAdmin.query<{
        email_contacto: string;
        email_user: string | null;
      }>(
        `SELECT p.email_contacto, u.email AS email_user
           FROM perfil_inquilino p JOIN "user" u ON u.id = p.user_id
          WHERE p.id = $1`,
        [creado.body.id],
      );

      expect(rows[0]?.email_contacto).toBe('sara@example.com');
      expect(rows[0]?.email_user).toBeNull();
    });

    it('crear un inquilino SIN correo sigue dando 400 (R19, ahora sobre el perfil)', async () => {
      for (const email of [undefined, '', null]) {
        const cuerpo: Record<string, unknown> = {
          ...inquilinoValido,
          documento: `D9-I-400-${String(email)}`,
        };
        if (email === undefined) delete cuerpo.email;
        else cuerpo.email = email;

        const respuesta = await comoAdminA('post', '/inquilinos').send(cuerpo);

        // RF-C4 exige el correo del inquilino. La opcionalidad de D-5 es solo
        // del propietario, y D-9 no la extiende: sigue siendo 400, y además
        // ahora la columna es NOT NULL, así que hay barrera en el motor.
        expect(respuesta.status, `email = ${String(email)}`).toBe(400);
      }

      const { rows } = await entorno.poolAdmin.query(
        `SELECT id FROM perfil_inquilino WHERE documento LIKE 'D9-I-400-%'`,
      );
      expect(rows).toHaveLength(0);
    });

    it('la columna email_contacto es NOT NULL en el motor (R69)', async () => {
      // `23502` = not_null_violation. El DTO puede cambiar; la columna no.
      await expect(
        entorno.poolAdmin.query(
          `INSERT INTO perfil_inquilino
             (tenant_id, user_id, tipo_documento, documento, celular, medio_preferido_contacto)
           VALUES ($1, $2, 'CC', 'D9-I-NULL', '3000000000', 'SMS')`,
          [TENANT_A, entorno.clienteSinCredenciales.id],
        ),
      ).rejects.toMatchObject({ code: '23502' });
    });
  });

  // ─── T72 — el perfil basta para notificar (R72) ─────────────────────────

  describe('el perfil basta para notificar (R72, RF-N1)', () => {
    it('una consulta SOLO al perfil de inquilino da destinatario y canal, sin JOIN a `user`', async () => {
      const creado = await comoAdminA('post', '/inquilinos').send({
        nombre: 'Tomas Notificable',
        tipo_documento: 'CC',
        documento: 'D9-N-1',
        email: 'tomas@example.com',
        celular: '3007778899',
        medio_preferido_contacto: 'CORREO',
      });
      expect(creado.status).toBe(201);

      // La consulta NO menciona `user` a propósito: es la afirmación entera.
      // El motor de notificaciones (feature #10, RF-N1) tomará el destinatario
      // de aquí y nunca de `user`, que puede tener el correo a NULL —de hecho
      // lo tiene— y en todo caso es credencial de acceso, no canal de aviso.
      const consulta = `SELECT email_contacto, celular, medio_preferido_contacto
                          FROM perfil_inquilino WHERE id = $1`;
      expect(consulta).not.toMatch(/\buser\b/);

      const { rows } = await entorno.poolAdmin.query<{
        email_contacto: string;
        celular: string;
        medio_preferido_contacto: string;
      }>(consulta, [creado.body.id]);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.medio_preferido_contacto).toBe('CORREO');

      const destinatario =
        rows[0]!.medio_preferido_contacto === 'CORREO'
          ? rows[0]!.email_contacto
          : rows[0]!.celular;
      expect(destinatario).toBe('tomas@example.com');
    });

    it.each(['SMS', 'WHATSAPP', 'LLAMADA'])(
      'con medio %s el destinatario resoluble es el celular del propio perfil',
      async (medio) => {
        const creado = await comoAdminA('post', '/inquilinos').send({
          nombre: `Notificable ${medio}`,
          tipo_documento: 'CC',
          documento: `D9-N-${medio}`,
          email: `n-${medio.toLowerCase()}@example.com`,
          celular: '3111112222',
          medio_preferido_contacto: medio,
        });
        expect(creado.status).toBe(201);

        const { rows } = await entorno.poolAdmin.query<{
          celular: string;
          medio_preferido_contacto: string;
        }>(
          `SELECT celular, medio_preferido_contacto FROM perfil_inquilino WHERE id = $1`,
          [creado.body.id],
        );

        expect(rows[0]?.medio_preferido_contacto).toBe(medio);
        expect(rows[0]?.celular).toBe('3111112222');
      },
    );

    it('el propietario también es notificable desde su solo perfil', async () => {
      const creado = await comoAdminA('post', '/propietarios').send({
        nombre: 'Ursula Notificable',
        tipo_documento: 'CC',
        documento: 'D9-N-P',
        email: 'ursula@example.com',
        telefono: '6045554433',
      });

      const { rows } = await entorno.poolAdmin.query<{
        email_contacto: string | null;
        telefono_contacto: string | null;
      }>(
        `SELECT email_contacto, telefono_contacto FROM perfil_propietario WHERE id = $1`,
        [creado.body.id],
      );

      expect(rows[0]?.email_contacto).toBe('ursula@example.com');
      expect(rows[0]?.telefono_contacto).toBe('6045554433');
    });
  });
});
