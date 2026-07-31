import type { Pool } from 'pg';

import { ConfigurationError } from '../common/errors';
import { getDatabasePool } from './database.client';

/**
 * Fail-fast de arranque: la aplicación se **niega a arrancar** si su rol puede
 * saltarse el Row-Level Security (**R44**, D-10; hallazgo **B3**).
 *
 * ## Por qué hace falta una comprobación en ejecución
 *
 * `FORCE ROW LEVEL SECURITY` alcanza al **dueño** de la tabla, pero **no** a un
 * superusuario ni a un rol con `BYPASSRLS`. Con esos roles, todas las políticas
 * del proyecto siguen ahí, escritas y probadas… y no las aplica nadie. El
 * aislamiento por tenant —el invariante nº 1 de este sistema— pasa a depender
 * únicamente de que ningún repositorio olvide un `WHERE tenant_id`.
 *
 * Eso no es hipotético: es lo que ocurría antes de esta feature, y ninguna
 * revisión de código lo habría visto, porque el defecto no estaba en el código
 * sino en una cadena de conexión. Una regresión de despliegue —volver a poner
 * la URL del superusuario "para que funcione"— lo reintroduce en un minuto y en
 * silencio absoluto.
 *
 * De ahí que la comprobación sea **ruidosa y en el arranque**: es la única
 * forma de que ese error falle de inmediato en vez de degradar la seguridad sin
 * que nadie se entere. Es barata: una consulta, una vez.
 *
 * ## Qué NO comprueba
 *
 * Que el rol no sea dueño de las tablas (también parte de R43) no se comprueba
 * aquí sino en `rol-aplicacion.test.ts`, contra la base real: es una propiedad
 * del esquema, no del rol, y bloquear el arranque por ella castigaría a un
 * despliegue de desarrollo legítimo sobre una base recién creada.
 */
export interface PrivilegiosDelRol {
  rolsuper: boolean;
  rolbypassrls: boolean;
}

/**
 * Traduce los privilegios observados a un `ConfigurationError` accionable.
 *
 * Está separada de la consulta para poder probarla sin base de datos: lo que
 * hay que verificar es **la decisión**, y esa es pura.
 */
export function exigirRolSujetoARls(
  privilegios: PrivilegiosDelRol | undefined,
  usuario: string,
): void {
  if (privilegios === undefined) {
    throw new ConfigurationError(
      ['DATABASE_URL'],
      `No se pudo determinar si el rol "${usuario}" esta sujeto al RLS. La aplicacion no arranca sin esa certeza (R44).`,
    );
  }

  const motivos: string[] = [];
  if (privilegios.rolsuper) motivos.push('es SUPERUSER');
  if (privilegios.rolbypassrls) motivos.push('tiene BYPASSRLS');

  if (motivos.length > 0) {
    throw new ConfigurationError(
      ['DATABASE_URL'],
      `El rol "${usuario}" ${motivos.join(' y ')}, asi que se salta el Row-Level Security y el aislamiento por tenant quedaria sin aplicar. ` +
        'Usa la cadena del rol de aplicacion (APP_DB_USER), no la del rol privilegiado: esa va en DATABASE_MIGRATION_URL y solo la usan las migraciones. ' +
        'Ejecuta `npm run db:migrate` para provisionar el rol de aplicacion (R43, R46, R47).',
    );
  }
}

/**
 * Consulta los privilegios del rol de la conexión y aborta si evade el RLS.
 *
 * Se invoca desde `main.ts`, **antes** de `app.listen`: si falla, el proceso
 * termina sin haber aceptado una sola petición.
 */
export async function verificarRolDeAplicacion(
  connectionString: string,
  pool: Pool = getDatabasePool(connectionString),
): Promise<void> {
  const { rows } = await pool.query<PrivilegiosDelRol & { usuario: string }>(
    'SELECT rolsuper, rolbypassrls, current_user AS usuario FROM pg_roles WHERE rolname = current_user',
  );

  exigirRolSujetoARls(rows[0], rows[0]?.usuario ?? 'desconocido');
}
