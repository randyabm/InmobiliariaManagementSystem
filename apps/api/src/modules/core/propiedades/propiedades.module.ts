import { Module } from '@nestjs/common';

import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module';
import { AuditModule } from '../audit/audit.module';
import { ClientesModule } from '../clientes/clientes.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { DocumentosController } from './documentos.controller';
import { DocumentosService } from './documentos.service';
import { FotosController } from './fotos.controller';
import { FotosService } from './fotos.service';
import { OcupacionController } from './ocupacion.controller';
import { OcupacionService } from './ocupacion.service';
import { PropiedadesController } from './propiedades.controller';
import { PropiedadesRepository } from './propiedades.repository';
import { PropiedadesService } from './propiedades.service';
import { PropietariosDePropiedadController } from './propietarios-de-propiedad.controller';
import { PropietariosDePropiedadRepository } from './propietarios-de-propiedad.repository';
import { PropietariosDePropiedadService } from './propietarios-de-propiedad.service';

/**
 * Hoja de vida del inmueble (feature #6) y su ciclo de vida (feature #8).
 *
 * Depende de `core/clientes` (perfiles, cuentas de giro), de
 * `core/almacenamiento` (fotos y documentos) y de `core/workflows` (el
 * ciclo de vida: la propiedad nace con su instancia y transiciona por el
 * motor). Todas son dependencias legales dentro de `core/`.
 *
 * Los submódulos de #8 (ciclo de vida y dashboard) se registran en sus
 * tasks del bloque 2.
 */
@Module({
  imports: [ClientesModule, AlmacenamientoModule, AuditModule, WorkflowsModule],
  controllers: [
    PropiedadesController,
    PropietariosDePropiedadController,
    OcupacionController,
    DocumentosController,
    FotosController,
  ],
  providers: [
    PropiedadesRepository,
    PropiedadesService,
    PropietariosDePropiedadRepository,
    PropietariosDePropiedadService,
    OcupacionService,
    DocumentosService,
    FotosService,
  ],
  exports: [PropiedadesService],
})
export class PropiedadesModule {}
