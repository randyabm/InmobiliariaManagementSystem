import { Injectable } from '@nestjs/common';
import type { CodeudorInquilino, TipoCodeudor, TipoDocumento } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';

/**
 * Único punto de acceso a `codeudor_inquilino` (**R2**, **R12**, **R13**).
 *
 * Mismas reglas que el resto de `clientes/`: solo el `PoolClient` de la
 * transacción con `SET LOCAL app.current_tenant` (**R22**) y `tenant_id`
 * explícito en cada consulta.
 *
 * Un codeudor no es una identidad del sistema: no hay `user` detrás, y la
 * UNIQUE de R2 —(tenant_id, perfil_inquilino_id, tipo_documento,
 * documento)— es quien garantiza R14; este repositorio expone la violación
 * sin traducirla, el service decide el error de dominio.
 */
@Injectable()
export class CodeudoresRepository {
  private static readonly SELECT = `
    SELECT id, tenant_id, perfil_inquilino_id, tipo, nombre,
           tipo_documento, documento, email, celular, activo,
           created_at, updated_at
      FROM codeudor_inquilino`;

  async insertar(
    ctx: ContextoPeticion,
    datos: {
      perfilInquilinoId: string;
      tipo: TipoCodeudor;
      nombre: string;
      tipoDocumento: TipoDocumento;
      documento: string;
      email: string | null;
      celular: string | null;
    },
  ): Promise<CodeudorInquilino> {
    const { rows } = await ctx.cliente.query(
      `${CodeudoresRepository.SELECT_INSERT_RETURNING}`,
      [
        ctx.tenantId,
        datos.perfilInquilinoId,
        datos.tipo,
        datos.nombre,
        datos.tipoDocumento,
        datos.documento,
        datos.email,
        datos.celular,
      ],
    );
    return aCodeudor(rows[0]!);
  }

  private static readonly SELECT_INSERT_RETURNING = `
    INSERT INTO codeudor_inquilino
      (tenant_id, perfil_inquilino_id, tipo, nombre,
       tipo_documento, documento, email, celular)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, tenant_id, perfil_inquilino_id, tipo, nombre,
              tipo_documento, documento, email, celular, activo,
              created_at, updated_at`;

  /** **R13** — solo activos, del tenant de la petición. */
  async listar(
    ctx: ContextoPeticion,
    perfilInquilinoId: string,
  ): Promise<CodeudorInquilino[]> {
    const { rows } = await ctx.cliente.query(
      `${CodeudoresRepository.SELECT}
        WHERE tenant_id = $1 AND perfil_inquilino_id = $2 AND activo = true
        ORDER BY created_at`,
      [ctx.tenantId, perfilInquilinoId],
    );
    return rows.map(aCodeudor);
  }

  async buscarPorId(
    ctx: ContextoPeticion,
    id: string,
  ): Promise<CodeudorInquilino | null> {
    const { rows } = await ctx.cliente.query(
      `${CodeudoresRepository.SELECT} WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    return rows[0] ? aCodeudor(rows[0]) : null;
  }

  /** **R13** — PATCH parcial; devuelve las filas afectadas (0 = 404 en el service). */
  async actualizar(
    ctx: ContextoPeticion,
    id: string,
    cambios: {
      tipo?: TipoCodeudor;
      nombre?: string;
      email?: string | null;
      celular?: string | null;
    },
  ): Promise<number> {
    const asignaciones: string[] = [];
    const valores: unknown[] = [];

    if (cambios.tipo !== undefined) {
      valores.push(cambios.tipo);
      asignaciones.push(`tipo = $${valores.length}`);
    }
    if (cambios.nombre !== undefined) {
      valores.push(cambios.nombre);
      asignaciones.push(`nombre = $${valores.length}`);
    }
    if (cambios.email !== undefined) {
      valores.push(cambios.email);
      asignaciones.push(`email = $${valores.length}`);
    }
    if (cambios.celular !== undefined) {
      valores.push(cambios.celular);
      asignaciones.push(`celular = $${valores.length}`);
    }

    asignaciones.push('updated_at = now()');
    valores.push(id, ctx.tenantId);

    const { rowCount } = await ctx.cliente.query(
      `UPDATE codeudor_inquilino SET ${asignaciones.join(', ')}
        WHERE id = $${valores.length - 1} AND tenant_id = $${valores.length}`,
      valores,
    );
    return rowCount ?? 0;
  }

  /** **R13** — baja lógica, nada de borrado físico. */
  async marcarInactivo(ctx: ContextoPeticion, id: string): Promise<number> {
    const { rowCount } = await ctx.cliente.query(
      `UPDATE codeudor_inquilino SET activo = false, updated_at = now()
        WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    return rowCount ?? 0;
  }
}

interface FilaCodeudor {
  id: string;
  tenant_id: string;
  perfil_inquilino_id: string;
  tipo: TipoCodeudor;
  nombre: string;
  tipo_documento: TipoDocumento;
  documento: string;
  email: string | null;
  celular: string | null;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
}

function aCodeudor(fila: unknown): CodeudorInquilino {
  const f = fila as FilaCodeudor;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    perfil_inquilino_id: f.perfil_inquilino_id,
    tipo: f.tipo,
    nombre: f.nombre,
    tipo_documento: f.tipo_documento,
    documento: f.documento,
    email: f.email,
    celular: f.celular,
    activo: f.activo,
    created_at: f.created_at.toISOString(),
    updated_at: f.updated_at.toISOString(),
  };
}
