import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { ROLES_KEY } from '../roles.decorator';
import { RolesGuard } from '../roles.guard';

/**
 * **T21 — R18, R20, R29**: el rol activo **restringe**, nunca amplía.
 *
 * ## Por qué esta parte se prueba aquí y no solo contra HTTP
 *
 * La propiedad de R18 —"elegir propietario quita el acceso a lo de
 * inquilino"— necesita dos endpoints que exijan `propietario` e `inquilino`
 * respectivamente, y **hoy no existen**: son del portal del cliente
 * (RF-AU2/AU4), que no está en el tablero, y esta feature no construye UI ni
 * inventa rutas para poder probarse. El guard es el **único** punto donde se
 * aplica la regla (`design.md` §6), así que aquí se ejerce con los roles reales
 * del caso, de forma determinista y sin infraestructura.
 *
 * La misma propiedad se comprueba **también** extremo a extremo sobre rutas que
 * sí existen, con los roles `empleado` y `propietario`, en
 * `rol-activo.api.test.ts`. Ninguna de las dos sustituye a la otra: esta fija la
 * regla, aquella demuestra que está enchufada.
 */

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

function contextoFalso(
  request: Record<string, unknown>,
  roles?: string[],
): { contexto: ExecutionContext; reflector: Reflector } {
  const reflector = {
    getAllAndOverride: (clave: string) =>
      clave === ROLES_KEY ? roles : undefined,
  } as unknown as Reflector;

  const contexto = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;

  return { contexto, reflector };
}

/** Identidad multirol: propietaria **e** inquilina de la misma inmobiliaria. */
function peticionMultirol(rolActivo?: string): Record<string, unknown> {
  return {
    headers: {},
    user: {
      sub: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      email: null,
      roles: [
        { tenant_id: TENANT_A, rol: 'propietario' },
        { tenant_id: TENANT_A, rol: 'inquilino' },
      ],
      ...(rolActivo === undefined ? {} : { rol_activo: rolActivo }),
    },
  };
}

function autorizar(
  request: Record<string, unknown>,
  requeridos: string[],
): boolean {
  const { contexto, reflector } = contextoFalso(request, requeridos);
  return new RolesGuard(reflector).canActivate(contexto);
}

describe('RolesGuard y el rol activo (#26 R18, R20, R29)', () => {
  describe('R18 — elegir un rol quita el acceso al otro', () => {
    it('con rol_activo=propietario, una ruta de propietario autoriza', () => {
      expect(autorizar(peticionMultirol('propietario'), ['propietario'])).toBe(
        true,
      );
    });

    it('con rol_activo=propietario, una ruta de inquilino responde 403', () => {
      // Aunque la identidad TIENE el rol inquilino activo en esta
      // inmobiliaria. Es la mitad que importa del acceptance nº4: el rol
      // elegido quita acceso, no solo lo oculta.
      expect(() =>
        autorizar(peticionMultirol('propietario'), ['inquilino']),
      ).toThrow(ForbiddenException);
    });

    it('y a la inversa: con rol_activo=inquilino, lo de propietario da 403', () => {
      expect(autorizar(peticionMultirol('inquilino'), ['inquilino'])).toBe(true);
      expect(() =>
        autorizar(peticionMultirol('inquilino'), ['propietario']),
      ).toThrow(ForbiddenException);
    });

    it('el rol activo nunca amplía: no autoriza un rol que la identidad no tiene', () => {
      // La propiedad estructural de §6: `rolesEfectivos ⊆ rolesDelTenant`.
      expect(() => autorizar(peticionMultirol('propietario'), ['admin'])).toThrow(
        ForbiddenException,
      );
      expect(() => autorizar(peticionMultirol(), ['admin'])).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('R20 — compatibilidad de los tokens sin rol activo', () => {
    it('sin rol_activo basta con tener alguno de los roles requeridos', () => {
      expect(autorizar(peticionMultirol(), ['propietario'])).toBe(true);
      expect(autorizar(peticionMultirol(), ['inquilino'])).toBe(true);
      expect(autorizar(peticionMultirol(), ['inquilino', 'admin'])).toBe(true);
    });

    it('un rol_activo vacío o no textual se trata como ausente', () => {
      // Un claim manipulado a `""`, `null` o un objeto no puede convertir el
      // guard en algo distinto de su comportamiento previo, ni en más
      // permisivo ni en un 500.
      for (const basura of ['', null, 0, {}, []]) {
        const peticion = {
          headers: {},
          user: {
            sub: 'x',
            roles: [{ tenant_id: TENANT_A, rol: 'propietario' }],
            rol_activo: basura,
          },
        };
        expect(autorizar(peticion, ['propietario'])).toBe(true);
        expect(() => autorizar(peticion, ['inquilino'])).toThrow(
          ForbiddenException,
        );
      }
    });
  });

  describe('R29 — el rol activo tiene que ser coherente con el token', () => {
    it('un rol_activo que el token no respalda responde 403', () => {
      const peticion = {
        headers: {},
        user: {
          sub: 'x',
          roles: [{ tenant_id: TENANT_A, rol: 'propietario' }],
          rol_activo: 'admin',
        },
      };

      expect(() => autorizar(peticion, ['admin'])).toThrow(ForbiddenException);
      // Y tampoco cuela para lo que sí tendría derecho: un token incoherente
      // no autoriza nada, no "autoriza lo de antes".
      expect(() => autorizar(peticion, ['propietario'])).toThrow(
        ForbiddenException,
      );
    });

    it('el rol activo se coteja contra los roles del tenant RESUELTO', () => {
      // El rol existe en el token, pero en OTRA inmobiliaria. Si se cotejara
      // contra "todos los roles del token" se autorizaría una petición dirigida
      // al tenant A con un permiso de B, que es el defecto que R33 cerró.
      const peticion = {
        headers: { 'x-tenant-id': TENANT_A },
        user: {
          sub: 'x',
          roles: [
            { tenant_id: TENANT_A, rol: 'propietario' },
            { tenant_id: TENANT_B, rol: 'admin' },
          ],
          rol_activo: 'admin',
        },
      };

      expect(() => autorizar(peticion, ['admin'])).toThrow(ForbiddenException);
    });
  });

  it('las rutas sin @Roles siguen sin exigir nada (sin regresión)', () => {
    const { contexto, reflector } = contextoFalso(
      peticionMultirol('propietario'),
      undefined,
    );
    expect(new RolesGuard(reflector).canActivate(contexto)).toBe(true);
  });
});
