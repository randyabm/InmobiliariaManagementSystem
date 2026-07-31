import { z } from 'zod';

import { ConfigurationError } from '../common/errors';

/** Token de inyección de la configuración validada. */
export const APP_CONFIG = 'APP_CONFIG';

/**
 * Orígenes CORS: lista explícita separada por comas.
 *
 * INVARIANTE (R18, D7, RF-INT4): está prohibido el comodín. El CORS es por
 * dominio de tenant; `*` anularía esa frontera de raíz.
 */
const corsOriginsSchema = z
  .string()
  .transform((valor) =>
    valor
      .split(',')
      .map((origen) => origen.trim())
      .filter((origen) => origen.length > 0),
  )
  .refine((origenes) => origenes.length > 0, {
    message: 'debe contener al menos un origen',
  })
  .refine((origenes) => !origenes.includes('*'), {
    message: 'no admite el comodín "*": declara los orígenes uno a uno',
  });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().positive().max(65535),
  /**
   * Cadena del **rol de aplicación** (D-10, R43, R47): sin `BYPASSRLS`, no
   * superusuario y no dueño de las tablas. El arranque se aborta si el rol de
   * esta conexión puede saltarse el RLS (R44, `verificarRolDeAplicacion`).
   */
  DATABASE_URL: z.string().min(1).startsWith('postgres'),

  /**
   * Cadena del **rol privilegiado** (R47). La usan las migraciones y la
   * provisión del rol de aplicación, nunca la aplicación en ejecución.
   *
   * Es opcional en el esquema, y a propósito: un despliegue que solo *sirve*
   * —sin migrar— no tiene por qué llevar encima la credencial privilegiada.
   * `npm run db:migrate` sí la exige, y falla nombrándola si no está.
   */
  DATABASE_MIGRATION_URL: z.string().min(1).startsWith('postgres').optional(),

  /** Credenciales con las que se provisiona el rol de aplicación (R46). */
  APP_DB_USER: z.string().min(1).optional(),
  APP_DB_PASSWORD: z.string().min(1).optional(),

  CORS_ORIGINS: corsOriginsSchema,

  // Opcionales: nada las consume todavía (feature #1). Se declaran para que
  // `.env.example` y el esquema no diverjan, pero no bloquean el arranque.
  REDIS_URL: z.string().min(1).optional(),
  MINIO_ENDPOINT: z.string().min(1).optional(),
});

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly databaseUrl: string;
  readonly databaseMigrationUrl?: string;
  readonly appDbUser?: string;
  readonly appDbPassword?: string;
  readonly corsOrigins: readonly string[];
  readonly redisUrl?: string;
  readonly minioEndpoint?: string;
}

/**
 * Valida el entorno y devuelve la configuración tipada.
 *
 * R17: si falta una variable requerida (o su valor es inválido) lanza
 * `ConfigurationError` nombrándola. NO existe ningún valor por defecto: un
 * default silencioso en `DATABASE_URL` o en `CORS_ORIGINS` sería precisamente
 * el "valor por defecto inseguro" que el requirement prohíbe.
 */
export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const resultado = envSchema.safeParse(env);

  if (!resultado.success) {
    const variables = [
      ...new Set(
        resultado.error.issues.map((issue) => String(issue.path[0] ?? 'ENV')),
      ),
    ].sort();
    const detalle = resultado.error.issues
      .map((issue) => `${String(issue.path[0] ?? 'ENV')}: ${issue.message}`)
      .join('; ');
    throw new ConfigurationError(variables, detalle);
  }

  const datos = resultado.data;
  return {
    nodeEnv: datos.NODE_ENV,
    port: datos.PORT,
    databaseUrl: datos.DATABASE_URL,
    ...(datos.DATABASE_MIGRATION_URL === undefined
      ? {}
      : { databaseMigrationUrl: datos.DATABASE_MIGRATION_URL }),
    ...(datos.APP_DB_USER === undefined ? {} : { appDbUser: datos.APP_DB_USER }),
    ...(datos.APP_DB_PASSWORD === undefined
      ? {}
      : { appDbPassword: datos.APP_DB_PASSWORD }),
    corsOrigins: Object.freeze([...datos.CORS_ORIGINS]),
    ...(datos.REDIS_URL === undefined ? {} : { redisUrl: datos.REDIS_URL }),
    ...(datos.MINIO_ENDPOINT === undefined
      ? {}
      : { minioEndpoint: datos.MINIO_ENDPOINT }),
  };
}
