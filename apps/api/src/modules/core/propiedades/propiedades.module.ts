import { Module } from '@nestjs/common';

import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module';
import { AuditModule } from '../audit/audit.module';
import { ClientesModule } from '../clientes/clientes.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { CicloVidaController } from './ciclo-vida.controller';
import { CicloVidaService } from './ciclo-vida.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DocumentosController } from './documentos.controller';
import { DocumentosService } from './documentos.service';
import { FotosController } from './fotos.controller';
import { FotosService } from './fotos.service';
import { IngresoController } from './ingreso.controller';
import { IngresoService } from './ingreso.service';
import { ResolverPerfilService } from './resolver-perfil.service';
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
 * **El orden del array de controllers importa:** `DashboardController`
 * (GET /propiedades/dashboard) va ANTES de `PropiedadesController`
 * (GET /propiedades/:id) — Express empareja en orden de registro.
 */
@Module({
  imports: [ClientesModule, AlmacenamientoModule, AuditModule, WorkflowsModule],
  controllers: [
    DashboardController,
    PropiedadesController,
    IngresoController,
    PropietariosDePropiedadController,
    OcupacionController,
    DocumentosController,
    FotosController,
    CicloVidaController,
  ],
  providers: [
    PropiedadesRepository,
    PropiedadesService,
    PropietariosDePropiedadRepository,
    PropietariosDePropiedadService,
    OcupacionService,
    DocumentosService,
    FotosService,
    CicloVidaService,
    DashboardService,
    ResolverPerfilService,
    IngresoService,
  ],
  exports: [PropiedadesService, CicloVidaService],
})
export class PropiedadesModule {}
