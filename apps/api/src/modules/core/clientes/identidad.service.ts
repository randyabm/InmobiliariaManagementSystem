import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

export type RolDeCliente = 'propietario' | 'inquilino';

export interface DatosDeIdentidad {
  nombre: string;
  email?: string | null;
  telefono?: string | null;
}

export interface IdentidadResuelta {
  userId: string;
  /** `true` si se reutilizó un `user` que ya existía (RF-C2, RF-AU6). */
  reutilizada: boolean;
}

/**
 * Crea o vincula la identidad (`user`) y su rol en el tenant (`user_role`).
 *
 * Recibe el `PoolClient` **explícitamente** para que la identidad, el rol y el
 * perfil ocurran en **la misma transacción** que abrió el
 * `TenantContextInterceptor` (**R22**): un fallo parcial no puede dejar un
 * `user` huérfano sin perfil.
 *
 * Reglas de vinculación:
 *
 * - **Con email** → se reutiliza el `user` que ya tenga ese email, aunque
 *   pertenezca a otra inmobiliaria. Es la identidad única multi-tenant de
 *   RF-C2/RF-AU6. La respuesta no expone nada de los perfiles de ese `user`
 *   en otros tenants (**R25**): aquí solo se devuelve el `user_id`.
 * - **Sin email** → identidad **nueva**, siempre. NO se busca por
 *   `documento` (**R26**): hacerlo fuera del tenant revelaría que la persona
 *   ya es cliente de otra inmobiliaria, justo lo que prohíbe el PRD §11.3.
 *   Consecuencia asumida (design.md §7.3): la misma persona sin correo
 *   registrada en dos inmobiliarias produce dos filas de `user`.
 *
 * El `user` se crea sin `password_hash`: es un cliente registrado por la
 * inmobiliaria (RF-C1), no alguien que se dio de alta en un portal. Mientras
 * el hash sea NULL el login responde 401 sin evaluar contraseña (**R6**).
 */
@Injectable()
export class IdentidadService {
  async crearOVincularIdentidad(
    cliente: PoolClient,
    datos: DatosDeIdentidad,
    tenantId: string,
    rol: RolDeCliente,
  ): Promise<IdentidadResuelta> {
    const email = normalizarEmail(datos.email);
    const identidad = email
      ? await this.vincularPorEmail(cliente, email, datos)
      : await this.crearIdentidadNueva(cliente, null, datos);

    await this.asegurarRol(cliente, identidad.userId, tenantId, rol);
    return identidad;
  }

  private async vincularPorEmail(
    cliente: PoolClient,
    email: string,
    datos: DatosDeIdentidad,
  ): Promise<IdentidadResuelta> {
    const { rows } = await cliente.query<{ id: string }>(
      'SELECT id FROM "user" WHERE email = $1',
      [email],
    );

    const existente = rows[0];
    if (existente) {
      return { userId: existente.id, reutilizada: true };
    }
    return this.crearIdentidadNueva(cliente, email, datos);
  }

  private async crearIdentidadNueva(
    cliente: PoolClient,
    email: string | null,
    datos: DatosDeIdentidad,
  ): Promise<IdentidadResuelta> {
    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO "user" (email, password_hash, nombre, telefono)
       VALUES ($1, NULL, $2, $3)
       RETURNING id`,
      [email, datos.nombre, datos.telefono ?? null],
    );

    const creada = rows[0];
    if (!creada) {
      throw new Error('No se pudo crear la identidad del cliente.');
    }
    return { userId: creada.id, reutilizada: false };
  }

  /**
   * `user_role` ya tiene `UNIQUE (user_id, tenant_id, rol)`, así que registrar
   * al mismo `user` como propietario dos veces no duplica la fila. Un `user`
   * puede ser propietario **e** inquilino en el mismo tenant (design.md §7.4).
   */
  private async asegurarRol(
    cliente: PoolClient,
    userId: string,
    tenantId: string,
    rol: RolDeCliente,
  ): Promise<void> {
    await cliente.query(
      `INSERT INTO user_role (user_id, tenant_id, rol, activo)
       VALUES ($1, $2, $3, true)
       ON CONFLICT ON CONSTRAINT user_role_user_tenant_rol_key DO NOTHING`,
      [userId, tenantId, rol],
    );
  }
}

/** Normaliza a NULL cualquier email ausente o en blanco (D-5). */
export function normalizarEmail(email?: string | null): string | null {
  if (typeof email !== 'string') return null;
  const limpio = email.trim().toLowerCase();
  return limpio === '' ? null : limpio;
}
