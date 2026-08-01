import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { PlantillasController } from './plantillas.controller';
import { PlantillasRepository } from './plantillas.repository';
import { PlantillasService } from './plantillas.service';

/**
 * Plantillas de inmuebles (feature #11, §8.8).
 *
 * Vive en `core/` (como clientes y workflows) porque el módulo de
 * inventarios (#12) lo consumirá para materializar la plantilla vigente.
 * `PlantillasService` se exporta como punto de extensión.
 */
@Module({
  imports: [AuditModule],
  controllers: [PlantillasController],
  providers: [PlantillasRepository, PlantillasService],
  exports: [PlantillasService],
})
export class PlantillasModule {}
