import { Injectable, type NestInterceptor, type ExecutionContext, type CallHandler } from '@nestjs/common';
import { tap } from 'rxjs';

const DOMINIOS_EJEMPLO = [
  'https://portal.inmobiliaria1.com',
  'https://portal.inmobiliaria2.com',
] as const;

@Injectable()
export class FrameAncetorsPorTenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest();
    const respuesta = context.switchToHttp().getResponse();

    const origin = request.headers['origin'] as string | undefined;
    const referer = request.headers['referer'] as string | undefined;

    const origen = origin ?? (referer ? new URL(referer).origin : undefined);

    if (origen && DOMINIOS_EJEMPLO.includes(origen as typeof DOMINIOS_EJEMPLO[number])) {
      respuesta.setHeader('content-security-policy', `default-src 'self'; frame-ancestors '${origen}'`);
    }

    return next.handle().pipe(tap(() => {}));
  }
}
