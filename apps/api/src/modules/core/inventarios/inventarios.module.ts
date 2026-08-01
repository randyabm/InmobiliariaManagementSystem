import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module';
import { PlantillasModule } from '../plantillas/plantillas.module';
import { InventariosController } from './inventarios.controller';
import { InventariosRepository } from './inventarios.repository';
import { InventariosService } from './inventarios.service';
import { RevisionInventarioController } from './revision-inventario.controller';
import { RevisionInventarioRepository } from './revision-inventario.repository';
import { RevisionInventarioService } from './revision-inventario.service';

/**
 * Inventario (feature #12, §8.7) y su revisión por el inquilino (#13).
 *
 * Consume la plantilla (#11) para materializar el snapshot en el alta (R4,
 * PA-12-3) y el almacenamiento compartido (#6) para las fotos (R3).
 */
@Module({
  imports: [AuditModule, PlantillasModule, AlmacenamientoModule],
  controllers: [InventariosController, RevisionInventarioController],
  providers: [
    InventariosRepository,
    InventariosService,
    RevisionInventarioRepository,
    RevisionInventarioService,
  ],
  exports: [InventariosService],
})
export class InventariosModule {}
