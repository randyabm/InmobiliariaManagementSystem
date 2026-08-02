import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

import { ConfigurationError } from '../errors';
import type { AppConfig } from '../../config';
import { getDatabasePool } from '../../database/database.client';

/**
 * Construye las opciones de CORS (RF-INT4, feature #32).
 *
 * INVARIANTE (R18, D7): `origin` es SIEMPRE una lista explícita de
 * cadenas (prohibidos `'*'` y `origin: true`) O un callback que resuelve
 * por tenant. El callback es el CORS POR TENANT de #32: primero la lista
 * configurada (camino rápido) y luego `tenant_dominio_por_origen` (la 5ª
 * vía SECURITY DEFINER, R54): si el Origin está registrado como dominio
 * del tenant, se permite; si no, el navegador queda bloqueado.
 */

type CallbackOrigin = (err: Error | null, origen: boolean) => void;

export function buildCorsOptions(config: AppConfig): CorsOptions {
  const origenes = [...config.corsOrigins];

  if (origenes.length === 0 || origenes.includes('*')) {
    throw new ConfigurationError(
      ['CORS_ORIGINS'],
      'Debe ser una lista explícita de orígenes; el comodín "*" está prohibido.',
    );
  }

  const resolverPorTenant = async (
    origin: string,
    callback: CallbackOrigin,
  ): Promise<void> => {
    try {
      const cliente = await getDatabasePool(process.env.DATABASE_URL!).connect();
      try {
        const { rows } = await cliente.query<{ tenant_id: string; activo: boolean }>(
          'SELECT tenant_id, activo FROM tenant_dominio_por_origen($1)',
          [origin.replace(/^https?:\/\//, '')],
        );
        if (rows.length === 0 || !rows[0]!.activo) {
          callback(null, false);
          return;
        }
        callback(null, true);
      } finally {
        cliente.release();
      }
    } catch {
      // Un fallo del lookup no abre la puerta: se niega el origen.
      callback(null, false);
    }
  };

  return {
    origin: (origin: string | undefined, callback: CallbackOrigin) => {
      // El CORS de cors() pasa `undefined` en peticiones sin Origin.
      if (!origin) {
        callback(null, true);
        return;
      }
      if (origenes.includes(origin)) {
        callback(null, true);
        return;
      }
      void resolverPorTenant(origin, callback);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
}
