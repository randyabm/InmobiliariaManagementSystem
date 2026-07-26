import type { PoolClient } from 'pg';

import { AppError } from '../errors';

/**
 * Un repositorio se ejecutó sin contexto de tenant (**R34**).
 *
 * Es 500 a propósito: no es una condición esperada del negocio sino un defecto
 * de programación (alguien saltó el `TenantContextInterceptor` o usó el pool
 * crudo). El `AllExceptionsFilter` no expone el mensaje de los errores >= 500,
 * así que el cliente recibe el 500 genérico sin detalle interno.
 */
export class SinContextoDeTenantError extends AppError {
  readonly code = 'SIN_CONTEXTO_DE_TENANT';
  readonly httpStatus = 500;

  constructor(
    message = 'La operación se intentó sin contexto de tenant establecido.',
  ) {
    super(message);
  }
}

/** Contexto mínimo que todo servicio de `clientes/` necesita. */
export interface ContextoPeticion {
  /** Cliente de la transacción que YA tiene `SET LOCAL app.current_tenant`. */
  readonly cliente: PoolClient;
  readonly tenantId: string;
  /** `user.id` de quien ejecuta la acción; alimenta `audit_log.actor_id`. */
  readonly actorId?: string;
}

interface PeticionConTenant {
  tenantClient?: unknown;
  tenantResuelto?: unknown;
  user?: { sub?: string };
}

function esPoolClient(valor: unknown): valor is PoolClient {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    typeof (valor as { query?: unknown }).query === 'function'
  );
}

/**
 * Devuelve el `PoolClient` de la transacción de la petición.
 *
 * **Regla dura de la feature #5** (design.md §3): ningún repositorio de
 * `clientes/` llama a `getDatabasePool()`. Todos consultan sobre este cliente,
 * que es el único que tiene el `SET LOCAL app.current_tenant`. Así una
 * consulta sin contexto **falla** en vez de devolver filas de más
 * (docs/architecture.md, R34).
 */
export function obtenerClienteTenant(request: unknown): PoolClient {
  const peticion = request as PeticionConTenant | undefined;
  const cliente = peticion?.tenantClient;

  if (!esPoolClient(cliente)) {
    throw new SinContextoDeTenantError();
  }
  return cliente;
}

/** Contexto completo de la petición, ya con el tenant resuelto y validado. */
export function construirContextoPeticion(request: unknown): ContextoPeticion {
  const peticion = request as PeticionConTenant | undefined;
  const cliente = obtenerClienteTenant(request);
  const tenantId = peticion?.tenantResuelto;

  if (typeof tenantId !== 'string' || tenantId === '') {
    throw new SinContextoDeTenantError();
  }

  return { cliente, tenantId, actorId: peticion?.user?.sub };
}
