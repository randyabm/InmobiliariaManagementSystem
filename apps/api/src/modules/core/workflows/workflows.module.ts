import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { DefinicionesService } from './definiciones.service';
import { WorkflowRepository } from './workflow.repository';
import { WorkflowService } from './workflow.service';
import { WorkflowsController } from './workflows.controller';

/**
 * Motor de workflows dirigido por datos (feature #7, RF-W1..W5, RF-A4, D3).
 *
 * Es transversal (lo consumirán #8, inventarios, contratos, mantenimiento)
 * y vive en `core/` por la misma razón que `clientes`: no depende de ningún
 * módulo de negocio y todos pueden depender de él. `WorkflowService` se
 * exporta como punto de extensión para los módulos que transicionan
 * entidades (el #8 lo usará para el ciclo de vida de la propiedad).
 */
@Module({
  imports: [AuditModule],
  controllers: [WorkflowsController],
  providers: [WorkflowRepository, WorkflowService, DefinicionesService],
  exports: [WorkflowService],
})
export class WorkflowsModule {}
