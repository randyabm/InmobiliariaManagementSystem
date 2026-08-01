import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
} from '../../../../../test/support/entorno-clientes';

/**
 * El motor contra PostgreSQL real y la app real (T15, T16, T17, T18, T19 →
 * R3, R4, R5, R6, R7, R8, R10, R17).
 *
 * La máquina de estados «completa definida solo con datos» es la sembrada
 * por la migración (`ciclo_vida_propiedad`, RF-P4): el criterio de
 * aceptación de la feature.
 */

const ENTIDAD = 'aaaaaaaa-0000-0000-0000-0000000000aa';

describe('Motor de workflows — integración (#7)', () => {
  let entorno: EntornoClientes;
  let idDefinicion: string;

  /** claves de estado del seed, resueltas del GET de la definición. */
  let estados: Record<string, string> = {};
  /** claves de transición del seed, resueltas del GET. */
  let transiciones: Record<string, string> = {};

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
    const servidor = () => entorno.app.getHttpServer();

    const lista = await request(servidor())
      .get('/workflows')
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);
    expect(lista.status).toBe(200);

    const ciclo = lista.body.find(
      (d: { tipo: string }) => d.tipo === 'ciclo_vida_propiedad',
    ) as { id: string };
    expect(ciclo).toBeDefined();
    idDefinicion = ciclo.id;

    const detalle = await request(servidor())
      .get(`/workflows/${idDefinicion}`)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);
    expect(detalle.status).toBe(200);

    for (const e of detalle.body.estados as Array<{ clave: string; id: string }>) {
      estados[e.clave] = e.id;
    }
    for (const t of detalle.body.transiciones as Array<{ clave: string; id: string }>) {
      transiciones[t.clave] = t.id;
    }
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

  // ─── T15 — máquina completa definida solo con datos (aceptación) ────────

  describe('T15 — recorrer la máquina del seed (criterio de aceptación)', () => {
    it('crea la instancia en disponible y recorre la cadena hasta arrendada (R6, R7, R10)', async () => {
      const creada = await comoAdminA('post', `/workflows/${idDefinicion}/instancias`).send({
        entidad_tipo: 'propiedad',
        entidad_id: ENTIDAD,
        contexto: { direccion: 'Calle Motor 1' },
      });
      expect(creada.status).toBe(201);
      expect(creada.body.estado_actual_id).toBe(estados['disponible']);

      const pasos: Array<[string, string]> = [
        ['iniciar_checkeo', 'en_checkeo'],
        ['enviar_aseguradora', 'con_aseguradora'],
        ['arrendar', 'arrendada'],
      ];
      for (const [transicion, estadoEsperado] of pasos) {
        const ejecutada = await comoAdminA(
          'post',
          `/workflows/instancias/${creada.body.id}/transiciones/${transiciones[transicion]}`,
        ).send({});
        expect(ejecutada.status, transicion).toBe(200);
        expect(ejecutada.body.estado_actual_id).toBe(estados[estadoEsperado]);
      }

      // Verificación independiente: estado persistido + log de 4 filas.
      const { rows: instancia } = await entorno.poolAdmin.query<{ estado: string }>(
        'SELECT estado_actual_id::text AS estado FROM workflow_instancia WHERE id = $1',
        [creada.body.id],
      );
      expect(instancia[0]?.estado).toBe(estados['arrendada']);

      const { rows: log } = await entorno.poolAdmin.query<{ total: string }>(
        'SELECT count(*)::text AS total FROM workflow_transicion_log WHERE instancia_id = $1',
        [creada.body.id],
      );
      expect(Number(log[0]?.total)).toBe(3);
    });

    it('la instancia duplicada para la misma entidad es 409 (R6, R12)', async () => {
      const respuesta = await comoAdminA('post', `/workflows/${idDefinicion}/instancias`).send({
        entidad_tipo: 'propiedad',
        entidad_id: ENTIDAD,
      });
      expect(respuesta.status).toBe(409);
      expect(respuesta.body.error).toBe('INSTANCIA_YA_EXISTE');
    });

    it('el historial es la línea de tiempo en orden (R10, R11)', async () => {
      const { rows: instancia } = await entorno.poolAdmin.query<{ id: string }>(
        'SELECT id FROM workflow_instancia WHERE entidad_id = $1',
        [ENTIDAD],
      );
      const historial = await comoAdminA(
        'get',
        `/workflows/instancias/${instancia[0]?.id}/historial`,
      );
      expect(historial.status).toBe(200);
      expect(historial.body).toHaveLength(3);
      const fechas = historial.body.map((l: { created_at: string }) => l.created_at);
      expect(fechas).toEqual([...fechas].sort());
      expect(
        historial.body.every((l: { actor_id: string | null }) => typeof l.actor_id === 'string'),
      ).toBe(true);
    });
  });

  // ─── T16 — la rama condicional como datos (R3, R7) ──────────────────────

  describe('T16 — la rama condicional de entrega (R3)', () => {
    const ENTIDAD_COND = 'bbbbbbbb-0000-0000-0000-0000000000bb';

    async function llevarAEnDesocupacion(entidadId: string): Promise<string> {
      const creada = await comoAdminA('post', `/workflows/${idDefinicion}/instancias`).send({
        entidad_tipo: 'propiedad',
        entidad_id: entidadId,
      });
      for (const [transicion] of [
        ['iniciar_checkeo'],
        ['enviar_aseguradora'],
        ['arrendar'],
        ['iniciar_desocupacion'],
      ] as const) {
        const ejecutada = await comoAdminA(
          'post',
          `/workflows/instancias/${creada.body.id}/transiciones/${transiciones[transicion]}`,
        ).send({});
        expect(ejecutada.status).toBe(200);
      }
      return creada.body.id as string;
    }

    it('con entrega_ok = true va a disponible (R3)', async () => {
      const idInstancia = await llevarAEnDesocupacion(ENTIDAD_COND);
      const respuesta = await comoAdminA(
        'post',
        `/workflows/instancias/${idInstancia}/transiciones/${transiciones['cerrar_entrega_ok']}`,
      ).send({ contexto: { entrega_ok: true } });
      expect(respuesta.status).toBe(200);
      expect(respuesta.body.estado_actual_id).toBe(estados['disponible']);
    });

    it('con entrega_ok = false va a en_checkeo (R3)', async () => {
      const ENTIDAD_COND2 = 'cccccccc-0000-0000-0000-0000000000cc';
      const idInstancia = await llevarAEnDesocupacion(ENTIDAD_COND2);
      const respuesta = await comoAdminA(
        'post',
        `/workflows/instancias/${idInstancia}/transiciones/${transiciones['reingresar_a_checkeo']}`,
      ).send({ contexto: { entrega_ok: false } });
      expect(respuesta.status).toBe(200);
      expect(respuesta.body.estado_actual_id).toBe(estados['en_checkeo']);
    });

    it('sin el dato en el contexto, la condición es falsa → 409 (R3, fail closed)', async () => {
      const ENTIDAD_COND3 = 'dddddddd-0000-0000-0000-0000000000dd';
      const idInstancia = await llevarAEnDesocupacion(ENTIDAD_COND3);
      const respuesta = await comoAdminA(
        'post',
        `/workflows/instancias/${idInstancia}/transiciones/${transiciones['cerrar_entrega_ok']}`,
      ).send({});
      expect(respuesta.status).toBe(409);
      expect(respuesta.body.error).toBe('TRANSICION_NO_DISPONIBLE');
    });
  });

  // ─── T18 — rechazos deterministas (R6, R7) ──────────────────────────────

  describe('T18 — rechazos (R6, R7)', () => {
    const ENTIDAD_RECHAZO = 'eeeeeeee-0000-0000-0000-0000000000ee';

    it('una transición de otro estado es 409 sin cambiar el estado (R7)', async () => {
      const creada = await comoAdminA('post', `/workflows/${idDefinicion}/instancias`).send({
        entidad_tipo: 'propiedad',
        entidad_id: ENTIDAD_RECHAZO,
      });
      // Desde `disponible`, pedir `arrendar` (que sale de con_aseguradora).
      const respuesta = await comoAdminA(
        'post',
        `/workflows/instancias/${creada.body.id}/transiciones/${transiciones['arrendar']}`,
      ).send({});
      expect(respuesta.status).toBe(409);

      const { rows } = await entorno.poolAdmin.query<{ estado: string }>(
        'SELECT estado_actual_id::text AS estado FROM workflow_instancia WHERE id = $1',
        [creada.body.id],
      );
      expect(rows[0]?.estado).toBe(estados['disponible']);
    });

    it('una transición inexistente es 409 sin distinguir el motivo (R7)', async () => {
      const creada = await comoAdminA('post', `/workflows/${idDefinicion}/instancias`).send({
        entidad_tipo: 'propiedad',
        entidad_id: 'ffffffff-0000-0000-0000-0000000000ff',
      });
      const respuesta = await comoAdminA(
        'post',
        `/workflows/instancias/${creada.body.id}/transiciones/ffffffff-ffff-ffff-ffff-ffffffffffff`,
      ).send({});
      expect(respuesta.status).toBe(409);
      expect(respuesta.body.error).toBe('TRANSICION_NO_DISPONIBLE');
    });
  });

  // ─── T17, T19 — definiciones: clonar, editar la copia, cascada ──────────

  describe('T17 + T19 — clonar, editar la copia y cascada automática', () => {
    it('clonar la plantilla del sistema crea una copia TENANT (R4)', async () => {
      const respuesta = await comoAdminA('post', `/workflows/${idDefinicion}/clonar`);
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.origen).toBe('TENANT');
      expect(respuesta.body.tipo).toBe('ciclo_vida_propiedad');
    });

    it('clonar el mismo tipo otra vez es 409 (R4)', async () => {
      const respuesta = await comoAdminA('post', `/workflows/${idDefinicion}/clonar`);
      expect(respuesta.status).toBe(409);
    });

    it('editar la definición del SISTEMA es 409 (R5)', async () => {
      const respuesta = await comoAdminA('post', `/workflows/${idDefinicion}/transiciones`).send({
        clave: 'hack',
        origen_estado_id: estados['disponible'],
        destino_estado_id: estados['arrendada'],
        tipo_ejecucion: 'HUMANA',
      });
      expect(respuesta.status).toBe(409);
      expect(respuesta.body.error).toBe('DEFINICION_SISTEMA_NO_EDITABLE');
    });

    it('añadir una transición a la copia y recorrerla con cascada automática (R5, R8)', async () => {
      // La copia del tenant: `ciclo_vida_propiedad` con origen TENANT.
      const lista = await comoAdminA('get', '/workflows');
      const copia = lista.body.find(
        (d: { tipo: string; origen: string }) =>
          d.tipo === 'ciclo_vida_propiedad' && d.origen === 'TENANT',
      ) as { id: string };
      expect(copia).toBeDefined();

      const detalle = await comoAdminA('get', `/workflows/${copia.id}`);
      const estadoMedio = (detalle.body.estados as Array<{ clave: string; id: string }>).find(
        (e) => e.clave === 'en_checkeo',
      )?.id;
      const estadoFinal = (detalle.body.estados as Array<{ clave: string; id: string }>).find(
        (e) => e.clave === 'arrendada',
      )?.id;
      expect(estadoMedio).toBeDefined();
      expect(estadoFinal).toBeDefined();

      // Añade una transición AUTOMATICA en_checkeo → arrendada.
      const anadida = await comoAdminA('post', `/workflows/${copia.id}/transiciones`).send({
        clave: 'aprobacion_automatica',
        origen_estado_id: estadoMedio,
        destino_estado_id: estadoFinal,
        tipo_ejecucion: 'AUTOMATICA',
      });
      expect(anadida.status).toBe(201);

      // Instancia sobre la COPIA: la humana `iniciar_checkeo` dispara la
      // cascada y deja la instancia en `arrendada` con 2 logs.
      const creada = await comoAdminA('post', `/workflows/${copia.id}/instancias`).send({
        entidad_tipo: 'propiedad',
        entidad_id: '11111111-0000-0000-0000-000000000011',
      });
      expect(creada.status).toBe(201);

      const iniciarCheckeoId = (detalle.body.transiciones as Array<{ clave: string; id: string }>).find(
        (t) => t.clave === 'iniciar_checkeo',
      )?.id;
      const ejecutada = await comoAdminA(
        'post',
        `/workflows/instancias/${creada.body.id}/transiciones/${iniciarCheckeoId}`,
      ).send({});
      if (ejecutada.status !== 200) { console.error('DEBUG 409:', JSON.stringify(ejecutada.body)); }
      expect(ejecutada.status).toBe(200);
      expect(ejecutada.body.estado_actual_id).toBe(estadoFinal);

      const { rows: log } = await entorno.poolAdmin.query<{
        automatica: boolean;
        actor_id: string | null;
      }>(
        'SELECT automatica, actor_id::text AS actor_id FROM workflow_transicion_log WHERE instancia_id = $1 ORDER BY created_at',
        [creada.body.id],
      );
      expect(log).toHaveLength(2);
      expect(log[0]?.automatica).toBe(false);
      expect(log[0]?.actor_id).toBe(entorno.adminA.id);
      expect(log[1]?.automatica).toBe(true);
      expect(log[1]?.actor_id).toBeNull();
    });

    it('dar de baja una transición de la copia la oculta (R5)', async () => {
      const lista = await comoAdminA('get', '/workflows');
      const copia = lista.body.find(
        (d: { tipo: string; origen: string }) =>
          d.tipo === 'ciclo_vida_propiedad' && d.origen === 'TENANT',
      ) as { id: string };
      const detalle = await comoAdminA('get', `/workflows/${copia.id}`);
      const transicion = (detalle.body.transiciones as Array<{ clave: string; id: string }>).find(
        (t) => t.clave === 'aprobacion_automatica',
      );
      expect(transicion).toBeDefined();

      const baja = await comoAdminA(
        'delete',
        `/workflows/${copia.id}/transiciones/${transicion?.id}`,
      );
      expect(baja.status).toBe(200);

      const { rows } = await entorno.poolAdmin.query<{ activo: boolean }>(
        'SELECT activo FROM workflow_transicion WHERE id = $1',
        [transicion?.id],
      );
      expect(rows[0]?.activo).toBe(false);
    });
  });
});
