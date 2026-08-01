import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { TicketsModule } from '../tickets/tickets.module';
import { ContratosModule } from '../contratos/contratos.module';
import { PagosModule } from '../pagos/pagos.module';
import { AsistenteController } from './asistente.controller';
import { AsistenteService } from './asistente.service';

/**
 * Asistente conversacional (feature #33, §14, D8). Herramientas acotadas
 * que llaman SERVICIOS con la sesión (PA-33-2); el proveedor LLM se
 * enchufa detrás de la interfaz (PA-33-1).
 */
@Module({
  imports: [AuditModule, TicketsModule, ContratosModule, PagosModule],
  controllers: [AsistenteController],
  providers: [AsistenteService],
  exports: [AsistenteService],
})
export class AsistenteModule {}
