import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import {
  HEADER_TENANT,
  type IdentidadDeToken,
  resolverTenantOpcional,
} from '../../../common/tenant/resolver-tenant';
import { SesionInvalidaError } from './errors/sesion-invalida.error';
import { SesionesService } from './sesiones.service';

interface JwtPayload {
  sub: string;
  email: string;
  tenant_id?: string;
  roles: Array<{ tenant_id: string; rol: string }>;
  /**
   * Rol con el que se eligió actuar (**R16**, #26).
   *
   * Se propaga **sin interpretarlo**: quien decide qué significa es el
   * `RolesGuard`, único punto donde se aplican R18/R20/R29. Duplicar aquí la
   * comprobación repartiría la regla de autorización entre dos archivos, que es
   * como acaban divergiendo.
   */
  rol_activo?: string;
  /** Id de la sesión (**R3**, #27). Obligatorio desde esta feature (R5). */
  jti?: string;
  /** `user.token_version` al emitir el token (**R3**, #27). Obligatorio (R5). */
  ver?: number;
}

/**
 * Valida firma, expiración y —desde la #27— **el estado vivo de la sesión**.
 *
 * ## Por qué la validación de sesión vive aquí y no en un guard aparte
 *
 * Es el único punto por el que pasa TODO access token (todas las rutas con
 * `JwtAuthGuard`, incluidas `GET /auth/me` y `POST /auth/rol-activo` que no
 * llevan `@Roles`). Si viviera en un guard, habría que acordarse de
 * engancharlo ruta por ruta, y la revocación dejaría de ser inmediata en la
 * primera ruta olvidada (PA-3).
 *
 * `validate` es `async`: una consulta a la base por petición, dentro de
 * `SET LOCAL` del tenant del token (R4). Es el precio de la revocación
 * inmediata con tokens sin estado (`design.md` §1).
 *
 * ## R5 — sin `jti`/`ver` no hay acceso
 *
 * Un token firmado pero sin sesión no tiene nada que revocar: es
 * exactamente la puerta que PA-3 dejó abierta. Todos los tokens, los
 * fabricados y los emitidos antes de esta feature, quedan rechazados con el
 * mismo 401 uniforme (`SesionInvalidaError`).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly sesiones: SesionesService) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET no está configurado');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      passReqToCallback: true,
    });
  }

  async validate(
    request: { headers?: Record<string, string | string[] | undefined> },
    payload: JwtPayload,
  ): Promise<JwtPayload> {
    if (!payload.sub) {
      throw new UnauthorizedException('Token inválido');
    }

    // R5: sin sesión declarada no hay nada que revocar → 401 uniforme.
    if (typeof payload.jti !== 'string' || payload.jti === '') {
      throw new SesionInvalidaError();
    }
    if (typeof payload.ver !== 'number' || !Number.isInteger(payload.ver)) {
      throw new SesionInvalidaError();
    }

    // El tenant de la sesión es el que el resto del pipeline va a usar (R33):
    // el header `x-tenant-id` validado contra los roles, o el único tenant del
    // token. NO `roles[0]`: un token que declara dos tenants con header válido
    // debe validar su sesión en el tenant indicado, no en el primero que
    // afirma (seguridad.api.test.ts, R33/R35).
    //
    // Sin tenant resoluble (token ambiguo sin header) no hay sesión que
    // validar: `RolesGuard` lo rechaza con 403 en las rutas protegidas y las
    // sin `@Roles` se resuelven como antes.
    const tenantId = resolverTenantOpcional(
      payload as IdentidadDeToken,
      request.headers?.[HEADER_TENANT],
    );

    // R4: la sesión debe estar viva y la versión debe ser la actual. El
    // mismo cuerpo de error para cada fallo (R9).
    if (tenantId !== null) {
      await this.sesiones.validarAcceso(payload.jti, payload.ver, tenantId);
    }

    return payload;
  }
}
