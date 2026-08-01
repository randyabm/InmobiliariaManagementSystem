import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  DefinicionCompleta,
  WorkflowDefinicion,
  WorkflowEstado,
  WorkflowInstancia,
  WorkflowTransicion,
  WorkflowTransicionLog,
} from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';

/**
 * Único punto de acceso a las cinco tablas del motor (feature #7).
 *
 * Mismas reglas que el resto del proyecto: solo el `PoolClient` de la
 * transacción con `SET LOCAL app.current_tenant` (R15) y `tenant_id`
 * explícito donde aplica. La política RLS de `workflow_definicion` (y la de
 * estado/transición por subconsulta) permite leer las plantillas del
 * sistema sin código especial (PA-7-1).
 */
@Injectable()
export class WorkflowRepository {
  private static readonly SELECT_DEFINICION = `
    SELECT id, tenant_id::text AS tenant_id, nombre, tipo, origen, version,
           activo, created_at, updated_at
      FROM workflow_definicion`;

  private static readonly SELECT_INSTANCIA = `
    SELECT id, tenant_id::text AS tenant_id, definicion_id,
           entidad_tipo, entidad_id::text AS entidad_id, estado_actual_id,
           contexto, activo, created_at, updated_at
      FROM workflow_instancia`;

  // ─── Definición ─────────────────────────────────────────────────────────

  async insertarDefinicion(
    cliente: PoolClient,
    datos: {
      tenantId: string;
      nombre: string;
      tipo: string;
      origen: 'SISTEMA' | 'TENANT';
    },
  ): Promise<{ id: string }> {
    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO workflow_definicion (tenant_id, nombre, tipo, origen)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [datos.tenantId, datos.nombre, datos.tipo, datos.origen],
    );
    return { id: rows[0]!.id };
  }

  async buscarDefinicion(
    ctx: ContextoPeticion,
    id: string,
  ): Promise<DefinicionCompleta | null> {
    const { rows } = await ctx.cliente.query(
      `${WorkflowRepository.SELECT_DEFINICION} WHERE id = $1`,
      [id],
    );
    if (!rows[0]) return null;

    const [estados, transiciones] = await Promise.all([
      this.estadosDe(ctx.cliente, id),
      this.transicionesDe(ctx.cliente, id),
    ]);
    return { ...aDefinicion(rows[0]), estados, transiciones };
  }

  async listarDefiniciones(ctx: ContextoPeticion) {
    const { rows } = await ctx.cliente.query(
      `${WorkflowRepository.SELECT_DEFINICION} ORDER BY tipo, origen`,
    );
    return rows.map(aDefinicion);
  }

  /** R4 — la definición del tenant por tipo (para el 409 del clon). */
  async buscarDefinicionPorTipo(
    ctx: ContextoPeticion,
    tipo: string,
  ): Promise<WorkflowDefinicion | null> {
    const { rows } = await ctx.cliente.query(
      `${WorkflowRepository.SELECT_DEFINICION} WHERE tenant_id = $1 AND tipo = $2`,
      [ctx.tenantId, tipo],
    );
    return rows[0] ? aDefinicion(rows[0]) : null;
  }

  /**
   * PA-8-3 (feature #8) — la definición activa para un tenant: la copia
   * `TENANT` si existe, si no la plantilla `SISTEMA`. Ambas son visibles
   * por la política RLS (la del sistema con el OR de PA-7-1).
   */
  async buscarDefinicionParaTenant(
    ctx: ContextoPeticion,
    tipo: string,
  ): Promise<WorkflowDefinicion | null> {
    const { rows } = await ctx.cliente.query(
      `${WorkflowRepository.SELECT_DEFINICION}
        WHERE tipo = $1
          AND (tenant_id = $2
               OR tenant_id = '00000000-0000-0000-0000-000000000000'::uuid)
        ORDER BY CASE WHEN tenant_id = $2 THEN 0 ELSE 1 END
        LIMIT 1`,
      [tipo, ctx.tenantId],
    );
    return rows[0] ? aDefinicion(rows[0]) : null;
  }

  async estadosDe(cliente: PoolClient, definicionId: string): Promise<WorkflowEstado[]> {
    const { rows } = await cliente.query(
      `SELECT id, definicion_id, clave, etiqueta, es_inicial, es_final, orden,
              created_at
         FROM workflow_estado
        WHERE definicion_id = $1
        ORDER BY orden`,
      [definicionId],
    );
    return rows.map(aEstado);
  }

  async transicionesDe(
    cliente: PoolClient,
    definicionId: string,
  ): Promise<WorkflowTransicion[]> {
    const { rows } = await cliente.query(
      `SELECT id, definicion_id, origen_estado_id, destino_estado_id, clave,
              tipo_ejecucion, roles_requeridos, condicion, notificacion,
              orden, activo, created_at
         FROM workflow_transicion
        WHERE definicion_id = $1
        ORDER BY orden`,
      [definicionId],
    );
    return rows.map(aTransicion);
  }

  async insertarEstado(
    cliente: PoolClient,
    datos: { definicionId: string; clave: string; etiqueta: string; orden: number },
  ): Promise<{ id: string }> {
    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO workflow_estado (definicion_id, clave, etiqueta, orden)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [datos.definicionId, datos.clave, datos.etiqueta, datos.orden],
    );
    return { id: rows[0]!.id };
  }

  async insertarTransicion(
    cliente: PoolClient,
    datos: {
      definicionId: string;
      origenEstadoId: string;
      destinoEstadoId: string;
      clave: string;
      tipoEjecucion: 'HUMANA' | 'AUTOMATICA';
      rolesRequeridos: string[];
      condicion: unknown;
      orden: number;
    },
  ): Promise<{ id: string }> {
    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO workflow_transicion
         (definicion_id, origen_estado_id, destino_estado_id, clave,
          tipo_ejecucion, roles_requeridos, condicion, orden)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        datos.definicionId,
        datos.origenEstadoId,
        datos.destinoEstadoId,
        datos.clave,
        datos.tipoEjecucion,
        datos.rolesRequeridos,
        JSON.stringify(datos.condicion ?? []),
        datos.orden,
      ],
    );
    return { id: rows[0]!.id };
  }

  async darDeBajaTransicion(ctx: ContextoPeticion, id: string): Promise<number> {
    const { rowCount } = await ctx.cliente.query(
      `UPDATE workflow_transicion SET activo = false
        WHERE id = $1 AND definicion_id IN (
          SELECT id FROM workflow_definicion WHERE tenant_id = $2
        )`,
      [id, ctx.tenantId],
    );
    return rowCount ?? 0;
  }

  async origenDeDefinicion(ctx: ContextoPeticion, id: string): Promise<'SISTEMA' | 'TENANT' | null> {
    const { rows } = await ctx.cliente.query<{ origen: 'SISTEMA' | 'TENANT' }>(
      'SELECT origen FROM workflow_definicion WHERE id = $1',
      [id],
    );
    return rows[0]?.origen ?? null;
  }

  /** La copia del clon: todos los estados y transiciones de la definición. */
  async copiarDefinicion(
    cliente: PoolClient,
    origenId: string,
    nuevaDefinicionId: string,
  ): Promise<void> {
    await cliente.query(
      `INSERT INTO workflow_estado
         (definicion_id, clave, etiqueta, es_inicial, es_final, orden)
       SELECT $1, clave, etiqueta, es_inicial, es_final, orden
         FROM workflow_estado WHERE definicion_id = $2`,
      [nuevaDefinicionId, origenId],
    );
    await cliente.query(
      `INSERT INTO workflow_transicion
         (definicion_id, origen_estado_id, destino_estado_id, clave,
          tipo_ejecucion, roles_requeridos, condicion, notificacion, orden, activo)
       SELECT $1,
              oe.id, de.id, t.clave,
              t.tipo_ejecucion, t.roles_requeridos, t.condicion,
              t.notificacion, t.orden, t.activo
         FROM workflow_transicion t
         JOIN workflow_estado oe
           ON oe.definicion_id = $1 AND oe.clave = (
             SELECT clave FROM workflow_estado WHERE id = t.origen_estado_id
           )
         JOIN workflow_estado de
           ON de.definicion_id = $1 AND de.clave = (
             SELECT clave FROM workflow_estado WHERE id = t.destino_estado_id
           )
        WHERE t.definicion_id = $2`,
      [nuevaDefinicionId, origenId],
    );
  }

  // ─── Instancia ──────────────────────────────────────────────────────────

  async insertarInstancia(
    ctx: ContextoPeticion,
    datos: {
      definicionId: string;
      entidadTipo: string;
      entidadId: string;
      estadoInicialId: string;
      contexto: unknown;
    },
  ): Promise<WorkflowInstancia> {
    const { rows } = await ctx.cliente.query(
      `${WorkflowRepository.SELECT_INSTANCIA_INSERT_RETURNING}`,
      [
        ctx.tenantId,
        datos.definicionId,
        datos.entidadTipo,
        datos.entidadId,
        datos.estadoInicialId,
        JSON.stringify(datos.contexto ?? {}),
      ],
    );
    return aInstancia(rows[0]!);
  }

  private static readonly SELECT_INSTANCIA_INSERT_RETURNING = `
    INSERT INTO workflow_instancia
      (tenant_id, definicion_id, entidad_tipo, entidad_id, estado_actual_id, contexto)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, tenant_id::text AS tenant_id, definicion_id,
              entidad_tipo, entidad_id::text AS entidad_id, estado_actual_id,
              contexto, activo, created_at, updated_at`;

  async buscarInstanciaPorEntidad(
    ctx: ContextoPeticion,
    definicionId: string,
    entidadTipo: string,
    entidadId: string,
  ): Promise<WorkflowInstancia | null> {
    const { rows } = await ctx.cliente.query(
      `${WorkflowRepository.SELECT_INSTANCIA}
        WHERE tenant_id = $1 AND definicion_id = $2
          AND entidad_tipo = $3 AND entidad_id = $4`,
      [ctx.tenantId, definicionId, entidadTipo, entidadId],
    );
    return rows[0] ? aInstancia(rows[0]) : null;
  }

  async buscarInstanciaPorId(
    ctx: ContextoPeticion,
    id: string,
  ): Promise<WorkflowInstancia | null> {
    const { rows } = await ctx.cliente.query(
      `${WorkflowRepository.SELECT_INSTANCIA} WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    return rows[0] ? aInstancia(rows[0]) : null;
  }

  /** Feature #8 — la instancia de una entidad, sin importar la definición. */
  async buscarInstanciaPorEntidadSinDefinicion(
    ctx: ContextoPeticion,
    entidadTipo: string,
    entidadId: string,
  ): Promise<WorkflowInstancia | null> {
    const { rows } = await ctx.cliente.query(
      `${WorkflowRepository.SELECT_INSTANCIA}
        WHERE tenant_id = $1 AND entidad_tipo = $2 AND entidad_id = $3
        ORDER BY created_at DESC LIMIT 1`,
      [ctx.tenantId, entidadTipo, entidadId],
    );
    return rows[0] ? aInstancia(rows[0]) : null;
  }

  async actualizarEstado(
    cliente: PoolClient,
    instanciaId: string,
    estadoId: string,
    contexto: unknown,
  ): Promise<void> {
    await cliente.query(
      `UPDATE workflow_instancia
          SET estado_actual_id = $2, contexto = $3, updated_at = now()
        WHERE id = $1`,
      [instanciaId, estadoId, JSON.stringify(contexto ?? {})],
    );
  }

  async insertarLog(
    cliente: PoolClient,
    datos: {
      tenantId: string;
      instanciaId: string;
      transicionId: string | null;
      desdeEstadoId: string;
      haciaEstadoId: string;
      actorId: string | null;
      automatica: boolean;
      contextoTras: unknown;
    },
  ): Promise<void> {
    await cliente.query(
      `INSERT INTO workflow_transicion_log
         (tenant_id, instancia_id, transicion_id, desde_estado_id,
          hacia_estado_id, actor_id, automatica, contexto_tras)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        datos.tenantId,
        datos.instanciaId,
        datos.transicionId,
        datos.desdeEstadoId,
        datos.haciaEstadoId,
        datos.actorId,
        datos.automatica,
        JSON.stringify(datos.contextoTras ?? {}),
      ],
    );
  }

  async historial(
    ctx: ContextoPeticion,
    instanciaId: string,
  ): Promise<WorkflowTransicionLog[]> {
    const { rows } = await ctx.cliente.query(
      `SELECT id, tenant_id::text AS tenant_id, instancia_id, transicion_id,
              desde_estado_id, hacia_estado_id, actor_id::text AS actor_id,
              automatica, contexto_tras, created_at
         FROM workflow_transicion_log
        WHERE tenant_id = $1 AND instancia_id = $2
        ORDER BY created_at ASC`,
      [ctx.tenantId, instanciaId],
    );
    return rows.map(aLog);
  }

  /** Roles ACTIVOS del actor en este tenant, frescos de la base (R7). */
  async rolesActivosDelActor(
    ctx: ContextoPeticion,
    actorId: string,
  ): Promise<string[]> {
    const { rows } = await ctx.cliente.query<{ rol: string }>(
      `SELECT rol FROM user_role
        WHERE user_id = $1 AND tenant_id = $2 AND activo = true`,
      [actorId, ctx.tenantId],
    );
    return rows.map((fila) => fila.rol);
  }
}

interface FilaDefinicion {
  id: string;
  tenant_id: string;
  nombre: string;
  tipo: string;
  origen: 'SISTEMA' | 'TENANT';
  version: number;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
}

function aDefinicion(fila: unknown): DefinicionCompleta {
  const f = fila as FilaDefinicion;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    nombre: f.nombre,
    tipo: f.tipo,
    origen: f.origen,
    version: f.version,
    activo: f.activo,
    created_at: f.created_at.toISOString(),
    updated_at: f.updated_at.toISOString(),
    estados: [],
    transiciones: [],
  };
}

interface FilaEstado {
  id: string;
  definicion_id: string;
  clave: string;
  etiqueta: string;
  es_inicial: boolean;
  es_final: boolean;
  orden: number;
  created_at: Date;
}

function aEstado(fila: unknown): WorkflowEstado {
  const f = fila as FilaEstado;
  return {
    id: f.id,
    definicion_id: f.definicion_id,
    clave: f.clave,
    etiqueta: f.etiqueta,
    es_inicial: f.es_inicial,
    es_final: f.es_final,
    orden: f.orden,
    created_at: f.created_at.toISOString(),
  };
}

interface FilaTransicion {
  id: string;
  definicion_id: string;
  origen_estado_id: string;
  destino_estado_id: string;
  clave: string;
  tipo_ejecucion: 'HUMANA' | 'AUTOMATICA';
  roles_requeridos: string[];
  condicion: unknown;
  notificacion: unknown;
  orden: number;
  activo: boolean;
  created_at: Date;
}

function aTransicion(fila: unknown): WorkflowTransicion {
  const f = fila as FilaTransicion;
  return {
    id: f.id,
    definicion_id: f.definicion_id,
    origen_estado_id: f.origen_estado_id,
    destino_estado_id: f.destino_estado_id,
    clave: f.clave,
    tipo_ejecucion: f.tipo_ejecucion,
    roles_requeridos: f.roles_requeridos,
    condicion: Array.isArray(f.condicion) ? f.condicion : [],
    notificacion:
      typeof f.notificacion === 'object' && f.notificacion !== null
        ? (f.notificacion as WorkflowTransicion['notificacion'])
        : {},
    orden: f.orden,
    activo: f.activo,
    created_at: f.created_at.toISOString(),
  };
}

interface FilaInstancia {
  id: string;
  tenant_id: string;
  definicion_id: string;
  entidad_tipo: string;
  entidad_id: string;
  estado_actual_id: string;
  contexto: unknown;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
}

function aInstancia(fila: unknown): WorkflowInstancia {
  const f = fila as FilaInstancia;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    definicion_id: f.definicion_id,
    entidad_tipo: f.entidad_tipo,
    entidad_id: f.entidad_id,
    estado_actual_id: f.estado_actual_id,
    contexto:
      typeof f.contexto === 'object' && f.contexto !== null
        ? (f.contexto as Record<string, unknown>)
        : {},
    activo: f.activo,
    created_at: f.created_at.toISOString(),
    updated_at: f.updated_at.toISOString(),
  };
}

interface FilaLog {
  id: string;
  tenant_id: string;
  instancia_id: string;
  transicion_id: string | null;
  desde_estado_id: string;
  hacia_estado_id: string;
  actor_id: string | null;
  automatica: boolean;
  contexto_tras: unknown;
  created_at: Date;
}

function aLog(fila: unknown): WorkflowTransicionLog {
  const f = fila as FilaLog;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    instancia_id: f.instancia_id,
    transicion_id: f.transicion_id,
    desde_estado_id: f.desde_estado_id,
    hacia_estado_id: f.hacia_estado_id,
    actor_id: f.actor_id,
    automatica: f.automatica,
    contexto_tras:
      typeof f.contexto_tras === 'object' && f.contexto_tras !== null
        ? (f.contexto_tras as Record<string, unknown>)
        : {},
    created_at: f.created_at.toISOString(),
  };
}
