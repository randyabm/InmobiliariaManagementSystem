import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module';
import { PlantillasModule } from '../plantillas/plantillas.module';
import { InventariosController } from './inventarios.controller';
import { InventariosRepository } from './inventarios.repository';
import { InventariosService } from './inventarios.service';

/**
 * Inventario (feature #12, §8.7).
 *
 * Consume la plantilla (#11) para materializar el snapshot en el alta (R4,
 * PA-12-3) y el almacenamiento compartido (#6) para las fotos (R3).
 */
@Module({
  imports: [AuditModule, PlantillasModule, AlmacenamientoModule],
  controllers: [InventariosController],
  providers: [InventariosRepository, InventariosService],
  exports: [InventariosService],
})
export class InventariosModule {}
