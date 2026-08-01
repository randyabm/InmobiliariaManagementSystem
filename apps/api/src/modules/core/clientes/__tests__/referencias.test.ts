import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
} from '../../../../../test/support/entorno-clientes';

/**
 * Referencias personales del inquilino — integración (T19 → R15, R16).
 *
 * Contra PostgreSQL real (Testcontainers) y la app NestJS real. Las
 * aserciones sobre el efecto se hacen con `SELECT` independientes.
 */
describe('Referencias del inquilino — integración (#25)', () => {
  let entorno: EntornoClientes;
  let idInquilino: string;

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();

    const creado = await request(entorno.app.getHttpServer())
      .post('/inquilinos')
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A)
      .send({
        nombre: 'Inquilino Con Referencias',
        tipo_documento: 'CC',
        documento: '3050',
        email: 'referencias@example.com',
        celular: '3005556666',
        medio_preferido_contacto: 'SMS',
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

  // ─── T19 — CRUD de referencias (R15, R16) ──────────────────────────────

  it('registra una referencia con relacion libre y responde 201 con su id (R15)', async () => {
    const respuesta = await comoAdminA(
      'post',
      `/inquilinos/${idInquilino}/referencias`,
    ).send({
      nombre: 'María Fernanda Gómez',
      telefono: '3124445566',
      relacion: 'Hermana',
      email: 'maria.ref@example.com',
    });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(respuesta.body.perfil_inquilino_id).toBe(idInquilino);
    expect(respuesta.body.relacion).toBe('Hermana');
    expect(respuesta.body.activo).toBe(true);

    const { rows } = await entorno.poolAdmin.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM referencia_inquilino WHERE id = $1',
      [respuesta.body.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenant_id).toBe(TENANT_A);
  });

  it('admite una referencia sin relacion ni email (R3: texto libre, nullable)', async () => {
    const respuesta = await comoAdminA(
      'post',
      `/inquilinos/${idInquilino}/referencias`,
    ).send({
      nombre: 'Vecino De Confianza',
      telefono: '3130001111',
    });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.relacion).toBeNull();
    expect(respuesta.body.email).toBeNull();
  });

  it('PATCH parcial actualiza y lo persiste (R16)', async () => {
    const creado = await comoAdminA(
      'post',
      `/inquilinos/${idInquilino}/referencias`,
    ).send({
      nombre: 'Rolando Díaz',
      telefono: '3132223333',
    });
    expect(creado.status).toBe(201);

    const respuesta = await comoAdminA(
      'patch',
      `/inquilinos/${idInquilino}/referencias/${creado.body.id}`,
    ).send({ telefono: '3139998888', relacion: 'Ex compañero de trabajo' });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.telefono).toBe('3139998888');
    expect(respuesta.body.relacion).toBe('Ex compañero de trabajo');

    const { rows } = await entorno.poolAdmin.query<{ telefono: string }>(
      'SELECT telefono FROM referencia_inquilino WHERE id = $1',
      [creado.body.id],
    );
    expect(rows[0]?.telefono).toBe('3139998888');
  });

  it('DELETE es baja lógica: la fila queda con activo = false y desaparece del listado (R16)', async () => {
    const creado = await comoAdminA(
      'post',
      `/inquilinos/${idInquilino}/referencias`,
    ).send({ nombre: 'Baja Referencia', telefono: '3141112222' });
    expect(creado.status).toBe(201);

    const respuesta = await comoAdminA(
      'delete',
      `/inquilinos/${idInquilino}/referencias/${creado.body.id}`,
    );
    expect(respuesta.status).toBe(200);

    const { rows } = await entorno.poolAdmin.query<{ activo: boolean }>(
      'SELECT activo FROM referencia_inquilino WHERE id = $1',
      [creado.body.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.activo).toBe(false);

    const listado = await comoAdminA('get', `/inquilinos/${idInquilino}/referencias`);
    expect(listado.status).toBe(200);
    expect(
      listado.body.some((r: { id: string }) => r.id === creado.body.id),
    ).toBe(false);
  });

  it('un inquilino inexistente produce 404, no 201 ni 500 (R19)', async () => {
    const inexistente = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    const respuesta = await comoAdminA(
      'post',
      `/inquilinos/${inexistente}/referencias`,
    ).send({ nombre: 'Fantasma', telefono: '3150000000' });
    expect(respuesta.status).toBe(404);
  });

  it('rechaza con 400 una referencia sin telefono (R3: campo obligatorio)', async () => {
    const respuesta = await comoAdminA(
      'post',
      `/inquilinos/${idInquilino}/referencias`,
    ).send({ nombre: 'Sin Teléfono' });
    expect(respuesta.status).toBe(400);

    const { rows } = await entorno.poolAdmin.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM referencia_inquilino
        WHERE perfil_inquilino_id = $1 AND nombre = 'Sin Teléfono'`,
      [idInquilino],
    );
    expect(Number(rows[0]?.total)).toBe(0);
  });
});
