import {
  bigint,
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { propiedad } from './propiedad';
import { tenant } from './tenant';
import { user } from './user';

/**
 * Repositorio documental de la propiedad (RF-P3, R4). Feature #6.
 *
 * El binario **nunca** vive aquí: la base guarda la clave de object storage,
 * el hash SHA-256 del binario (R21), el mime y el tamaño. `tipo_documento` es
 * texto libre: el PRD no define una taxonomía de documentos y no se inventa
 * una. La digitalización de contratos físicos (§13.4) es la feature #18 y
 * consumirá este repositorio.
 *
 * `clave_storage` es única: una clave de MinIO identifica un único objeto,
 * y dos filas apuntando al mismo objeto romperían la trazabilidad de la
 * auditoría (quién subió qué).
 */
export const propiedadDocumento = pgTable(
  'propiedad_documento',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    propiedadId: uuid('propiedad_id')
      .notNull()
      .references(() => propiedad.id),
    nombre: text('nombre').notNull(),
    tipoDocumento: text('tipo_documento'),
    claveStorage: text('clave_storage').notNull(),
    hashSha256: text('hash_sha256').notNull(),
    mime: text('mime'),
    tamanoBytes: bigint('tamano_bytes', { mode: 'number' }),
    subidoPor: uuid('subido_por').references(() => user.id),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('propiedad_documento_clave_storage_key').on(t.claveStorage),
    index('propiedad_documento_tenant_propiedad_idx').on(t.tenantId, t.propiedadId),
  ],
);
