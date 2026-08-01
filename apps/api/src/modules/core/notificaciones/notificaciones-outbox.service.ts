import { Injectable } from '@nestjs/common';
import type {
  HookNotificacion,
  NotificacionEnviada,
  NotificacionPendiente,
  NotificacionProgramada,
  WorkflowInstancia,
  WorkflowTransicion,
} from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';

/**
 * Outbox de notificaciones (feature #10, R1, R2, R8).
 *
 * `escribirDesdeTransicion` es el gancho del motor (PA-10-4): construye el
 * `contenido` con sustitución mínima y escribe la fila en el `ctx.cliente`
 * de la petición — la MISMA transacción que la transición del workflow
 * (si revierte, la notificación también, R2).
 *
 * El outbox guarda la INTENCIÓN: el destinatario final se resuelve al
 * procesar (R7), no al encolar.
 */
@Injectable()
export class NotificacionesOutboxService {
  /** R2, R18 — el gancho del motor. */
  async escribirDesdeTransicion(
    instancia: WorkflowInstancia,
    transicion: WorkflowTransicion,
    ctx: ContextoPeticion,
  ): Promise<void> {
    const hook = hookDe(transicion);
    if (!hook) return;

    const canal = hook.canal ?? null;
    const destinatario =
      hook.destinatario?.email ?? hook.destinatario?.celular ?? null;

    await ctx.cliente.query(
      `INSERT INTO notificacion_pendiente
         (tenant_id, canal, destinatario, plantilla, contenido,
          entidad_tipo, entidad_id, transicion_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        ctx.tenantId,
        canal,
        destinatario,
        hook.plantilla ?? null,
        JSON.stringify(contenidoDe(instancia, hook)),
        instancia.entidad_tipo,
        instancia.entidad_id,
        transicion.id,
      ],
    );
  }

  /** R8 — envío manual: misma tabla, misma semántica. */
  async crear(
    datos: {
      destinatario: string;
      canal: string;
      contenido: unknown;
    },
    ctx: ContextoPeticion,
  ): Promise<{ id: string }> {
    const { rows } = await ctx.cliente.query<{ id: string }>(
      `INSERT INTO notificacion_pendiente
         (tenant_id, canal, destinatario, contenido, estado)
       VALUES ($1, $2, $3, $4, 'PENDIENTE')
       RETURNING id`,
      [ctx.tenantId, datos.canal, datos.destinatario, JSON.stringify(datos.contenido ?? {})],
    );
    return { id: rows[0]!.id };
  }

  /** R9 — la fila del outbox por id (para el 201 de R8). */
  async buscarPendiente(id: string, ctx: ContextoPeticion): Promise<NotificacionPendiente> {
    const { rows } = await ctx.cliente.query(
      `SELECT id, tenant_id::text AS tenant_id, canal, destinatario, plantilla,
              contenido, entidad_tipo, entidad_id::text AS entidad_id,
              transicion_id::text AS transicion_id, estado, intentos, error,
              created_at, procesada_en
         FROM notificacion_pendiente
        WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    if (!rows[0]) {
      throw new ResourceNotFoundError();
    }
    return aPendiente(rows[0]);
  }

  /** R9 — entregas y pendientes del tenant, más recientes primero. */
  async listar(ctx: ContextoPeticion): Promise<{
    enviadas: NotificacionEnviada[];
    pendientes: NotificacionPendiente[];
  }> {
    const { rows: enviadas } = await ctx.cliente.query(
      `SELECT id, tenant_id::text AS tenant_id, canal, destinatario,
              entidad_tipo, entidad_id::text AS entidad_id, plantilla,
              contenido, estado, created_at
         FROM notificacion_enviada
        WHERE tenant_id = $1
        ORDER BY created_at DESC`,
      [ctx.tenantId],
    );
    const { rows: pendientes } = await ctx.cliente.query(
      `SELECT id, tenant_id::text AS tenant_id, canal, destinatario, plantilla,
              contenido, entidad_tipo, entidad_id::text AS entidad_id,
              transicion_id::text AS transicion_id, estado, intentos, error,
              created_at, procesada_en
         FROM notificacion_pendiente
        WHERE tenant_id = $1
        ORDER BY created_at DESC`,
      [ctx.tenantId],
    );
    return {
      enviadas: enviadas.map(aEnviada),
      pendientes: pendientes.map(aPendiente),
    };
  }

  /** R11 — programar un recordatorio. */
  async programar(
    datos: {
      programadaPara: Date;
      destinatario: string;
      canal: string;
      plantilla: string | null;
      contenido: unknown;
      entidadTipo: string | null;
      entidadId: string | null;
    },
    ctx: ContextoPeticion,
  ): Promise<NotificacionProgramada> {
    const { rows } = await ctx.cliente.query(
      `INSERT INTO notificacion_programada
         (tenant_id, programada_para, destinatario, canal, plantilla,
          contenido, entidad_tipo, entidad_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, tenant_id::text AS tenant_id, programada_para, estado,
                 destinatario, canal, plantilla, contenido, entidad_tipo,
                 entidad_id::text AS entidad_id, created_at, ejecutada_en`,
      [
        ctx.tenantId,
        datos.programadaPara,
        datos.destinatario,
        datos.canal,
        datos.plantilla,
        JSON.stringify(datos.contenido ?? {}),
        datos.entidadTipo,
        datos.entidadId,
      ],
    );
    return aProgramada(rows[0]!);
  }

  /** R11 — listar los recordatorios del tenant. */
  async listarProgramadas(ctx: ContextoPeticion): Promise<NotificacionProgramada[]> {
    const { rows } = await ctx.cliente.query(
      `SELECT id, tenant_id::text AS tenant_id, programada_para, estado,
              destinatario, canal, plantilla, contenido, entidad_tipo,
              entidad_id::text AS entidad_id, created_at, ejecutada_en
         FROM notificacion_programada
        WHERE tenant_id = $1
        ORDER BY programada_para`,
      [ctx.tenantId],
    );
    return rows.map(aProgramada);
  }

  /** R11 — cancelar (baja lógica); 404 si no existe o es de otro tenant. */
  async cancelarProgramada(id: string, ctx: ContextoPeticion): Promise<void> {
    const { rowCount } = await ctx.cliente.query(
      `UPDATE notificacion_programada SET estado = 'CANCELADA'
        WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    if ((rowCount ?? 0) === 0) {
      throw new ResourceNotFoundError();
    }
  }
}

interface FilaPendiente {
  id: string;
  tenant_id: string;
  canal: string | null;
  destinatario: string | null;
  plantilla: string | null;
  contenido: unknown;
  entidad_tipo: string | null;
  entidad_id: string | null;
  transicion_id: string | null;
  estado: 'PENDIENTE' | 'PROCESADA' | 'FALLIDA';
  intentos: number;
  error: string | null;
  created_at: Date;
  procesada_en: Date | null;
}

function aPendiente(fila: unknown): NotificacionPendiente {
  const f = fila as FilaPendiente;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    canal: f.canal as NotificacionPendiente['canal'],
    destinatario: f.destinatario,
    plantilla: f.plantilla,
    contenido:
      typeof f.contenido === 'object' && f.contenido !== null
        ? (f.contenido as Record<string, unknown>)
        : {},
    entidad_tipo: f.entidad_tipo,
    entidad_id: f.entidad_id,
    transicion_id: f.transicion_id,
    estado: f.estado,
    intentos: f.intentos,
    error: f.error,
    created_at: f.created_at.toISOString(),
    procesada_en: f.procesada_en ? f.procesada_en.toISOString() : null,
  };
}

interface FilaEnviada {
  id: string;
  tenant_id: string;
  canal: string;
  destinatario: string;
  entidad_tipo: string | null;
  entidad_id: string | null;
  plantilla: string | null;
  contenido: unknown;
  estado: 'PROCESADA' | 'FALLIDA';
  created_at: Date;
}

function aEnviada(fila: unknown): NotificacionEnviada {
  const f = fila as FilaEnviada;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    canal: f.canal as NotificacionEnviada['canal'],
    destinatario: f.destinatario,
    entidad_tipo: f.entidad_tipo,
    entidad_id: f.entidad_id,
    plantilla: f.plantilla,
    contenido:
      typeof f.contenido === 'object' && f.contenido !== null
        ? (f.contenido as Record<string, unknown>)
        : {},
    estado: f.estado,
    created_at: f.created_at.toISOString(),
  };
}

interface FilaProgramada {
  id: string;
  tenant_id: string;
  programada_para: Date;
  estado: 'PENDIENTE' | 'EJECUTADA' | 'CANCELADA';
  destinatario: string;
  canal: string;
  plantilla: string | null;
  contenido: unknown;
  entidad_tipo: string | null;
  entidad_id: string | null;
  created_at: Date;
  ejecutada_en: Date | null;
}

function aProgramada(fila: unknown): NotificacionProgramada {
  const f = fila as FilaProgramada;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    programada_para: f.programada_para.toISOString(),
    estado: f.estado,
    destinatario: f.destinatario,
    canal: f.canal as NotificacionProgramada['canal'],
    plantilla: f.plantilla,
    contenido:
      typeof f.contenido === 'object' && f.contenido !== null
        ? (f.contenido as Record<string, unknown>)
        : {},
    entidad_tipo: f.entidad_tipo,
    entidad_id: f.entidad_id,
    created_at: f.created_at.toISOString(),
    ejecutada_en: f.ejecutada_en ? f.ejecutada_en.toISOString() : null,
  };
}

/** El hook si la transición lo declara; `null` si está vacío (R2). */
function hookDe(transicion: WorkflowTransicion): HookNotificacion | null {
  const hook = transicion.notificacion;
  if (!hook || typeof hook !== 'object') return null;
  if (Object.keys(hook).length === 0) return null;
  return hook;
}

/** Sustitución mínima de variables: `{entidad}` y `{estado}` (design §2). */
function contenidoDe(
  instancia: WorkflowInstancia,
  hook: HookNotificacion,
): Record<string, unknown> {
  const contenido: Record<string, unknown> = {
    entidad: instancia.entidad_id,
    estado: instancia.estado_actual_id,
  };
  if (hook.plantilla) {
    contenido.plantilla = hook.plantilla;
  }
  return contenido;
}
