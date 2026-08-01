import { Injectable } from '@nestjs/common';
import type { InventarioVersion } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import { AcuerdoIncompletoError } from './errors/acuerdo-incompleto.error';
import { InventariosRepository } from './inventarios.repository';

/**
 * Versionado de la negociación (feature #22, R1–R4, RF-I6).
 */
@Injectable()
export class VersionadoInventariosService {
  constructor(private readonly inventarios: InventariosRepository) {}

  /** R1, R2 — abrir (o avanzar) la negociación versionando el snapshot. */
  async negociar(ctx: ContextoPeticion, inventarioId: string): Promise<InventarioVersion> {
    const inventario = await this.inventarios.buscarInventarioPorId(ctx, inventarioId);
    if (!inventario) throw new ResourceNotFoundError();
    if (!['ENVIADO', 'EN_REVISION', 'EN_NEGOCIACION'].includes(inventario.estado)) {
      throw new AcuerdoIncompletoError(
        `El inventario está en ${inventario.estado}; no se puede negociar.`,
      );
    }

    const completo = await this.inventarios.buscarCompleto(ctx, inventarioId);
    if (!completo) throw new ResourceNotFoundError();

    // PA-22-1: zonas/ítems activos con respuestas (fotos solo claves).
    const snapshot = completo.zonas.map((z) => ({
      id: z.id,
      nombre: z.nombre,
      repetible: z.repetible,
      orden: z.orden,
      items: z.items.map((i) => ({
        id: i.id,
        nombre: i.nombre,
        field_type: i.field_type,
        estado_checklist: i.estado_checklist,
        valor_respuesta: i.valor_respuesta,
        comentario: i.comentario,
        fotos: i.fotos.map((f) => ({ id: f.id, clave: f.clave_storage })),
      })),
    }));

    const { rows: ultima } = await ctx.cliente.query<{ version: number }>(
      `SELECT COALESCE(MAX(version), 0) AS version FROM inventario_version
        WHERE tenant_id = $1 AND inventario_id = $2`,
      [ctx.tenantId, inventarioId],
    );
    const version = (ultima[0]?.version ?? 0) + 1;

    const { rows } = await ctx.cliente.query(
      `INSERT INTO inventario_version
         (tenant_id, inventario_id, version, snapshot_json, creado_por)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, tenant_id::text AS tenant_id, inventario_id::text AS inventario_id,
                 version, snapshot_json, creado_por::text AS creado_por, created_at`,
      [ctx.tenantId, inventarioId, version, JSON.stringify(snapshot), ctx.actorId ?? null],
    );

    // R1: la primera ronda transiciona a EN_NEGOCIACION; las siguientes se
    // quedan (R2).
    if (inventario.estado !== 'EN_NEGOCIACION') {
      await this.inventarios.actualizarEstado(ctx, inventarioId, 'EN_NEGOCIACION');
    }
    return aVersion(rows[0]!);
  }

  /** R4 — historial de versiones. */
  async listarVersiones(
    ctx: ContextoPeticion,
    inventarioId: string,
  ): Promise<InventarioVersion[]> {
    const inventario = await this.inventarios.buscarInventarioPorId(ctx, inventarioId);
    if (!inventario) throw new ResourceNotFoundError();
    const { rows } = await ctx.cliente.query(
      `SELECT id, tenant_id::text AS tenant_id, inventario_id::text AS inventario_id,
              version, snapshot_json, creado_por::text AS creado_por, created_at
         FROM inventario_version
        WHERE tenant_id = $1 AND inventario_id = $2 ORDER BY version`,
      [ctx.tenantId, inventarioId],
    );
    return rows.map(aVersion);
  }
}

interface FilaVersion {
  id: string;
  tenant_id: string;
  inventario_id: string;
  version: number;
  snapshot_json: unknown;
  creado_por: string | null;
  created_at: Date;
}

function aVersion(fila: unknown): InventarioVersion {
  const f = fila as FilaVersion;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    inventario_id: f.inventario_id,
    version: f.version,
    snapshot_json: f.snapshot_json as Record<string, unknown>,
    creado_por: f.creado_por,
    created_at: f.created_at.toISOString(),
  };
}
