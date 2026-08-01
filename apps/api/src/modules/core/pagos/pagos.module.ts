import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { PagosController } from './pagos.controller';
import { ImportacionesService } from './importaciones.service';

/**
 * Conciliación de pagos (feature #30, §15, D9). Espejo: nunca procesa
 * pagos; la inferencia de estructura es una interfaz (PA-30-1) con MVP
 * determinista; el parseo de valores es 100% código (PA-30-2).
 */
@Module({
  imports: [AuditModule],
  controllers: [PagosController],
  providers: [ImportacionesService],
  exports: [ImportacionesService],
})
export class PagosModule {}
