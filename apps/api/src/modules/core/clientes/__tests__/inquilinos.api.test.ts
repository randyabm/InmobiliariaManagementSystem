import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
} from '../../../../../test/support/entorno-clientes';

/**
 * CRUD del inquilino (T36 → **R18**, **R19**, **R20**, **R21**, R23, R24).
 *
 * El email **sí** es obligatorio aquí: RF-C4 lo exige explícitamente y la
 * opcionalidad de D-5 aplica solo al propietario.
 *
 * Codeudores, coarrendatarios y referencias NO son alcance de esta feature
 * (D-6): están en la feature #25.
 */
describe('Inquilinos — CRUD (#5)', () => {
  let entorno: EntornoClientes;

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const comoAdminA = (metodo: 'post' | 'get' | 'patch' | 'delete', ruta: string) =>
    request(entorno.app.getHttpServer())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);

  const inquilinoValido = {
    nombre: 'Marta Arrendataria',
    tipo_documento: 'CC',
    documento: 'I-1001',
    email: 'marta@example.com',
    celular: '3001234567',
    medio_preferido_contacto: 'WHATSAPP',
  };

  // ─── R18 — creación con los 6 campos obligatorios ───────────────────────

  it('crea el inquilino con los seis campos mínimos y responde 201 con su id (R18)', async () => {
    const respuesta = await comoAdminA('post', '/inquilinos').send(inquilinoValido);

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(respuesta.body.tenant_id).toBe(TENANT_A);
    expect(respuesta.body.celular).toBe('3001234567');
    expect(respuesta.body.medio_preferido_contacto).toBe('WHATSAPP');
    // D-9 (R69): el correo del inquilino se devuelve desde el perfil.
    expect(respuesta.body.email_contacto).toBe('marta@example.com');
    expect(respuesta.body.activo).toBe(true);

    const { rows } = await entorno.poolAdmin.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM perfil_inquilino WHERE id = $1',
      [respuesta.body.id],
    );
    expect(rows[0]?.tenant_id).toBe(TENANT_A);
  });

  it('crea la identidad y el rol `inquilino` en el tenant (R22)', async () => {
    const respuesta = await comoAdminA('post', '/inquilinos').send({
      ...inquilinoValido,
      documento: 'I-1002',
      email: 'segunda@example.com',
    });

    const { rows } = await entorno.poolAdmin.query<{ rol: string; tenant_id: string }>(
      'SELECT rol, tenant_id FROM user_role WHERE user_id = $1',
      [respuesta.body.user_id],
    );
    expect(rows).toEqual([{ rol: 'inquilino', tenant_id: TENANT_A }]);
  });

  // ─── R19 — tabla de casos de rechazo, un campo faltante por caso ────────

  describe('campos mínimos obligatorios (R19)', () => {
    const OBLIGATORIOS = [
      'nombre',
      'tipo_documento',
      'documento',
      'email',
      'celular',
      'medio_preferido_contacto',
    ] as const;

    it.each(OBLIGATORIOS)(
      'omitir %s devuelve 400 y no persiste ninguna fila',
      async (campo) => {
        const cuerpo: Record<string, unknown> = {
          ...inquilinoValido,
          documento: `I-400-${campo}`,
        };
        delete cuerpo[campo];

        const respuesta = await comoAdminA('post', '/inquilinos').send(cuerpo);

        expect(respuesta.status).toBe(400);

        const { rows } = await entorno.poolAdmin.query(
          'SELECT id FROM perfil_inquilino WHERE documento = $1',
          [`I-400-${campo}`],
        );
        expect(rows).toHaveLength(0);
      },
    );

    it('un medio_preferido_contacto fuera del enum devuelve 400 (R19)', async () => {
      const respuesta = await comoAdminA('post', '/inquilinos').send({
        ...inquilinoValido,
        documento: 'I-400-medio',
        medio_preferido_contacto: 'PALOMA_MENSAJERA',
      });

      expect(respuesta.status).toBe(400);

      const { rows } = await entorno.poolAdmin.query(
        'SELECT id FROM perfil_inquilino WHERE documento = $1',
        ['I-400-medio'],
      );
      expect(rows).toHaveLength(0);
    });

    it('el email vacío o inválido devuelve 400: D-5 no aplica al inquilino (R19)', async () => {
      for (const email of ['', null, 'no-es-un-email']) {
        const respuesta = await comoAdminA('post', '/inquilinos').send({
          ...inquilinoValido,
          documento: 'I-400-email',
          email,
        });
        expect(respuesta.status).toBe(400);
      }

      const { rows } = await entorno.poolAdmin.query(
        'SELECT id FROM perfil_inquilino WHERE documento = $1',
        ['I-400-email'],
      );
      expect(rows).toHaveLength(0);
    });

    it('el 400 no devuelve el valor rechazado (R36)', async () => {
      const respuesta = await comoAdminA('post', '/inquilinos').send({
        ...inquilinoValido,
        documento: 'I-400-fuga',
        celular: '',
      });

      expect(respuesta.status).toBe(400);
      expect(JSON.stringify(respuesta.body)).not.toContain('I-400-fuga');
      expect(respuesta.body.message).toBe('La solicitud no es válida.');
    });
  });

  // ─── R20 — PATCH parcial ────────────────────────────────────────────────

  it('el PATCH parcial cambia medio_preferido_contacto y refresca updated_at (R20)', async () => {
    const creado = await comoAdminA('post', '/inquilinos').send({
      ...inquilinoValido,
      documento: 'I-2001',
      email: 'patch@example.com',
    });
    const id = creado.body.id;

    const respuesta = await comoAdminA('patch', `/inquilinos/${id}`).send({
      medio_preferido_contacto: 'CORREO',
    });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.medio_preferido_contacto).toBe('CORREO');
    // Lo no enviado no se toca.
    expect(respuesta.body.celular).toBe('3001234567');
    expect(respuesta.body.nombre).toBe('Marta Arrendataria');

    const { rows } = await entorno.poolAdmin.query<{
      medio_preferido_contacto: string;
    }>('SELECT medio_preferido_contacto FROM perfil_inquilino WHERE id = $1', [id]);
    expect(rows[0]?.medio_preferido_contacto).toBe('CORREO');
  });

  it('el PATCH con un medio inválido devuelve 400 y no cambia nada (R19, R20)', async () => {
    const creado = await comoAdminA('post', '/inquilinos').send({
      ...inquilinoValido,
      documento: 'I-2002',
      email: 'patch2@example.com',
    });

    const respuesta = await comoAdminA('patch', `/inquilinos/${creado.body.id}`).send({
      medio_preferido_contacto: 'SEÑALES_DE_HUMO',
    });

    expect(respuesta.status).toBe(400);

    const { rows } = await entorno.poolAdmin.query<{
      medio_preferido_contacto: string;
    }>('SELECT medio_preferido_contacto FROM perfil_inquilino WHERE id = $1', [
      creado.body.id,
    ]);
    expect(rows[0]?.medio_preferido_contacto).toBe('WHATSAPP');
  });

  // ─── R21 — baja lógica ──────────────────────────────────────────────────

  it('el DELETE deja la fila con activo = false y NO la borra (R21)', async () => {
    const creado = await comoAdminA('post', '/inquilinos').send({
      ...inquilinoValido,
      documento: 'I-3001',
      email: 'baja@example.com',
    });

    const respuesta = await comoAdminA('delete', `/inquilinos/${creado.body.id}`);
    expect(respuesta.status).toBe(200);

    const { rows } = await entorno.poolAdmin.query<{ activo: boolean }>(
      'SELECT activo FROM perfil_inquilino WHERE id = $1',
      [creado.body.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.activo).toBe(false);
  });

  // ─── R23, R24 — crear si no existe ──────────────────────────────────────

  it('la búsqueda por documento y el 409 por documento repetido (R23, R24)', async () => {
    await comoAdminA('post', '/inquilinos').send({
      ...inquilinoValido,
      documento: 'I-4001',
      email: 'busqueda@example.com',
    });

    const encontrado = await comoAdminA(
      'get',
      '/inquilinos?tipo_documento=CC&documento=I-4001',
    );
    expect(encontrado.status).toBe(200);
    expect(encontrado.body).toHaveLength(1);

    const repetido = await comoAdminA('post', '/inquilinos').send({
      ...inquilinoValido,
      documento: 'I-4001',
      email: 'otro@example.com',
    });
    expect(repetido.status).toBe(409);
    expect(repetido.body.error).toBe('PERFIL_YA_EXISTE');

    const { rows } = await entorno.poolAdmin.query(
      'SELECT id FROM perfil_inquilino WHERE tenant_id = $1 AND documento = $2',
      [TENANT_A, 'I-4001'],
    );
    expect(rows).toHaveLength(1);
  });

  /**
   * §7.4 tras **D-9**: el modelo sigue admitiendo que una identidad tenga los
   * dos roles en la misma inmobiliaria (RF-C2), pero el **flujo de alta ya no
   * la deduplica**, y no por descuido.
   *
   * Antes, la deduplicación dentro del tenant se hacía por `user.email`. D-9
   * (**R71**) manda que `user.email` quede **NULL** en un cliente registrado
   * por la inmobiliaria —es credencial de acceso, no contacto—, así que no
   * queda ninguna clave por la que reconocer a la misma persona en el momento
   * del alta. `design.md` §7.3 ya lo anticipaba: *"la deduplicación de
   * identidad solo es posible cuando hay email"*.
   *
   * Consecuencia: la misma persona registrada como propietaria **y** como
   * inquilina de la misma inmobiliaria tiene hoy **dos filas de `user`** y un
   * perfil colgando de cada una. Queda anotado como decisión abierta en
   * `progress/impl_owner_tenant_profiles_cierre.md`: unificarlas exigiría una
   * deduplicación por `documento` dentro del tenant, que **ningún requirement
   * pide** y que no se ha inventado aquí.
   */
  it('el modelo admite los dos roles en una identidad, aunque el alta ya no deduplique (§7.4, D-9)', async () => {
    const propietario = await request(entorno.app.getHttpServer())
      .post('/propietarios')
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A)
      .send({
        nombre: 'Doble Rol',
        tipo_documento: 'CC',
        documento: 'D-1',
        email: 'ambos-roles@example.com',
      })
      .expect(201);

    const inquilino = await comoAdminA('post', '/inquilinos').send({
      ...inquilinoValido,
      nombre: 'Doble Rol',
      documento: 'D-1',
      email: 'ambos-roles@example.com',
    });
    expect(inquilino.status).toBe(201);

    // Hoy: dos identidades, ambas del tenant A, ambas con `email` NULL (R71).
    expect(inquilino.body.user_id).not.toBe(propietario.body.user_id);
    const { rows: identidades } = await entorno.poolAdmin.query<{
      email: string | null;
      tenant_id: string;
    }>(`SELECT email, tenant_id::text FROM "user" WHERE id = ANY($1::uuid[])`, [
      [propietario.body.user_id, inquilino.body.user_id],
    ]);
    expect(identidades).toHaveLength(2);
    expect(identidades.every((i) => i.email === null)).toBe(true);
    expect(identidades.every((i) => i.tenant_id === TENANT_A)).toBe(true);

    // Y el ESQUEMA sigue admitiendo los dos roles sobre una sola identidad,
    // que es lo que §7.4 afirma: `user_role` tiene UNIQUE(user_id, tenant_id,
    // rol), no UNIQUE(user_id, tenant_id).
    const { rowCount } = await entorno.poolAdmin.query(
      `INSERT INTO user_role (user_id, tenant_id, rol) VALUES ($1, $2, 'inquilino')`,
      [propietario.body.user_id, TENANT_A],
    );
    expect(rowCount).toBe(1);

    const { rows: roles } = await entorno.poolAdmin.query<{ rol: string }>(
      `SELECT rol FROM user_role WHERE user_id = $1 ORDER BY rol`,
      [propietario.body.user_id],
    );
    expect(roles.map((r) => r.rol)).toEqual(['inquilino', 'propietario']);
  });
});
