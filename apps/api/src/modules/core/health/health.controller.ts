import { Controller, Get } from '@nestjs/common';
import type { HealthStatus } from '@inmobiliaria/types';

import { HealthService } from './health.service';

/**
 * Único endpoint público del sistema en esta fase (R16).
 *
 * La ruta se declara sin prefijo de versión a propósito: los healthchecks los
 * consumen orquestadores y balanceadores, que no versionan.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth(): HealthStatus {
    return this.healthService.getStatus();
  }
}
