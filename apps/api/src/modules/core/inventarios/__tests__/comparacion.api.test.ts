import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
} from '../../../../../test/support/entorno-clientes';

/**
 * Comparación entrada vs salida (T8–T10 → R1, R2, R3, RF-I10).
 */
describe('Comparación de inventarios (#21)', () => {
  let entorno: EntornoClientes;
  let idPropiedad: string;
  let idEntrada: string;
  let idSalida: string;
  let itemParedes: { id: string; nombre: string };

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
      nombre: `P Comp ${suf}`,
      tipo_documento: 'CC',
      documento: `PC-${suf}`,
    });
    const propiedad = await comoAdminA('post', '/propiedades').send({
      direccion: `Calle Comp ${suf}`,
      tipo: 'APARTAMENTO',
      area: '60.00',
      canon: '1000000.00',
      propietario_principal_id: propietario.body.id,
    });
    idPropiedad = propiedad.body.id;

    const entrada = await comoAdminA('post', '/inventarios').send({
      propiedad_id: idPropiedad,
      tipo_evento: 'ENTREGA',
    });
    idEntrada = entrada.body.id;
    itemParedes = entrada.body.zonas[0].items[0];
    await comoAdminA('patch', `/inventarios/${idEntrada}/items/${itemParedes.id}`).send({
      estado_checklist: 'BUENO',
    });

    const salida = await comoAdminA('post', '/inventarios').send({
      propiedad_id: idPropiedad,
      tipo_evento: 'DEVOLUCION',
    });
    idSalida = salida.body.id;
    // El mismo ítem (mismo plantilla_item_id) con estado distinto.
    const itemSalida = salida.body.zonas[0].items.find(
      (i: { nombre: string }) => i.nombre === itemParedes.nombre,
    );
    await comoAdminA('patch', `/inventarios/${idSalida}/items/${itemSalida.id}`).send({
      estado_checklist: 'MALO',
      comentario: 'Grieta en el muro norte.',
    });
    // Una zona con ítem que no existe en la salida (ausente).
    const sotano = await comoAdminA('post', `/inventarios/${idEntrada}/zonas`).send({
      nombre: 'Sótano',
      repetible: false,
      orden: 99,
    });
    await comoAdminA(
      'post',
      `/inventarios/${idEntrada}/zonas/${sotano.body.id}/items`,
    ).send({ nombre: 'Humedad', field_type: 'estado' });
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

  // ─── R1 — comparar ──────────────────────────────────────────────────────

  describe('R1 — comparar (RF-I10)', () => {
    it('detecta el ítem diferente (BUENO vs MALO) con sus comentarios', async () => {
      const respuesta = await comoAdminA(
        'get',
        `/inventarios/${idEntrada}/comparar/${idSalida}`,
      );
      expect(respuesta.status).toBe(200);
      expect(respuesta.body.total_entrada).toBeGreaterThan(0);
      expect(respuesta.body.diferentes).toBeGreaterThanOrEqual(1);

      const detalle = respuesta.body.zonas
        .flatMap((z: { items: Array<Record<string, unknown>> }) => z.items)
        .find((i: { nombre: string }) => i.nombre === itemParedes.nombre);
      expect(detalle).toBeDefined();
      expect(detalle.veredicto).toBe('diferente');
      expect(detalle.entrada).toBe('BUENO');
      expect(detalle.salida).toBe('MALO');
      expect(detalle.comentario_salida).toContain('Grieta');
    });

    it('la zona sin pareja en la salida aparece como ausente', async () => {
      const respuesta = await comoAdminA(
        'get',
        `/inventarios/${idEntrada}/comparar/${idSalida}`,
      );
      const sotano = respuesta.body.zonas.find((z: { zona: string }) => z.zona === 'Sótano');
      expect(sotano).toBeDefined();
      expect(sotano.items[0].veredicto).toBe('ausente_en_salida');
    });

    it('mismo inventario → 400; inventario ajeno → 404', async () => {
      const mismo = await comoAdminA('get', `/inventarios/${idEntrada}/comparar/${idEntrada}`);
      expect(mismo.status).toBe(400);

      const ajeno = await comoAdminA(
        'get',
        `/inventarios/${idEntrada}/comparar/00000000-0000-0000-0000-000000000000`,
      );
      expect(ajeno.status).toBe(404);
    });
  });

  // ─── R2 — solo lectura ──────────────────────────────────────────────────

  describe('R2 — solo lectura', () => {
    it('la comparación no escribe nada (ni estados ni auditoría)', async () => {
      const antes = await entorno.poolAdmin.query<{ estado: string }>(
        `SELECT estado FROM inventario WHERE id = $1`,
        [idEntrada],
      );
      await comoAdminA('get', `/inventarios/${idEntrada}/comparar/${idSalida}`);
      const despues = await entorno.poolAdmin.query<{ estado: string }>(
        `SELECT estado FROM inventario WHERE id = $1`,
        [idEntrada],
      );
      expect(despues.rows[0]?.estado).toBe(antes.rows[0]?.estado);

      const { rows: auditoria } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM audit_log
          WHERE tenant_id = $1 AND entity_type = 'inventario'
            AND accion NOT IN ('crear')`,
        [TENANT_A],
      );
      // Solo las ediciones de items de la preparación (PATCH), no la
      // comparación: se verifica que no haya accion 'comparar'.
      const { rows: comparaciones } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM audit_log WHERE accion = 'comparar'`,
      );
      expect(Number(comparaciones[0]?.total)).toBe(0);
      void auditoria;
    });
  });

  // ─── R3 — seguridad ─────────────────────────────────────────────────────

  describe('R3 — seguridad', () => {
    it('401 sin token', async () => {
      const respuesta = await request(servidor())
        .get(`/inventarios/${idEntrada}/comparar/${idSalida}`)
        .set('x-tenant-id', TENANT_A);
      expect(respuesta.status).toBe(401);
    });
  });
});
