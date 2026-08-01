import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';

import { getDatabasePool } from '../../../database/database.client';
import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import { InvitacionesRepository } from './invitaciones.repository';
import { InvitacionInvalidaError } from './errors/invitacion-invalida.error';
import { InventarioNoEnviableError } from './errors/inventario-no-enviable.error';

/**
 * Invitación de revisión (feature #13, R1, R2, R3, R12).
 *
 * El token (48 B de entropía) se genera, se guarda SOLO su hash SHA-256 y
 * viaja en claro únicamente en la respuesta del 201 (R12). La generación
 * transiciona el inventario BORRADOR → ENVIADO en la misma transacción
 * (R2). El bootstrap valida por la función `invitacion_por_token` (PA-13-4)
 * y revalida DENTRO del RLS (R3).
 */
@Injectable()
export class InvitacionesService {
  constructor(private readonly repositorio: InvitacionesRepository) {}

  /** R1, R2 — generar la invitación y transicionar el inventario. */
  async generar(
    ctx: ContextoPeticion,
    datos: { inventarioId: string; perfilInquilinoId: string },
  ): Promise<{ url_invitacion: string; expira_en: string }> {
    // El inventario DEBE estar en BORRADOR para poder enviarse (R2).
    const inventario = await ctx.cliente.query<{ estado: string }>(
      `SELECT estado FROM inventario WHERE id = $1 AND tenant_id = $2 AND activo = true`,
      [datos.inventarioId, ctx.tenantId],
    );
    if (inventario.rowCount === 0) {
      throw new ResourceNotFoundError();
    }
    if (inventario.rows[0]!.estado !== 'BORRADOR') {
      throw new InventarioNoEnviableError(
        `El inventario está en ${inventario.rows[0]!.estado}; solo se invita en borrador.`,
      );
    }

    // El perfil debe pertenecer al mismo tenant (doble barrera: RLS + WHERE).
    const perfil = await ctx.cliente.query<{ id: string }>(
      `SELECT id FROM perfil_inquilino
        WHERE id = $1 AND tenant_id = $2`,
      [datos.perfilInquilinoId, ctx.tenantId],
    );
    if (perfil.rowCount === 0) {
      throw new ResourceNotFoundError();
    }

    const token = randomBytes(48).toString('base64url');
    const tokenHash = hashToken(token);
    const expiraEn = new Date(Date.now() + INVITACION_EXPIRACION_MS);

    const invitacion = await this.repositorio.insertar(ctx, {
      inventarioId: datos.inventarioId,
      perfilInquilinoId: datos.perfilInquilinoId,
      tokenHash,
      expiraEn,
    });

    // R2: misma transacción, BORRADOR → ENVIADO y el inquilino objetivo
    // queda asignado al inventario (scoping R9).
    const { rowCount } = await ctx.cliente.query(
      `UPDATE inventario
          SET estado = 'ENVIADO', perfil_inquilino_id = $3, updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND estado = 'BORRADOR'`,
      [datos.inventarioId, ctx.tenantId, datos.perfilInquilinoId],
    );
    if ((rowCount ?? 0) === 0) {
      throw new InvitacionInvalidaError();
    }

    return {
      url_invitacion: `${BASE_URL_INVITACION}${token}`,
      expira_en: invitacion.expira_en,
    };
  }

  /**
   * R3 — bootstrap sin sesión: la función arranca el contexto, la relectura
   * dentro del RLS decide. 401 uniforme si algo falla.
   */
  async bootstrap(token: string): Promise<{
    inventario_id: string;
    tenant_id: string;
    propiedad_direccion: string;
    propiedad_tipo: string;
    tipo_evento: string;
    estado: string;
    perfil_inquilino_id: string;
    inquilino_nombre: string;
    inquilino_tipo_documento: string;
    inquilino_documento: string;
  }> {
    const tokenHash = hashToken(token);
    const cliente = await getDatabasePool(process.env.DATABASE_URL!).connect();
    try {
      const bootstrapFila = await this.repositorio.buscarPorHash(cliente, tokenHash);
      if (!bootstrapFila) throw new InvitacionInvalidaError();
      if (bootstrapFila.usada_en !== null) throw new InvitacionInvalidaError();
      if (bootstrapFila.expira_en.getTime() <= Date.now()) {
        throw new InvitacionInvalidaError();
      }

      await cliente.query('BEGIN');
      await cliente.query(`SET LOCAL app.current_tenant = '${bootstrapFila.tenant_id}'`);
      const ctx: ContextoPeticion = { cliente, tenantId: bootstrapFila.tenant_id };

      const vigente = await this.repositorio.buscarActiva(ctx, bootstrapFila.id);
      if (!vigente) throw new InvitacionInvalidaError();

      const { rows: datos } = await cliente.query<{
        direccion: string;
        tipo: string;
        tipo_evento: string;
        estado: string;
        nombre: string;
        tipo_documento: string;
        documento: string;
      }>(
        `SELECT p.direccion, p.tipo, i.tipo_evento, i.estado,
                u.nombre, pi.tipo_documento, pi.documento
           FROM inventario i
           JOIN propiedad p ON p.id = i.propiedad_id
           JOIN perfil_inquilino pi ON pi.id = i.perfil_inquilino_id
           JOIN "user" u ON u.id = pi.user_id
          WHERE i.id = $1 AND i.tenant_id = $2`,
        [vigente.inventario_id, ctx.tenantId],
      );
      const fila = datos[0];
      if (!fila) throw new InvitacionInvalidaError();

      await cliente.query('COMMIT');
      return {
        inventario_id: vigente.inventario_id,
        tenant_id: ctx.tenantId,
        propiedad_direccion: fila.direccion,
        propiedad_tipo: fila.tipo,
        tipo_evento: fila.tipo_evento,
        estado: fila.estado,
        perfil_inquilino_id: vigente.perfil_inquilino_id,
        inquilino_nombre: fila.nombre,
        inquilino_tipo_documento: fila.tipo_documento,
        inquilino_documento: fila.documento,
      };
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      cliente.release();
    }
  }
}

/** SHA-256 del token: la base nunca ve el valor en claro (R12). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const INVITACION_EXPIRACION_MS = 72 * 60 * 60 * 1000;

const BASE_URL_INVITACION = '/invitaciones/';
