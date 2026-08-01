import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';

import { getDatabasePool } from '../../../database/database.client';
import { SesionInvalidaError } from './errors/sesion-invalida.error';
import { SesionesRepository } from './sesiones.repository';

/**
 * Ciclo de vida de las sesiones (**#27**).
 *
 * - `abrirSesion` — login (R6): crea la sesión y devuelve el refresh en
 *   claro **una sola vez**.
 * - `validarAcceso` — cada petición (R4, R5): sesión viva + versión actual.
 * - `rotar` — refresh (R7): el vigente pasa a huella, el nuevo manda.
 * - `revocar` — logout y reuso (R8, R11).
 *
 * ## Dónde vive el hash (R10)
 *
 * El refresh en claro solo existe en la respuesta del login y del refresh.
 * En la base, solo su SHA-256: vigente y anterior. `hashToken` es el único
 * lugar del sistema que produce ese hash.
 *
 * ## La excepción RLS (R18, R19)
 *
 * `validarAcceso` y `revocar` corren dentro de `SET LOCAL app.current_tenant`
 * (R16). La única operación que no puede fijar contexto por sí sola es la
 * resolución inicial del refresh (aún no sabe el tenant): la hace
 * `AuthService.refrescar` vía `sesion_por_refresh_token` (R18) y revalida
 * todo aquí, dentro del RLS (R19).
 */
@Injectable()
export class SesionesService {
  constructor(private readonly repositorio: SesionesRepository) {}

  /**
   * **R4**, R5 — valida un access token contra el estado vivo.
   *
   * Una consulta, dentro del tenant del token. Cualquier fallo (sesión
   * inexistente, revocada, expirada o versión vieja) es el mismo 401.
   */
  async validarAcceso(jti: string, ver: number, tenantId: string): Promise<void> {
    const cliente = await getDatabasePool(process.env.DATABASE_URL!).connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query('SELECT set_config($1, $2, true)', [
        'app.current_tenant',
        tenantId,
      ]);

      const sesion = await this.repositorio.validarAcceso(cliente, jti);
      await cliente.query('COMMIT');

      if (!sesion) throw new SesionInvalidaError();
      if (sesion.revocadaAt !== null) throw new SesionInvalidaError();
      if (sesion.expiraEn.getTime() <= Date.now()) throw new SesionInvalidaError();
      if (sesion.tokenVersion !== ver) throw new SesionInvalidaError();
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      cliente.release();
    }
  }

  /** **R6** — crea la sesión dentro de la transacción del login. */
  async abrirSesion(
    cliente: PoolClient,
    datos: { userId: string; tenantId: string },
  ): Promise<{ id: string; refreshToken: string }> {
    const refreshToken = generarRefreshToken();
    const expiraEn = new Date(Date.now() + REFRESH_TOKEN_EXPIRACION_MS);
    const { id } = await this.repositorio.crear(cliente, {
      userId: datos.userId,
      tenantId: datos.tenantId,
      refreshTokenHash: hashToken(refreshToken),
      expiraEn,
    });
    return { id, refreshToken };
  }

  /** **R7** — rotación: el hash vigente pasa a `..._anterior` (huella de reuso). */
  async rotar(
    cliente: PoolClient,
    sesionId: string,
  ): Promise<{ refreshToken: string }> {
    const refreshToken = generarRefreshToken();
    await this.repositorio.rotarRefresh(cliente, sesionId, hashToken(refreshToken));
    return { refreshToken };
  }

  /** **R11** — revocación con motivo (el CHECK de coherencia los exige juntos). */
  async revocar(
    cliente: PoolClient,
    sesionId: string,
    motivo: string,
  ): Promise<void> {
    await this.repositorio.revocar(cliente, sesionId, motivo);
  }

  /** **R19** — relectura de la sesión dentro del RLS, para el refresh. */
  buscarPorId(cliente: PoolClient, sesionId: string) {
    return this.repositorio.buscarPorId(cliente, sesionId);
  }
}

/**
 * Duración del refresh token: 30 días por defecto, configurable
 * (`PA-27-3`). El access token mantiene su `JWT_EXPIRATION` de 1 hora.
 */
const REFRESH_TOKEN_EXPIRACION_MS =
  (Number(process.env.REFRESH_TOKEN_EXPIRATION) || 2_592_000) * 1000;

/** 48 bytes ≈ 384 bits de entropía: nunca predecible, nunca legible. */
function generarRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

/**
 * **R10** — SHA-256 en hex. El único rastro del refresh en la base; la
 * comparación en `sesion_por_refresh_token` es por coincidencia exacta (R18).
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
