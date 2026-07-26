import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { getDatabasePool } from '../../../database/database.client';

interface LoginDto {
  email: string;
  password: string;
}

interface JwtTokenPayload {
  sub: string;
  email: string;
  roles: Array<{ tenant_id: string; rol: string }>;
}

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  async login(dto: LoginDto): Promise<{ access_token: string; user: { id: string; email: string; nombre: string } }> {
    const pool = getDatabasePool(process.env.DATABASE_URL!);

    const rows = await pool.query('SELECT id, email, nombre, password_hash FROM "user" WHERE email = $1', [dto.email]);
    const found = rows.rows[0] as { id: string; email: string; nombre: string; password_hash: string } | undefined;

    if (!found) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const passwordValid = await bcrypt.compare(dto.password, found.password_hash);
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
