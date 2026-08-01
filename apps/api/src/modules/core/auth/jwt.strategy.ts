import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

interface JwtPayload {
  sub: string;
  email: string;
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
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET no está configurado');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    if (!payload.sub) {
      throw new UnauthorizedException('Token inválido');
    }
    return payload;
  }
}
