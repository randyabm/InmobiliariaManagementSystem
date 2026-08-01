import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

/**
 * Único punto de acceso a `sesion` (**#27**, R1).
 *
 * Todas las operaciones reciben el `PoolClient` de la transacción con
 * `SET LOCAL app.current_tenant` —nunca un pool crudo (**R16**)— y llevan
 * `tenant_id` explícito donde corresponde como defensa en profundidad sobre
 * el RLS (R14).
 *
 * La **única** excepción a esa regla vive en `AuthService.refrescar`: la
 * resolución inicial del tenant por `sesion_por_refresh_token` (R18), que
 * por definición ocurre antes de tener contexto; después, todo se revalida
 * aquí dentro del RLS (R19).
 */
@Injectable()
export class SesionesRepository {
  private static readonly SELECT = `
    SELECT id, user_id, tenant_id, refresh_token_hash,
           refresh_token_hash_anterior, expira_en, revocada_at,
           motivo_revocacion, last_used_at, created_at, updated_at
      FROM sesion`;

  /**
   * **R4** — la fila de la sesión con la versión de la identidad, para la
   * validación por petición. `null` si la sesión no existe (o no es de este
   * tenant: el RLS la filtra).
   */
  async validarAcceso(
    cliente: PoolClient,
    jti: string,
  ): Promise<{
    id: string;
    revocadaAt: Date | null;
    expiraEn: Date;
    tokenVersion: number;
  } | null> {
    const { rows } = await cliente.query<{
      id: string;
      revocada_at: Date | null;
      expira_en: Date;
      token_version: number;
    }>(
      `SELECT s.id, s.revocada_at, s.expira_en, u.token_version
         FROM sesion s
         JOIN "user" u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
        WHERE s.id = $1`,
      [jti],
    );
    const fila = rows[0];
    if (!fila) return null;
    return {
      id: fila.id,
      revocadaAt: fila.revocada_at,
      expiraEn: fila.expira_en,
      tokenVersion: fila.token_version,
    };
  }

  /** **R19** — relectura completa de la sesión DENTRO del RLS. */
  async buscarPorId(cliente: PoolClient, id: string) {
    const { rows } = await cliente.query(`${SesionesRepository.SELECT} WHERE id = $1`, [
      id,
    ]);
    return rows[0] ? aSesion(rows[0]) : null;
  }

  /** **R6** — crea la sesión del login. El hash del refresh es el único rastro (R10). */
  async crear(
    cliente: PoolClient,
    datos: {
      userId: string;
      tenantId: string;
      refreshTokenHash: string;
      expiraEn: Date;
    },
  ): Promise<{ id: string }> {
    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO sesion (user_id, tenant_id, refresh_token_hash, expira_en)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [datos.userId, datos.tenantId, datos.refreshTokenHash, datos.expiraEn],
    );
    return { id: rows[0]!.id };
  }

  /** **R7** — rotación: el vigente pasa a ser la huella; el nuevo, el vigente. */
  async rotarRefresh(
    cliente: PoolClient,
    sesionId: string,
    hashNuevo: string,
  ): Promise<void> {
    await cliente.query(
      `UPDATE sesion
          SET refresh_token_hash_anterior = refresh_token_hash,
              refresh_token_hash = $2,
              last_used_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [sesionId, hashNuevo],
    );
  }

  /** **R8**, R11 — revocación con motivo: el CHECK de coherencia lo exige juntos. */
  async revocar(
    cliente: PoolClient,
    sesionId: string,
    motivo: string,
  ): Promise<void> {
    await cliente.query(
      `UPDATE sesion
          SET revocada_at = now(), motivo_revocacion = $2, updated_at = now()
        WHERE id = $1`,
      [sesionId, motivo],
    );
  }
}

export interface FilaSesion {
  id: string;
  user_id: string;
  tenant_id: string;
  refresh_token_hash: string | null;
  refresh_token_hash_anterior: string | null;
  expira_en: Date;
  revocada_at: Date | null;
  motivo_revocacion: string | null;
  last_used_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function aSesion(fila: unknown): FilaSesion {
  return fila as FilaSesion;
}
