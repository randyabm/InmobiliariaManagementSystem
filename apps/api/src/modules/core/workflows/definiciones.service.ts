import { Injectable } from '@nestjs/common';
import type { DefinicionCompleta, WorkflowDefinicion, WorkflowTransicion } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import {
  DefinicionSistemaNoEditableError,
  InstanciaYaExisteError,
} from './errors';
import { WorkflowRepository } from './workflow.repository';

/**
 * Gestión de definiciones (RF-W2 base, R4, R5). Feature #7.
 *
 * - `clonar`: copia una plantilla (del sistema o propia) a una definición
 *   `TENANT` del tenant. El `origen` se copia de la fila: la API nunca
 *   escribe filas del sistema (R13).
 * - `anadirTransicion` / `darDeBajaTransicion`: solo sobre definiciones
 *   `TENANT` (R5); las del sistema responden 409.
 */
@Injectable()
export class DefinicionesService {
  constructor(private readonly repositorio: WorkflowRepository) {}

  async listar(ctx: ContextoPeticion): Promise<WorkflowDefinicion[]> {
    return this.repositorio.listarDefiniciones(ctx);
  }

  async obtener(id: string, ctx: ContextoPeticion): Promise<DefinicionCompleta> {
    const definicion = await this.repositorio.buscarDefinicion(ctx, id);
    if (!definicion || !definicion.activo) {
      throw new ResourceNotFoundError();
    }
    return definicion;
  }

  /** R4 — clonar una plantilla a una definición editable del tenant. */
  async clonar(id: string, ctx: ContextoPeticion): Promise<WorkflowDefinicion> {
    const origen = await this.repositorio.buscarDefinicion(ctx, id);
    if (!origen || !origen.activo) {
      throw new ResourceNotFoundError();
    }

    // 404 para la ajena; la definición del sistema es legible por todos, la
    // ajena queda filtrada por RLS en `buscarDefinicion` (R14).
    if (origen.tenant_id !== ctx.tenantId && origen.origen !== 'SISTEMA') {
      throw new ResourceNotFoundError();
    }

    const duplicado = await this.repositorio.buscarDefinicionPorTipo(
      ctx,
      origen.tipo,
    );
    if (duplicado) {
      throw new InstanciaYaExisteError(
        'El tenant ya tiene una definición de ese tipo.',
      );
    }

    const cliente = ctx.cliente;
    const { id: nuevaId } = await this.repositorio.insertarDefinicion(cliente, {
      tenantId: ctx.tenantId,
      nombre: origen.nombre,
      tipo: origen.tipo,
      origen: 'TENANT',
    });
    await this.repositorio.copiarDefinicion(cliente, origen.id, nuevaId);

    const creada = await this.repositorio.buscarDefinicion(ctx, nuevaId);
    if (!creada) {
      throw new Error('La definición recién clonada no es legible.');
    }
    return creada;
  }

  /** R5 — añadir una transición a la copia del tenant. */
  async anadirTransicion(
    idDefinicion: string,
    datos: {
      clave: string;
      origenEstadoId: string;
      destinoEstadoId: string;
      tipoEjecucion: 'HUMANA' | 'AUTOMATICA';
      rolesRequeridos?: string[];
      condicion?: unknown;
      notificacion?: unknown;
      orden?: number;
    },
    ctx: ContextoPeticion,
  ): Promise<WorkflowTransicion> {
    await this.exigirEditable(idDefinicion, ctx);

    const { id } = await this.repositorio.insertarTransicion(ctx.cliente, {
      definicionId: idDefinicion,
      origenEstadoId: datos.origenEstadoId,
      destinoEstadoId: datos.destinoEstadoId,
      clave: datos.clave,
      tipoEjecucion: datos.tipoEjecucion,
      rolesRequeridos: datos.rolesRequeridos ?? [],
      condicion: datos.condicion ?? [],
      notificacion: datos.notificacion ?? {},
      orden: datos.orden ?? 0,
    });

    const transiciones = await this.repositorio.transicionesDe(ctx.cliente, idDefinicion);
    const creada = transiciones.find((t) => t.id === id);
    if (!creada) {
      throw new Error('La transición recién creada no es legible.');
    }
    return creada;
  }

  /** R5 — baja lógica de una transición de la copia del tenant. */
  async darDeBajaTransicion(
    idDefinicion: string,
    idTransicion: string,
    ctx: ContextoPeticion,
  ): Promise<void> {
    await this.exigirEditable(idDefinicion, ctx);

    const afectadas = await this.repositorio.darDeBajaTransicion(ctx, idTransicion);
    if (afectadas === 0) {
      throw new ResourceNotFoundError();
    }
  }

  /** R5 — 404 si la definición no es del tenant; 409 si es del sistema. */
  private async exigirEditable(
    idDefinicion: string,
    ctx: ContextoPeticion,
  ): Promise<void> {
    const origen = await this.repositorio.origenDeDefinicion(ctx, idDefinicion);
    if (origen === null) {
      throw new ResourceNotFoundError();
    }
    if (origen === 'SISTEMA') {
      throw new DefinicionSistemaNoEditableError();
    }
  }
}
