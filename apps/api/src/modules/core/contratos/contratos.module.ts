import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { PlantillasContratoController } from './plantillas-contrato.controller';
import { PlantillasContratoRepository } from './plantillas-contrato.repository';
import { PlantillasContratoService } from './plantillas-contrato.service';

/**
 * Plantillas de contrato (feature #16, §13.2).
 *
 * La plantilla de la propiedad (copia pre-rellena, RF-CT2) la consumirá
 * #17 para el merge; el servicio se exporta como punto de extensión.
 */
@Module({
  imports: [AuditModule],
  controllers: [PlantillasContratoController],
  providers: [PlantillasContratoRepository, PlantillasContratoService],
  exports: [PlantillasContratoService, PlantillasContratoRepository],
})
export class ContratosModule {}
