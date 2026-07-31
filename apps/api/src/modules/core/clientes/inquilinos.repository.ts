import { Injectable } from '@nestjs/common';
import type {
  MedioPreferidoContacto,
  PerfilInquilino,
  TipoDocumento,
} from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { predicadoDePertenenciaAlTenant } from './predicado-identidad';

/**
 * Único punto de acceso a datos de `perfil_inquilino`.
 *
 * Mismas reglas que `PropietariosRepository`: solo el `PoolClient` de la
 * transacción con `SET LOCAL app.current_tenant` (**R34**), y `tenant_id`
 * explícito en cada consulta como defensa en profundidad sobre el RLS.
 */
@Injectable()
export class InquilinosRepository {
  private static readonly SELECT = `
    SELECT p.id, p.tenant_id, p.user_id,
           u.nombre,
           p.email_contacto,
           p.tipo_documento, p.documento, p.celular,
           p.medio_preferido_contacto, p.activo,
           p.created_at, p.updated_at
      FROM perfil_inquilino p
      JOIN "user" u ON u.id = p.user_id`;

  async insertar(
    ctx: ContextoPeticion,
    datos: {
      userId: string;
      tipoDocumento: TipoDocumento;
      documento: string;
      emailContacto: string;
      celular: string;
      medioPreferidoContacto: MedioPreferidoContacto;
    },
  ): Promise<PerfilInquilino> {
    const { rows } = await ctx.cliente.query<{ id: string }>(
      `INSERT INTO perfil_inquilino
         (tenant_id, user_id, tipo_documento, documento,
          email_contacto, celular, medio_preferido_contacto)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        ctx.tenantId,
        datos.userId,
        datos.tipoDocumento,
        datos.documento,
        datos.emailContacto,
        datos.celular,
        datos.medioPreferidoContacto,
      ],
    );

    const creado = await this.buscarPorId(ctx, rows[0]!.id);
    if (!creado) {
      throw new Error('El perfil de inquilino recién creado no es legible.');
    }
    return creado;
  }

  async buscarPorId(
    ctx: ContextoPeticion,
    id: string,
  ): Promise<PerfilInquilino | null> {
    const { rows } = await ctx.cliente.query(
      `${InquilinosRepository.SELECT} WHERE p.id = $1 AND p.tenant_id = $2`,
      [id, ctx.tenantId],
    );
    return rows[0] ? aPerfil(rows[0]) : null;
  }

  /** **R23**, D-4 — solo perfiles del tenant de la petición. */
  async buscarPorDocumento(
    ctx: ContextoPeticion,
    tipoDocumento: TipoDocumento,
    documento: string,
  ): Promise<PerfilInquilino[]> {
    const { rows } = await ctx.cliente.query(
      `${InquilinosRepository.SELECT}
        WHERE p.tenant_id = $1 AND p.tipo_documento = $2 AND p.documento = $3
        ORDER BY p.created_at`,
      [ctx.tenantId, tipoDocumento, documento],
    );
    return rows.map(aPerfil);
  }

  /** **R20**. */
  async actualizar(
    ctx: ContextoPeticion,
    id: string,
    cambios: {
      emailContacto?: string;
      celular?: string;
      medioPreferidoContacto?: MedioPreferidoContacto;
    },
  ): Promise<void> {
    const asignaciones: string[] = [];
    const valores: unknown[] = [];

    // D-9 (R69): el correo del inquilino se escribe en el perfil, y su
    // obligatoriedad la impone ahora el NOT NULL de la columna.
    if (cambios.emailContacto !== undefined) {
      valores.push(cambios.emailContacto);
      asignaciones.push(`email_contacto = $${valores.length}`);
    }
    if (cambios.celular !== undefined) {
      valores.push(cambios.celular);
      asignaciones.push(`celular = $${valores.length}`);
    }
    if (cambios.medioPreferidoContacto !== undefined) {
      valores.push(cambios.medioPreferidoContacto);
      asignaciones.push(`medio_preferido_contacto = $${valores.length}`);
    }

    asignaciones.push('updated_at = now()');
    valores.push(id, ctx.tenantId);

    await ctx.cliente.query(
      `UPDATE perfil_inquilino SET ${asignaciones.join(', ')}
        WHERE id = $${valores.length - 1} AND tenant_id = $${valores.length}`,
      valores,
    );
  }

  /**
   * Lo que queda de la persona en `user`: hoy solo el `nombre` (**R20**).
   *
   * **D-9 (R69, R71):** el correo de contacto vive en
   * `perfil_inquilino.email_contacto` y el teléfono de contacto es `celular`,
   * que ya estaba en el perfil. `user.email` queda para la credencial.
   *
   * **R38 — hallazgo B1.** Mismo cierre que en `PropietariosRepository`: el
   * `UPDATE` lleva la condición de pertenencia al tenant y devuelve las filas
   * afectadas, para que el servicio traduzca "0" a **404** (T51). `null`
   * significa que no había contacto que escribir, no que la identidad sea
   * ajena.
   */
  async actualizarContacto(
    ctx: ContextoPeticion,
    userId: string,
    cambios: { nombre?: string },
  ): Promise<number | null> {
    const asignaciones: string[] = [];
    const valores: unknown[] = [];

    if (cambios.nombre !== undefined) {
      valores.push(cambios.nombre);
      asignaciones.push(`nombre = $${valores.length}`);
    }
    if (asignaciones.length === 0) return null;

    asignaciones.push('updated_at = now()');
    valores.push(userId, ctx.tenantId);

    const { rowCount } = await ctx.cliente.query(
      `UPDATE "user" SET ${asignaciones.join(', ')}
        WHERE id = $${valores.length - 1}
          AND ${predicadoDePertenenciaAlTenant(valores.length)}`,
      valores,
    );
    return rowCount ?? 0;
  }

  /** Baja lógica (**R21**): nada de borrado físico. */
  async marcarInactivo(ctx: ContextoPeticion, id: string): Promise<number> {
    const { rowCount } = await ctx.cliente.query(
      `UPDATE perfil_inquilino SET activo = false, updated_at = now()
        WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    return rowCount ?? 0;
  }
}

interface FilaPerfilInquilino {
  id: string;
  tenant_id: string;
  user_id: string;
  nombre: string;
  email_contacto: string;
  tipo_documento: TipoDocumento;
  documento: string;
  celular: string;
  medio_preferido_contacto: MedioPreferidoContacto;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
}

function aPerfil(fila: unknown): PerfilInquilino {
  const f = fila as FilaPerfilInquilino;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    user_id: f.user_id,
    nombre: f.nombre,
    email_contacto: f.email_contacto,
    tipo_documento: f.tipo_documento,
    documento: f.documento,
    celular: f.celular,
    medio_preferido_contacto: f.medio_preferido_contacto,
    activo: f.activo,
    created_at: f.created_at.toISOString(),
    updated_at: f.updated_at.toISOString(),
  };
}
