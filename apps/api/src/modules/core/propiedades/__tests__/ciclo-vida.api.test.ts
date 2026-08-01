import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
} from '../../../../../test/support/entorno-clientes';

/**
 * Ciclo de vida desde la ficha (T11, T12, T13 → R4, R5, R6, R7).
 *
 * La máquina es la sembrada por el motor (#7): recorrerla por la ruta de
 * negocio de #8 valida que la envoltura no duplica la lógica del motor.
 */
describe('Ciclo de vida de la propiedad (#8)', () => {
  let entorno: EntornoClientes;

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();

  const comoAdminA = (metodo: 'post' | 'get', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);

  async function crearPropiedad(sufijo: string): Promise<string> {
    const prop = await comoAdminA('post', '/propietarios').send({
      nombre: `Prop CV ${sufijo}`,
      tipo_documento: 'CC',
      documento: `CV8-${sufijo}`,
    });
    const creada = await comoAdminA('post', '/propiedades').send({
      direccion: `Calle CV ${sufijo}`,
      tipo: 'APARTAMENTO',
      area: '60.00',
      canon: '1200000.00',
      propietario_principal_id: prop.body.id,
    });
    expect(creada.status).toBe(201);
    return creada.body.id as string;
  }

  // ─── T11 — consultar y ejecutar por clave (R4, R5, R6, R7) ──────────────

  describe('T11 — consultar y ejecutar (R4, R5, R6)', () => {
    it('GET ciclo-vida: estado disponible y la acción iniciar_checkeo disponible (R4)', async () => {
      const idPropiedad = await crearPropiedad('A');

      const respuesta = await comoAdminA('get', `/propiedades/${idPropiedad}/ciclo-vida`);
      expect(respuesta.status).toBe(200);
      expect(respuesta.body.estado.clave).toBe('disponible');
      const claves = respuesta.body.transiciones_disponibles.map(
        (t: { clave: string }) => t.clave,
      );
      expect(claves).toContain('iniciar_checkeo');
      expect(claves).not.toContain('arrendar');
    });

    it('ejecutar iniciar_checkeo por clave → en_checkeo, con log del motor (R5, R7)', async () => {
      const idPropiedad = await crearPropiedad('B');

      const ejecutada = await comoAdminA(
        'post',
        `/propiedades/${idPropiedad}/ciclo-vida/transiciones/iniciar_checkeo`,
      ).send({});
      expect(ejecutada.status).toBe(200);
      expect(ejecutada.body.propiedad_id).toBe(idPropiedad);
      expect(ejecutada.body.instancia.estado_actual_id).toBeTruthy();

      // SELECT independiente: la instancia está en en_checkeo y el log tiene
      // una fila (R7: el log del motor).
      const { rows: estado } = await entorno.poolAdmin.query<{ clave: string }>(
        `SELECT e.clave
           FROM workflow_instancia i
           JOIN workflow_estado e ON e.id = i.estado_actual_id
          WHERE i.entidad_tipo = 'propiedad' AND i.entidad_id = $1`,
        [idPropiedad],
      );
      expect(estado[0]?.clave).toBe('en_checkeo');

      const { rows: log } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total
           FROM workflow_transicion_log l
           JOIN workflow_instancia i ON i.id = l.instancia_id
          WHERE i.entidad_tipo = 'propiedad' AND i.entidad_id = $1`,
        [idPropiedad],
      );
      expect(Number(log[0]?.total)).toBe(1);
    });

    it('una transición de otro estado es 409 y no cambia nada (R6)', async () => {
      const idPropiedad = await crearPropiedad('C');

      const respuesta = await comoAdminA(
        'post',
        `/propiedades/${idPropiedad}/ciclo-vida/transiciones/arrendar`,
      ).send({});
      expect(respuesta.status).toBe(409);
      expect(respuesta.body.error).toBe('TRANSICION_NO_DISPONIBLE');

      const { rows: estado } = await entorno.poolAdmin.query<{ clave: string }>(
        `SELECT e.clave
           FROM workflow_instancia i
           JOIN workflow_estado e ON e.id = i.estado_actual_id
          WHERE i.entidad_tipo = 'propiedad' AND i.entidad_id = $1`,
        [idPropiedad],
      );
      expect(estado[0]?.clave).toBe('disponible');

      const { rows: log } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total
           FROM workflow_transicion_log l
           JOIN workflow_instancia i ON i.id = l.instancia_id
          WHERE i.entidad_tipo = 'propiedad' AND i.entidad_id = $1`,
        [idPropiedad],
      );
      expect(Number(log[0]?.total)).toBe(0);
    });

    it('una clave inexistente es 409 indistinguible (R5)', async () => {
      const idPropiedad = await crearPropiedad('D');
      const respuesta = await comoAdminA(
        'post',
        `/propiedades/${idPropiedad}/ciclo-vida/transiciones/no_existe`,
      ).send({});
      expect(respuesta.status).toBe(409);
      expect(respuesta.body.error).toBe('TRANSICION_NO_DISPONIBLE');
    });
  });

  // ─── T12 — la rama condicional desde la propiedad (R5) ──────────────────

  describe('T12 — rama condicional (R5)', () => {
    async function hastaEnDesocupacion(idPropiedad: string): Promise<void> {
      for (const clave of [
        'iniciar_checkeo',
        'enviar_aseguradora',
        'arrendar',
        'iniciar_desocupacion',
      ]) {
        const respuesta = await comoAdminA(
          'post',
          `/propiedades/${idPropiedad}/ciclo-vida/transiciones/${clave}`,
        ).send({});
        expect(respuesta.status, clave).toBe(200);
      }
    }

    it('cerrar_entrega_ok con entrega_ok=true → disponible (R5)', async () => {
      const idPropiedad = await crearPropiedad('E');
      await hastaEnDesocupacion(idPropiedad);

      const respuesta = await comoAdminA(
        'post',
        `/propiedades/${idPropiedad}/ciclo-vida/transiciones/cerrar_entrega_ok`,
      ).send({ contexto: { entrega_ok: true } });
      expect(respuesta.status).toBe(200);
      expect(respuesta.body.propiedad_id).toBe(idPropiedad);

      const { rows: estado } = await entorno.poolAdmin.query<{ clave: string }>(
        `SELECT e.clave
           FROM workflow_instancia i
           JOIN workflow_estado e ON e.id = i.estado_actual_id
          WHERE i.entidad_tipo = 'propiedad' AND i.entidad_id = $1`,
        [idPropiedad],
      );
      expect(estado[0]?.clave).toBe('disponible');
    });

    it('sin el dato, la condición es falsa → 409 (R5, fail closed)', async () => {
      const idPropiedad = await crearPropiedad('F');
      await hastaEnDesocupacion(idPropiedad);

      const respuesta = await comoAdminA(
        'post',
        `/propiedades/${idPropiedad}/ciclo-vida/transiciones/cerrar_entrega_ok`,
      ).send({});
      expect(respuesta.status).toBe(409);
    });
  });

  // ─── T13 — auditoría (R7) ───────────────────────────────────────────────

  describe('T13 — auditoría (R7)', () => {
    it('la ejecución genera exactamente una fila en audit_log con entity_id = propiedad', async () => {
      const desde = new Date();
      const idPropiedad = await crearPropiedad('G');

      const ejecutada = await comoAdminA(
        'post',
        `/propiedades/${idPropiedad}/ciclo-vida/transiciones/iniciar_checkeo`,
      ).send({});
      expect(ejecutada.status).toBe(200);

      const { rows } = await entorno.poolAdmin.query<{
        total: string;
        tenant_id: string;
        actor_id: string;
        entity_type: string;
        metadata: Record<string, unknown> | null;
      }>(
        `SELECT count(*)::text AS total,
                min(tenant_id::text) AS tenant_id,
                min(actor_id::text) AS actor_id,
                min(entity_type) AS entity_type,
                min(metadata::text)::jsonb AS metadata
           FROM audit_log
          WHERE accion = 'actualizar' AND entity_type = 'propiedad'
            AND entity_id = $1 AND created_at >= $2`,
        [idPropiedad, desde],
      );
      expect(Number(rows[0]?.total)).toBe(1);
      expect(rows[0]?.tenant_id).toBe(TENANT_A);
      expect(rows[0]?.actor_id).toBe(entorno.adminA.id);
      expect(rows[0]?.entity_type).toBe('propiedad');
      // R15: metadata vacío — nada de direcciones ni contexto.
      expect(rows[0]?.metadata).toBeNull();
    });
  });
});
