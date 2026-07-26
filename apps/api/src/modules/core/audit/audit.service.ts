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

    // Conexión y transacción PROPIAS, no las de la petición: la entrada de
    // auditoría no debe deshacerse si la operación auditada hace rollback más
    // tarde, ni retener la transacción de negocio.
    //
    // `SET LOCAL app.current_tenant` es obligatorio: `audit_log` tiene RLS con
    // FORCE y su política de INSERT exige que `tenant_id` coincida con el
    // contexto. Sin esto la auditoría solo funcionaría conectando con un rol
    // que se salte el RLS (corregido en la feature #5).
    let cliente;
    try {
      cliente = await getDatabasePool(databaseUrl).connect();
    } catch (error: unknown) {
      this.logger.error(`Error al registrar auditoría: ${String(error)}`);
      return;
    }

    try {
      await cliente.query('BEGIN');
      await cliente.query('SELECT set_config($1, $2, true)', [
        'app.current_tenant',
        entry.tenantId,
      ]);
      await cliente.query(
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
      await cliente.query('COMMIT');
    } catch (error: unknown) {
      // La auditoría no debe bloquear la operación principal. El mensaje no
      // lleva datos personales (Ley 1581 de 2012).
      await cliente.query('ROLLBACK').catch(() => undefined);
      this.logger.error(`Error al registrar auditoría: ${String(error)}`);
    } finally {
      cliente.release();
    }
  }
}
