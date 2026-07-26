import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  override handleRequest<TUser = unknown>(err: Error | null, user: TUser | null): TUser {
    if (err || !user) {
      throw err ?? new UnauthorizedException('Token inválido o ausente');
    }
    return user;
  }
}
