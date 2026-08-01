import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { OtpModule } from '../otp/otp.module';
import { PlantillasModule } from '../plantillas/plantillas.module';
import { FirmaPdfController } from './firma/firma-pdf.controller';
import { FirmaPdfRepository } from './firma/firma-pdf.repository';
import { FirmaPdfService } from './firma/firma-pdf.service';
import { ComparacionInventariosController } from './comparacion-inventarios.controller';
import { ComparacionInventariosService } from './comparacion-inventarios.service';
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
 * PA-12-3) y el almacenamiento compartido (#6) para las fotos (R3); la
 * revisión completa notifica al empleado por el motor de #10 (R7).
 */
@Module({
  imports: [
    AuditModule,
    PlantillasModule,
    AlmacenamientoModule,
    NotificacionesModule,
    OtpModule,
  ],
  controllers: [InventariosController, RevisionInventarioController, FirmaPdfController, ComparacionInventariosController],
  providers: [
    InventariosRepository,
    InventariosService,
    RevisionInventarioRepository,
    RevisionInventarioService,
    FirmaPdfRepository,
    FirmaPdfService,
    ComparacionInventariosService,
  ],
  exports: [InventariosService],
})
export class InventariosModule {}
