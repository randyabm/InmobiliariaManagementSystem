import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
  TENANT_B,
} from '../../../../../test/support/entorno-clientes';

/**
 * Invariantes de seguridad de plantillas (T16, T17, T18 → R11, R13).
 */
describe('Invariantes de seguridad de #11 (T16-T18)', () => {
  let entorno: EntornoClientes;
  let idPlantillaB: string;

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
    const servidor = () => entorno.app.getHttpServer();

    // Una plantilla del tenant B (clonada).
    const lista = await request(servidor())
      .get('/plantillas')
      .set('Authorization', `Bearer ${entorno.adminB.token}`)
      .set('x-tenant-id', TENANT_B);
    const sistema = lista.body.find(
      (p: { tipo: string; origen: string }) =>
        p.tipo === 'CASA' && p.origen === 'SISTEMA',
    );
    const clonada = await request(servidor())
      .post(`/plantillas/${sistema.id}/clonar`)
      .set('Authorization', `Bearer ${entorno.adminB.token}`)
      .set('x-tenant-id', TENANT_B);
    expect(clonada.status).toBe(201);
    idPlantillaB = clonada.body.id;
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();

  // ─── T16 — aislamiento (R11) ────────────────────────────────────────────

  describe('aislamiento por tenant (R11)', () => {
    it('la plantilla de B accedida por A → 404 indistinguible, sin escribir', async () => {
      const casos = [
        ['get', `/plantillas/${idPlantillaB}`, undefined],
        ['post', `/plantillas/${idPlantillaB}/clonar`, undefined],
        ['post', `/plantillas/${idPlantillaB}/zonas`, { nombre: 'Intruso' }],
      ] as const;

      for (const [metodo, ruta, cuerpo] of casos) {
        const peticion = request(servidor())
          [metodo](ruta)
          .set('Authorization', `Bearer ${entorno.adminA.token}`)
          .set('x-tenant-id', TENANT_A);
        const respuesta = cuerpo ? await peticion.send(cuerpo) : await peticion;
        expect(respuesta.status, `${metodo.toUpperCase()} ${ruta}`).toBe(404);
      }

      const { rows } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM plantilla_zona
          WHERE plantilla_id = $1 AND nombre = 'Intruso'`,
        [idPlantillaB],
      );
      expect(Number(rows[0]?.total)).toBe(0);
    });
  });

  // ─── T17 — RBAC (R11) ───────────────────────────────────────────────────

  describe('RBAC (R11)', () => {
    const rutas = (): Array<
      ['post' | 'get' | 'patch' | 'delete', string, Record<string, unknown> | undefined]
    > => [
      ['get', '/plantillas', undefined],
      ['get', '/plantillas/ffffffff-ffff-ffff-ffff-ffffffffffff', undefined],
      ['post', '/plantillas/ffffffff-ffff-ffff-ffff-ffffffffffff/clonar', undefined],
      ['post', '/plantillas/ffffffff-ffff-ffff-ffff-ffffffffffff/zonas', { nombre: 'X' }],
      ['patch', '/plantillas/ffffffff-ffff-ffff-ffff-ffffffffffff/zonas/ffffffff-ffff-ffff-ffff-ffffffffffff', { nombre: 'Y' }],
      ['delete', '/plantillas/ffffffff-ffff-ffff-ffff-ffffffffffff/zonas/ffffffff-ffff-ffff-ffff-ffffffffffff', undefined],
      ['post', '/plantillas/ffffffff-ffff-ffff-ffff-ffffffffffff/zonas/ffffffff-ffff-ffff-ffff-ffffffffffff/items', { nombre: 'Z', field_type: 'estado' }],
      ['patch', '/plantillas/ffffffff-ffff-ffff-ffff-ffffffffffff/zonas/ffffffff-ffff-ffff-ffff-ffffffffffff/items/ffffffff-ffff-ffff-ffff-ffffffffffff', { nombre: 'W' }],
      ['delete', '/plantillas/ffffffff-ffff-ffff-ffff-ffffffffffff/zonas/ffffffff-ffff-ffff-ffff-ffffffffffff/items/ffffffff-ffff-ffff-ffff-ffffffffffff', undefined],
    ];

    for (const rol of ['propietario', 'inquilino'] as const) {
      it(`${rol}: 403 en las 9 rutas`, async () => {
        const token =
          rol === 'propietario' ? entorno.propietarioA.token : entorno.inquilinoA.token;
        for (const [metodo, ruta, cuerpo] of rutas()) {
          const peticion = request(servidor())
            [metodo](ruta)
            .set('Authorization', `Bearer ${token}`)
            .set('x-tenant-id', TENANT_A);
          const respuesta = cuerpo ? await peticion.send(cuerpo) : await peticion;
          expect(respuesta.status, `${metodo.toUpperCase()} ${ruta}`).toBe(403);
        }
      });
    }

    it('empleado: 403 en la gestión y 200 en la lectura (PA-11-4)', async () => {
      const lista = await request(servidor())
        .get('/plantillas')
        .set('Authorization', `Bearer ${entorno.empleadoA.token}`)
        .set('x-tenant-id', TENANT_A);
      expect(lista.status).toBe(200);

      const sistema = lista.body.find(
        (p: { tipo: string; origen: string }) =>
          p.tipo === 'APARTAMENTO' && p.origen === 'SISTEMA',
      );
      const clonar = await request(servidor())
        .post(`/plantillas/${sistema.id}/clonar`)
        .set('Authorization', `Bearer ${entorno.empleadoA.token}`)
        .set('x-tenant-id', TENANT_A);
      expect(clonar.status).toBe(403);
    });

    it('sin token → 401', async () => {
      for (const [metodo, ruta, cuerpo] of rutas()) {
        const peticion = request(servidor())
          [metodo](ruta)
          .set('x-tenant-id', TENANT_A);
        const respuesta = cuerpo ? await peticion.send(cuerpo) : await peticion;
        expect(respuesta.status, `${metodo.toUpperCase()} ${ruta}`).toBe(401);
      }
    });
  });

  // ─── T18 — auditoría (R13) ──────────────────────────────────────────────

  describe('auditoría (R13)', () => {
    it('clonar y cada mutación generan su fila con entity_id correcto y metadata vacío', async () => {
      const desde = new Date();

      const lista = await request(servidor())
        .get('/plantillas')
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);
      const sistema = lista.body.find(
        (p: { tipo: string; origen: string }) =>
          p.tipo === 'LOCAL' && p.origen === 'SISTEMA',
      );
      const clonada = await request(servidor())
        .post(`/plantillas/${sistema.id}/clonar`)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);
      expect(clonada.status).toBe(201);

      const zona = await request(servidor())
        .post(`/plantillas/${clonada.body.id}/zonas`)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A)
        .send({ nombre: 'Zona Audit' });
      expect(zona.status).toBe(201);

      const item = await request(servidor())
        .post(`/plantillas/${clonada.body.id}/zonas/${zona.body.id}/items`)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A)
        .send({ nombre: 'Item Audit', field_type: 'estado' });
      expect(item.status).toBe(201);

      const esperadas: Array<[string, string, string]> = [
        ['crear', 'plantilla_inmueble', clonada.body.id],
        ['crear', 'plantilla_zona', zona.body.id],
        ['crear', 'plantilla_item', item.body.id],
      ];
      for (const [accion, entityType, entityId] of esperadas) {
        const { rows } = await entorno.poolAdmin.query<{
          total: string;
          tenant_id: string;
          actor_id: string;
          metadata: Record<string, unknown> | null;
        }>(
          `SELECT count(*)::text AS total,
                  min(tenant_id::text) AS tenant_id,
                  min(actor_id::text) AS actor_id,
                  min(metadata::text)::jsonb AS metadata
             FROM audit_log
            WHERE accion = $1 AND entity_type = $2 AND entity_id = $3
              AND created_at >= $4`,
          [accion, entityType, entityId, desde],
        );
        expect(Number(rows[0]?.total), `${accion}/${entityType}`).toBe(1);
        expect(rows[0]?.tenant_id).toBe(TENANT_A);
        expect(rows[0]?.actor_id).toBe(entorno.adminA.id);
        expect(rows[0]?.metadata).toBeNull();
      }
    });
  });
});
