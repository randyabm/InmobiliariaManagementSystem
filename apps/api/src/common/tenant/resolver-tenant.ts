import { TenantNoAutorizadoError } from '../errors';

export const HEADER_TENANT = 'x-tenant-id';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RolDeToken {
  tenant_id: string;
  rol: string;
}

export interface IdentidadDeToken {
  sub?: string;
  email?: string | null;
  roles?: RolDeToken[];
}

/**
 * Tenants distintos en los que el portador del token tiene un rol activo.
 *
 * El JWT solo lleva roles activos (`AuthService.login` filtra por
 * `activo = true`), así que no hace falta volver a filtrar aquí.
 */
export function tenantsDelToken(identidad?: IdentidadDeToken | null): string[] {
  if (!identidad || !Array.isArray(identidad.roles)) return [];

  const vistos = new Set<string>();
  for (const rol of identidad.roles) {
    if (typeof rol?.tenant_id === 'string' && rol.tenant_id !== '') {
      vistos.add(rol.tenant_id);
    }
  }
  return [...vistos];
}

/**
 * Resuelve el tenant de una petición autenticada (**R33**).
 *
 * Regla (design.md §1, deuda heredada de #2/#3):
 *
 * 1. Si viene `x-tenant-id`, DEBE corresponder a un rol activo del JWT.
 * 2. Si no viene y el JWT tiene exactamente un tenant, se usa ese.
 * 3. Cualquier otro caso → 403.
 *
 * Antes el tenant se deducía de `roles[0].tenant_id`. Con una identidad con
 * roles en varias inmobiliarias (RF-AU6) eso podía escribir en la equivocada:
 * no es un detalle cosmético, es el invariante de aislamiento.
 *
 * Es una función **pura**: no toca la base de datos, así que el 403 ocurre
 * antes de ejecutar ninguna consulta de negocio.
 */
export function resolverTenantDePeticion(
  identidad: IdentidadDeToken | undefined,
  headerCrudo: unknown,
): string {
  const tenants = tenantsDelToken(identidad);
  const header = typeof headerCrudo === 'string' ? headerCrudo.trim() : '';

  if (header !== '') {
    if (!UUID_REGEX.test(header) || !tenants.includes(header)) {
      throw new TenantNoAutorizadoError();
    }
    return header;
  }

  const [unico] = tenants;
  if (tenants.length === 1 && unico !== undefined) {
    return unico;
  }

  throw new TenantNoAutorizadoError();
}

/**
 * Variante para el interceptor global, que corre sobre **todas** las rutas,
 * incluidas las públicas (`GET /health`, `POST /auth/login`).
 *
 * - Petición sin JWT → `null`: no se abre transacción ni se conecta a la base
 *   de datos. `GET /health` sigue respondiendo sin PostgreSQL levantado (R14
 *   de la feature #1).
 * - Header presente que no casa con ningún rol activo → **403**, que es la
 *   condición literal de R33, se pida el recurso que se pida.
 * - Sin header y con 0 o varios tenants → `null`: no se establece contexto.
 *   Las rutas de negocio ya han sido rechazadas con 403 por `RolesGuard`, que
 *   usa `resolverTenantDePeticion` en su versión estricta; las que no exigen
 *   rol (p. ej. `GET /auth/me`) siguen funcionando para una identidad
 *   multi-tenant, que es justo el caso de RF-AU6.
 */
export function resolverTenantOpcional(
  identidad: IdentidadDeToken | undefined,
  headerCrudo: unknown,
): string | null {
  if (!identidad) return null;

  const header = typeof headerCrudo === 'string' ? headerCrudo.trim() : '';
  if (header !== '') {
    return resolverTenantDePeticion(identidad, header);
  }

  const tenants = tenantsDelToken(identidad);
  const [unico] = tenants;
  return tenants.length === 1 && unico !== undefined ? unico : null;
}
