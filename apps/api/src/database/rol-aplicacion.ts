import { Pool } from 'pg';

/**
 * Provisión del **rol de aplicación** (**R45**, **R46**), hallazgo **B3** de
 * `progress/review_owner_tenant_profiles.md`.
 *
 * ## El defecto que esto cierra
 *
 * `FORCE ROW LEVEL SECURITY` alcanza al **dueño** de la tabla, pero no a un
 * superusuario ni a un rol con `BYPASSRLS`. La aplicación usaba el usuario por
 * defecto del contenedor, que es superusuario: **el RLS era decorativo en
 * ejecución**. Los tests HTTP heredaban el defecto, así que los nueve accesos
 * cruzados que devolvían 404 medían el `WHERE tenant_id` del repositorio, no el
 * motor.
 *
 * ## Por qué esto es un procedimiento y no un script suelto
 *
 * Producción, la CI y los entornos de prueba usan **este mismo código** (R46).
 * Que el rol contra el que se prueban los invariantes sea *exactamente* el rol
 * con el que corre la aplicación es la única forma de no repetir el defecto B2,
 * donde el test se fabricaba su propio sujeto y por eso siempre pasaba.
 *
 * Se ejecuta **después** de las migraciones, siempre: los `GRANT` no alcanzan
 * retroactivamente a tablas que aún no existían, así que una tabla nueva sin
 * volver a provisionar sería invisible para la aplicación.
 *
 * ## Privilegios mínimos (R45)
 *
 * - `USAGE` en el esquema.
 * - `SELECT, INSERT, UPDATE` en las tablas de negocio.
 * - `SELECT, INSERT` en `audit_log` — nunca `UPDATE` ni `DELETE`: la auditoría
 *   es append-only (R41) y aquí eso deja de depender solo del trigger.
 * - `EXECUTE` en `tenant_por_codigo`, la única ruta previa al contexto de
 *   tenant (R52), en `sesion_por_refresh_token`, la única ruta del refresh
 *   previa al tenant (R18, feature #27), en `notificaciones_pendientes`,
 *   la única ruta del procesador de notificaciones (R3, feature #10), y en
 *   `invitacion_por_token`, la única ruta de la invitación previa al tenant
 *   (R53, feature #13). Todas se revocan de PUBLIC en su migración y se
 *   conceden aquí, explícitamente.
 * - **`DELETE` en ninguna tabla.** No hace falta: todas las bajas son lógicas
 *   (R14, R21) y las entidades con valor legal son inmutables. Negarlo en el
 *   motor convierte esa convención en una barrera real.
 *
 * El rol **no es dueño** de ninguna tabla, que es lo que hace que el `FORCE
 * ROW LEVEL SECURITY` de las migraciones signifique algo para él.
 */

/** Tablas cuyo régimen de privilegios NO es el de una tabla de negocio. */
const TABLAS_APPEND_ONLY: readonly string[] = ['audit_log'];

export interface CredencialesDeAplicacion {
  readonly usuario: string;
  /** Nunca se registra en logs: se interpola solo dentro del `ALTER ROLE`. */
  readonly clave: string;
}

/**
 * Crea (o actualiza) el rol de aplicación y aplica sus `GRANT`.
 *
 * Idempotente: se puede invocar en cada arranque y en cada test sin efectos
 * acumulativos. Recibe la URL del **rol privilegiado** porque crear roles y
 * conceder privilegios exige `CREATEROLE`/propiedad, cosa que —por definición—
 * el rol que estamos creando no tiene.
 */
export async function asegurarRolDeAplicacion(
  urlDeMigracion: string,
  credenciales: CredencialesDeAplicacion,
): Promise<void> {
  const { usuario, clave } = credenciales;
  validarIdentificador(usuario);

  const pool = new Pool({ connectionString: urlDeMigracion });
  try {
    const rol = comillasDobles(usuario);

    // 1) El rol, con los atributos que lo dejan sujeto al RLS. `NOBYPASSRLS` y
    //    `NOSUPERUSER` son el punto entero de esta función.
    await pool.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(usuario)}) THEN
           EXECUTE format('CREATE ROLE %I LOGIN', ${literal(usuario)});
         END IF;
       END $$;`,
    );
    await pool.query(
      `ALTER ROLE ${rol} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE LOGIN
         PASSWORD ${literal(clave)}`,
    );

    // 2) Punto de partida limpio: se retira todo y se concede solo lo mínimo.
    //    Sin esto, una provisión anterior más laxa sobreviviría para siempre.
    await pool.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${rol}`);
    await pool.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${rol}`);
    await pool.query(`REVOKE ALL ON SCHEMA public FROM ${rol}`);

    await pool.query(`GRANT USAGE ON SCHEMA public TO ${rol}`);

    // 3) Tablas de negocio: leer, insertar y actualizar. Nunca borrar.
    const { rows: tablas } = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    for (const { tablename } of tablas) {
      const tabla = comillasDobles(tablename);
      if (TABLAS_APPEND_ONLY.includes(tablename)) {
        await pool.query(`GRANT SELECT, INSERT ON ${tabla} TO ${rol}`);
      } else {
        await pool.query(`GRANT SELECT, INSERT, UPDATE ON ${tabla} TO ${rol}`);
      }
    }

    // 4) Las secuencias que alimentan los `DEFAULT`, si las hubiera. Sin
    //    `USAGE` un INSERT fallaría por un motivo que no tiene nada que ver
    //    con el aislamiento, y costaría horas de diagnóstico.
    await pool.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${rol}`);

    // 5) Las únicas funciones que evitan el RLS (R52, R18 y R3). Se conceden
    //    explícitamente porque la migración se las revocó a PUBLIC.
    await pool.query(`GRANT EXECUTE ON FUNCTION tenant_por_codigo(text) TO ${rol}`);
    await pool.query(
      `GRANT EXECUTE ON FUNCTION sesion_por_refresh_token(text) TO ${rol}`,
    );
    await pool.query(
      `GRANT EXECUTE ON FUNCTION notificaciones_tenants_a_procesar() TO ${rol}`,
    );
    await pool.query(`GRANT EXECUTE ON FUNCTION invitacion_por_token(text) TO ${rol}`);
  } finally {
    await pool.end();
  }
}

/**
 * Nombre de rol o de tabla entre comillas dobles.
 *
 * El identificador viene de configuración, no de una petición HTTP, pero se
 * escapa igual: `docs/conventions.md` no admite concatenar identificadores en
 * SQL "porque este viene de un sitio de confianza".
 */
function comillasDobles(identificador: string): string {
  return `"${identificador.replace(/"/g, '""')}"`;
}

/** Literal de cadena SQL con las comillas simples escapadas. */
function literal(valor: string): string {
  return `'${valor.replace(/'/g, "''")}'`;
}

/**
 * `CREATE ROLE` y `GRANT` no admiten parámetros, así que el nombre del rol
 * acaba en el texto de la sentencia. Se acota a un identificador SQL corriente
 * para que no haya forma de colar nada por ahí.
 */
function validarIdentificador(valor: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(valor)) {
    throw new Error(
      `Nombre de rol de aplicación inválido: "${valor}". Debe ser un identificador SQL simple (letras, dígitos y guion bajo, sin empezar por dígito).`,
    );
  }
}
