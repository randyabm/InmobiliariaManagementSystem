import { defineConfig } from 'drizzle-kit';

/**
 * Configuración de drizzle-kit (`npm run db:generate`).
 *
 * Las migraciones se emiten como SQL plano y versionado en `drizzle/`: son
 * auditables por el reviewer y permiten escribir RLS (`ENABLE`/`FORCE ROW
 * LEVEL SECURITY`, `CREATE POLICY`) como SQL de primera clase en la misma
 * migración que crea la tabla (docs/conventions.md, design.md §3).
 *
 * `schema` apunta a `src/database/schema/`, todavía vacío: el esquema de
 * negocio empieza en la feature #2.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
