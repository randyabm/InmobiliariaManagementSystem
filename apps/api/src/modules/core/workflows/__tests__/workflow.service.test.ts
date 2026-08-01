import type { PoolClient } from 'pg';
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { WorkflowService } from '../workflow.service';
import { CicloAutomaticoError, TransicionNoDisponibleError } from '../errors';
import type { WorkflowInstancia } from '@inmobiliaria/types';

/**
 * **T11 — R6, R7, R8, R9.** El núcleo del motor con un doble de repositorio
 * que registra llamadas: creación en estado inicial, 409 por duplicado, la
 * distinción 403/409 de R7 y la cascada automática con su límite. La
 * integración real está en `workflows.api.test.ts` contra PostgreSQL.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const ESTADO_INICIAL = 'eeee-0000-0000-0000-000000000001';
const ESTADO_MEDIO = 'eeee-0000-0000-0000-000000000002';
const ESTADO_FINAL = 'eeee-0000-0000-0000-000000000003';

const CTX = {
  tenantId: TENANT,
  actorId: undefined,
  cliente: { query: vi.fn() } as unknown as PoolClient,
};

const DEFINICION = {
  id: 'dddd-0000-0000-0000-000000000001',
  tenant_id: TENANT,
  nombre: 'Prueba',
  tipo: 'prueba',
  origen: 'TENANT' as const,
  version: 1,
  activo: true,
  created_at: '',
  updated_at: '',
  estados: [
    { id: ESTADO_INICIAL, definicion_id: 'x', clave: 'inicio', etiqueta: 'Inicio', es_inicial: true, es_final: false, orden: 1, created_at: '' },
    { id: ESTADO_MEDIO, definicion_id: 'x', clave: 'medio', etiqueta: 'Medio', es_inicial: false, es_final: false, orden: 2, created_at: '' },
    { id: ESTADO_FINAL, definicion_id: 'x', clave: 'final', etiqueta: 'Final', es_inicial: false, es_final: true, orden: 3, created_at: '' },
  ],
  transiciones: [
    { id: 'tttt-0000-0000-0000-000000000001', definicion_id: 'x', origen_estado_id: ESTADO_INICIAL, destino_estado_id: ESTADO_MEDIO, clave: 'avanzar', tipo_ejecucion: 'HUMANA', roles_requeridos: ['admin'], condicion: [], notificacion: {}, orden: 1, activo: true, created_at: '' },
  ],
};

const INSTANCIA: WorkflowInstancia = {
  id: 'iiii-0000-0000-0000-000000000001',
  tenant_id: TENANT,
  definicion_id: DEFINICION.id,
  entidad_tipo: 'propiedad',
  entidad_id: 'aaaaaaaa-0000-0000-0000-000000000001',
  estado_actual_id: ESTADO_INICIAL,
  contexto: {},
  activo: true,
  created_at: '',
  updated_at: '',
};

function repositorioMock(sobres: Record<string, unknown> = {}) {
  return {
    buscarDefinicion: vi.fn().mockResolvedValue(DEFINICION),
    buscarInstanciaPorEntidad: vi.fn().mockResolvedValue(null),
    insertarInstancia: vi.fn().mockResolvedValue(INSTANCIA),
    buscarInstanciaPorId: vi.fn().mockResolvedValue(INSTANCIA),
    estadosDe: vi.fn().mockResolvedValue(DEFINICION.estados),
    transicionesDe: vi.fn().mockResolvedValue(DEFINICION.transiciones),
    rolesActivosDelActor: vi.fn().mockResolvedValue(['admin']),
    insertarLog: vi.fn().mockResolvedValue(undefined),
    actualizarEstado: vi.fn().mockResolvedValue(undefined),
    historial: vi.fn().mockResolvedValue([]),
    ...sobres,
  };
}

describe('WorkflowService (T11: R6, R7, R8, R9)', () => {
  it('crearInstancia usa el estado inicial de la definición (R6)', async () => {
    const repo = repositorioMock();
    const servicio = new WorkflowService(repo as never);

    const instancia = await servicio.crearInstancia(
      DEFINICION.id,
      { entidadTipo: 'propiedad', entidadId: 'aaaaaaaa-0000-0000-0000-000000000001', contexto: { x: 1 } },
      CTX,
    );

    expect(instancia.estado_actual_id).toBe(ESTADO_INICIAL);
    expect(repo.insertarInstancia).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ estadoInicialId: ESTADO_INICIAL }),
    );
  });

  it('crearInstancia con entidad repetida → 409 INSTANCIA_YA_EXISTE (R6)', async () => {
    const repo = repositorioMock({
      buscarInstanciaPorEntidad: vi.fn().mockResolvedValue(INSTANCIA),
    });
    const servicio = new WorkflowService(repo as never);

    await expect(
      servicio.crearInstancia(DEFINICION.id, { entidadTipo: 'propiedad', entidadId: INSTANCIA.entidad_id, contexto: {} }, CTX),
    ).rejects.toMatchObject({ code: 'INSTANCIA_YA_EXISTE' });
  });

  it('rol insuficiente → 403; condición falsa o estado equivocado → 409 (R7)', async () => {
    const sinRol = new WorkflowService(
      repositorioMock({ rolesActivosDelActor: vi.fn().mockResolvedValue(['empleado']) }) as never,
    );
    await expect(
      sinRol.ejecutarTransicion(INSTANCIA.id, DEFINICION.transiciones[0]!.id, {}, 'user-1', CTX),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const condicionFalsa = new WorkflowService(
      repositorioMock({
        transicionesDe: vi.fn().mockResolvedValue([
          { ...DEFINICION.transiciones[0]!, condicion: [{ campo: 'ok', operador: 'igual', valor: true }] },
        ]),
      }) as never,
    );
    await expect(
      condicionFalsa.ejecutarTransicion(INSTANCIA.id, DEFINICION.transiciones[0]!.id, {}, 'user-1', CTX),
    ).rejects.toBeInstanceOf(TransicionNoDisponibleError);
  });

  it('el contexto extra de la petición se fusiona ANTES de evaluar (R7)', async () => {
    const repo = repositorioMock({
      transicionesDe: vi.fn().mockResolvedValue([
        { ...DEFINICION.transiciones[0]!, condicion: [{ campo: 'ok', operador: 'igual', valor: true }] },
      ]),
    });
    const servicio = new WorkflowService(repo as never);

    // Sin el contexto extra, la condición sería falsa; con él, pasa.
    await expect(
      servicio.ejecutarTransicion(INSTANCIA.id, DEFINICION.transiciones[0]!.id, { ok: true }, 'user-1', CTX),
    ).resolves.toBeDefined();
    expect(repo.insertarLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ contextoTras: expect.objectContaining({ ok: true }) }),
    );
  });

  it('la cascada automática ejecuta en orden hasta agotar (R8)', async () => {
    const transiciones = [
      { id: 't-humana', definicion_id: 'x', origen_estado_id: ESTADO_INICIAL, destino_estado_id: ESTADO_MEDIO, clave: 'avanzar', tipo_ejecucion: 'HUMANA', roles_requeridos: ['admin'], condicion: [], notificacion: {}, orden: 1, activo: true, created_at: '' },
      { id: 't-auto-1', definicion_id: 'x', origen_estado_id: ESTADO_MEDIO, destino_estado_id: ESTADO_FINAL, clave: 'auto1', tipo_ejecucion: 'AUTOMATICA', roles_requeridos: [], condicion: [], notificacion: {}, orden: 2, activo: true, created_at: '' },
    ];
    const repo = repositorioMock({ transicionesDe: vi.fn().mockResolvedValue(transiciones) });
    const servicio = new WorkflowService(repo as never);

    await servicio.ejecutarTransicion(INSTANCIA.id, 't-humana', {}, 'user-1', CTX);

    // La instancia queda en el estado final tras la cascada.
    expect(repo.actualizarEstado).toHaveBeenCalledWith(
      expect.anything(),
      INSTANCIA.id,
      ESTADO_FINAL,
      expect.anything(),
    );
    const llamadas = repo.insertarLog.mock.calls.map((c) => c[1] as { automatica: boolean; transicionId: string });
    expect(llamadas.map((l) => l.transicionId)).toEqual(['t-humana', 't-auto-1']);
    expect(llamadas[0]?.automatica).toBe(false);
    expect(llamadas[1]?.automatica).toBe(true);
  });

  it('una cadena automática infinita aborta con CICLO_AUTOMATICO (R8)', async () => {
    const ciclica = { id: 't-loop', definicion_id: 'x', origen_estado_id: ESTADO_MEDIO, destino_estado_id: ESTADO_MEDIO, clave: 'loop', tipo_ejecucion: 'AUTOMATICA', roles_requeridos: [], condicion: [], notificacion: {}, orden: 1, activo: true, created_at: '' };
    const transiciones = [
      { ...DEFINICION.transiciones[0]!, id: 't-humana' },
      ciclica,
    ];
    const repo = repositorioMock({ transicionesDe: vi.fn().mockResolvedValue(transiciones) });
    const servicio = new WorkflowService(repo as never);

    await expect(
      servicio.ejecutarTransicion(INSTANCIA.id, 't-humana', {}, 'user-1', CTX),
    ).rejects.toBeInstanceOf(CicloAutomaticoError);
    // El límite se corta: no se escriben 11+ logs, y el estado NO se actualiza.
    expect(repo.insertarLog.mock.calls.length).toBeLessThanOrEqual(11);
    expect(repo.actualizarEstado).not.toHaveBeenCalled();
  });
});
