import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { getDatabasePool } from '../../../database/database.client';

interface LoginDto {
  email?: string | null;
  password?: string | null;
}

interface JwtTokenPayload {
  sub: string;
  email: string;
  roles: Array<{ tenant_id: string; rol: string }>;
}

/**
 * Normaliza el email recibido en el login (**R8**, D-5).
 *
 * Devuelve `null` si es nulo, ausente, no es texto o queda vacío tras podar
 * espacios. Con `null` NO se consulta la base de datos. Desde D-5 hay muchas
 * identidades con `email IS NULL` (todo propietario registrado sin correo):
 * ninguna petición de login puede llegar a seleccionarlas.
 */
export function normalizarEmailDeLogin(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const limpio = email.trim();
  return limpio === '' ? null : limpio;
}

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  async login(dto: LoginDto): Promise<{ access_token: string; user: { id: string; email: string; nombre: string } }> {
    // R8: email nulo, ausente o vacío -> 401 SIN consultar la base de datos.
    const email = normalizarEmailDeLogin(dto?.email);
    if (email === null) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const pool = getDatabasePool(process.env.DATABASE_URL!);

    // `email = $1` con $1 no nulo nunca casa una fila con `email IS NULL`
    // (en SQL, `NULL = 'algo'` es NULL, no true). R8.
    const rows = await pool.query(
      'SELECT id, email, nombre, password_hash FROM "user" WHERE email = $1 AND email IS NOT NULL',
      [email],
    );
    const found = rows.rows[0] as
      | { id: string; email: string; nombre: string; password_hash: string | null }
      | undefined;

    if (!found) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // R6: una identidad sin credenciales (cliente registrado por la
    // inmobiliaria que aún no activó portal) NO puede iniciar sesión. Se
    // rechaza ANTES de invocar bcrypt: `bcrypt.compare(x, null)` no es una
    // comparación válida y su resultado no debe decidir una autenticación.
    if (found.password_hash === null || found.password_hash === '') {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const password = typeof dto?.password === 'string' ? dto.password : '';
    const passwordValid = await bcrypt.compare(password, found.password_hash);
    if (!passwordValid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const roleRows = await pool.query(
      'SELECT tenant_id, rol FROM user_role WHERE user_id = $1 AND activo = true',
      [found.id],
    );
    const roles = roleRows.rows as Array<{ tenant_id: string; rol: string }>;

    const payload: JwtTokenPayload = {
      sub: found.id,
      email: found.email,
      roles,
    };

    const access_token = this.jwtService.sign(payload);

    return {
      access_token,
      user: { id: found.id, email: found.email, nombre: found.nombre },
    };
  }

  async getProfile(userId: string): Promise<{ id: string; email: string; nombre: string; roles: Array<{ tenant_id: string; rol: string }> }> {
    const pool = getDatabasePool(process.env.DATABASE_URL!);

    const rows = await pool.query('SELECT id, email, nombre FROM "user" WHERE id = $1', [userId]);
    const found = rows.rows[0] as { id: string; email: string; nombre: string } | undefined;

    if (!found) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    const roleRows = await pool.query(
      'SELECT tenant_id, rol FROM user_role WHERE user_id = $1 AND activo = true',
      [userId],
    );
    const roles = roleRows.rows as Array<{ tenant_id: string; rol: string }>;

    return { ...found, roles };
  }
}
