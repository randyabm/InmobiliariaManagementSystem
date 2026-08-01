import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
} from '../../../../../test/support/entorno-clientes';

/**
 * Codeudores y coarrendatarios del inquilino — integración y fronteras D-6
 * (T19, T20, T21 → R12, R13, R14, R15, R16, R17, R18).
 *
 * Contra PostgreSQL real (Testcontainers) y la app NestJS real. Las
 * aserciones sobre el efecto se hacen con `SELECT` independientes, no con el
 * código de respuesta.
 */
describe('Codeudores y referencias — integración (#25)', () => {
  let entorno: EntornoClientes;
  let idInquilino: string;

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();

    const creado = await request(entorno.app.getHttpServer())
      .post('/inquilinos')
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A)
      .send({
        nombre: 'Inquilino Con Anexos',
        tipo_documento: 'CC',
        documento: '3010',
        email: 'anexos@example.com',
        celular: '3001112222',
        medio_preferido_contacto: 'WHATSAPP',
      });
    expect(creado.status).toBe(201);
    idInquilino = creado.body.id;
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();

  const comoAdminA = (metodo: 'post' | 'get' | 'patch' | 'delete', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);

  // ─── T19 — CRUD de codeudores (R12, R13, R14) ──────────────────────────

  describe('CRUD de codeudores (R12, R13, R14)', () => {
    it('registra un codeudor y responde 201 con su id (R12)', async () => {
      const respuesta = await comoAdminA(
        'post',
        `/inquilinos/${idInquilino}/codeudores`,
      ).send({
        tipo: 'CODEUDOR',
        nombre: 'Luis Fernando Mejía',
        tipo_documento: 'CC',
        documento: '4010',
        email: 'luis@example.com',
        celular: '3102223344',
      });

      expect(respuesta.status).toBe(201);
      expect(respuesta.body.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(respuesta.body.perfil_inquilino_id).toBe(idInquilino);
      expect(respuesta.body.tipo).toBe('CODEUDOR');
      expect(respuesta.body.activo).toBe(true);

      const { rows } = await entorno.poolAdmin.query<{
        tenant_id: string;
        documento: string;
      }>(
        'SELECT tenant_id, documento FROM codeudor_inquilino WHERE id = $1',
        [respuesta.body.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenant_id).toBe(TENANT_A);
      expect(rows[0]?.documento).toBe('4010');
    });

    it('rechaza con 409 CODEUDOR_YA_EXISTE el documento repetido en el MISMO inquilino y no crea fila (R14)', async () => {
      const respuesta = await comoAdminA(
        'post',
        `/inquilinos/${idInquilino}/codeudores`,
      ).send({
        tipo: 'COARRENDATARIO',
        nombre: 'Luis Fernando Mejía (duplicado)',
        tipo_documento: 'CC',
        documento: '4010',
      });

      expect(respuesta.status).toBe(409);
      expect(respuesta.body.error).toBe('CODEUDOR_YA_EXISTE');

      const { rows } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM codeudor_inquilino
          WHERE perfil_inquilino_id = $1 AND tipo_documento = 'CC' AND documento = '4010'`,
        [idInquilino],
      );
      expect(Number(rows[0]?.total)).toBe(1);
    });

    it('permite el MISMO documento en otro inquilino del mismo tenant (D-7, R2)', async () => {
      const segundo = await request(servidor())
        .post('/inquilinos')
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A)
        .send({
          nombre: 'Otro Inquilino',
          tipo_documento: 'CC',
          documento: '3011',
          email: 'otro@example.com',
          celular: '3003334444',
          medio_preferido_contacto: 'CORREO',
        });
      expect(segundo.status).toBe(201);

      const respuesta = await comoAdminA(
        'post',
        `/inquilinos/${segundo.body.id}/codeudores`,
      ).send({
        tipo: 'CODEUDOR',
        nombre: 'Luis Fernando Mejía',
        tipo_documento: 'CC',
        documento: '4010',
      });

      expect(respuesta.status).toBe(201);
    });

    it('PATCH parcial actualiza y lo persiste (R13)', async () => {
      const creado = await comoAdminA(
        'post',
        `/inquilinos/${idInquilino}/codeudores`,
      ).send({
        tipo: 'CODEUDOR',
        nombre: 'Rosa Pacheco',
        tipo_documento: 'CE',
        documento: '4020',
        celular: '3111112222',
      });
      expect(creado.status).toBe(201);

      const respuesta = await comoAdminA(
        'patch',
        `/inquilinos/${idInquilino}/codeudores/${creado.body.id}`,
      ).send({ nombre: 'Rosa Pacheco Gómez', celular: '3112223333' });

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.nombre).toBe('Rosa Pacheco Gómez');
      expect(respuesta.body.celular).toBe('3112223333');

      const { rows } = await entorno.poolAdmin.query<{ nombre: string }>(
        'SELECT nombre FROM codeudor_inquilino WHERE id = $1',
        [creado.body.id],
      );
      expect(rows[0]?.nombre).toBe('Rosa Pacheco Gómez');
    });

    it('DELETE es baja lógica: la fila queda con activo = false y desaparece del listado (R13)', async () => {
      const creado = await comoAdminA(
        'post',
        `/inquilinos/${idInquilino}/codeudores`,
      ).send({
        tipo: 'CODEUDOR',
        nombre: 'Baja Lógica',
        tipo_documento: 'CC',
        documento: '4030',
      });
      expect(creado.status).toBe(201);

      const respuesta = await comoAdminA(
        'delete',
        `/inquilinos/${idInquilino}/codeudores/${creado.body.id}`,
      );
      expect(respuesta.status).toBe(200);

      const { rows } = await entorno.poolAdmin.query<{ activo: boolean }>(
        'SELECT activo FROM codeudor_inquilino WHERE id = $1',
        [creado.body.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.activo).toBe(false);

      const listado = await comoAdminA('get', `/inquilinos/${idInquilino}/codeudores`);
      expect(listado.status).toBe(200);
      expect(
        listado.body.some((c: { id: string }) => c.id === creado.body.id),
      ).toBe(false);
    });

    it('un inquilino inexistente produce 404, no 201 ni 500 (R19)', async () => {
      const inexistente = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      const respuesta = await comoAdminA(
        'post',
        `/inquilinos/${inexistente}/codeudores`,
      ).send({
        tipo: 'CODEUDOR',
        nombre: 'Fantasma',
        tipo_documento: 'CC',
        documento: '9999',
      });
      expect(respuesta.status).toBe(404);
    });
  });

  // ─── T20 — frontera de comportamiento (R17) ─────────────────────────────

  it('registra codeudor y referencia SIN que exista contrato, firma ni inventario (R17)', async () => {
    // La feature #12 ya creó las tablas `inventario*`, pero el invariante se
    // mantiene: ninguna FK de codeudores/referencias puede exigir contrato,
    // firma ni inventario. Si algún día alguien añade una FK que las exija,
    // este test deja de ser verde por construcción — y T21 lo señala antes.
    const { rows: dependencias } = await entorno.poolAdmin.query<{ conname: string }>(
      `SELECT conname
         FROM pg_constraint c
        WHERE c.contype = 'f'
          AND (
            (EXISTS (SELECT 1 FROM pg_class r
                      WHERE r.oid = c.conrelid
                        AND r.relname IN ('codeudor_inquilino', 'referencia_inquilino'))
             AND EXISTS (SELECT 1 FROM pg_class r
                          WHERE r.oid = c.confrelid
                            AND r.relname ~ 'contrato|firma|inventario|otp'))
            OR
            (EXISTS (SELECT 1 FROM pg_class r
                      WHERE r.oid = c.confrelid
                        AND r.relname IN ('codeudor_inquilino', 'referencia_inquilino'))
             AND EXISTS (SELECT 1 FROM pg_class r
                          WHERE r.oid = c.conrelid
                            AND r.relname ~ 'contrato|firma|inventario|otp'))
          )`,
    );
    expect(dependencias).toEqual([]);

    const codeudor = await comoAdminA(
      'post',
      `/inquilinos/${idInquilino}/codeudores`,
    ).send({
      tipo: 'CODEUDOR',
      nombre: 'Sin Contrato',
      tipo_documento: 'CC',
      documento: '4040',
    });
    expect(codeudor.status).toBe(201);

    const referencia = await comoAdminA(
      'post',
      `/inquilinos/${idInquilino}/referencias`,
    ).send({
      nombre: 'Referencia Sin Contrato',
      telefono: '3121112233',
      relacion: 'Amiga del trabajo',
    });
    expect(referencia.status).toBe(201);
  });

  // ─── T21 — frontera estructural (R18) ────────────────────────────────────

  it('ninguna FK de codeudor_inquilino ni referencia_inquilino apunta a contrato, firma, inventario u OTP (R18)', async () => {
    const { rows } = await entorno.poolAdmin.query<{
      table_name: string;
      referenciada: string;
    }>(
      `SELECT tc.table_name, ccu.table_name AS referenciada
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name
          AND kcu.table_schema = tc.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        WHERE tc.table_schema = 'public'
          AND tc.table_name IN ('codeudor_inquilino', 'referencia_inquilino')
          AND tc.constraint_type = 'FOREIGN KEY'`,
    );

    const prohibidas = rows.filter((r) =>
      /contrato|firma|inventario|otp/i.test(r.referenciada),
    );
    expect(prohibidas).toEqual([]);
  });
});
