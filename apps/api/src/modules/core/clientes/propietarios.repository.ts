import { Injectable } from '@nestjs/common';
import type { PerfilPropietario, TipoDocumento } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { predicadoDePertenenciaAlTenant } from './predicado-identidad';

/**
 * Único punto de acceso a datos de `perfil_propietario`
 * (`docs/architecture.md`: ninguna consulta SQL vive fuera del repositorio).
 *
 * **Nunca usa `getDatabasePool()`.** Todas las consultas van sobre
 * `ctx.cliente`, el `PoolClient` de la transacción que tiene el
 * `SET LOCAL app.current_tenant` (**R34**, design.md §3). Si alguien llama a
 * un método sin contexto, `obtenerClienteTenant` ya habrá lanzado
 * `SinContextoDeTenantError` antes de llegar aquí.
 *
 * **Doble barrera de aislamiento, a propósito:**
 *
 * 1. **RLS `FORCE` en el motor** — la garantía real, verificada de forma
 *    determinista con un rol sin `BYPASSRLS` en `clientes-rls.test.ts`.
 * 2. **`tenant_id = $1` explícito en cada consulta** — defensa en profundidad.
 *    No sustituye a la primera: existe porque un despliegue que conecte con un
 *    rol superusuario (o con `BYPASSRLS`) se saltaría el RLS entero, y el
 *    aislamiento no puede depender de un detalle de configuración del rol.
 */
@Injectable()
export class PropietariosRepository {
  private static readonly SELECT = `
    SELECT p.id, p.tenant_id, p.user_id,
           u.nombre, u.email, u.telefono,
           p.tipo_documento, p.documento,
           p.direccion_notificacion, p.ciudad,
           p.sujeto_retencion, p.activo,
           p.created_at, p.updated_at
      FROM perfil_propietario p
      JOIN "user" u ON u.id = p.user_id`;

  async insertar(
    ctx: ContextoPeticion,
    datos: {
      userId: string;
      tipoDocumento: TipoDocumento;
      documento: string;
      direccionNotificacion?: string | null;
      ciudad?: string | null;
      sujetoRetencion: boolean;
    },
  ): Promise<PerfilPropietario> {
    const { rows } = await ctx.cliente.query<{ id: string }>(
      `INSERT INTO perfil_propietario
         (tenant_id, user_id, tipo_documento, documento,
          direccion_notificacion, ciudad, sujeto_retencion)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        ctx.tenantId,
        datos.userId,
        datos.tipoDocumento,
        datos.documento,
        datos.direccionNotificacion ?? null,
        datos.ciudad ?? null,
        datos.sujetoRetencion,
      ],
    );

    const creado = await this.buscarPorId(ctx, rows[0]!.id);
    if (!creado) {
      throw new Error('El perfil de propietario recién creado no es legible.');
    }
    return creado;
  }

  async buscarPorId(
    ctx: ContextoPeticion,
    id: string,
  ): Promise<PerfilPropietario | null> {
    const { rows } = await ctx.cliente.query(
      `${PropietariosRepository.SELECT} WHERE p.id = $1 AND p.tenant_id = $2`,
      [id, ctx.tenantId],
    );
    return rows[0] ? aPerfil(rows[0]) : null;
  }

  /**
   * Búsqueda previa de "crear si no existe" (**R23**, D-4).
   *
   * Devuelve solo perfiles **del tenant de la petición**: encontrar el de otra
   * inmobiliaria revelaría que la persona ya es su cliente (PRD §11.3, D-7).
   */
  async buscarPorDocumento(
    ctx: ContextoPeticion,
    tipoDocumento: TipoDocumento,
    documento: string,
  ): Promise<PerfilPropietario[]> {
    const { rows } = await ctx.cliente.query(
      `${PropietariosRepository.SELECT}
        WHERE p.tenant_id = $1 AND p.tipo_documento = $2 AND p.documento = $3
        ORDER BY p.created_at`,
      [ctx.tenantId, tipoDocumento, documento],
    );
    return rows.map(aPerfil);
  }

  /** Actualiza solo los campos presentes en `cambios` (**R13**). */
  async actualizar(
    ctx: ContextoPeticion,
    id: string,
    cambios: {
      direccionNotificacion?: string | null;
      ciudad?: string | null;
      sujetoRetencion?: boolean;
    },
  ): Promise<void> {
    const asignaciones: string[] = [];
    const valores: unknown[] = [];

    if ('direccionNotificacion' in cambios) {
      valores.push(cambios.direccionNotificacion ?? null);
      asignaciones.push(`direccion_notificacion = $${valores.length}`);
    }
    if ('ciudad' in cambios) {
      valores.push(cambios.ciudad ?? null);
      asignaciones.push(`ciudad = $${valores.length}`);
    }
    if ('sujetoRetencion' in cambios) {
      valores.push(cambios.sujetoRetencion);
      asignaciones.push(`sujeto_retencion = $${valores.length}`);
    }

    // `updated_at` se refresca siempre que el PATCH toca el perfil (R13).
    asignaciones.push('updated_at = now()');
    valores.push(id, ctx.tenantId);

    await ctx.cliente.query(
      `UPDATE perfil_propietario SET ${asignaciones.join(', ')}
        WHERE id = $${valores.length - 1} AND tenant_id = $${valores.length}`,
      valores,
    );
  }

  /**
   * Actualiza los datos de contacto, que viven en `user` (**R13**).
   *
   * **R38 — hallazgo B1 de la revisión.** La sentencia incorpora la condición
   * de que esa identidad **pertenece al tenant de la petición**. Antes era
   * `WHERE id = $N` a secas: bastaba con un `user_id` mal resuelto —o con un
   * perfil cuyo `user_id` apuntase a la identidad de otra inmobiliaria— para
   * reescribir la fila de un tercero, sin que ninguna capa lo impidiera.
   *
   * Devuelve el número de filas afectadas para que el servicio traduzca "0" a
   * **404** (T51). Devuelve `null` cuando no había ningún campo de contacto
   * que escribir: eso no es un fallo de pertenencia, es un PATCH que solo toca
   * el perfil.
   *
   * @see predicadoDePertenenciaAlTenant — por qué es ese predicado y no
   *      `tenant_id = $N`.
   */
  async actualizarContacto(
    ctx: ContextoPeticion,
    userId: string,
    cambios: { nombre?: string; email?: string | null; telefono?: string | null },
  ): Promise<number | null> {
    const asignaciones: string[] = [];
    const valores: unknown[] = [];

    if (cambios.nombre !== undefined) {
      valores.push(cambios.nombre);
      asignaciones.push(`nombre = $${valores.length}`);
    }
    if ('email' in cambios) {
      valores.push(cambios.email ?? null);
      asignaciones.push(`email = $${valores.length}`);
    }
    if ('telefono' in cambios) {
      valores.push(cambios.telefono ?? null);
      asignaciones.push(`telefono = $${valores.length}`);
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

  /**
   * Baja **lógica** (**R14**, `docs/conventions.md`): nada de borrado físico
   * en entidades con valor legal. El histórico de contratos de un propietario
   * dado de baja tiene que seguir siendo auditable.
   */
  async marcarInactivo(ctx: ContextoPeticion, id: string): Promise<number> {
    const { rowCount } = await ctx.cliente.query(
      `UPDATE perfil_propietario SET activo = false, updated_at = now()
        WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    return rowCount ?? 0;
  }
}

interface FilaPerfilPropietario {
  id: string;
  tenant_id: string;
  user_id: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  tipo_documento: TipoDocumento;
  documento: string;
  direccion_notificacion: string | null;
  ciudad: string | null;
  sujeto_retencion: boolean;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
}

function aPerfil(fila: unknown): PerfilPropietario {
  const f = fila as FilaPerfilPropietario;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    user_id: f.user_id,
    nombre: f.nombre,
    email: f.email,
    telefono: f.telefono,
    tipo_documento: f.tipo_documento,
    documento: f.documento,
    direccion_notificacion: f.direccion_notificacion,
    ciudad: f.ciudad,
    sujeto_retencion: f.sujeto_retencion,
    activo: f.activo,
    created_at: f.created_at.toISOString(),
    updated_at: f.updated_at.toISOString(),
  };
}
