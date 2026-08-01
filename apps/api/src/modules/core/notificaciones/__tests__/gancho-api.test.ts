import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
} from '../../../../../test/support/entorno-clientes';

/**
 * El gancho del motor (T7, T21 → R2, R18): una transición con `notificacion`
 * escribe el outbox en la misma transacción; sin hook no escribe nada; y la
 * semántica de la transición no cambia. Contra PostgreSQL real y la app.
 */
describe('Gancho de notificaciones del motor (T7, T21)', () => {
  let entorno: EntornoClientes;

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();

  const comoAdminA = (metodo: 'post' | 'get' | 'delete', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);

  /** Crea una propiedad (con su instancia del ciclo de vida). */
  async function crearPropiedad(sufijo: string): Promise<string> {
    const prop = await comoAdminA('post', '/propietarios').send({
      nombre: `Prop Hook ${sufijo}`,
      tipo_documento: 'CC',
      documento: `HK-${sufijo}`,
    });
    const creada = await comoAdminA('post', '/propiedades').send({
      direccion: `Calle Hook ${sufijo}`,
      tipo: 'APARTAMENTO',
      area: '60.00',
      canon: '1200000.00',
      propietario_principal_id: prop.body.id,
    });
    expect(creada.status).toBe(201);
    return creada.body.id as string;
  }

  /** Reutiliza la copia TENANT (o la clona) y le añade una transición con hook. */
  async function clonarConHook(
    sufijo: string,
    hook: Record<string, unknown>,
  ): Promise<{ idDefinicion: string; idTransicion: string; idEstadoOrigen: string }> {
    const { rows: copia } = await entorno.poolAdmin.query<{ id: string }>(
      `SELECT id FROM workflow_definicion
        WHERE tipo = 'ciclo_vida_propiedad' AND origen = 'TENANT'`,
    );
    let idCopia = copia[0]?.id;
    if (!idCopia) {
      const { rows: sistema } = await entorno.poolAdmin.query<{ id: string }>(
        `SELECT id FROM workflow_definicion
          WHERE tipo = 'ciclo_vida_propiedad' AND origen = 'SISTEMA'`,
      );
      const clonada = await comoAdminA('post', `/workflows/${sistema[0]?.id}/clonar`);
      expect(clonada.status).toBe(201);
      idCopia = clonada.body.id;
    }

    const detalle = await comoAdminA('get', `/workflows/${idCopia}`);
    const estados = detalle.body.estados as Array<{ clave: string; id: string }>;
    const estadoOrigen = estados.find((e) => e.clave === 'en_checkeo')?.id;
    const estadoDestino = estados.find((e) => e.clave === 'con_aseguradora')?.id;
    expect(estadoOrigen).toBeDefined();
    expect(estadoDestino).toBeDefined();

    const anadida = await comoAdminA('post', `/workflows/${idCopia}/transiciones`).send({
      clave: `aviso_hook_${sufijo}`,
      origen_estado_id: estadoOrigen,
      destino_estado_id: estadoDestino,
      tipo_ejecucion: 'HUMANA',
      notificacion: hook,
    });
    expect(anadida.status).toBe(201);

    return { idDefinicion: idCopia!, idTransicion: anadida.body.id, idEstadoOrigen: estadoOrigen! };
  }

  // ─── T7 — el outbox se escribe con la transición (R2) ───────────────────

  describe('T7 — el gancho transaccional (R2)', () => {
    it('una transición con hook escribe la fila del outbox en la misma transacción', async () => {
      const { idTransicion } = await clonarConHook('A', {
        canal: 'CORREO',
        plantilla: 'aviso',
        destinatario: { email: 'aviso@example.com' },
      });

      // La instancia cuelga de la COPIA (PA-8-3): se avanza hasta en_checkeo
      // de la copia y se ejecuta la transición con hook por el motor.
      const idPropiedad = await crearPropiedad('A');
      const avanzada = await comoAdminA(
        'post',
        `/propiedades/${idPropiedad}/ciclo-vida/transiciones/iniciar_checkeo`,
      ).send({});
      expect(avanzada.status).toBe(200);

      const { rows: instancia } = await entorno.poolAdmin.query<{ id: string }>(
        `SELECT i.id FROM workflow_instancia i
          WHERE i.entidad_tipo = 'propiedad' AND i.entidad_id = $1`,
        [idPropiedad],
      );
      const ejecutada = await comoAdminA(
        'post',
        `/workflows/instancias/${instancia[0]?.id}/transiciones/${idTransicion}`,
      ).send({});
      expect(ejecutada.status).toBe(200);

      // SELECT: la fila del outbox existe, con el hook como datos.
      const { rows: outbox } = await entorno.poolAdmin.query<{
        canal: string;
        transicion_id: string;
      }>(
        'SELECT canal, transicion_id::text AS transicion_id FROM notificacion_pendiente WHERE transicion_id = $1',
        [idTransicion],
      );
      expect(outbox).toHaveLength(1);
      expect(outbox[0]?.canal).toBe('CORREO');
    });

    it('una transición SIN hook no escribe nada (R2)', async () => {
      const idPropiedad = await crearPropiedad('B');
      const { rows: antes } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM notificacion_pendiente
          WHERE entidad_tipo = 'propiedad'
            AND entidad_id = (SELECT id FROM propiedad WHERE direccion = 'Calle Hook B')`,
      );
      expect(Number(antes[0]?.total)).toBe(0);

      const ejecutada = await comoAdminA(
        'post',
        `/propiedades/${idPropiedad}/ciclo-vida/transiciones/iniciar_checkeo`,
      ).send({});
      expect(ejecutada.status).toBe(200);

      const { rows: despues } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM notificacion_pendiente
          WHERE entidad_tipo = 'propiedad' AND entidad_id = $1`,
        [idPropiedad],
      );
      expect(Number(despues[0]?.total)).toBe(0);
    });

    it('una transición que falla (condición falsa) no deja outbox (R2, rollback)', async () => {
      const idPropiedad = await crearPropiedad('C');
      const respuesta = await comoAdminA(
        'post',
        `/propiedades/${idPropiedad}/ciclo-vida/transiciones/cerrar_entrega_ok`,
      ).send({});
      expect(respuesta.status).toBe(409);

      const { rows } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM notificacion_pendiente
          WHERE entidad_tipo = 'propiedad' AND entidad_id = $1`,
        [idPropiedad],
      );
      expect(Number(rows[0]?.total)).toBe(0);
    });
  });

  // ─── T21 — la semántica no cambia (R18) ─────────────────────────────────

  describe('T21 — la semántica del motor no cambia (R18)', () => {
    it('una transición con hook se ejecuta igual: mismo estado y mismo log de dominio', async () => {
      const { idTransicion } = await clonarConHook('D', {
        canal: 'CORREO',
        destinatario: { email: 'semantica@example.com' },
      });

      const idPropiedad = await crearPropiedad('D');
      const { rows: instancia } = await entorno.poolAdmin.query<{ id: string }>(
        `SELECT i.id FROM workflow_instancia i
          WHERE i.entidad_tipo = 'propiedad' AND i.entidad_id = $1`,
        [idPropiedad],
      );
      const { rows: copia } = await entorno.poolAdmin.query<{ id: string }>(
        `SELECT id FROM workflow_definicion
          WHERE tipo = 'ciclo_vida_propiedad' AND origen = 'TENANT'`,
      );
      const { rows: estados } = await entorno.poolAdmin.query<{ id: string; clave: string }>(
        `SELECT e.id::text AS id, e.clave FROM workflow_estado e
          WHERE e.definicion_id = $1`,
        [copia[0]?.id],
      );
      const enCheckeo = estados.find((e) => e.clave === 'en_checkeo')?.id;
      const conAseguradora = estados.find((e) => e.clave === 'con_aseguradora')?.id;

      // Avanza hasta en_checkeo de la copia y ejecuta la transición con hook
      // (en_checkeo → con_aseguradora): el estado cambia igual que sin hook.
      await comoAdminA(
        'post',
        `/propiedades/${idPropiedad}/ciclo-vida/transiciones/iniciar_checkeo`,
      ).send({});
      const ejecutada = await comoAdminA(
        'post',
        `/workflows/instancias/${instancia[0]?.id}/transiciones/${idTransicion}`,
      ).send({});
      expect(ejecutada.status).toBe(200);
      expect(ejecutada.body.estado_actual_id).toBe(conAseguradora);
      expect(ejecutada.body.estado_actual_id).not.toBe(enCheckeo);

      // El log de dominio tiene UNA fila por transición ejecutada (aquí:
      // iniciar_checkeo + la del hook = 2). El hook no añade filas extra:
      // la semántica del motor no cambia (R18).
      const { rows: log } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM workflow_transicion_log
          WHERE instancia_id = $1`,
        [instancia[0]?.id],
      );
      expect(Number(log[0]?.total)).toBe(2);
    });
  });
});
