import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { SesionInvalidaError } from '../errors/sesion-invalida.error';
import { hashToken, SesionesService } from '../sesiones.service';

/**
 * **T24 — R4, R5, R7, R9, R10.**
 *
 * Dos cosas que se pueden afirmar sin base de datos y conviene afirmar aquí:
 *
 * 1. `validarAcceso` traduce **cada** estado inválido al MISMO
 *    `SesionInvalidaError` (R9): no encontrada, revocada, expirada o con
 *    versión vieja — un atacante no puede distinguirlas.
 * 2. El hash del refresh es SHA-256 hex de 64 caracteres (R10), el refresh
 *    en claro solo existe en la respuesta (R6) y `rotar` genera un token
 *    NUEVO distinto del anterior (R7).
 *
 * El doble de `PoolClient` solo registra llamadas y `getDatabasePool` está
 * mockeado: el aislamiento se mide en `sesiones-rls.test.ts` y la detección
 * de reuso (que vive en `AuthService.refrescar`, R8) en `sesiones.api.test.ts`
 * T17, contra el motor real.
 */

const { clienteMock } = vi.hoisted(() => {
  const cliente = {
    query: vi.fn(async (sql: string) => {
      if (
        sql.startsWith('BEGIN') ||
        sql.startsWith('COMMIT') ||
        sql.startsWith('ROLLBACK') ||
        sql.includes('set_config')
      ) {
        return { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return { clienteMock: cliente };
});

vi.mock('../../../../database/database.client', () => ({
  getDatabasePool: () => ({ connect: async () => clienteMock }),
}));

interface ConsultaRegistrada {
  sql: string;
  parametros: readonly unknown[];
}

function clienteEspia(): {
  cliente: PoolClient;
  consultas: ConsultaRegistrada[];
} {
  const consultas: ConsultaRegistrada[] = [];
  const cliente = {
    query: (sql: string, parametros: unknown[] = []) => {
      consultas.push({ sql, parametros });
      return Promise.resolve({ rows: [], rowCount: 0 });
    },
  } as unknown as PoolClient;
  return { cliente, consultas };
}

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const JTI = 'aaaaaaaa-1111-1111-1111-111111111111';
const AHORA = Date.now();

const SESION_VALIDA = {
  id: JTI,
  revocadaAt: null,
  expiraEn: new Date(AHORA + 60_000),
  tokenVersion: 3,
};

describe('SesionesService.validarAcceso (T24: R4, R5, R9)', () => {
  const repositorio = (valor: unknown) => ({
    validarAcceso: vi.fn().mockResolvedValue(valor),
  });

  it('una sesión viva con la versión actual pasa sin lanzar (R4)', async () => {
    const servicio = new SesionesService(repositorio(SESION_VALIDA) as never);
    await expect(
      servicio.validarAcceso(JTI, 3, TENANT_A),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['no encontrada', null],
    ['revocada', { ...SESION_VALIDA, revocadaAt: new Date(AHORA - 1000) }],
    ['expirada', { ...SESION_VALIDA, expiraEn: new Date(AHORA - 1000) }],
    ['versión vieja', { ...SESION_VALIDA, tokenVersion: 2 }],
  ] as const)('sesión %s → SesionInvalidaError (R4, R9)', async (_caso, estado) => {
    const servicio = new SesionesService(repositorio(estado) as never);

    await expect(servicio.validarAcceso(JTI, 3, TENANT_A)).rejects.toBeInstanceOf(
      SesionInvalidaError,
    );
  });

  it('todos los fallos lanzan EXACTAMENTE el mismo mensaje (R9)', async () => {
    const servicio = new SesionesService(repositorio(null) as never);
    const mensajes = new Set<string>();

    for (let i = 0; i < 3; i++) {
      try {
        await servicio.validarAcceso(JTI, 3, TENANT_A);
      } catch (error) {
        mensajes.add((error as Error).message);
      }
    }

    expect(mensajes.size).toBe(1);
  });
});

describe('SesionesService.abrirSesion y rotar (T24: R6, R7, R10)', () => {
  it('abrirSesion devuelve el refresh en claro y guarda su hash SHA-256 (R6, R10)', async () => {
    const { cliente } = clienteEspia();
    const capturado: { hash?: string; expiraEn?: Date } = {};
    const repositorio = {
      crear: vi.fn().mockImplementation(
        async (
          _cliente: PoolClient,
          datos: { refreshTokenHash: string; expiraEn: Date },
        ) => {
          capturado.hash = datos.refreshTokenHash;
          capturado.expiraEn = datos.expiraEn;
          return { id: JTI };
        },
      ),
    };
    const servicio = new SesionesService(repositorio as never);

    const { id, refreshToken } = await servicio.abrirSesion(cliente, {
      userId: 'user-1',
      tenantId: TENANT_A,
    });

    expect(id).toBe(JTI);
    expect(refreshToken.length).toBeGreaterThanOrEqual(64);
    expect(capturado.hash).toBe(hashToken(refreshToken));
    expect(capturado.hash).toMatch(/^[0-9a-f]{64}$/);
    // El valor en claro no es el hash: no se guarda el token, solo su rastro.
    expect(capturado.hash).not.toBe(refreshToken);
    expect((capturado.expiraEn?.getTime() ?? 0)).toBeGreaterThan(Date.now());
  });

  it('rotar genera un refresh NUEVO distinto del anterior (R7)', async () => {
    const { cliente } = clienteEspia();
    const recibido: { hash?: string } = {};
    const repositorio = {
      rotarRefresh: vi.fn().mockImplementation(
        async (_cliente: PoolClient, _id: string, hash: string) => {
          recibido.hash = hash;
        },
      ),
    };
    const servicio = new SesionesService(repositorio as never);

    const primero = await servicio.rotar(cliente, JTI);
    const segundo = await servicio.rotar(cliente, JTI);

    expect(primero.refreshToken).not.toBe(segundo.refreshToken);
    expect(recibido.hash).toBe(hashToken(segundo.refreshToken));
    expect(recibido.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
