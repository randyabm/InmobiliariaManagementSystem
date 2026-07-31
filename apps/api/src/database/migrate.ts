/**
 * Punto de entrada de `npm run db:migrate` (R10).
 *
 * No forma parte del bundle de la aplicación: es una herramienta de operación.
 */
import { AppError, ConfigurationError } from '../common/errors';
import { asegurarRolDeAplicacion } from './rol-aplicacion';
import { readDatabaseUrl, runMigrations } from './run-migrations';

/**
 * Aplica las migraciones y **después** provisiona el rol de aplicación (R46).
 *
 * El orden no es negociable: los `GRANT` no alcanzan retroactivamente a tablas
 * que aún no existían, así que provisionar antes de migrar dejaría cada tabla
 * nueva invisible para la aplicación. Por eso van juntos en el mismo comando y
 * no en dos pasos que alguien pueda ejecutar en el orden equivocado.
 */
async function main(): Promise<void> {
  const connectionString = readDatabaseUrl();
  await runMigrations(connectionString);
  console.info('[db:migrate] Migraciones aplicadas correctamente.');

  const usuario = process.env.APP_DB_USER?.trim();
  const clave = process.env.APP_DB_PASSWORD?.trim();
  if (!usuario || !clave) {
    throw new ConfigurationError(
      ['APP_DB_USER', 'APP_DB_PASSWORD'],
      'Son las credenciales del rol de aplicacion sujeto a RLS (R43, R46). Sin ellas la API tendria que conectarse con el rol privilegiado y el aislamiento por tenant quedaria inerte.',
    );
  }

  await asegurarRolDeAplicacion(connectionString, { usuario, clave });
  console.info(
    `[db:migrate] Rol de aplicacion "${usuario}" provisionado (NOSUPERUSER, NOBYPASSRLS, sin DELETE).`,
  );
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
