import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

/**
 * Tickets de mantenimiento (feature #31, §6.5). Instancias del motor de
 * #7 (PA-31-1); scoping por rol en el servicio (RF-M7).
 */
@Module({
  imports: [AuditModule, WorkflowsModule],
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
