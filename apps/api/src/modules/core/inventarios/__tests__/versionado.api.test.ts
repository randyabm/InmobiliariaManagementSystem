import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
} from '../../../../../test/support/entorno-clientes';

/**
 * Versionado de la negociación (T8–T11 → R1–R4, RF-I6).
 */
describe('Versionado de la negociación (#22)', () => {
  let entorno: EntornoClientes;
  let idPropiedad: string;
  let idInventario: string;

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
    const servidor = () => entorno.app.getHttpServer();
    const comoAdminA = (metodo: 'post' | 'get' | 'patch', ruta: string) =>
      request(servidor())
        [metodo](ruta)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);

    const suf = Date.now().toString().slice(-6);
    const propietario = await comoAdminA('post', '/propietarios').send({
      nombre: `P Ver ${suf}`,
      tipo_documento: 'CC',
      documento: `PV-${suf}`,
    });
    const propiedad = await comoAdminA('post', '/propiedades').send({
      direccion: `Calle Ver ${suf}`,
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
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();
  const comoAdminA = (metodo: 'post' | 'get' | 'patch', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);

  // ─── R1, R2 — negociar y versionar ──────────────────────────────────────

  describe('R1, R2 — negociar y versionar', () => {
    it('BORRADOR no se puede negociar → 409', async () => {
      const respuesta = await comoAdminA('post', `/inventarios/${idInventario}/negociar`);
      expect(respuesta.status).toBe(409);
    });

    it('EN_REVISION → versión 1 y EN_NEGOCIACION; segunda ronda → versión 2', async () => {
      await entorno.poolAdmin.query(
        `UPDATE inventario SET estado = 'EN_REVISION',
                revision_completada_en = now()
          WHERE id = $1`,
        [idInventario],
      );
      const primera = await comoAdminA('post', `/inventarios/${idInventario}/negociar`);
      expect(primera.status).toBe(201);
      expect(primera.body.version).toBe(1);
      expect(primera.body.snapshot_json).toBeDefined();

      const { rows } = await entorno.poolAdmin.query<{ estado: string }>(
        `SELECT estado FROM inventario WHERE id = $1`,
        [idInventario],
      );
      expect(rows[0]?.estado).toBe('EN_NEGOCIACION');

      const segunda = await comoAdminA('post', `/inventarios/${idInventario}/negociar`);
      expect(segunda.status).toBe(201);
      expect(segunda.body.version).toBe(2);
    });
  });

  // ─── R3 — acuerdo desde EN_NEGOCIACION ──────────────────────────────────

  describe('R3 — acuerdo desde la negociación', () => {
    it('confirmar-acuerdo en EN_NEGOCIACION → ACORDADO', async () => {
      const respuesta = await comoAdminA('post', `/inventarios/${idInventario}/confirmar-acuerdo`);
      expect(respuesta.status).toBe(201);
      const { rows } = await entorno.poolAdmin.query<{ estado: string }>(
        `SELECT estado FROM inventario WHERE id = $1`,
        [idInventario],
      );
      expect(rows[0]?.estado).toBe('ACORDADO');
    });
  });

  // ─── R4 — historial ─────────────────────────────────────────────────────

  describe('R4 — historial', () => {
    it('GET /inventarios/:id/versiones lista 1 y 2 en orden', async () => {
      const respuesta = await comoAdminA('get', `/inventarios/${idInventario}/versiones`);
      expect(respuesta.status).toBe(200);
      expect(respuesta.body.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    });

    it('inventario ajeno → 404; sin token → 401', async () => {
      const ajeno = await comoAdminA(
        'get',
        '/inventarios/00000000-0000-0000-0000-000000000000/versiones',
      );
      expect(ajeno.status).toBe(404);

      const sinToken = await request(servidor())
        .get(`/inventarios/${idInventario}/versiones`)
        .set('x-tenant-id', TENANT_A);
      expect(sinToken.status).toBe(401);
    });
  });
});
