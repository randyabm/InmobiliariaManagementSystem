import {
  Body,
  Controller,
  Get,
  HttpCode,
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

/**
 * Cuerpo de `POST /auth/rol-activo` (**R16**, #26).
 *
 * Un solo campo: con qué rol quiere actuar quien ya está autenticado. La
 * inmobiliaria **no** se recibe, se toma del token: aceptarla del cliente
 * reabriría la puerta que R33 cerró.
 */
class RolActivoDto {
  rol!: string;
}

/** Lo que `JwtStrategy` deja en `request.user`. */
interface IdentidadDelToken {
  sub: string;
  email?: string | null;
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

  /**
   * `POST /auth/rol-activo` — actuar como propietario o como inquilino
   * (**R16**, **R17**, **R19**, **R21**).
   *
   * Devuelve un token nuevo con el claim `rol_activo`, o **403** si esa
   * identidad no tiene ese rol activo en su inmobiliaria. El 403 se decide
   * contra la **base de datos**, no contra lo que afirma el token.
   *
   * No lleva `@Roles(...)`: cualquier identidad autenticada puede elegir entre
   * **sus** roles, y quién es se resuelve del token. El `RolesGuard` no aporta
   * nada aquí y exigir un rol concreto sería, literalmente, pedirle a alguien
   * el rol que viene a elegir.
   *
   * El selector **visual** no es de esta feature: pertenece al portal del
   * cliente (RF-AU2/AU4), que no existe en el tablero. Aquí queda el contrato.
   */
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('rol-activo')
  async elegirRolActivo(
    @Request() req: { user: IdentidadDelToken },
    @Body() dto: RolActivoDto,
  ) {
    const tenantId = req.user.tenant_id ?? req.user.roles?.[0]?.tenant_id;
    if (tenantId === undefined) {
      throw new UnauthorizedException('Token sin inmobiliaria');
    }

    return this.authService.elegirRolActivo(
      req.user.sub,
      tenantId,
      typeof dto?.rol === 'string' ? dto.rol : '',
      req.user.email ?? null,
    );
  }
}
