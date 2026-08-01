import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
} from '../../../../../test/support/entorno-clientes';

/**
 * El ingreso de propiedad (T8, T9, T10, T11, T12, T13 → R1..R7, R9).
 *
 * Contra PostgreSQL real y la app real; las aserciones de estado se hacen
 * con SELECTs independientes.
 */
describe('Ingreso de propiedad (#9)', () => {
  let entorno: EntornoClientes;

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();

  const comoAdminA = (metodo: 'post', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);

  const propietarioInline = (sufijo: string) => ({
    datos: {
      nombre: `Propietario Ingreso ${sufijo}`,
      tipo_documento: 'CC',
      documento: `I9-${sufijo}`,
    },
  });

  const propiedadBase = (sufijo: string) => ({
    direccion: `Calle Ingreso ${sufijo}`,
    tipo: 'APARTAMENTO',
    area: '65.00',
    canon: '1300000.00',
  });

  const inquilinoInline = (sufijo: string) => ({
    datos: {
      nombre: `Inquilino Ingreso ${sufijo}`,
      tipo_documento: 'CC',
      documento: `I9I-${sufijo}`,
      email: `ingreso-${sufijo}@example.com`,
      celular: '3005556677',
      medio_preferido_contacto: 'SMS',
    },
  });

  // ─── T8, T9 — escenario A (R1, R3, R7) ──────────────────────────────────

  describe('T8+T9 — escenario A (R1, R3, R7)', () => {
    it('crea propietario en línea, la propiedad y la deja en disponible (R1, R7)', async () => {
      const respuesta = await comoAdminA('post', '/propiedades/ingreso').send({
        escenario: 'VACANTE',
        propietario: propietarioInline('A'),
        propiedad: propiedadBase('A'),
      });

      expect(respuesta.status).toBe(201);
      expect(respuesta.body.estado_ciclo_vida?.clave).toBe('disponible');

      const { rows: perfil } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM perfil_propietario
          WHERE tenant_id = $1 AND documento = 'I9-A'`,
        [TENANT_A],
      );
      expect(Number(perfil[0]?.total)).toBe(1);

      const { rows: instancia } = await entorno.poolAdmin.query<{ clave: string }>(
        `SELECT e.clave
           FROM workflow_instancia i
           JOIN workflow_estado e ON e.id = i.estado_actual_id
          WHERE i.entidad_tipo = 'propiedad' AND i.entidad_id = $1`,
        [respuesta.body.id],
      );
      expect(instancia[0]?.clave).toBe('disponible');
    });

    it('reutiliza un propietario existente con el mismo documento y nombre (R3)', async () => {
      // El primer ingreso ya creó I9-A: un segundo con los mismos datos
      // reutiliza el perfil (SELECT: sigue habiendo UNA fila).
      const respuesta = await comoAdminA('post', '/propiedades/ingreso').send({
        escenario: 'VACANTE',
        propietario: propietarioInline('A'),
        propiedad: propiedadBase('A2'),
      });
      expect(respuesta.status).toBe(201);

      const { rows: perfil } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM perfil_propietario
          WHERE tenant_id = $1 AND documento = 'I9-A'`,
        [TENANT_A],
      );
      expect(Number(perfil[0]?.total)).toBe(1);
    });
  });

  // ─── T10 — escenario B (R2, R7, R9) ─────────────────────────────────────

  describe('T10 — escenario B (R2, R7, R9)', () => {
    it('crea propietario e inquilino en línea y deja la propiedad en arrendada', async () => {
      const respuesta = await comoAdminA('post', '/propiedades/ingreso').send({
        escenario: 'ARRENDADA',
        propietario: propietarioInline('B'),
        propiedad: propiedadBase('B'),
        inquilino: inquilinoInline('B'),
      });

      expect(respuesta.status).toBe(201);
      expect(respuesta.body.estado_ciclo_vida?.clave).toBe('arrendada');
      expect(respuesta.body.inquilino_actual_nombre).toBe('Inquilino Ingreso B');

      // SELECT: inquilino creado, asignado, línea de ocupación abierta.
      const { rows: perfil } = await entorno.poolAdmin.query<{ id: string }>(
        `SELECT id FROM perfil_inquilino
          WHERE tenant_id = $1 AND documento = 'I9I-B'`,
        [TENANT_A],
      );
      expect(perfil).toHaveLength(1);

      const { rows: ocupacion } = await entorno.poolAdmin.query<{ hasta: Date | null }>(
        `SELECT hasta FROM historial_ocupacion
          WHERE propiedad_id = $1`,
        [respuesta.body.id],
      );
      expect(ocupacion).toHaveLength(1);
      expect(ocupacion[0]?.hasta).toBeNull();

      // R9: el log del motor tiene las 3 transiciones de la cadena.
      const { rows: log } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total
           FROM workflow_transicion_log l
           JOIN workflow_instancia i ON i.id = l.instancia_id
          WHERE i.entidad_tipo = 'propiedad' AND i.entidad_id = $1`,
        [respuesta.body.id],
      );
      expect(Number(log[0]?.total)).toBe(3);
    });

    it('reutiliza un inquilino existente con el mismo documento y nombre (R4)', async () => {
      const respuesta = await comoAdminA('post', '/propiedades/ingreso').send({
        escenario: 'ARRENDADA',
        propietario: propietarioInline('B2'),
        propiedad: propiedadBase('B2'),
        inquilino: inquilinoInline('B'),
      });
      expect(respuesta.status).toBe(201);

      const { rows: perfil } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM perfil_inquilino
          WHERE tenant_id = $1 AND documento = 'I9I-B'`,
        [TENANT_A],
      );
      expect(Number(perfil[0]?.total)).toBe(1);
    });
  });

  // ─── T11 — 409 por nombre divergente (R3, R4, R6) ───────────────────────

  describe('T11 — nombre divergente → 409 sin escribir nada (R3, R4, R6)', () => {
    it('propietario con el mismo documento y OTRO nombre → 409 y rollback total', async () => {
      const respuesta = await comoAdminA('post', '/propiedades/ingreso').send({
        escenario: 'VACANTE',
        propietario: {
          datos: {
            nombre: 'Nombre Diferente Total',
            tipo_documento: 'CC',
            documento: 'I9-A',
          },
        },
        propiedad: propiedadBase('C'),
      });

      expect(respuesta.status).toBe(409);
      expect(respuesta.body.error).toBe('NOMBRE_NO_COINCIDE_CON_IDENTIDAD');

      // Rollback: ni la propiedad se escribió.
      const { rows } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM propiedad WHERE direccion = 'Calle Ingreso C'`,
      );
      expect(Number(rows[0]?.total)).toBe(0);
    });
  });

  // ─── T12 — errores de forma (R5, R10) ───────────────────────────────────

  describe('T12 — errores de forma (R5, R10)', () => {
    it('escenario ARRENDADA sin inquilino → 400 sin escribir nada', async () => {
      const respuesta = await comoAdminA('post', '/propiedades/ingreso').send({
        escenario: 'ARRENDADA',
        propietario: propietarioInline('D'),
        propiedad: propiedadBase('D'),
      });
      expect(respuesta.status).toBe(400);

      const { rows } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM propiedad WHERE direccion = 'Calle Ingreso D'`,
      );
      expect(Number(rows[0]?.total)).toBe(0);
    });

    it('perfil por id inexistente → 404 sin escribir nada', async () => {
      const respuesta = await comoAdminA('post', '/propiedades/ingreso').send({
        escenario: 'VACANTE',
        propietario: { perfil_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
        propiedad: propiedadBase('E'),
      });
      expect(respuesta.status).toBe(404);
    });
  });

  // ─── T13 — atomicidad (R6) ──────────────────────────────────────────────

  describe('T13 — atomicidad (R6)', () => {
    it('una cadena bloqueada revierte TODO el ingreso', async () => {
      // Se clona la plantilla y se da de baja `arrendar` en la copia: la
      // cadena del escenario B no puede completarse.
      const { rows: sistema } = await entorno.poolAdmin.query<{ id: string }>(
        `SELECT id FROM workflow_definicion
          WHERE tipo = 'ciclo_vida_propiedad' AND origen = 'SISTEMA'`,
      );
      const clonada = await comoAdminA('post', `/workflows/${sistema[0]?.id}/clonar`);
      expect(clonada.status).toBe(201);

      const detalle = await request(servidor())
        .get(`/workflows/${clonada.body.id}`)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);
      const arrendar = (detalle.body.transiciones as Array<{ clave: string; id: string }>).find(
        (t) => t.clave === 'arrendar',
      );
      const baja = await request(servidor())
        .delete(`/workflows/${clonada.body.id}/transiciones/${arrendar?.id}`)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);
      expect(baja.status).toBe(200);

      // El ingreso B ahora usa la copia (PA-8-3) y falla al llegar a la
      // transición desactivada.
      const respuesta = await comoAdminA('post', '/propiedades/ingreso').send({
        escenario: 'ARRENDADA',
        propietario: propietarioInline('F'),
        propiedad: propiedadBase('F'),
        inquilino: inquilinoInline('F'),
      });
      expect(respuesta.status).toBe(409);
      expect(respuesta.body.error).toBe('TRANSICION_NO_DISPONIBLE');

      // Rollback total: sin propietario, sin propiedad, sin instancia, sin log.
      const { rows: propietario } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM perfil_propietario
          WHERE tenant_id = $1 AND documento = 'I9-F'`,
        [TENANT_A],
      );
      expect(Number(propietario[0]?.total)).toBe(0);

      const { rows: propiedad } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM propiedad WHERE direccion = 'Calle Ingreso F'`,
      );
      expect(Number(propiedad[0]?.total)).toBe(0);

      const { rows: instancia } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM workflow_instancia
          WHERE entidad_tipo = 'propiedad'
            AND entidad_id = (SELECT id FROM propiedad WHERE direccion = 'Calle Ingreso F')`,
      );
      expect(Number(instancia[0]?.total)).toBe(0);
    });
  });
});
