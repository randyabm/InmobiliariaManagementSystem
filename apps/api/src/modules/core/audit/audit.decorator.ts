import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'audit';

export interface AuditMetadata {
  accion: string;
  entityType: string;
  extractEntityId?: (response: unknown) => string | undefined;
}

export const Audit = (
  accion: string,
  entityType: string,
  extractEntityId?: (response: unknown) => string | undefined,
) => SetMetadata(AUDIT_KEY, { accion, entityType, extractEntityId } satisfies AuditMetadata);
