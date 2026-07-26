import { Injectable } from '@nestjs/common';
import type { HealthStatus } from '@inmobiliaria/types';

import { APP_VERSION } from '../../../app-version';

/**
 * Sonda de *liveness*: responde si el proceso está vivo.
 *
 * INVARIANTE (R14): NO consulta PostgreSQL, Redis ni MinIO. Una sonda de
 * liveness que dependa de infraestructura externa hace que un fallo de la base
 * de datos se lea como "el proceso está muerto" y provoca reinicios en cascada.
 * La sonda de dependencias (`/health/ready`) llega en la feature #2.
 *
 * INVARIANTE (R15): devuelve exactamente `status`, `version` y `uptime`.
 * Ningún dato de negocio, tenant, entorno ni cadena de conexión.
 */
@Injectable()
export class HealthService {
  getStatus(): HealthStatus {
    return {
      status: 'ok',
      version: APP_VERSION,
      uptime: Math.floor(process.uptime()),
    };
  }
}
