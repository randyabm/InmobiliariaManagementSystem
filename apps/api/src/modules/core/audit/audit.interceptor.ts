import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { concatMap, type Observable } from 'rxjs';

import { HEADER_TENANT } from '../../../common/tenant/resolver-tenant';
import { AUDIT_KEY, type AuditMetadata } from './audit.decorator';
import { AuditService } from './audit.service';

interface JwtPayload {
  sub?: string;
  email?: string;
}

/**
 * Registra en `audit_log` las acciones marcadas con `@Audit` (RF-W4, §11.3).
 *
 * **Ajustado en la feature #5** en tres puntos, todos necesarios para R35:
 *
 * 1. El tenant sale de `request.tenantResuelto` (el que validó `RolesGuard`
 *    contra los roles activos del JWT), **no** de `roles[0].tenant_id`:
 *    auditar una acción bajo la inmobiliaria equivocada es tan grave como
 *    ejecutarla bajo la equivocada (R33).
 * 2. Se **espera** a que la escritura termine antes de emitir la respuesta.
 *    Con `tap` la promesa quedaba suelta y la respuesta podía salir antes de
 *    que la fila existiera: una auditoría que llega "quizá" no es auditoría.
 * 3. El `entity_id` se toma también de los parámetros de ruta, para que las
 *    bajas lógicas (que no devuelven cuerpo) queden trazadas. Ampliado en la
 *    feature #25 con `idCodeudor` e `idReferencia`, en la #6 con
 *    `idPropietario` e `idDocumento`, en la #7 con `idTransicion` y en la
 *    #11 con `idZona` e `idItem`: el
 *    fallback nunca puede caer al id del recurso raíz, o la auditoría
 *    apuntaría al recurso equivocado (R23).
 *
 * `metadata` se deja deliberadamente vacío: **R36** prohíbe que documentos,
 * celulares, teléfonos, emails y números de cuenta lleguen a `audit_log`.
 */
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
      concatMap(async (responseData: unknown) => {
        try {
          const user = request.user as JwtPayload | undefined;
          const tenantId =
            (request.tenantResuelto as string | undefined) ??
            (request.headers?.[HEADER_TENANT] as string | undefined);

          if (tenantId) {
            await this.auditService.log({
              tenantId,
              actorId: user?.sub,
              actorEmail: user?.email,
              accion: auditMeta.accion,
              entityType: auditMeta.entityType,
              entityId: resolverEntityId(auditMeta, responseData, request),
              ipAddress: request.ip,
              requestId: request.id,
            });
          }
        } catch (error: unknown) {
          // La auditoría no bloquea la operación principal, pero el fallo
          // queda registrado (sin datos personales).
          this.logger.error(`Error en AuditInterceptor: ${String(error)}`);
        }
        return responseData;
      }),
    );
  }
}

function resolverEntityId(
  meta: AuditMetadata,
  respuesta: unknown,
  request: { params?: Record<string, string> },
): string | undefined {
  const extraido = meta.extractEntityId?.(respuesta);
  if (extraido) return extraido;

  const id = (respuesta as { id?: unknown } | null | undefined)?.id;
  if (typeof id === 'string') return id;

  // Las bajas lógicas no devuelven cuerpo: el id está en la ruta.
  const params = request.params ?? {};
  return (
    params.idItem ??
    params.idZona ??
    params.idTransicion ??
    params.idDocumento ??
    params.idPropietario ??
    params.idCodeudor ??
    params.idReferencia ??
    params.idCuenta ??
    params.id
  );
}
