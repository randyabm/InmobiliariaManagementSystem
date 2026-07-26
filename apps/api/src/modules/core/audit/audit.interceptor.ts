import { Injectable, type NestInterceptor, type ExecutionContext, type CallHandler, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Observable, tap } from 'rxjs';
import { AUDIT_KEY, type AuditMetadata } from './audit.decorator';
import { AuditService } from './audit.service';

interface JwtPayload {
  sub?: string;
  email?: string;
  roles?: Array<{ tenant_id: string }>;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const auditMeta = this.reflector.getAllAndOverride<AuditMetadata>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!auditMeta) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();

    return next.handle().pipe(
      tap(async (responseData: unknown) => {
        try {
          const user = request.user as JwtPayload | undefined;
          const tenantId = request.headers['x-tenant-id'] as string | undefined
            ?? user?.roles?.[0]?.tenant_id;

          if (!tenantId) {
            return;
          }

          const entityId = auditMeta.extractEntityId?.(responseData);

          await this.auditService.log({
            tenantId,
            actorId: user?.sub,
            actorEmail: user?.email,
            accion: auditMeta.accion,
            entityType: auditMeta.entityType,
            entityId,
            ipAddress: request.ip,
            requestId: request.id,
          });
        } catch (error: unknown) {
          this.logger.error(`Error en AuditInterceptor: ${error}`);
        }
      }),
    );
  }
}
