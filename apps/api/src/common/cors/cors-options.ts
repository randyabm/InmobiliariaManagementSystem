import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

import { ConfigurationError } from '../errors';
import type { AppConfig } from '../../config';

/**
 * Construye las opciones de CORS a partir de la configuración validada.
 *
 * INVARIANTE (R18, D7, RF-INT4): `origin` es SIEMPRE una lista explícita de
 * cadenas. Están prohibidos `'*'` y `origin: true` (que refleja cualquier
 * origen). Es la base de "CORS por dominio de tenant"; la resolución dinámica
 * por tenant llega con la feature #2.
 *
 * La comprobación se repite aquí, aunque el esquema de configuración ya la
 * haga, porque este es el último punto antes de aplicarla a la app: si alguien
 * construye un `AppConfig` a mano en un test o en un script, el comodín sigue
 * sin poder colarse.
 */
export function buildCorsOptions(config: AppConfig): CorsOptions {
  const origenes = [...config.corsOrigins];

  if (origenes.length === 0 || origenes.includes('*')) {
    throw new ConfigurationError(
      ['CORS_ORIGINS'],
      'Debe ser una lista explícita de orígenes; el comodín "*" está prohibido.',
    );
  }

  return {
    origin: origenes,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
}
