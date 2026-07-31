import type { INestApplication } from '@nestjs/common';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { Pool } from 'pg';

import { closeDatabasePool } from '../../src/database/database.client';
import { resolveMigrationsFolder } from '../../src/database/migrations-folder';
import { runMigrations } from '../../src/database/run-migrations';
import { crearAppDePrueba } from './create-test-app';
import { ENTORNO_DE_PRUEBA } from './test-env';

/**
 * Entorno compartido de los tests de la feature #5: **PostgreSQL real**
 * (Testcontainers) + la aplicación NestJS real, configurada exactamente igual
 * que en producción (`configureApp`).
 *
 * Nada de mocks del repositorio ni de la base de datos: el aislamiento por
 * tenant y el RBAC se prueban sobre el sistema, no sobre la intención del
 * código (docs/verification.md, niveles 2 y 3).
 *
 * `JWT_SECRET` es un valor inerte de test, no un secreto (CHECKPOINTS.md §C7).
 */
export const JWT_SECRET_DE_PRUEBA = ENTORNO_DE_PRUEBA.JWT_SECRET as string;

export const TENANT_A = '11111111-1111-1111-1111-111111111111';
export const TENANT_B = '22222222-2222-2222-2222-222222222222';

/**
 * Códigos de inmobiliaria (D-12, R73). Son el identificador que el usuario
 * escribe en el login desde que el correo dejó de ser único global (D-8), y
 * cumplen el formato de etiqueta DNS que exige R73.
 */
export const CODIGO_TENANT_A = 'inmobiliaria-a';
export const CODIGO_TENANT_B = 'inmobiliaria-b';

/** Contraseña literal de test, no una credencial real. */
export const CLAVE_DE_PRUEBA = 'clave-de-prueba-1234';

export interface UsuarioSembrado {
  id: string;
  email: string | null;
  token: string;
}

export interface EntornoClientes {
  app: INestApplication;
  poolAdmin: Pool;
  contenedor: StartedPostgreSqlContainer;
  /** admin del tenant A, con credenciales. */
  adminA: UsuarioSembrado;
  /** empleado del tenant A. */
  empleadoA: UsuarioSembrado;
  /** admin del tenant B. */
  adminB: UsuarioSembrado;
  /** único rol activo `propietario` en el tenant A (R32). */
  propietarioA: UsuarioSembrado;
  /** único rol activo `inquilino` en el tenant A (R32). */
  inquilinoA: UsuarioSembrado;
  /**
   * `admin` del tenant B **con un token que además declara un rol en A**.
   *
   * Sustituye a la antigua identidad `multiTenant` (un `user` con roles en A y
   * en B), que **D-8 hizo irrepresentable**: `user.tenant_id` y la FK compuesta
   * de R60 impiden que una identidad viva en dos inmobiliarias.
   *
   * Lo que aquella semilla probaba de R33 —que el tenant se resuelve del header
   * validado y no de `roles[0]`— sigue haciendo falta, y este usuario lo prueba
   * **mejor**: el token afirma dos tenants, pero la identidad solo pertenece a
   * uno. Un token manipulado es exactamente la amenaza contra la que R33
   * defiende, y ahora el motor tiene la última palabra.
   */
  tokenConRolAjeno: UsuarioSembrado;
  /** Identidad sin email y sin `password_hash` (R6, D-5). */
  clienteSinCredenciales: { id: string };
  cerrar(): Promise<void>;
}

function firmar(id: string, email: string | null, roles: Array<{ tenant_id: string; rol: string }>): string {
  return jwt.sign({ sub: id, email, roles }, JWT_SECRET_DE_PRUEBA, {
    expiresIn: '1h',
  });
}

export async function levantarEntornoClientes(): Promise<EntornoClientes> {
  const contenedor = await new PostgreSqlContainer('postgres:16.4-alpine').start();
  const connectionString = contenedor.getConnectionUri();

  await runMigrations(connectionString, resolveMigrationsFolder(__dirname));

  const poolAdmin = new Pool({ connectionString });

  await poolAdmin.query(
    `INSERT INTO tenant (id, nombre, nit, codigo)
     VALUES ($1, 'Inmobiliaria A', '900111111', $3),
            ($2, 'Inmobiliaria B', '900222222', $4)`,
    [TENANT_A, TENANT_B, CODIGO_TENANT_A, CODIGO_TENANT_B],
  );

  const hash = await bcrypt.hash(CLAVE_DE_PRUEBA, 10);

  /**
   * Siembra una identidad y sus roles.
   *
   * Desde **D-8** la identidad pertenece a **un** tenant (`user.tenant_id`), y
   * la FK compuesta de R60 impide que sus roles apunten a otro. `rolesEnToken`
   * existe solo para poder firmar un token que **afirme** más de lo que la base
   * permite: es el escenario de token manipulado contra el que R33 defiende.
   */
  async function sembrar(
    tenantId: string,
    email: string | null,
    nombre: string,
    roles: Array<{ tenant_id: string; rol: string }>,
    conCredenciales = true,
    rolesEnToken: Array<{ tenant_id: string; rol: string }> = roles,
  ): Promise<UsuarioSembrado> {
    const { rows } = await poolAdmin.query<{ id: string }>(
      `INSERT INTO "user" (tenant_id, email, password_hash, nombre)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [tenantId, email, conCredenciales ? hash : null, nombre],
    );
    const id = rows[0]!.id;

    for (const rol of roles) {
      await poolAdmin.query(
        `INSERT INTO user_role (user_id, tenant_id, rol) VALUES ($1, $2, $3)`,
        [id, rol.tenant_id, rol.rol],
      );
    }
    return { id, email, token: firmar(id, email, rolesEnToken) };
  }

  const adminA = await sembrar(TENANT_A, 'admin-a@example.com', 'Admin A', [
    { tenant_id: TENANT_A, rol: 'admin' },
  ]);
  const empleadoA = await sembrar(TENANT_A, 'empleado-a@example.com', 'Empleado A', [
    { tenant_id: TENANT_A, rol: 'empleado' },
  ]);
  const adminB = await sembrar(TENANT_B, 'admin-b@example.com', 'Admin B', [
    { tenant_id: TENANT_B, rol: 'admin' },
  ]);
  const propietarioA = await sembrar(
    TENANT_A,
    'propietario-a@example.com',
    'Propietario A',
    [{ tenant_id: TENANT_A, rol: 'propietario' }],
  );
  const inquilinoA = await sembrar(TENANT_A, 'inquilino-a@example.com', 'Inquilino A', [
    { tenant_id: TENANT_A, rol: 'inquilino' },
  ]);
  // Identidad del tenant B cuyo TOKEN declara además un rol en A. En la base
  // solo existe el rol de B (D-8, R60); el token afirma de más a propósito.
  const tokenConRolAjeno = await sembrar(
    TENANT_B,
    'token-ajeno@example.com',
    'Token Con Rol Ajeno',
    [{ tenant_id: TENANT_B, rol: 'admin' }],
    true,
    [
      { tenant_id: TENANT_A, rol: 'admin' },
      { tenant_id: TENANT_B, rol: 'admin' },
    ],
  );
  const clienteSinCredenciales = await sembrar(
    TENANT_A,
    null,
    'Cliente sin credenciales',
    [{ tenant_id: TENANT_A, rol: 'propietario' }],
    false,
  );

  const envOriginal = { ...process.env };
  Object.assign(process.env, ENTORNO_DE_PRUEBA, {
    DATABASE_URL: connectionString,
  });

  // El pool es un singleton perezoso: se cierra por si otro test lo abrió
  // contra una cadena distinta.
  await closeDatabasePool();
  const app = await crearAppDePrueba();

  return {
    app,
    poolAdmin,
    contenedor,
    adminA,
    empleadoA,
    adminB,
    propietarioA,
    inquilinoA,
    tokenConRolAjeno,
    clienteSinCredenciales: { id: clienteSinCredenciales.id },
    async cerrar() {
      await app.close();
      await closeDatabasePool();
      await poolAdmin.end();
      await contenedor.stop();
      for (const clave of Object.keys(process.env)) {
        if (!(clave in envOriginal)) delete process.env[clave];
      }
      Object.assign(process.env, envOriginal);
    },
  };
}
