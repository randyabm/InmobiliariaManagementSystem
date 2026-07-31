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
}

/**
 * Crea la identidad (`user`) y su rol en el tenant (`user_role`).
 *
 * Recibe el `PoolClient` **explícitamente** para que la identidad, el rol y el
 * perfil ocurran en **la misma transacción** que abrió el
 * `TenantContextInterceptor` (**R22**): un fallo parcial no puede dejar un
 * `user` huérfano sin perfil.
 *
 * ## Nunca se reutiliza una identidad de OTRA inmobiliaria (R62, D-8)
 *
 * `vincularPorEmail` reutilizaba el `user` que ya tuviera ese correo **aunque
 * perteneciera a otra inmobiliaria** (**R25**). D-8 eliminó R25: esa
 * vinculación ocurría sin consentimiento de nadie y permitía que el tenant A se
 * hiciera con la identidad del administrador del tenant B, que es el paso 1 de
 * la cadena de ataque descrita en la revisión (B1). Con `user.tenant_id` y la
 * FK compuesta de R60 ya no es ni representable, y aquí no queda ni rastro de
 * la búsqueda global.
 *
 * Tampoco se busca por **`documento`** (**R26**, vigente): hacerlo fuera del
 * tenant revelaría que la persona ya es cliente de otra inmobiliaria, justo lo
 * que prohíbe el PRD §11.3.
 *
 * ## Dentro del MISMO tenant sí se reutiliza, y es a propósito
 *
 * Una persona puede ser propietaria **e** inquilina de la misma inmobiliaria
 * (RF-C2, `design.md` §7.4): son dos perfiles y dos `user_role`, pero **una
 * sola identidad**. `design.md` §20.4 lo dice sin ambigüedad al acotar el
 * alcance de D-8: *"RF-C2 sigue siendo cierto dentro de un tenant […] pero deja
 * de serlo entre tenants"*. Y la `UNIQUE (tenant_id, email)` de R59 lo exige de
 * todos modos: crear una segunda identidad con el mismo correo en el mismo
 * tenant sería una violación de unicidad.
 *
 * > **Contradicción del spec, resuelta a favor del diseño.** El titular de
 * > **R62** y el enunciado de **T58** dicen "la identidad es **siempre**
 * > nueva". Leído al pie de la letra rompería RF-C2 y §7.4. El cuerpo del
 * > propio R62 acota la prohibición —*"NO DEBE consultar ni reutilizar ninguna
 * > identidad existente **de otro tenant**"*— y §20.4 la acota igual, así que
 * > "siempre nueva" es taquigrafía de "nunca heredada de otra inmobiliaria".
 * > Queda anotado en `progress/impl_owner_tenant_profiles_cierre.md`.
 *
 * Consecuencia asumida (`design.md` §7.3 y §20.4, **D-13**): la misma persona
 * registrada en dos inmobiliarias tendrá dos filas de `user`, dos contraseñas y
 * dos portales.
 *
 * El `user` se crea sin `password_hash` y —desde **D-9**— con `email` **NULL**:
 * es un cliente registrado por la inmobiliaria (RF-C1), no alguien que se dio
 * de alta en un portal. Su correo de contacto vive en el perfil (**R71**).
 * Mientras el hash sea NULL el login responde 401 sin evaluar contraseña
 * (**R6**).
 */
@Injectable()
export class IdentidadService {
  async crearIdentidad(
    cliente: PoolClient,
    datos: DatosDeIdentidad,
    tenantId: string,
    rol: RolDeCliente,
  ): Promise<IdentidadResuelta> {
    const email = normalizarEmail(datos.email);
    const identidad =
      (email === null
        ? null
        : await this.buscarEnEsteTenant(cliente, email, tenantId)) ??
      (await this.crearIdentidadNueva(cliente, email, datos, tenantId));

    await this.asegurarRol(cliente, identidad.userId, tenantId, rol);
    return identidad;
  }

  /**
   * Identidad existente **de esta misma inmobiliaria** con ese correo.
   *
   * El `AND tenant_id = $2` es lo único que separa esto de la vinculación de
   * R25 que D-8 eliminó, y por eso no es opcional ni redundante con el RLS:
   * hasta T61 la aplicación se conecta como superusuario y el RLS es inerte,
   * así que sin esta condición la consulta volvería a alcanzar identidades de
   * otras inmobiliarias. Es la misma doble barrera que usan los repositorios.
   */
  private async buscarEnEsteTenant(
    cliente: PoolClient,
    email: string,
    tenantId: string,
  ): Promise<IdentidadResuelta | null> {
    const { rows } = await cliente.query<{ id: string }>(
      'SELECT id FROM "user" WHERE email = $1 AND tenant_id = $2',
      [email, tenantId],
    );
    return rows[0] ? { userId: rows[0].id } : null;
  }

  private async crearIdentidadNueva(
    cliente: PoolClient,
    email: string | null,
    datos: DatosDeIdentidad,
    tenantId: string,
  ): Promise<IdentidadResuelta> {
    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO "user" (tenant_id, email, password_hash, nombre, telefono)
       VALUES ($1, $2, NULL, $3, $4)
       RETURNING id`,
      [tenantId, email, datos.nombre, datos.telefono ?? null],
    );

    const creada = rows[0];
    if (!creada) {
      throw new Error('No se pudo crear la identidad del cliente.');
    }
    return { userId: creada.id };
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
