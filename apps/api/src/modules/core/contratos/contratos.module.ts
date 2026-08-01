import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module';
import { OtpModule } from '../otp/otp.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { PropiedadesModule } from '../propiedades/propiedades.module';
import { ContratosController } from './contratos.controller';
import { DigitalizacionController } from './digitalizacion.controller';
import { DigitalizacionService } from './digitalizacion.service';
import { RenovacionesController } from './renovaciones.controller';
import { RenovacionesService } from './renovaciones.service';
import { ContratosRepository } from './contratos.repository';
import { ContratosService } from './contratos.service';
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
  imports: [AuditModule, AlmacenamientoModule, OtpModule, NotificacionesModule, PropiedadesModule],
  controllers: [PlantillasContratoController, RenovacionesController, DigitalizacionController, ContratosController],
  providers: [
    PlantillasContratoRepository,
    PlantillasContratoService,
    ContratosRepository,
    ContratosService,
    DigitalizacionService,
    RenovacionesService,
  ],
  exports: [PlantillasContratoService, PlantillasContratoRepository, ContratosService],
})
export class ContratosModule {}
