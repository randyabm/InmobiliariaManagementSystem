import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { TipoDocumento } from '@inmobiliaria/types';

import { NombreNoCoincideConIdentidadError } from './errors/nombre-no-coincide.error';

export type RolDeCliente = 'propietario' | 'inquilino';

export interface DatosDeIdentidad {
  nombre: string;
  tipoDocumento: TipoDocumento;
  documento: string;
}

export interface IdentidadResuelta {
  userId: string;
  /** `true` si se reutilizó una identidad preexistente de esta inmobiliaria. */
  reutilizada: boolean;
}

/**
 * Resuelve la identidad (`user`) de un cliente y le asegura su rol en la
 * inmobiliaria (`user_role`).
 *
 * Recibe el `PoolClient` **explícitamente** para que la identidad, el rol y el
 * perfil ocurran en **la misma transacción** que abrió el
 * `TenantContextInterceptor` (**R12**): un fallo parcial no puede dejar un
 * `user` huérfano sin perfil, ni un `user_role` de más.
 *
 * ## La clave de la identidad es el DOCUMENTO, no el correo (#26, R11)
 *
 * Hasta la feature #26 esto buscaba por `email`. Esa búsqueda quedó
 * **inalcanzable** cuando D-9 mudó el contacto al perfil y `user.email` pasó a
 * ser NULL para todo cliente registrado por la inmobiliaria: ningún llamador le
 * pasaba correo. Con ello desapareció la clave por la que reconocer a la misma
 * persona **dentro** de una agencia, y quien fuera propietario **e** inquilino
 * acababa siendo **dos filas de `user`** con dos credenciales potenciales.
 *
 * Ahora la clave es `(tenant_id, tipo_documento, documento)`, que además es un
 * **índice único parcial** en el motor desde `0009` (**R6**). El servicio
 * deduplica; quien garantiza el invariante es PostgreSQL.
 *
 * ## Nunca se reutiliza una identidad de OTRA inmobiliaria (R14, D-8)
 *
 * D-8 sigue intacta y esta feature no la reintroduce por la puerta de atrás:
 * `buscarPorDocumentoEnEsteTenant` lleva el `tenant_id` como **predicado
 * explícito** además del RLS (**R10**), así que la misma persona dada de alta
 * en dos inmobiliarias tiene dos identidades, dos credenciales y dos portales
 * (D-13). Buscar el documento fuera del tenant revelaría que ya es cliente de
 * otra agencia, justo lo que prohíbe el PRD §11.3.
 *
 * ## Dentro de la MISMA inmobiliaria sí se reutiliza, y es el objetivo
 *
 * Una persona puede ser propietaria **e** inquilina de la misma inmobiliaria
 * (RF-C2): son dos perfiles y dos `user_role`, pero **una sola identidad** y
 * por tanto **una sola credencial** (**R4**). Al reutilizar no se toca ni el
 * `email`, ni el `password_hash`, ni el `nombre`.
 *
 * Lo que **no** se deduplica es el **perfil**: crear dos veces el mismo rol
 * para el mismo documento sigue siendo 409 `PERFIL_YA_EXISTE` (**R7**), y esa
 * comprobación ocurre antes, en el servicio de cada rol.
 *
 * El `user` se crea sin `password_hash` y con `email` NULL: es un cliente
 * registrado por la inmobiliaria (RF-C1), no alguien que se dio de alta en un
 * portal. Mientras el hash sea NULL, el login responde 401 sin evaluar
 * contraseña (**R6** de la #5).
 */
@Injectable()
export class IdentidadService {
  async resolverIdentidad(
    cliente: PoolClient,
    datos: DatosDeIdentidad,
    tenantId: string,
    rol: RolDeCliente,
  ): Promise<IdentidadResuelta> {
    const existente = await this.buscarPorDocumentoEnEsteTenant(
      cliente,
      datos.tipoDocumento,
      datos.documento,
      tenantId,
    );

    // R9: el rechazo por nombre discrepante ocurre ANTES de tocar `user_role`,
    // así que no queda nada que deshacer. La atomicidad de R12 cubre el otro
    // camino (el perfil que falla después de haber añadido el rol).
    if (existente !== null && !nombresCoinciden(existente.nombre, datos.nombre)) {
      throw new NombreNoCoincideConIdentidadError(
        existente.userId,
        existente.nombre,
        datos.nombre,
      );
    }

    const identidad: IdentidadResuelta =
      existente !== null
        ? { userId: existente.userId, reutilizada: true }
        : {
            userId: await this.crearIdentidadNueva(cliente, datos, tenantId),
            reutilizada: false,
          };

    await this.asegurarRol(cliente, identidad.userId, tenantId, rol);
    return identidad;
  }

  /**
   * Identidad existente **de esta misma inmobiliaria** con ese documento
   * (**R1**, **R2**, **R10**).
   *
   * El `AND tenant_id = $3` no es redundante con el RLS y no es opcional: es la
   * **doble barrera** que usan todos los repositorios de este proyecto. El RLS
   * es la garantía real, pero es inerte para un rol con `BYPASSRLS`, y el
   * aislamiento no puede depender de un detalle de configuración del
   * despliegue. Quitarlo es una de las mutaciones que el informe de
   * implementación pone en rojo (T27b).
   *
   * Devuelve también el `nombre` porque R9 lo necesita para decidir, y el 409
   * de R28 para poder decir contra qué nombre choca.
   */
  private async buscarPorDocumentoEnEsteTenant(
    cliente: PoolClient,
    tipoDocumento: TipoDocumento,
    documento: string,
    tenantId: string,
  ): Promise<{ userId: string; nombre: string } | null> {
    const { rows } = await cliente.query<{ id: string; nombre: string }>(
      `SELECT id, nombre FROM "user"
        WHERE tipo_documento = $1 AND documento = $2 AND tenant_id = $3`,
      [tipoDocumento, documento, tenantId],
    );
    const encontrada = rows[0];
    return encontrada
      ? { userId: encontrada.id, nombre: encontrada.nombre }
      : null;
  }

  /** **R5**: el documento se persiste en la identidad, no solo en el perfil. */
  private async crearIdentidadNueva(
    cliente: PoolClient,
    datos: DatosDeIdentidad,
    tenantId: string,
  ): Promise<string> {
    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO "user" (tenant_id, email, password_hash, nombre, tipo_documento, documento)
       VALUES ($1, NULL, NULL, $2, $3, $4)
       RETURNING id`,
      [tenantId, datos.nombre, datos.tipoDocumento, datos.documento],
    );

    const creada = rows[0];
    if (!creada) {
      throw new Error('No se pudo crear la identidad del cliente.');
    }
    return creada.id;
  }

  /**
   * **R3**: el rol se añade a la identidad reutilizada, dejando activas ambas
   * filas.
   *
   * `user_role` ya tiene `UNIQUE (user_id, tenant_id, rol)`, así que registrar
   * al mismo `user` como propietario dos veces no duplica la fila.
   */
  private async asegurarRol(
    cliente: PoolClient,
    userId: string,
    tenantId: string,
    rol: RolDeCliente,
  ): Promise<void> {
    await cliente.query(
      `INSERT INTO user_role (user_id, tenant_id, rol, activo)
       VALUES ($1, $2, $3, true)
       ON CONFLICT ON CONSTRAINT user_role_user_tenant_rol_key DO NOTHING`,
      [userId, tenantId, rol],
    );
  }
}

/**
 * Criterio de comparación de nombres de **R27**: podar los extremos, colapsar
 * los espacios internos repetidos y pasar a minúsculas. **Nada más.**
 *
 * Es lo mínimo defendible: absorbe el ruido de tecleo (doble espacio,
 * mayúsculas inconsistentes) y ninguna otra cosa.
 *
 * ## Lo que deliberadamente NO hace (PA-5, `design.md` §10.2)
 *
 * 1. **No pliega tildes ni diacríticos.** `"Maria Perez"` y `"María Pérez"`
 *    **no** coinciden y disparan el 409 de R9. Decisión explícita del humano:
 *    es lo estricto, obliga a escribir bien el nombre legal, y plegarlos sería
 *    inventar producto. Si algún día se decide plegar, es una línea aquí más su
 *    caso en el test.
 * 2. **No reordena apellidos.** `"Pérez María"` y `"María Pérez"` son la misma
 *    persona y este criterio los rechaza. Resolverlo exige un modelo de nombre
 *    por partes que hoy no existe (`user.nombre` es texto libre): es un cambio
 *    de modelo de datos, no de comparación, y sería feature propia.
 *
 * Mientras PA-5 no se decida, **este criterio rige tal cual**.
 */
export function nombresCoinciden(a: string, b: string): boolean {
  return normalizarNombre(a) === normalizarNombre(b);
}

function normalizarNombre(nombre: string): string {
  return nombre.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Normaliza a NULL cualquier email ausente o en blanco (D-5). */
export function normalizarEmail(email?: string | null): string | null {
  if (typeof email !== 'string') return null;
  const limpio = email.trim().toLowerCase();
  return limpio === '' ? null : limpio;
}
