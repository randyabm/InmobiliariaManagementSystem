import { describe, expect, it } from 'vitest';

import type { ContextoPeticion } from '../../../../common/database/cliente-tenant';
import { WorkflowRepository } from '../workflow.repository';

/**
 * **T2 — R2 (PA-8-3).** `buscarDefinicionParaTenant` prefiere la copia del
 * tenant y cae a la plantilla del sistema: el doble solo registra el SQL y
 * los parámetros — la precedencia real se prueba en T6 contra PostgreSQL.
 */

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_SISTEMA = '00000000-0000-0000-0000-000000000000';

const CTX = {
  tenantId: TENANT_A,
  actorId: undefined,
  cliente: {} as never,
} as ContextoPeticion;

describe('WorkflowRepository.buscarDefinicionParaTenant (T2: R2)', () => {
  it('la consulta prefiere la copia TENANT y cae a la SISTEMA, una sola fila', async () => {
    const consultas: Array<{ sql: string; parametros: readonly unknown[] }> = [];
    const cliente = {
      query: (sql: string, parametros: unknown[] = []) => {
        consultas.push({ sql, parametros });
        return Promise.resolve({
          rows: [
            {
              id: 'copiada',
              tenant_id: TENANT_A,
              nombre: 'Copia',
              tipo: 'ciclo_vida_propiedad',
              origen: 'TENANT',
              version: 1,
              activo: true,
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
          rowCount: 1,
        });
      },
    } as never;
    const repositorio = new WorkflowRepository();

    const definicion = await repositorio.buscarDefinicionParaTenant(
      { ...CTX, cliente } as ContextoPeticion,
      'ciclo_vida_propiedad',
    );

    expect(definicion?.id).toBe('copiada');
    const [consulta] = consultas;
    expect(consulta?.sql).toContain('LIMIT 1');
    expect(consulta?.sql).toContain('CASE WHEN tenant_id = $2 THEN 0 ELSE 1 END');
    // El tenant del sistema entra en el OR: la SISTEMA es el fallback.
    expect(consulta?.parametros).toEqual([
      'ciclo_vida_propiedad',
      TENANT_A,
    ]);
    expect(consulta?.sql).toContain(TENANT_SISTEMA);
  });

  it('sin filas devuelve null (tipo inexistente)', async () => {
    const cliente = {
      query: () => Promise.resolve({ rows: [], rowCount: 0 }),
    } as never;
    const repositorio = new WorkflowRepository();

    const definicion = await repositorio.buscarDefinicionParaTenant(
      { ...CTX, cliente } as ContextoPeticion,
      'no_existe',
    );

    expect(definicion).toBeNull();
  });
});
