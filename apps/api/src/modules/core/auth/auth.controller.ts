import {
  Body,
  Controller,
  Get,
  Post,
  Request,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Cuerpo de `POST /auth/login`.
 *
 * `codigo` es obligatorio desde **D-8/D-12** (**R63**): sin él la petición es
 * ambigua, porque desde que las identidades no se comparten entre
 * inmobiliarias el mismo correo puede existir en dos de ellas.
 */
class LoginDto {
  codigo!: string;
  email!: string;
  password!: string;
}

/** Lo que `JwtStrategy` deja en `request.user`. */
interface IdentidadDelToken {
  sub: string;
  tenant_id?: string;
  roles?: Array<{ tenant_id: string; rol: string }>;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getProfile(@Request() req: { user: IdentidadDelToken }) {
    // El tenant sale del token, que desde R67 lleva uno solo. Se acepta
    // deducirlo de `roles` como respaldo para no invalidar de golpe los tokens
    // emitidos antes de este cambio mientras no caduquen.
    const tenantId = req.user.tenant_id ?? req.user.roles?.[0]?.tenant_id;

    if (tenantId === undefined) {
      throw new UnauthorizedException('Token sin inmobiliaria');
    }
    return this.authService.getProfile(req.user.sub, tenantId);
  }
}
