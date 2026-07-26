/**
 * Punto de entrada de `npm run db:migrate` (R10).
 *
 * No forma parte del bundle de la aplicación: es una herramienta de operación.
 */
import { AppError } from '../common/errors';
import { readDatabaseUrl, runMigrations } from './run-migrations';

async function main(): Promise<void> {
  const connectionString = readDatabaseUrl();
  await runMigrations(connectionString);
  console.info('[db:migrate] Migraciones aplicadas correctamente.');
}

main().catch((error: unknown) => {
  // Los errores de dominio se muestran como mensaje accionable; el resto,
  // con su detalle, porque es una herramienta de operación, no una respuesta
  // HTTP que pueda filtrar información a un cliente.
  if (error instanceof AppError) {
    console.error(`[db:migrate] ${error.message}`);
  } else {
    console.error('[db:migrate] Falló la aplicación de migraciones:', error);
  }
  process.exitCode = 1;
});
