import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
} from '../../../../../test/support/entorno-clientes';

/**
 * El vínculo propiedad ↔ máquina (T5, T6 → R1, R2, R3; PA-8-2, PA-8-3).
 *
 * La propiedad nace con su instancia del motor en `disponible`, la ficha la
 * expone sin columna duplicada, y la definición usada prefiere la copia del
 * tenant (T6). Contra PostgreSQL real y la app real.
 */
describe('Ciclo de vida — vínculo propiedad ↔ instancia (#8)', () => {
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
      nombre: `Prop Ciclo ${sufijo}`,
      tipo_documento: 'CC',
      documento: `C8-${sufijo}`,
    });
    expect(prop.status).toBe(201);

    const creada = await comoAdminA('post', '/propiedades').send({
      direccion: `Calle Ciclo ${sufijo}`,
      tipo: 'APARTAMENTO',
      area: '60.00',
      canon: '1200000.00',
      propietario_principal_id: prop.body.id,
    });
    expect(creada.status).toBe(201);
    return creada.body.id as string;
  }

  // ─── T5 — la propiedad nace con su instancia (R1, R3) ───────────────────

  describe('T5 — instancia al crear y ficha con estado (R1, R3)', () => {
    it('crear una propiedad crea su instancia en disponible, en la misma transacción (R1)', async () => {
      const idPropiedad = await crearPropiedad('A');

      // SELECT independiente: la instancia existe y su estado es el
      // `disponible` de SU definición.
      const { rows } = await entorno.poolAdmin.query<{
        clave: string;
        definicion_id: string;
      }>(
        `SELECT e.clave, i.definicion_id::text AS definicion_id
           FROM workflow_instancia i
           JOIN workflow_estado e ON e.id = i.estado_actual_id
          WHERE i.entidad_tipo = 'propiedad' AND i.entidad_id = $1`,
        [idPropiedad],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.clave).toBe('disponible');
      expect(rows[0]?.definicion_id).toBeTruthy();
    });

    it('la ficha expone estado_ciclo_vida leído del motor (R3)', async () => {
      const idPropiedad = await crearPropiedad('B');

      const ficha = await comoAdminA('get', `/propiedades/${idPropiedad}`);
      expect(ficha.status).toBe(200);
      expect(ficha.body.estado_ciclo_vida?.clave).toBe('disponible');
      expect(ficha.body.estado_ciclo_vida?.etiqueta).toBe('Disponible / Vacante');
      expect(typeof ficha.body.estado_ciclo_vida?.desde).toBe('string');

      // PA-8-1: `propiedad` NO tiene columna de estado.
      const { rows: columnas } = await entorno.poolAdmin.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'propiedad'
            AND column_name LIKE '%estado%'`,
      );
      expect(columnas).toEqual([]);
    });

    it('una propiedad sin instancia (caso dev) muestra estado null (R3)', async () => {
      // Se siembra una propiedad a mano SIN su instancia: es el caso de los
      // datos anteriores a esta feature (no hay producción).
      const prop = await comoAdminA('post', '/propietarios').send({
        nombre: 'Prop Sin Maquina',
        tipo_documento: 'CC',
        documento: 'C8-SM',
      });
      const { rows } = await entorno.poolAdmin.query<{ id: string }>(
        `INSERT INTO propiedad
           (tenant_id, direccion, tipo, area, canon, propietario_principal_id)
         VALUES ($1, 'Calle Sin Maquina', 'LOCAL', '30.00', '800000.00', $2)
         RETURNING id`,
        [TENANT_A, prop.body.id],
      );

      const ficha = await comoAdminA('get', `/propiedades/${rows[0]?.id}`);
      expect(ficha.status).toBe(200);
      expect(ficha.body.estado_ciclo_vida).toBeNull();
    });
  });

  // ─── T6 — precedencia de la definición (R2, PA-8-3) ─────────────────────

  describe('T6 — copia TENANT si existe, si no SISTEMA (R2)', () => {
    it('sin copia, la instancia cuelga de la definición SISTEMA', async () => {
      const idPropiedad = await crearPropiedad('C');

      const { rows } = await entorno.poolAdmin.query<{ def: string }>(
        `SELECT i.definicion_id::text AS def
           FROM workflow_instancia i
          WHERE i.entidad_tipo = 'propiedad' AND i.entidad_id = $1`,
        [idPropiedad],
      );
      const { rows: sistema } = await entorno.poolAdmin.query<{ id: string }>(
        `SELECT id FROM workflow_definicion
          WHERE tipo = 'ciclo_vida_propiedad' AND origen = 'SISTEMA'`,
      );
      expect(rows[0]?.def).toBe(sistema[0]?.id);
    });

    it('con copia TENANT, la instancia nueva cuelga de la copia', async () => {
      // Clona la plantilla (solo admin) para crear la copia del tenant.
      const { rows: sistema } = await entorno.poolAdmin.query<{ id: string }>(
        `SELECT id FROM workflow_definicion
          WHERE tipo = 'ciclo_vida_propiedad' AND origen = 'SISTEMA'`,
      );
      const clonada = await comoAdminA('post', `/workflows/${sistema[0]?.id}/clonar`);
      expect(clonada.status).toBe(201);

      const idPropiedad = await crearPropiedad('D');

      const { rows } = await entorno.poolAdmin.query<{ def: string }>(
        `SELECT i.definicion_id::text AS def
           FROM workflow_instancia i
          WHERE i.entidad_tipo = 'propiedad' AND i.entidad_id = $1`,
        [idPropiedad],
      );
      expect(rows[0]?.def).toBe(clonada.body.id);
    });
  });
});
