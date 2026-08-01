import { describe, expect, it, vi } from 'vitest';

import { ResourceNotFoundError } from '../../../../common/errors';
import { WorkflowService } from '../../workflows/workflow.service';
import { TransicionNoDisponibleError } from '../../workflows/errors';
import { PropiedadesService } from '../propiedades.service';
import { CicloVidaService } from '../ciclo-vida.service';

/**
 * **T21 — R5, R13.** La envoltura de negocio: 404 de propiedad ajena/
 * inexistente, 409 de clave no encontrada y delegación al motor con los ids
 * correctos. El doble registra llamadas; la integración real está en
 * `ciclo-vida.api.test.ts`.
 */

const CTX = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  actorId: undefined,
  cliente: {} as never,
} as never;

const PROPIEDAD = { id: 'propiedad-1' };
const INSTANCIA = { id: 'instancia-1', definicion_id: 'definicion-1' };

function entorno(sobres: Record<string, unknown> = {}) {
  const workflow = {
    consultarInstancia: vi.fn().mockResolvedValue({
      instancia: { id: 'instancia-1' },
      transiciones_disponibles: [],
    }),
    transicionesDeDefinicion: vi.fn().mockResolvedValue([
      { id: 'trans-1', clave: 'iniciar_checkeo', tipo_ejecucion: 'HUMANA' },
      { id: 'trans-2', clave: 'auto', tipo_ejecucion: 'AUTOMATICA' },
    ]),
    ejecutarTransicion: vi.fn().mockResolvedValue({ id: 'instancia-1' }),
    buscarInstanciaDeEntidad: vi.fn().mockResolvedValue(INSTANCIA),
    ...sobres,
  } as unknown as WorkflowService;

  const propiedades = {
    exigir: vi.fn().mockResolvedValue(PROPIEDAD),
  } as unknown as PropiedadesService;

  const repositorio = {
    estadoCicloVida: vi.fn().mockResolvedValue({
      clave: 'disponible',
      etiqueta: 'Disponible / Vacante',
      desde: '2026-01-01T00:00:00.000Z',
    }),
  };

  const servicio = new CicloVidaService(propiedades, repositorio as never, workflow);
  return { servicio, workflow, propiedades, repositorio };
}

describe('CicloVidaService (T21: R5, R13)', () => {
  it('una propiedad inexistente o ajena es 404, sin tocar el motor (R13)', async () => {
    const { servicio, propiedades, workflow } = entorno();
    (propiedades.exigir as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ResourceNotFoundError(),
    );

    await expect(
      servicio.ejecutar('ajena', 'iniciar_checkeo', {}, 'user-1', CTX),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(workflow.buscarInstanciaDeEntidad).not.toHaveBeenCalled();
  });

  it('una clave inexistente o automática es 409 indistinguible (R5)', async () => {
    const { servicio, workflow } = entorno();
    await expect(
      servicio.ejecutar('propiedad-1', 'no_existe', {}, 'user-1', CTX),
    ).rejects.toBeInstanceOf(TransicionNoDisponibleError);
    await expect(
      servicio.ejecutar('propiedad-1', 'auto', {}, 'user-1', CTX),
    ).rejects.toBeInstanceOf(TransicionNoDisponibleError);
    expect(workflow.ejecutarTransicion).not.toHaveBeenCalled();
  });

  it('delega en el motor con la instancia y la transición resueltas (R5)', async () => {
    const { servicio, workflow } = entorno();

    const resultado = await servicio.ejecutar(
      'propiedad-1',
      'iniciar_checkeo',
      { ok: true },
      'user-1',
      CTX,
    );

    expect(workflow.buscarInstanciaDeEntidad).toHaveBeenCalledWith(
      'propiedad',
      'propiedad-1',
      CTX,
    );
    expect(workflow.ejecutarTransicion).toHaveBeenCalledWith(
      'instancia-1',
      'trans-1',
      { ok: true },
      'user-1',
      CTX,
    );
    expect(resultado.propiedad_id).toBe('propiedad-1');
  });

  it('una instancia inexistente (propiedad sin máquina) es 404 (R13)', async () => {
    const { servicio } = entorno({
      buscarInstanciaDeEntidad: vi.fn().mockResolvedValue(null),
    });

    await expect(
      servicio.ejecutar('propiedad-1', 'iniciar_checkeo', {}, 'user-1', CTX),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it('consultar devuelve estado + disponibles del motor (R4)', async () => {
    const { servicio } = entorno();

    const resultado = await servicio.consultar('propiedad-1', 'user-1', CTX);

    expect(resultado.estado.clave).toBe('disponible');
    expect(resultado.transiciones_disponibles).toEqual([]);
  });
});
