import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
  TENANT_B,
} from '../../../../../test/support/entorno-clientes';

/**
 * **T13, T14, T15, T17, T18, T31 — R1, R2, R3, R4, R7, R8, R9, R13, R14, R22,
 * R28.**
 *
 * El escenario que da nombre a la feature #26: quien es propietario **e**
 * inquilino de la misma inmobiliaria es **una** persona con **una** credencial,
 * dos roles y dos perfiles con contactos independientes.
 *
 * ## Cómo se afirma
 *
 * Contra PostgreSQL real (Testcontainers) y con la aplicación corriendo con el
 * **rol sin `BYPASSRLS`** que provisiona `asegurarRolDeAplicacion`
 * (`levantarEntornoClientes`). Las afirmaciones sobre lo que quedó escrito se
 * hacen con `SELECT` independientes y **nunca** con el código de estado ni con
 * el cuerpo de la respuesta: que un POST devuelva 409 no demuestra que no haya
 * escrito nada, y es justamente eso lo que R7 y R9 exigen.
 *
 * Este archivo no crea ningún objeto de esquema (`tests/ddl-en-tests.test.ts`).
 */
describe('Identidad única por inmobiliaria (#26 bloque A)', () => {
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

  const comoAdminB = (metodo: 'post' | 'get' | 'patch', ruta: string) =>
    request(entorno.app.getHttpServer())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.adminB.token}`)
      .set('x-tenant-id', TENANT_B);

  /** Estado persistido de una persona, leído sin pasar por la API. */
  async function identidadesConDocumento(tenantId: string, documento: string) {
    const { rows } = await entorno.poolAdmin.query<{
      id: string;
      email: string | null;
      password_hash: string | null;
      nombre: string;
      tenant_id: string;
    }>(
      `SELECT id, email, password_hash, nombre, tenant_id::text
         FROM "user"
        WHERE tenant_id = $1 AND tipo_documento = 'CC' AND documento = $2
        ORDER BY created_at`,
      [tenantId, documento],
    );
    return rows;
  }

  async function rolesDe(userId: string) {
    const { rows } = await entorno.poolAdmin.query<{
      rol: string;
      activo: boolean;
      tenant_id: string;
    }>(
      `SELECT rol, activo, tenant_id::text FROM user_role
        WHERE user_id = $1 ORDER BY rol`,
      [userId],
    );
    return rows;
  }

  // ─── T13 — una sola identidad, una sola credencial (R1..R4) ─────────────

  describe('T13 — propietario e inquilino son una sola identidad', () => {
    const DOCUMENTO = 'MR-1000';

    it('el segundo alta reutiliza la identidad y solo añade el rol', async () => {
      const propietario = await comoAdminA('post', '/propietarios').send({
        nombre: 'Ana Multirol',
        tipo_documento: 'CC',
        documento: DOCUMENTO,
        email: 'ana.propietaria@example.com',
        telefono: '6041110000',
      });
      expect(propietario.status).toBe(201);

      const inquilino = await comoAdminA('post', '/inquilinos').send({
        nombre: 'Ana Multirol',
        tipo_documento: 'CC',
        documento: DOCUMENTO,
        email: 'ana.inquilina@example.com',
        celular: '3001110000',
        medio_preferido_contacto: 'WHATSAPP',
      });
      expect(inquilino.status).toBe(201);

      // R1/R2: UNA fila de `user`, no dos.
      const identidades = await identidadesConDocumento(TENANT_A, DOCUMENTO);
      expect(identidades).toHaveLength(1);
      expect(inquilino.body.user_id).toBe(propietario.body.user_id);
      expect(identidades[0]?.id).toBe(propietario.body.user_id);

      // R3: los dos roles, ambos activos, en esta inmobiliaria.
      expect(await rolesDe(identidades[0]!.id)).toEqual([
        { rol: 'inquilino', activo: true, tenant_id: TENANT_A },
        { rol: 'propietario', activo: true, tenant_id: TENANT_A },
      ]);

      // R5: el documento es atributo de la identidad, no solo del perfil.
      const { rows: doc } = await entorno.poolAdmin.query<{
        tipo_documento: string;
        documento: string;
      }>('SELECT tipo_documento, documento FROM "user" WHERE id = $1', [
        identidades[0]!.id,
      ]);
      expect(doc[0]).toEqual({ tipo_documento: 'CC', documento: DOCUMENTO });
    });

    it('los dos perfiles existen y cuelgan de la misma identidad', async () => {
      const identidades = await identidadesConDocumento(TENANT_A, DOCUMENTO);
      const userId = identidades[0]!.id;

      const { rows } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT ((SELECT count(*) FROM perfil_propietario WHERE user_id = $1)
               + (SELECT count(*) FROM perfil_inquilino  WHERE user_id = $1))::text AS total`,
        [userId],
      );
      expect(Number(rows[0]?.total)).toBe(2);
    });

    it('una sola credencial: el segundo alta no crea ni pisa password_hash (R4)', async () => {
      // Es lo que hace que esta persona sea "una sola persona" en la
      // inmobiliaria. Si el alta del inquilino hubiera escrito credenciales,
      // habría dos formas de entrar a los mismos datos.
      const identidades = await identidadesConDocumento(TENANT_A, DOCUMENTO);

      expect(identidades).toHaveLength(1);
      expect(identidades[0]?.password_hash).toBeNull();
      // R71 de la #5 sigue vigente: `user.email` es credencial, no contacto.
      expect(identidades[0]?.email).toBeNull();
      expect(identidades[0]?.nombre).toBe('Ana Multirol');
    });
  });

  // ─── T14 — contactos independientes por perfil (R8) ─────────────────────

  describe('T14 — cada perfil conserva su propio contacto (R8)', () => {
    it('el correo y el teléfono de cada rol son distintos y ninguno pisa al otro', async () => {
      // Desde D-9 el contacto vive en el PERFIL, no en la identidad, y cada rol
      // tiene el suyo. Que la propietaria declare un correo y la inquilina otro
      // es un estado legítimo, no una divergencia a reconciliar.
      const identidades = await identidadesConDocumento(TENANT_A, 'MR-1000');
      const userId = identidades[0]!.id;

      const { rows: propietario } = await entorno.poolAdmin.query<{
        email_contacto: string | null;
        telefono_contacto: string | null;
      }>(
        'SELECT email_contacto, telefono_contacto FROM perfil_propietario WHERE user_id = $1',
        [userId],
      );
      const { rows: inquilino } = await entorno.poolAdmin.query<{
        email_contacto: string;
        celular: string;
        medio_preferido_contacto: string;
      }>(
        `SELECT email_contacto, celular, medio_preferido_contacto
           FROM perfil_inquilino WHERE user_id = $1`,
        [userId],
      );

      expect(propietario[0]?.email_contacto).toBe('ana.propietaria@example.com');
      expect(propietario[0]?.telefono_contacto).toBe('6041110000');
      expect(inquilino[0]?.email_contacto).toBe('ana.inquilina@example.com');
      expect(inquilino[0]?.celular).toBe('3001110000');
      expect(inquilino[0]?.medio_preferido_contacto).toBe('WHATSAPP');
    });

    it('el nombre de la identidad no lo sobrescribe el segundo alta (R4)', async () => {
      const identidades = await identidadesConDocumento(TENANT_A, 'MR-1000');
      expect(identidades[0]?.nombre).toBe('Ana Multirol');
    });
  });

  // ─── T31 — el 409 por nombre discrepante (R9, R27, R28) ─────────────────

  describe('T31 — nombre discrepante bloquea el alta y dice qué corregir', () => {
    const DOCUMENTO = 'MR-2000';
    let userIdExistente: string;

    it('(a) alta con nombre distinto → 409 NOMBRE_NO_COINCIDE_CON_IDENTIDAD', async () => {
      const propietario = await comoAdminA('post', '/propietarios').send({
        nombre: 'María Pérez',
        tipo_documento: 'CC',
        documento: DOCUMENTO,
        email: 'maria.p@example.com',
      });
      expect(propietario.status).toBe(201);
      userIdExistente = propietario.body.user_id;

      // "Maria Perez" sin tildes NO coincide con "María Pérez" (R27, PA-5.1):
      // decisión explícita del humano, y la causa más frecuente de este 409.
      const inquilino = await comoAdminA('post', '/inquilinos').send({
        nombre: 'Maria Perez',
        tipo_documento: 'CC',
        documento: DOCUMENTO,
        email: 'maria.i@example.com',
        celular: '3002220000',
        medio_preferido_contacto: 'CORREO',
      });

      expect(inquilino.status).toBe(409);
      expect(inquilino.body.error).toBe('NOMBRE_NO_COINCIDE_CON_IDENTIDAD');
    });

    it('(a) el cuerpo trae user_id, nombre_registrado y nombre_recibido (R28)', async () => {
      const inquilino = await comoAdminA('post', '/inquilinos').send({
        nombre: 'Maria Perez',
        tipo_documento: 'CC',
        documento: DOCUMENTO,
        email: 'maria.i@example.com',
        celular: '3002220000',
        medio_preferido_contacto: 'CORREO',
      });

      // Sin estos tres datos el empleado queda bloqueado sin saber qué ficha
      // corregir: la fricción de R9 solo es asumible si el error es accionable.
      expect(inquilino.body.user_id).toBe(userIdExistente);
      expect(inquilino.body.nombre_registrado).toBe('María Pérez');
      expect(inquilino.body.nombre_recibido).toBe('Maria Perez');
    });

    it('(a) el 409 no revela el documento, ni en el cuerpo ni en el mensaje', async () => {
      // Ley 1581 de 2012: quien recibe este error acaba de teclear el documento.
      const inquilino = await comoAdminA('post', '/inquilinos').send({
        nombre: 'Maria Perez',
        tipo_documento: 'CC',
        documento: DOCUMENTO,
        email: 'maria.i@example.com',
        celular: '3002220000',
        medio_preferido_contacto: 'CORREO',
      });

      expect(JSON.stringify(inquilino.body)).not.toContain(DOCUMENTO);
    });

    it('(a) NO se escribió nada: verificado con SELECT, no con el código', async () => {
      // El código de estado dice qué contestó la API, no qué quedó en la base.
      const identidades = await identidadesConDocumento(TENANT_A, DOCUMENTO);
      expect(identidades).toHaveLength(1);
      expect(identidades[0]?.id).toBe(userIdExistente);

      expect(await rolesDe(userIdExistente)).toEqual([
        { rol: 'propietario', activo: true, tenant_id: TENANT_A },
      ]);

      const { rows } = await entorno.poolAdmin.query<{ total: string }>(
        'SELECT count(*)::text AS total FROM perfil_inquilino WHERE user_id = $1',
        [userIdExistente],
      );
      expect(Number(rows[0]?.total)).toBe(0);
    });

    it('(b) corregida la ficha existente, el alta pasa y deduplica', async () => {
      // El camino de salida que R28 promete: un PATCH al perfil existente y a
      // reintentar, sin salir a buscar nada.
      const { rows: perfiles } = await entorno.poolAdmin.query<{ id: string }>(
        'SELECT id FROM perfil_propietario WHERE user_id = $1',
        [userIdExistente],
      );
      const corregido = await comoAdminA(
        'patch',
        `/propietarios/${perfiles[0]!.id}`,
      ).send({ nombre: 'Maria Perez' });
      expect(corregido.status).toBe(200);

      const inquilino = await comoAdminA('post', '/inquilinos').send({
        nombre: 'Maria Perez',
        tipo_documento: 'CC',
        documento: DOCUMENTO,
        email: 'maria.i@example.com',
        celular: '3002220000',
        medio_preferido_contacto: 'CORREO',
      });

      expect(inquilino.status).toBe(201);
      expect(inquilino.body.user_id).toBe(userIdExistente);
      expect(await identidadesConDocumento(TENANT_A, DOCUMENTO)).toHaveLength(1);
      expect(await rolesDe(userIdExistente)).toEqual([
        { rol: 'inquilino', activo: true, tenant_id: TENANT_A },
        { rol: 'propietario', activo: true, tenant_id: TENANT_A },
      ]);
    });

    it('los espacios y las mayúsculas sí se absorben (R27)', async () => {
      const DOC = 'MR-2100';
      const propietario = await comoAdminA('post', '/propietarios').send({
        nombre: 'Jorge  RESTREPO',
        tipo_documento: 'CC',
        documento: DOC,
      });
      expect(propietario.status).toBe(201);

      const inquilino = await comoAdminA('post', '/inquilinos').send({
        nombre: 'jorge restrepo',
        tipo_documento: 'CC',
        documento: DOC,
        email: 'jorge@example.com',
        celular: '3002220001',
        medio_preferido_contacto: 'SMS',
      });

      expect(inquilino.status).toBe(201);
      expect(inquilino.body.user_id).toBe(propietario.body.user_id);
    });
  });

  // ─── T15 — el 409 por perfil repetido se conserva (R7) ──────────────────

  describe('T15 — ser propietario dos veces sigue siendo un error (R7)', () => {
    const DOCUMENTO = 'MR-3000';

    it('el segundo alta del MISMO rol responde 409 PERFIL_YA_EXISTE', async () => {
      const primero = await comoAdminA('post', '/propietarios').send({
        nombre: 'Luis Repetido',
        tipo_documento: 'CC',
        documento: DOCUMENTO,
      });
      expect(primero.status).toBe(201);

      const segundo = await comoAdminA('post', '/propietarios').send({
        nombre: 'Luis Repetido',
        tipo_documento: 'CC',
        documento: DOCUMENTO,
      });

      expect(segundo.status).toBe(409);
      expect(segundo.body.error).toBe('PERFIL_YA_EXISTE');
    });

    it('y no crea ni modifica ninguna fila: verificado con SELECT', async () => {
      // R1/R2 deduplican la IDENTIDAD, no el PERFIL. Que la identidad se
      // reutilice no puede convertir un alta duplicada en un no-op silencioso.
      const identidades = await identidadesConDocumento(TENANT_A, DOCUMENTO);
      expect(identidades).toHaveLength(1);

      const { rows } = await entorno.poolAdmin.query<{ total: string }>(
        'SELECT count(*)::text AS total FROM perfil_propietario WHERE user_id = $1',
        [identidades[0]!.id],
      );
      expect(Number(rows[0]?.total)).toBe(1);

      expect(await rolesDe(identidades[0]!.id)).toEqual([
        { rol: 'propietario', activo: true, tenant_id: TENANT_A },
      ]);
    });
  });

  // ─── T17 — la frontera D-8 (R14, R22) ───────────────────────────────────

  describe('T17 — la reutilización entre inmobiliarias sigue prohibida (R14)', () => {
    const DOCUMENTO = 'MR-4000';

    it('la misma persona en A y en B produce DOS identidades distintas', async () => {
      const enA = await comoAdminA('post', '/propietarios').send({
        nombre: 'Sofía Dos Agencias',
        tipo_documento: 'CC',
        documento: DOCUMENTO,
        email: 'sofia-a@example.com',
      });
      const enB = await comoAdminB('post', '/propietarios').send({
        nombre: 'Sofía Dos Agencias',
        tipo_documento: 'CC',
        documento: DOCUMENTO,
        email: 'sofia-b@example.com',
      });

      expect(enA.status).toBe(201);
      expect(enB.status).toBe(201);
      expect(enB.body.user_id).not.toBe(enA.body.user_id);

      const identidadA = await identidadesConDocumento(TENANT_A, DOCUMENTO);
      const identidadB = await identidadesConDocumento(TENANT_B, DOCUMENTO);
      expect(identidadA).toHaveLength(1);
      expect(identidadB).toHaveLength(1);
      expect(identidadA[0]?.tenant_id).toBe(TENANT_A);
      expect(identidadB[0]?.tenant_id).toBe(TENANT_B);
    });

    it('la respuesta de B no contiene ningún dato de A (R22)', async () => {
      // Ni el `user_id`, ni el correo, ni el id de perfil: confirmar que esa
      // persona ya es cliente de otra agencia es la fuga que prohíbe el PRD
      // §11.3, y basta un identificador para confirmarlo.
      const identidadA = (await identidadesConDocumento(TENANT_A, DOCUMENTO))[0]!;
      const { rows: perfilA } = await entorno.poolAdmin.query<{ id: string }>(
        'SELECT id FROM perfil_propietario WHERE user_id = $1',
        [identidadA.id],
      );

      const enB = await comoAdminB('post', '/propietarios').send({
        nombre: 'Sofía Dos Agencias',
        tipo_documento: 'CC',
        documento: 'MR-4001',
        email: 'sofia-b2@example.com',
      });

      const cuerpo = JSON.stringify(enB.body);
      expect(cuerpo).not.toContain(identidadA.id);
      expect(cuerpo).not.toContain(perfilA[0]!.id);
      expect(cuerpo).not.toContain('sofia-a@example.com');
    });

    it('un nombre distinto en la otra inmobiliaria NO dispara el 409 de R9', async () => {
      // Es la prueba de que la comparación de nombres tampoco cruza la
      // frontera: si consultara fuera del tenant, este alta fallaría con 409 y
      // revelaría por la puerta de atrás que esa persona ya existe en A.
      const enB = await comoAdminB('post', '/propietarios').send({
        nombre: 'Nombre Completamente Distinto',
        tipo_documento: 'CC',
        documento: 'MR-4002',
        email: 'otro-b@example.com',
      });
      expect(enB.status).toBe(201);

      const enA = await comoAdminA('post', '/propietarios').send({
        nombre: 'Nada Que Ver',
        tipo_documento: 'CC',
        documento: 'MR-4002',
        email: 'otro-a@example.com',
      });

      expect(enA.status).toBe(201);
      expect(enA.body.user_id).not.toBe(enB.body.user_id);
    });
  });

  // ─── T18 — auditoría de la reutilización (R13) ──────────────────────────

  describe('T18 — la reutilización de identidad se audita (R13)', () => {
    const DOCUMENTO = 'MR-5000';
    let userId: string;

    beforeAll(async () => {
      const propietario = await comoAdminA('post', '/propietarios').send({
        nombre: 'Elena Auditada',
        tipo_documento: 'CC',
        documento: DOCUMENTO,
      });
      userId = propietario.body.user_id;

      await comoAdminA('post', '/inquilinos').send({
        nombre: 'Elena Auditada',
        tipo_documento: 'CC',
        documento: DOCUMENTO,
        email: 'elena@example.com',
        celular: '3005550000',
        medio_preferido_contacto: 'CORREO',
      });
    });

    async function entradas() {
      const { rows } = await entorno.poolAdmin.query<{
        tenant_id: string;
        actor_id: string | null;
        entity_type: string;
        entity_id: string | null;
        metadata: Record<string, unknown> | null;
      }>(
        `SELECT tenant_id::text, actor_id::text, entity_type, entity_id::text, metadata
           FROM audit_log WHERE accion = 'identidad.rol_anadido' AND entity_id = $1`,
        [userId],
      );
      return rows;
    }

    it('existe la entrada `identidad.rol_anadido` con tenant, actor y user_id', async () => {
      const filas = await entradas();

      expect(filas).toHaveLength(1);
      expect(filas[0]?.tenant_id).toBe(TENANT_A);
      expect(filas[0]?.actor_id).toBe(entorno.adminA.id);
      expect(filas[0]?.entity_type).toBe('user');
      expect(filas[0]?.entity_id).toBe(userId);
      expect(filas[0]?.metadata).toEqual({ rol: 'inquilino' });
    });

    it('el metadata NO contiene el documento (Ley 1581 de 2012)', async () => {
      const filas = await entradas();
      expect(JSON.stringify(filas[0]?.metadata)).not.toContain(DOCUMENTO);
    });

    it('crear una identidad NUEVA no genera esta entrada', async () => {
      // Se audita lo excepcional —una credencial que gana un rol nuevo—, no
      // cada alta: el `@Audit` del controlador ya registra `crear`.
      const nuevo = await comoAdminA('post', '/propietarios').send({
        nombre: 'Primera Vez',
        tipo_documento: 'CC',
        documento: 'MR-5001',
      });

      const { rows } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM audit_log
          WHERE accion = 'identidad.rol_anadido' AND entity_id = $1`,
        [nuevo.body.user_id],
      );
      expect(Number(rows[0]?.total)).toBe(0);
    });
  });
});
