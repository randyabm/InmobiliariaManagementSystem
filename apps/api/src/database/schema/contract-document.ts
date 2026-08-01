import { check, index, jsonb, pgTable, text, timestamp, uuid, bigint } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { contract } from './contract';
import { tenant } from './tenant';

/**
 * Documento del contrato (feature #18, RF-CT6/RF-CT7, PA-18-2).
 *
 * Origen `generado` (merge de #17) o `digitalizado` (escaneo de físico);
 * el binario vive en object storage, la fila guarda clave y hash.
 */
export const contractDocument = pgTable(
  'contract_document',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contract.id),
    nombre: text('nombre').notNull(),
    origen: text('origen').notNull(),
    claveStorage: text('clave_storage').notNull(),
    hashSha256: text('hash_sha256').notNull(),
    mime: text('mime').notNull(),
    tamanoBytes: bigint('tamano_bytes', { mode: 'number' }),
    metadatos: jsonb('metadatos'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'contract_document_origen_check',
      sql`${t.origen} IN ('generado', 'digitalizado')`,
    ),
    check('contract_document_hash_check', sql`length(${t.hashSha256}) = 64`),
    index('contract_document_tenant_contract_idx').on(t.tenantId, t.contractId),
  ],
);
