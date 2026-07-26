import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import {
  SinContextoDeTenantError,
  construirContextoPeticion,
  obtenerClienteTenant,
} from '../../database/cliente-tenant';
import { TenantNoAutorizadoError } from '../../errors';
import { TenantContextInterceptor } from '../../interceptors/tenant-context.interceptor';
import { RolesGuard } from '../../../modules/core/auth/roles.guard';
import { ROLES_KEY } from '../../../modules/core/auth/roles.decorator';
import {
  resolverTenantDePeticion,
  resolverTenantOpcional,
  tenantsDelToken,
} from '../resolver-tenant';

/**
 * Resolución del tenant de la petición (T14 → R32, R33, R34).
 *
 * Deterministas y sin base de datos: la regla que decide EN QUÉ inmobiliaria
 * se escribe es lógica pura y debe poder probarse sin infraestructura. El
 * aislamiento real contra PostgreSQL vive en `clientes-rls.test.ts` y en los
 * tests HTTP de `modules/core/clientes/__tests__/`.
 */

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

const identidadUnTenant = {
  sub: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  email: 'admin@example.com',
  roles: [{ tenant_id: TENANT_A, rol: 'admin' }],
};

const identidadDosTenants = {
  sub: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  email: 'multi@example.com',
  roles: [
    { tenant_id: TENANT_A, rol: 'empleado' },
    { tenant_id: TENANT_B, rol: 'admin' },
  ],
};

describe('tenantsDelToken', () => {
  it('deduplica los tenants del token', () => {
    expect(
      tenantsDelToken({
        roles: [
          { tenant_id: TENANT_A, rol: 'admin' },
          { tenant_id: TENANT_A, rol: 'empleado' },
          { tenant_id: TENANT_B, rol: 'admin' },
        ],
      }),
    ).toEqual([TENANT_A, TENANT_B]);
  });

  it('devuelve lista vacía si el token no trae roles', () => {
    expect(tenantsDelToken(undefined)).toEqual([]);
    expect(tenantsDelToken({})).toEqual([]);
  });
});

describe('resolverTenantDePeticion (R33)', () => {
  it('sin header y con un solo tenant en el JWT, usa ese tenant', () => {
    expect(resolverTenantDePeticion(identidadUnTenant, undefined)).toBe(TENANT_A);
  });

  it('con header que corresponde a un rol activo, usa el header', () => {
    expect(resolverTenantDePeticion(identidadDosTenants, TENANT_B)).toBe(TENANT_B);
  });

  it('con header de un tenant SIN rol activo en el JWT, lanza 403', () => {
    const ajeno = '33333333-3333-3333-3333-333333333333';

    expect(() => resolverTenantDePeticion(identidadUnTenant, ajeno)).toThrow(
      TenantNoAutorizadoError,
    );
  });

  it('el 403 no revela el tenant solicitado', () => {
    try {
      resolverTenantDePeticion(identidadUnTenant, TENANT_B);
      expect.unreachable('debía lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(TenantNoAutorizadoError);
      expect((error as Error).message).not.toContain(TENANT_B);
    }
  });

  it('con header que no es un uuid, lanza 403 en vez de intentar la consulta', () => {
    expect(() =>
      resolverTenantDePeticion(identidadUnTenant, "'; DROP TABLE tenant; --"),
    ).toThrow(TenantNoAutorizadoError);
  });

  it('sin header y con VARIOS tenants en el JWT, lanza 403 (no elige roles[0])', () => {
    // Este es exactamente el defecto heredado de #2/#3: `roles[0].tenant_id`
    // habría devuelto TENANT_A en silencio.
    expect(() => resolverTenantDePeticion(identidadDosTenants, undefined)).toThrow(
      TenantNoAutorizadoError,
    );
  });

  it('sin header y sin ningún rol activo, lanza 403', () => {
    expect(() => resolverTenantDePeticion({ sub: 'x', roles: [] }, undefined)).toThrow(
      TenantNoAutorizadoError,
    );
  });
});

describe('resolverTenantOpcional (interceptor global)', () => {
  it('una petición sin JWT no resuelve tenant y no lanza', () => {
    expect(resolverTenantOpcional(undefined, TENANT_A)).toBeNull();
  });

  it('sin header y con varios tenants devuelve null, no un tenant arbitrario', () => {
    expect(resolverTenantOpcional(identidadDosTenants, undefined)).toBeNull();
  });

  it('con header ajeno lanza 403 aunque la ruta no exija rol (R33)', () => {
    expect(() => resolverTenantOpcional(identidadUnTenant, TENANT_B)).toThrow(
      TenantNoAutorizadoError,
    );
  });
});

// ─── RolesGuard ────────────────────────────────────────────────────────────

function contextoFalso(
  request: Record<string, unknown>,
  roles?: string[],
): { contexto: ExecutionContext; reflector: Reflector } {
  const reflector = {
    getAllAndOverride: (clave: string) => (clave === ROLES_KEY ? roles : undefined),
  } as unknown as Reflector;

  const contexto = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;

  return { contexto, reflector };
}

describe('RolesGuard con el tenant resuelto (R32, R33)', () => {
  it('deja pasar al admin del tenant indicado y deja el tenant resuelto', () => {
    const request = { user: identidadDosTenants, headers: { 'x-tenant-id': TENANT_B } };
    const { contexto, reflector } = contextoFalso(request, ['admin', 'empleado']);

    expect(new RolesGuard(reflector).canActivate(contexto)).toBe(true);
    expect(request).toMatchObject({ tenantResuelto: TENANT_B });
  });

  it('rechaza con 403 si el header apunta a un tenant sin rol activo', () => {
    const request = { user: identidadUnTenant, headers: { 'x-tenant-id': TENANT_B } };
    const { contexto, reflector } = contextoFalso(request, ['admin']);

    expect(() => new RolesGuard(reflector).canActivate(contexto)).toThrow(
      TenantNoAutorizadoError,
    );
    expect(request).not.toHaveProperty('tenantResuelto');
  });

  it('rechaza al usuario que tiene el rol exigido pero en OTRA inmobiliaria', () => {
    // Antes de #5 esto pasaba el guard: se miraban todos los roles del token.
    const request = { user: identidadDosTenants, headers: { 'x-tenant-id': TENANT_A } };
    const { contexto, reflector } = contextoFalso(request, ['admin']);

    expect(() => new RolesGuard(reflector).canActivate(contexto)).toThrow(
      /Rol insuficiente/,
    );
  });

  it('sin metadatos de rol no exige nada', () => {
    const { contexto, reflector } = contextoFalso({ headers: {} }, undefined);
    expect(new RolesGuard(reflector).canActivate(contexto)).toBe(true);
  });

  it('sin roles en el token, 403', () => {
    const { contexto, reflector } = contextoFalso({ user: {}, headers: {} }, ['admin']);
    expect(() => new RolesGuard(reflector).canActivate(contexto)).toThrow(
      /Sin roles asignados/,
    );
  });
});

// ─── TenantContextInterceptor ──────────────────────────────────────────────

describe('TenantContextInterceptor (R33, R34)', () => {
  const siguiente = { handle: () => of('ok') };

  it('una petición sin JWT pasa sin abrir transacción', async () => {
    const request: Record<string, unknown> = { headers: {} };
    const { contexto } = contextoFalso(request);

    const salida = await new TenantContextInterceptor().intercept(contexto, siguiente);

    await expect(firstValueFrom(salida)).resolves.toBe('ok');
    expect(request.tenantClient).toBeUndefined();
  });

  it('con header ajeno lanza 403 antes de tocar la base de datos (R33)', async () => {
    const request = { user: identidadUnTenant, headers: { 'x-tenant-id': TENANT_B } };
    const { contexto } = contextoFalso(request);

    await expect(
      new TenantContextInterceptor().intercept(contexto, siguiente),
    ).rejects.toBeInstanceOf(TenantNoAutorizadoError);
    expect(request).not.toHaveProperty('tenantClient');
  });

  it('sin DATABASE_URL no inventa un cliente: el repositorio fallará con R34', async () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const request: Record<string, unknown> = { user: identidadUnTenant, headers: {} };
      const { contexto } = contextoFalso(request);

      const salida = await new TenantContextInterceptor().intercept(contexto, siguiente);
      await firstValueFrom(salida);

      expect(request.tenantResuelto).toBe(TENANT_A);
      expect(() => obtenerClienteTenant(request)).toThrow(SinContextoDeTenantError);
    } finally {
      if (original === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original;
    }
  });
});

// ─── obtenerClienteTenant (R34) ────────────────────────────────────────────

describe('obtenerClienteTenant (R34)', () => {
  it('sin tenantClient lanza SinContextoDeTenantError', () => {
    expect(() => obtenerClienteTenant({})).toThrow(SinContextoDeTenantError);
    expect(() => obtenerClienteTenant(undefined)).toThrow(SinContextoDeTenantError);
  });

  it('el error es 500 y su código no se filtra como condición de negocio', () => {
    const error = new SinContextoDeTenantError();
    expect(error.httpStatus).toBe(500);
    expect(error.code).toBe('SIN_CONTEXTO_DE_TENANT');
  });

  it('devuelve el cliente de la transacción cuando existe', () => {
    const cliente = { query: () => undefined };
    expect(obtenerClienteTenant({ tenantClient: cliente })).toBe(cliente);
  });

  it('rechaza cualquier cosa que no sea un cliente de PostgreSQL', () => {
    expect(() => obtenerClienteTenant({ tenantClient: {} })).toThrow(
      SinContextoDeTenantError,
    );
    expect(() => obtenerClienteTenant({ tenantClient: 'un cliente' })).toThrow(
      SinContextoDeTenantError,
    );
  });
});

describe('construirContextoPeticion (R34)', () => {
  const cliente = { query: () => undefined };

  it('sin cliente de transacción falla en vez de consultar sin filtro', () => {
    expect(() => construirContextoPeticion({ tenantResuelto: TENANT_A })).toThrow(
      SinContextoDeTenantError,
    );
  });

  it('sin tenant resuelto falla aunque haya cliente', () => {
    // Un cliente sin `SET LOCAL app.current_tenant` es exactamente el caso que
    // docs/architecture.md prohíbe: la consulta debe fallar, no devolver todo.
    expect(() => construirContextoPeticion({ tenantClient: cliente })).toThrow(
      SinContextoDeTenantError,
    );
    expect(() =>
      construirContextoPeticion({ tenantClient: cliente, tenantResuelto: '' }),
    ).toThrow(SinContextoDeTenantError);
  });

  it('construye el contexto completo, con el actor para la auditoría', () => {
    const ctx = construirContextoPeticion({
      tenantClient: cliente,
      tenantResuelto: TENANT_A,
      user: { sub: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    });

    expect(ctx.tenantId).toBe(TENANT_A);
    expect(ctx.actorId).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(ctx.cliente).toBe(cliente);
  });
});
