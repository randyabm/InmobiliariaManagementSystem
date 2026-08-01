import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  HEADER_TENANT,
  type IdentidadDeToken,
  resolverTenantDePeticion,
} from '../../../common/tenant/resolver-tenant';
import { ROLES_KEY } from './roles.decorator';

/**
 * RBAC validado en el backend (R32, `docs/conventions.md`).
 *
 * **Cambiado en la feature #5:** el rol se comprueba contra el tenant
 * *resuelto* (header `x-tenant-id` validado contra los roles activos del JWT),
 * no contra el header crudo ni contra "todos los roles del token".
 *
 * Antes, sin header, bastaba con tener el rol exigido en **cualquier**
 * inmobiliaria para pasar el guard: un empleado del tenant A quedaba
 * autorizado en una petición dirigida al tenant B. Ahora el tenant se fija
 * primero (403 si es ambiguo o ajeno, R33) y solo después se miran los roles
 * de ESE tenant.
 *
 * Corre antes que los interceptores, así que el 403 ocurre sin haber
 * ejecutado ninguna consulta de negocio.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as IdentidadDeToken | undefined;

    if (!user?.roles || !Array.isArray(user.roles)) {
      throw new ForbiddenException('Sin roles asignados');
    }

    // Lanza TenantNoAutorizadoError (403) si el header no casa con ningún rol
    // activo, o si el token tiene 0 o varias inmobiliarias y no se indicó cuál.
    const tenantId = resolverTenantDePeticion(
      user,
      request.headers?.[HEADER_TENANT],
    );
    request.tenantResuelto = tenantId;

    const rolesDelTenant = user.roles.filter((r) => r.tenant_id === tenantId);
    const rolesEfectivos = this.rolesEfectivos(
      rolesDelTenant,
      (user as { rol_activo?: unknown }).rol_activo,
    );
    const tieneRol = rolesEfectivos.some((rol) => requiredRoles.includes(rol));

    if (!tieneRol) {
      throw new ForbiddenException('Rol insuficiente');
    }

    return true;
  }

  /**
   * Conjunto de roles con los que la petición queda autorizada (**R18**,
   * **R20**, **R29**, #26).
   *
   * ```
   * si el token trae rol_activo:
   *     si rol_activo ∉ rolesDelTenant   → 403           (coherencia, R29)
   *     rolesEfectivos = { rol_activo }                  (R18)
   * si no:
   *     rolesEfectivos = rolesDelTenant                  (R20)
   * ```
   *
   * **La propiedad que importa** es que `rolesEfectivos` es siempre un
   * **subconjunto** de `rolesDelTenant`: por construcción, elegir un rol no
   * puede autorizar nada que el conjunto completo no autorizara ya. Elegir
   * "propietario" **quita** el acceso a lo de inquilino; no se limita a
   * ocultarlo en el frontend.
   *
   * **Qué se comprueba aquí y qué no.** Solo la **coherencia interna del
   * token** (R29): es barato, no consulta la base y basta para que un
   * `rol_activo` manipulado no amplíe el conjunto autorizado. La comprobación
   * **contra la base de datos** ocurre una sola vez, en la emisión
   * (`POST /auth/rol-activo`, R19). La ventana entre revocar un rol y que el
   * token expire la cierra la feature **#27**, no esta.
   */
  private rolesEfectivos(
    rolesDelTenant: Array<{ rol: string }>,
    rolActivo: unknown,
  ): string[] {
    const roles = rolesDelTenant.map((r) => r.rol);

    // R20: sin `rol_activo` se autoriza exactamente como antes de la #26.
    // Ningún token ya emitido cambia de comportamiento.
    if (typeof rolActivo !== 'string' || rolActivo === '') {
      return roles;
    }

    // R29: un `rol_activo` que el propio token no respalda es incoherente, y un
    // token incoherente no autoriza nada.
    if (!roles.includes(rolActivo)) {
      throw new ForbiddenException('Rol activo no disponible');
    }

    return [rolActivo];
  }
}
