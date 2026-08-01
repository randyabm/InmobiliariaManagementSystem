import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

/**
 * Portales embebibles (feature #32, §6.6, D7).
 */
@Module({
  imports: [AuditModule],
  controllers: [PortalController],
  providers: [PortalService],
  exports: [PortalService],
})
export class PortalModule {}
