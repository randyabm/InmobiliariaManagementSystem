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
    const tieneRol = rolesDelTenant.some((r) => requiredRoles.includes(r.rol));

    if (!tieneRol) {
      throw new ForbiddenException('Rol insuficiente');
    }

    return true;
  }
}
