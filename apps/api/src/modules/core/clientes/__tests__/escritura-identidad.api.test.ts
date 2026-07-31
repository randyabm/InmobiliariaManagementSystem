import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
  TENANT_B,
} from '../../../../../test/support/entorno-clientes';

/**
 * **T52 — R38**: toda escritura sobre `user` va acotada al tenant.
 *
 * Origen: hallazgo **B1** de `progress/review_owner_tenant_profiles.md`. El
 * `UPDATE "user" … WHERE id = $N` del PATCH no llevaba **ninguna** condición de
 * tenant, así que un `user_id` que apuntase a la identidad de otra
 * inmobiliaria se reescribía sin que nada lo impidiera.
 *
 * ## Cómo se construye el caso, y por qué así
 *
 * Con **D-8** las identidades nunca se comparten: cada inmobiliaria tiene su
 * propia fila de `user` para una misma persona. El escenario del defecto es,
 * por tanto, una **resolución equivocada**: un perfil del tenant A cuyo
 * `user_id` apunta a la identidad del tenant B. Se siembra directamente con el
 * pool privilegiado —no por HTTP— porque ninguna ruta puede producirlo: es
 * exactamente el estado corrupto contra el que la condición defiende.
 *
 * Las dos identidades son **homónimas** (misma persona física, dos
 * inmobiliarias) y tienen **correos distintos**: sembrar el mismo correo en dos
 * tenants no es representable hasta que el login sepa en qué inmobiliaria entra
 * (T57), y `design.md` §20.5 lo prohíbe expresamente antes de esa task.
 *
 * La aserción de que nada cambió se hace con un `SELECT` independiente: un 404
 * por sí solo no demuestra que la fila no se haya tocado antes de responder.
 */
describe('Escritura sobre `user` acotada al tenant (#5 R38, B1)', () => {
  let entorno: EntornoClientes;

  /** Perfil del tenant A cuyo `user_id` apunta —mal— a la identidad de B. */
  let perfilConIdentidadAjena = '';
  /** La identidad del tenant B que ese perfil señala. */
  let identidadDeB = '';
  /** Perfil sano del tenant A, para el caso positivo. */
  let perfilPropio = '';
  let identidadPropia = '';

  const NOMBRE_ORIGINAL_EN_B = 'Marta Homonima';
  const EMAIL_EN_B = 'marta-en-b@example.com';
  const TELEFONO_EN_B = '6042223344';

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();

    // 1) La identidad de la misma persona en el tenant B, con SU correo.
    const { rows: usuariosB } = await entorno.poolAdmin.query<{ id: string }>(
      `INSERT INTO "user" (email, password_hash, nombre, telefono)
       VALUES ($1, NULL, $2, $3) RETURNING id`,
      [EMAIL_EN_B, NOMBRE_ORIGINAL_EN_B, TELEFONO_EN_B],
    );
    identidadDeB = usuariosB[0]!.id;
    await entorno.poolAdmin.query(
      `INSERT INTO user_role (user_id, tenant_id, rol) VALUES ($1, $2, 'propietario')`,
      [identidadDeB, TENANT_B],
    );

    // 2) Un perfil del tenant A que apunta a esa identidad ajena.
    const { rows: perfiles } = await entorno.poolAdmin.query<{ id: string }>(
      `INSERT INTO perfil_propietario (tenant_id, user_id, tipo_documento, documento)
       VALUES ($1, $2, 'CC', 'B1-CRUZADO') RETURNING id`,
      [TENANT_A, identidadDeB],
    );
    perfilConIdentidadAjena = perfiles[0]!.id;

    // 3) Un propietario sano del tenant A, creado por la vía normal.
    const propio = await request(entorno.app.getHttpServer())
      .post('/propietarios')
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A)
      .send({
        nombre: 'Propio De A',
        tipo_documento: 'CC',
        documento: 'B1-PROPIO',
        email: 'propio-de-a@example.com',
      })
      .expect(201);
    perfilPropio = propio.body.id;
    identidadPropia = propio.body.user_id;
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();

  const comoAdminA = (metodo: 'patch', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);

  it('el PATCH del tenant A sobre una identidad del tenant B responde 404', async () => {
    const respuesta = await comoAdminA(
      'patch',
      `/propietarios/${perfilConIdentidadAjena}`,
    ).send({ nombre: 'Nombre Robado', telefono: '3000000000' });

    // 404 y no 409 ni 403: R39 quedó eliminado por D-8 y confirmar que la
    // identidad existe en otra inmobiliaria sería la fuga que R31 prohíbe.
    expect(respuesta.status).toBe(404);
  });

  it('ninguna columna de esa identidad ajena cambió (verificado con SELECT)', async () => {
    const { rows } = await entorno.poolAdmin.query<{
      nombre: string;
      email: string | null;
      telefono: string | null;
    }>('SELECT nombre, email, telefono FROM "user" WHERE id = $1', [identidadDeB]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.nombre).toBe(NOMBRE_ORIGINAL_EN_B);
    expect(rows[0]?.email).toBe(EMAIL_EN_B);
    expect(rows[0]?.telefono).toBe(TELEFONO_EN_B);
  });

  it('el PATCH sobre la identidad propia SÍ actualiza', async () => {
    const respuesta = await comoAdminA('patch', `/propietarios/${perfilPropio}`).send({
      nombre: 'Propio Renombrado',
    });

    expect(respuesta.status).toBe(200);

    const { rows } = await entorno.poolAdmin.query<{ nombre: string }>(
      'SELECT nombre FROM "user" WHERE id = $1',
      [identidadPropia],
    );
    expect(rows[0]?.nombre).toBe('Propio Renombrado');
  });

  it('el PATCH que solo toca el perfil no se confunde con una identidad ajena', async () => {
    // `actualizarContacto` devuelve `null` (no `0`) cuando no hay contacto que
    // escribir: sin esa distinción, todo PATCH de solo-perfil daría 404.
    const respuesta = await comoAdminA('patch', `/propietarios/${perfilPropio}`).send({
      ciudad: 'Manizales',
    });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.ciudad).toBe('Manizales');
  });
});
