import { Injectable, type NestInterceptor, type ExecutionContext, type CallHandler } from '@nestjs/common';
import { tap } from 'rxjs';

const HEADERS_SEGURIDAD = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'content-security-policy': "default-src 'self'; frame-ancestors 'self'",
} as const;

@Injectable()
export class SeguridadHeadersInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const respuesta = context.switchToHttp().getResponse();

    for (const [nombre, valor] of Object.entries(HEADERS_SEGURIDAD)) {
      respuesta.setHeader(nombre, valor);
    }

    return next.handle().pipe(tap(() => {}));
  }
}
