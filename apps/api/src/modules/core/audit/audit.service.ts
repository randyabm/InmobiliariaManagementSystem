import { Injectable, Logger } from '@nestjs/common';
import { getDatabasePool } from '../../../database/database.client';

export interface AuditEntry {
  tenantId: string;
  actorId?: string;
  actorEmail?: string;
  accion: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  requestId?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  async log(entry: AuditEntry): Promise<void> {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      this.logger.warn('DATABASE_URL no configurada, auditoría no registrada');
      return;
    }

    try {
      const pool = getDatabasePool(databaseUrl);
      await pool.query(
        `INSERT INTO audit_log (tenant_id, actor_id, actor_email, accion, entity_type, entity_id, metadata, ip_address, request_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          entry.tenantId,
          entry.actorId ?? null,
          entry.actorEmail ?? null,
          entry.accion,
          entry.entityType,
          entry.entityId ?? null,
          entry.metadata ? JSON.stringify(entry.metadata) : null,
          entry.ipAddress ?? null,
          entry.requestId ?? null,
        ],
      );
    } catch (error: unknown) {
      // La auditoría no debe bloquear la operación principal
      this.logger.error(`Error al registrar auditoría: ${error}`);
    }
  }
}
