import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuditModule } from '../audit/audit.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { SesionesRepository } from './sesiones.repository';
import { SesionesService } from './sesiones.service';

/**
 * El secreto se lee **cuando se construye el módulo**, no cuando se importa el
 * archivo (**#26**).
 *
 * Con `JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-secret' })`
 * el valor quedaba congelado en el instante en que Node evaluaba este archivo.
 * Si algo fijaba `JWT_SECRET` después —y es exactamente lo que hace el arnés de
 * tests al levantar la aplicación—, el servidor **firmaba** con `dev-secret`
 * mientras `JwtStrategy`, que sí lee la variable al construirse, **verificaba**
 * con el secreto real: todo token emitido por la API era rechazado por la
 * propia API con "invalid signature". Nadie lo había visto porque hasta ahora
 * ningún test volvía a usar el token que devuelve `POST /auth/login`, y la #26
 * es la primera feature cuyo endpoint existe para emitir uno.
 *
 * `registerAsync` difiere la lectura al momento de instanciar el módulo, que es
 * cuando el entorno ya está completo. Sin `dev-secret` de reserva: `JwtStrategy`
 * ya aborta el arranque si falta `JWT_SECRET`, y un valor por defecto en la
 * firma solo sirve para que un despliegue mal configurado emita tokens
 * falsificables en silencio.
 */
@Module({
  imports: [
    // #26 R21: la elección de rol activo se audita, así que `AuthService`
    // necesita el servicio de auditoría.
    AuditModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
          throw new Error('JWT_SECRET no está configurado');
        }
        return {
          secret,
          signOptions: { expiresIn: Number(process.env.JWT_EXPIRATION) || 3600 },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, SesionesRepository, SesionesService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
