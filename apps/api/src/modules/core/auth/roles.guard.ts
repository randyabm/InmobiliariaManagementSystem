import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

interface JwtPayload {
  sub: string;
  email: string;
  roles: Array<{ tenant_id: string; rol: string }>;
}

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
    const user = request.user as JwtPayload | undefined;

    if (!user?.roles || !Array.isArray(user.roles)) {
      throw new ForbiddenException('Sin roles asignados');
    }

    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    const userRoles = tenantId
      ? user.roles.filter((r) => r.tenant_id === tenantId)
      : user.roles;

    const hasRole = userRoles.some((r) => requiredRoles.includes(r.rol));

    if (!hasRole) {
      throw new ForbiddenException('Rol insuficiente');
    }

    return true;
  }
}
