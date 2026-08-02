import { BadRequestException, Injectable } from '@nestjs/common';
import type { TicketResumen } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { rolEfectivo } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import { NotificacionesOutboxService } from '../notificaciones/notificaciones-outbox.service';
import { WorkflowService } from '../workflows/workflow.service';

/**
 * Tickets de mantenimiento (feature #31, R1–R6, §6.5).
 *
 * Los tickets SON instancias del motor de #7 (`entidad_tipo='ticket'`,
 * PA-31-1): el id del ticket es `entidad_id` y los datos viven en el
 * contexto. El scoping por rol (R2, RF-M7) filtra por contexto.
 */
@Injectable()
export class TicketsService {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly outbox: NotificacionesOutboxService,
  ) {}

  /** R1 — crear una solicitud (scoping del inquilino por contrato vigente). */
  async crear(
    ctx: ContextoPeticion,
    propertyId: string,
    datos: { categoria: string; descripcion: string },
  ): Promise<TicketResumen> {
    if (!ctx.actorId) throw new ResourceNotFoundError();

    // La propiedad debe existir y (si el solicitante es inquilino) estar
    // ocupada por él (RF-M1: "la propiedad que ocupa").
    const { rows: propiedad } = await ctx.cliente.query<{ id: string }>(
      `SELECT id FROM propiedad WHERE id = $1 AND tenant_id = $2`,
      [propertyId, ctx.tenantId],
    );
    if (propiedad.length === 0) throw new ResourceNotFoundError();

    if (rolEfectivo(ctx) === 'inquilino') {
      const { rows: perfil } = await ctx.cliente.query<{ id: string }>(
        `SELECT id FROM perfil_inquilino WHERE tenant_id = $1 AND user_id = $2`,
        [ctx.tenantId, ctx.actorId],
      );
      const perfilId = perfil[0]?.id;
      if (!perfilId) throw new ResourceNotFoundError();
      const { rows: contrato } = await ctx.cliente.query<{ id: string }>(
        `SELECT id FROM contract
          WHERE tenant_id = $1 AND property_id = $2 AND inquilino_id = $3
            AND fecha_inicio <= now() AND fecha_fin >= now()
          LIMIT 1`,
        [ctx.tenantId, propertyId, perfilId],
      );
      if (contrato.length === 0) throw new ResourceNotFoundError();
    }

    const ticketId = await generarUuid();
    const definicion = await this.workflow.resolverDefinicionParaTenant('incidencias', ctx);
    if (!definicion) {
      throw new ResourceNotFoundError();
    }

    await this.workflow.crearInstancia(
      definicion.id,
      {
        entidadTipo: 'ticket',
        entidadId: ticketId,
        contexto: {
          propiedad_id: propertyId,
          solicitante_user_id: ctx.actorId,
          categoria: datos.categoria,
          descripcion: datos.descripcion,
          costo_aprobado: null,
          comentarios: [],
        },
      },
      ctx,
    );

    const instancia = await this.workflow.buscarInstanciaDeEntidad('ticket', ticketId, ctx);
    const { rows: estado } = await ctx.cliente.query<{ clave: string }>(
      `SELECT clave FROM workflow_estado WHERE id = $1`,
      [instancia?.estado_actual_id ?? ''],
    );
    return aResumen(ticketId, estado[0]?.clave ?? '', datos.categoria, datos.descripcion, propertyId, ctx.actorId);
  }

  /** R2 — listar con scoping por rol (RF-M7). */
  async listar(ctx: ContextoPeticion): Promise<TicketResumen[]> {
    const { rows } = await ctx.cliente.query<{
      entidad_id: string;
      contexto: unknown;
      estado: string;
      created_at: Date;
    }>(
      `SELECT i.entidad_id::text AS entidad_id, i.contexto,
              e.clave AS estado, i.created_at
         FROM workflow_instancia i
         JOIN workflow_estado e ON e.id = i.estado_actual_id
        WHERE i.tenant_id = $1 AND i.entidad_tipo = 'ticket'
        ORDER BY i.created_at DESC`,
      [ctx.tenantId],
    );

    const tickets: TicketResumen[] = [];
    for (const fila of rows) {
      const contexto = fila.contexto as {
        propiedad_id: string;
        solicitante_user_id: string;
        categoria: string;
        descripcion: string;
        costo_aprobado: boolean | null;
      };
      if (await this.visiblePara(ctx, fila.entidad_id, contexto)) {
        tickets.push(
          aResumen(
            fila.entidad_id,
            fila.estado,
            contexto.categoria,
            contexto.descripcion,
            contexto.propiedad_id,
            contexto.solicitante_user_id,
            contexto.costo_aprobado,
            fila.created_at,
          ),
        );
      }
    }
    return tickets;
  }

  /** R2 — detalle con scoping. */
  async obtener(ctx: ContextoPeticion, ticketId: string): Promise<TicketResumen> {
    const instancia = await this.workflow.buscarInstanciaDeEntidad('ticket', ticketId, ctx);
    if (!instancia) throw new ResourceNotFoundError();
    const contexto = instancia.contexto as {
      propiedad_id: string;
      solicitante_user_id: string;
      categoria: string;
      descripcion: string;
      costo_aprobado: boolean | null;
    };
    if (!(await this.visiblePara(ctx, ticketId, contexto))) {
      throw new ResourceNotFoundError();
    }
    const { rows: estado } = await ctx.cliente.query<{ clave: string }>(
      `SELECT clave FROM workflow_estado WHERE id = $1`,
      [instancia.estado_actual_id],
    );
    return aResumen(
      ticketId,
      estado[0]?.clave ?? '',
      contexto.categoria,
      contexto.descripcion,
      contexto.propiedad_id,
      contexto.solicitante_user_id,
      contexto.costo_aprobado,
      new Date(instancia.created_at),
    );
  }

  /** R4 — comentarios con evidencia (en el contexto). */
  async agregarComentario(
    ctx: ContextoPeticion,
    ticketId: string,
    comentario: string,
  ): Promise<void> {
    const instancia = await this.workflow.buscarInstanciaDeEntidad('ticket', ticketId, ctx);
    if (!instancia) throw new ResourceNotFoundError();
    const contexto = instancia.contexto as { comentarios?: Array<Record<string, unknown>> };
    const comentarios = [...(contexto.comentarios ?? [])];
    comentarios.push({
      autor: ctx.actorId ?? null,
      texto: comentario,
      fecha: new Date().toISOString(),
    });
    await ctx.cliente.query(
      `UPDATE workflow_instancia
          SET contexto = jsonb_set(contexto, '{comentarios}', $2::jsonb)
        WHERE id = $1 AND tenant_id = $3`,
      [instancia.id, JSON.stringify(comentarios), ctx.tenantId],
    );
  }

  /** R4 — aceptar/rechazar la resolución (cerrada o reabrir). */
  async resolver(ctx: ContextoPeticion, ticketId: string, aceptada: boolean): Promise<void> {
    const instancia = await this.workflow.buscarInstanciaDeEntidad('ticket', ticketId, ctx);
    if (!instancia) throw new ResourceNotFoundError();
    const contexto = instancia.contexto as { solicitante_user_id: string };
    if (contexto.solicitante_user_id !== ctx.actorId) {
      throw new ResourceNotFoundError();
    }
    await this.ejecutarPorClave(ctx, instancia.id, aceptada ? 'aceptar_resolucion' : 'reabrir');
  }

  /** R5 — aprobar costos (el propietario, solo de SUS propiedades). */
  async aprobarCostos(ctx: ContextoPeticion, ticketId: string, aprobado: boolean): Promise<void> {
    const instancia = await this.workflow.buscarInstanciaDeEntidad('ticket', ticketId, ctx);
    if (!instancia) throw new ResourceNotFoundError();
    const contexto = instancia.contexto as { propiedad_id: string };
    if (!(await this.esPropietarioDe(ctx, contexto.propiedad_id))) {
      throw new ResourceNotFoundError();
    }
    await this.ejecutarPorClave(ctx, instancia.id, 'aprobar_costos', { costo_aprobado: aprobado });
  }

  /** R5 — transiciones de gestión por clave (admin/empleado). */
  async transicionar(ctx: ContextoPeticion, ticketId: string, clave: string): Promise<void> {
    const instancia = await this.workflow.buscarInstanciaDeEntidad('ticket', ticketId, ctx);
    if (!instancia) throw new ResourceNotFoundError();
    await this.ejecutarPorClave(ctx, instancia.id, clave);
  }

  private async ejecutarPorClave(
    ctx: ContextoPeticion,
    instanciaId: string,
    clave: string,
    contextoExtra: Record<string, unknown> = {},
  ): Promise<void> {
    const instancia = await this.workflow.exigirInstancia(instanciaId, ctx);
    const transiciones = await this.workflow.transicionesDeDefinicion(
      instancia.definicion_id,
      ctx,
    );
    const transicion = transiciones.find((t) => t.clave === clave);
    if (!transicion) throw new ResourceNotFoundError();
    const antes = instancia.estado_actual_id;
    try {
      await this.workflow.ejecutarTransicion(
        instancia.id,
        transicion.id,
        contextoExtra,
        ctx.actorId ?? '',
        ctx,
      );
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ResourceNotFoundError();
    }
    // RF-M3: cada cambio de estado notifica al solicitante por el motor de
    // #10 (canal CORREO con el email del solicitante; RF-C4 en su
    // variante mínima).
    await this.notificarCambio(ctx, instanciaId, antes, clave);
  }

  /** RF-M3 — notificar al solicitante el cambio de estado del ticket. */
  private async notificarCambio(
    ctx: ContextoPeticion,
    instanciaId: string,
    estadoAnteriorId: string,
    clave: string,
  ): Promise<void> {
    const { rows } = await ctx.cliente.query<{
      solicitante_user_id: string;
      email: string | null;
      estado: string;
      descripcion: string;
    }>(
      `SELECT i.contexto->>'solicitante_user_id' AS solicitante_user_id,
              u.email,
              e.clave AS estado,
              i.contexto->>'descripcion' AS descripcion
         FROM workflow_instancia i
         JOIN "user" u ON u.id = (i.contexto->>'solicitante_user_id')::uuid
         JOIN workflow_estado e ON e.id = i.estado_actual_id
        WHERE i.id = $1 AND i.tenant_id = $2`,
      [instanciaId, ctx.tenantId],
    );
    const fila = rows[0];
    if (!fila?.email) return;
    void estadoAnteriorId;
    await this.outbox.crear(
      {
        destinatario: fila.email,
        canal: 'CORREO',
        contenido: {
          asunto: `Tu ticket cambió a ${fila.estado} (${clave})`,
          ticket_descripcion: fila.descripcion ?? '',
          transicion: clave,
        },
      },
      ctx,
    );
  }

  private async visiblePara(
    ctx: ContextoPeticion,
    _ticketId: string,
    contexto: { propiedad_id: string; solicitante_user_id: string },
  ): Promise<boolean> {
    const rol = rolEfectivo(ctx);
    if (rol === 'admin' || rol === 'empleado') return true;
    if (rol === 'inquilino') {
      return contexto.solicitante_user_id === ctx.actorId;
    }
    if (rol === 'propietario') {
      return this.esPropietarioDe(ctx, contexto.propiedad_id);
    }
    return false;
  }

  private async esPropietarioDe(ctx: ContextoPeticion, propertyId: string): Promise<boolean> {
    if (!ctx.actorId) return false;
    const { rows } = await ctx.cliente.query<{ id: string }>(
      `SELECT id FROM perfil_propietario
        WHERE tenant_id = $1 AND user_id = $2`,
      [ctx.tenantId, ctx.actorId],
    );
    const perfilId = rows[0]?.id;
    if (!perfilId) return false;
    const { rows: propiedad } = await ctx.cliente.query<{ id: string }>(
      `SELECT id FROM propiedad
        WHERE id = $1 AND tenant_id = $2
          AND (propietario_principal_id = $3
               OR EXISTS (SELECT 1 FROM propiedad_propietario pp
                           WHERE pp.propiedad_id = propiedad.id
                             AND pp.perfil_propietario_id = $3))`,
      [propertyId, ctx.tenantId, perfilId],
    );
    return propiedad.length > 0;
  }
}

function aResumen(
  id: string,
  estado: string,
  categoria: string,
  descripcion: string,
  propiedadId: string,
  solicitante: string,
  costoAprobado: boolean | null = null,
  creado: Date = new Date(),
): TicketResumen {
  return {
    id,
    propiedad_id: propiedadId,
    categoria,
    descripcion,
    estado,
    solicitante_user_id: solicitante,
    costo_aprobado: costoAprobado,
    created_at: creado.toISOString(),
  };
}

async function generarUuid(): Promise<string> {
  const { randomUUID } = await import('node:crypto');
  return randomUUID();
}
