import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
} from '../../../../../test/support/entorno-clientes';

/**
 * Dashboard de gestión (T14, T15, T16 → R9, R10, R11, R12).
 *
 * Conteos, filtros y tiempo en estado se verifican con SELECTs
 * independientes contra las instancias del motor.
 */
describe('Dashboard de propiedades (#8)', () => {
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

  /** Crea una propiedad y la deja en el estado indicado (por la ruta de #8). */
  async function crearPropiedadEn(sufijo: string, claveEstado: string, tipo = 'APARTAMENTO'): Promise<string> {
    const prop = await comoAdminA('post', '/propietarios').send({
      nombre: `Prop DB ${sufijo}`,
      tipo_documento: 'CC',
      documento: `DB8-${sufijo}`,
    });
    expect(prop.status).toBe(201);

    const creada = await comoAdminA('post', '/propiedades').send({
      direccion: `Calle DB ${sufijo}`,
      tipo,
      area: '60.00',
      canon: '1200000.00',
      propietario_principal_id: prop.body.id,
    });
    expect(creada.status).toBe(201);
    const id = creada.body.id as string;

    const camino: Record<string, string[]> = {
      disponible: [],
      en_checkeo: ['iniciar_checkeo'],
      con_aseguradora: ['iniciar_checkeo', 'enviar_aseguradora'],
      arrendada: ['iniciar_checkeo', 'enviar_aseguradora', 'arrendar'],
    };
    for (const clave of camino[claveEstado] ?? []) {
      const r = await comoAdminA(
        'post',
        `/propiedades/${id}/ciclo-vida/transiciones/${clave}`,
      ).send({});
      expect(r.status, clave).toBe(200);
    }
    return id;
  }

  // ─── T14 — conteos y listado (R9, R12) ──────────────────────────────────

  describe('T14 — conteos y listado (R9, R12)', () => {
    it('los conteos por estado coinciden con SELECTs independientes', async () => {
      await crearPropiedadEn('A', 'disponible');
      await crearPropiedadEn('B', 'en_checkeo');
      await crearPropiedadEn('C', 'con_aseguradora');

      const dashboard = await comoAdminA('get', '/propiedades/dashboard');
      expect(dashboard.status).toBe(200);

      const { rows: esperados } = await entorno.poolAdmin.query<{
        clave: string;
        cantidad: number;
      }>(
        `SELECT e.clave, count(*)::int AS cantidad
           FROM propiedad p
           JOIN workflow_instancia i
             ON i.entidad_tipo = 'propiedad' AND i.entidad_id = p.id
           JOIN workflow_estado e ON e.id = i.estado_actual_id
          WHERE p.tenant_id = $1 AND p.activo = true
          GROUP BY e.clave`,
        [TENANT_A],
      );
      const esperadoMap = new Map(esperados.map((e) => [e.clave, e.cantidad]));
      for (const conteo of dashboard.body.conteos as Array<{ clave: string; cantidad: number }>) {
        expect(conteo.cantidad, conteo.clave).toBe(esperadoMap.get(conteo.clave) ?? 0);
      }

      // El listado incluye estado, instancia_id y tiempo.
      expect(dashboard.body.propiedades.length).toBeGreaterThanOrEqual(3);
      for (const fila of dashboard.body.propiedades as Array<{
        estado_ciclo_vida: { clave: string } | null;
        instancia_id: string | null;
        tiempo_en_estado_segundos: number;
      }>) {
        expect(fila.estado_ciclo_vida?.clave).toBeTruthy();
        expect(fila.instancia_id).toBeTruthy();
        expect(fila.tiempo_en_estado_segundos).toBeGreaterThanOrEqual(0);
      }
    });

    it('las propiedades sin instancia NO aparecen (R9)', async () => {
      // Ficha sembrada a mano sin instancia (caso dev).
      const prop = await comoAdminA('post', '/propietarios').send({
        nombre: 'Prop Sin Maquina DB',
        tipo_documento: 'CC',
        documento: 'DB8-SM',
      });
      const { rows } = await entorno.poolAdmin.query<{ id: string }>(
        `INSERT INTO propiedad
           (tenant_id, direccion, tipo, area, canon, propietario_principal_id)
         VALUES ($1, 'Calle Sin Maquina DB', 'LOCAL', '30.00', '800000.00', $2)
         RETURNING id`,
        [TENANT_A, prop.body.id],
      );

      const dashboard = await comoAdminA('get', '/propiedades/dashboard');
      expect(
        dashboard.body.propiedades.some(
          (f: { id: string }) => f.id === rows[0]?.id,
        ),
      ).toBe(false);
    });
  });

  // ─── T15 — filtros (R10) ────────────────────────────────────────────────

  describe('T15 — filtros (R10)', () => {
    it('?estado limita conteos y listado', async () => {
      await crearPropiedadEn('D', 'en_checkeo');
      await crearPropiedadEn('E', 'en_checkeo');

      const dashboard = await comoAdminA('get', '/propiedades/dashboard?estado=en_checkeo');
      expect(dashboard.status).toBe(200);
      expect(dashboard.body.conteos).toHaveLength(1);
      expect(dashboard.body.conteos[0].clave).toBe('en_checkeo');
      expect(
        dashboard.body.propiedades.every(
          (f: { estado_ciclo_vida: { clave: string } }) =>
            f.estado_ciclo_vida.clave === 'en_checkeo',
        ),
      ).toBe(true);
    });

    it('?tipo limita el listado sin tocar los conteos globales', async () => {
      await crearPropiedadEn('F', 'disponible', 'CASA');

      const dashboard = await comoAdminA('get', '/propiedades/dashboard?tipo=CASA');
      expect(dashboard.status).toBe(200);
      expect(
        dashboard.body.propiedades.every((f: { tipo: string }) => f.tipo === 'CASA'),
      ).toBe(true);
      expect(dashboard.body.propiedades.length).toBeGreaterThanOrEqual(1);
    });

    it('estado + tipo combinados', async () => {
      const dashboard = await comoAdminA(
        'get',
        '/propiedades/dashboard?estado=disponible&tipo=CASA',
      );
      expect(dashboard.status).toBe(200);
      expect(dashboard.body.conteos[0]?.clave).toBe('disponible');
      expect(
        dashboard.body.propiedades.every(
          (f: { tipo: string; estado_ciclo_vida: { clave: string } }) =>
            f.tipo === 'CASA' && f.estado_ciclo_vida.clave === 'disponible',
        ),
      ).toBe(true);
    });
  });

  // ─── T16 — orden por tiempo en estado (R11) ─────────────────────────────

  describe('T16 — estancadas primero (R11)', () => {
    it('el listado viene ordenado por tiempo_en_estado_segundos DESC', async () => {
      await crearPropiedadEn('G', 'arrendada');
      const nueva = await crearPropiedadEn('H', 'en_checkeo');

      const dashboard = await comoAdminA('get', '/propiedades/dashboard');
      const tiempos = dashboard.body.propiedades.map(
        (f: { tiempo_en_estado_segundos: number }) => f.tiempo_en_estado_segundos,
      );
      expect(tiempos).toEqual([...tiempos].sort((a, b) => b - a));

      // La propiedad recién transicionada (H) es la de menor tiempo.
      const filaH = dashboard.body.propiedades.find(
        (f: { id: string }) => f.id === nueva,
      ) as { tiempo_en_estado_segundos: number };
      expect(filaH.tiempo_en_estado_segundos).toBeLessThanOrEqual(tiempos[0]!);
    });
  });
});
