import { Injectable, ForbiddenException } from '@nestjs/common';
import type {
  InstanciaConDisponibles,
  WorkflowEstado,
  WorkflowInstancia,
  WorkflowTransicion,
} from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import { NotificacionesOutboxService } from '../notificaciones/notificaciones-outbox.service';
import { cumpleCondicion } from './evaluador-condiciones';
import {
  CicloAutomaticoError,
  InstanciaYaExisteError,
  TransicionNoDisponibleError,
} from './errors';
import { WorkflowRepository } from './workflow.repository';

/**
 * Núcleo de ejecución del motor (RF-W1, R7, R8, R9). Feature #7.
 *
 * La cascada automática (R8) corre en la transacción de la petición (la
 * abre `TenantContextInterceptor`): no hay procesos en segundo plano, y si
 * la cadena excede el límite, el 409 hace rollback de TODO —la transición
 * humana incluida—.
 */
@Injectable()
export class WorkflowService {
  private static readonly LIMITE_CASCADA = 10;

  constructor(
    private readonly repositorio: WorkflowRepository,
    private readonly notificaciones: NotificacionesOutboxService,
  ) {}

  /** R6 — crear la instancia en el estado inicial. */
  async crearInstancia(
    definicionId: string,
    datos: { entidadTipo: string; entidadId: string; contexto: unknown },
    ctx: ContextoPeticion,
  ): Promise<WorkflowInstancia> {
    const definicion = await this.repositorio.buscarDefinicion(ctx, definicionId);
    if (!definicion) {
      throw new ResourceNotFoundError();
    }
    if (!definicion.activo) {
      throw new ResourceNotFoundError();
    }

    const existente = await this.repositorio.buscarInstanciaPorEntidad(
      ctx,
      definicionId,
      datos.entidadTipo,
      datos.entidadId,
    );
    if (existente) {
      throw new InstanciaYaExisteError();
    }

    const estadoInicial = definicion.estados.find((e) => e.es_inicial);
    if (!estadoInicial) {
      throw new TransicionNoDisponibleError(
        'La definición no tiene un estado inicial.',
      );
    }

    return this.repositorio.insertarInstancia(ctx, {
      definicionId,
      entidadTipo: datos.entidadTipo,
      entidadId: datos.entidadId,
      estadoInicialId: estadoInicial.id,
      contexto: datos.contexto,
    });
  }

  /** R9 — estado actual + transiciones HUMANAS disponibles para el actor. */
  async consultarInstancia(
    idInstancia: string,
    actorId: string,
    ctx: ContextoPeticion,
  ): Promise<InstanciaConDisponibles> {
    const instancia = await this.exigirInstancia(idInstancia, ctx);
    const [estados, transiciones, roles] = await Promise.all([
      this.repositorio.estadosDe(ctx.cliente, instancia.definicion_id),
      this.repositorio.transicionesDe(ctx.cliente, instancia.definicion_id),
      this.repositorio.rolesActivosDelActor(ctx, actorId),
    ]);

    const disponibles = transiciones.filter((t) =>
      this.humanaDisponible(t, instancia, estados, roles, instancia.contexto),
    );

    return { instancia, transiciones_disponibles: disponibles };
  }

  /** R7, R8 — ejecutar una transición humana con cascada automática. */
  async ejecutarTransicion(
    idInstancia: string,
    idTransicion: string,
    contextoExtra: unknown,
    actorId: string,
    ctx: ContextoPeticion,
  ): Promise<WorkflowInstancia> {
    const instancia = await this.exigirInstancia(idInstancia, ctx);
    const [estados, transiciones, roles] = await Promise.all([
      this.repositorio.estadosDe(ctx.cliente, instancia.definicion_id),
      this.repositorio.transicionesDe(ctx.cliente, instancia.definicion_id),
      this.repositorio.rolesActivosDelActor(ctx, actorId),
    ]);

    const transicion = transiciones.find((t) => t.id === idTransicion);
    if (!transicion || transicion.tipo_ejecucion !== 'HUMANA') {
      throw new TransicionNoDisponibleError();
    }

    // R7: rol → 403; el resto de los fallos → 409 sin distinguir cuál.
    if (transicion.roles_requeridos.length > 0 &&
        !transicion.roles_requeridos.some((r) => roles.includes(r))) {
      throw new ForbiddenException('Rol insuficiente');
    }

    const contexto = { ...instancia.contexto, ...(normalizarContexto(contextoExtra)) };

    // Primera parada: la transición humana pedida debe estar disponible con
    // el contexto YA fusionado (R7: la condición se evalúa sobre el contexto
    // que la petición declara, no sobre el viejo de la instancia).
    const disponibles = transiciones.filter((t) =>
      this.humanaDisponible(t, instancia, estados, roles, contexto),
    );
    if (!disponibles.some((t) => t.id === idTransicion)) {
      throw new TransicionNoDisponibleError();
    }

    let estadoActual = instancia.estado_actual_id;
    let pasosAutomaticos = 0;

    // Paso 1: la transición humana.
    estadoActual = transicion.destino_estado_id;
    await this.registrar(instancia, transicion, estadoActual, contexto, actorId, false, ctx);

    // Pasos 2..n: cascada automática.
    for (;;) {
      const automaticas = transiciones.filter(
        (t) =>
          t.tipo_ejecucion === 'AUTOMATICA' &&
          t.activo &&
          t.origen_estado_id === estadoActual &&
          cumpleCondicion(t.condicion, contexto),
      );
      if (automaticas.length === 0) break;

      pasosAutomaticos += 1;
      if (pasosAutomaticos > WorkflowService.LIMITE_CASCADA) {
        throw new CicloAutomaticoError();
      }

      const siguiente = automaticas[0]!;
      estadoActual = siguiente.destino_estado_id;
      await this.registrar(instancia, siguiente, estadoActual, contexto, null, true, ctx);
    }

    // Actualiza la instancia (en la misma transacción de la petición).
    await this.repositorio.actualizarEstado(ctx.cliente, instancia.id, estadoActual, contexto);

    return this.exigirInstancia(idInstancia, ctx);
  }

  /** R11 — el log de la instancia, ordenado por `created_at` ascendente. */
  async historial(idInstancia: string, ctx: ContextoPeticion) {
    await this.exigirInstancia(idInstancia, ctx);
    return this.repositorio.historial(ctx, idInstancia);
  }

  /**
   * PA-8-3 (feature #8) — la definición activa para un tenant: la copia
   * `TENANT` si existe, si no la plantilla `SISTEMA`.
   */
  resolverDefinicionParaTenant(tipo: string, ctx: ContextoPeticion) {
    return this.repositorio.buscarDefinicionParaTenant(ctx, tipo);
  }

  /** Feature #8 — las transiciones de una definición (lectura con RLS). */
  transicionesDeDefinicion(definicionId: string, ctx: ContextoPeticion) {
    return this.repositorio.transicionesDe(ctx.cliente, definicionId);
  }

  /** Feature #8 — la instancia de una entidad (una por definición y entidad). */
  async buscarInstanciaDeEntidad(
    entidadTipo: string,
    entidadId: string,
    ctx: ContextoPeticion,
  ) {
    return this.repositorio.buscarInstanciaPorEntidadSinDefinicion(
      ctx,
      entidadTipo,
      entidadId,
    );
  }

  // ─── Privado ────────────────────────────────────────────────────────────

  private async registrar(
    instancia: WorkflowInstancia,
    transicion: WorkflowTransicion,
    haciaEstadoId: string,
    contexto: Record<string, unknown>,
    actorId: string | null,
    automatica: boolean,
    ctx: ContextoPeticion,
  ): Promise<void> {
    await this.repositorio.insertarLog(ctx.cliente, {
      tenantId: ctx.tenantId,
      instanciaId: instancia.id,
      transicionId: transicion.id,
      desdeEstadoId: transicion.origen_estado_id,
      haciaEstadoId,
      actorId,
      automatica,
      contextoTras: contexto,
    });

    // R2, R18 (feature #10): el gancho de notificaciones es transaccional.
    // Si la transición revierte, la fila del outbox revierte con ella; el
    // hook vacío no escribe nada y la semántica del motor no cambia.
    await this.notificaciones.escribirDesdeTransicion(instancia, transicion, ctx);
  }

  private humanaDisponible(
    t: WorkflowTransicion,
    instancia: WorkflowInstancia,
    estados: WorkflowEstado[],
    roles: string[],
    contexto: Record<string, unknown>,
  ): boolean {
    if (t.tipo_ejecucion !== 'HUMANA') return false;
    if (!t.activo) return false;
    if (t.origen_estado_id !== instancia.estado_actual_id) return false;
    if (!cumpleCondicion(t.condicion, contexto)) return false;
    if (t.roles_requeridos.length > 0 &&
        !t.roles_requeridos.some((r) => roles.includes(r))) {
      return false;
    }
    // Los estados finales no tienen salidas; los estados inexistentes tampoco.
    const origen = estados.find((e) => e.id === t.origen_estado_id);
    if (!origen) return false;
    return true;
  }

  async exigirInstancia(id: string, ctx: ContextoPeticion): Promise<WorkflowInstancia> {
    const instancia = await this.repositorio.buscarInstanciaPorId(ctx, id);
    if (!instancia || !instancia.activo) {
      throw new ResourceNotFoundError();
    }
    return instancia;
  }
}

function normalizarContexto(valor: unknown): Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null) return {};
  return valor as Record<string, unknown>;
}
