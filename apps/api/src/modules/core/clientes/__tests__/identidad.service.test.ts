import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import { NombreNoCoincideConIdentidadError } from '../errors/nombre-no-coincide.error';
import { IdentidadService, nombresCoinciden } from '../identidad.service';

/**
 * **T30 — R27** y **T12 — R10, R11**.
 *
 * Dos cosas que se pueden afirmar sin base de datos y conviene afirmar aquí,
 * porque en un test de API quedarían escondidas detrás de un 201:
 *
 * 1. El **criterio de comparación de nombres** es exactamente el de R27, ni más
 *    ni menos. Los casos que **no** coinciden son documentación ejecutable de
 *    la frontera de PA-5, no un descuido.
 * 2. Las consultas que emite `resolverIdentidad`: **ninguna** filtra `user` por
 *    `email` (R11, cierra la deuda D5) y **toda** búsqueda lleva `tenant_id`
 *    como predicado explícito (R10).
 *
 * El doble de `PoolClient` no simula PostgreSQL —el aislamiento se mide contra
 * el motor real en `identidad-por-documento-rls.test.ts` y en los tests de
 * API—; solo **registra el SQL** para poder afirmar sobre su forma.
 */

interface ConsultaRegistrada {
  sql: string;
  parametros: readonly unknown[];
}

function clienteEspia(
  respuestas: Array<{ rows: Array<Record<string, unknown>> }>,
): { cliente: PoolClient; consultas: ConsultaRegistrada[] } {
  const consultas: ConsultaRegistrada[] = [];
  let indice = 0;

  const cliente = {
    query: (sql: string, parametros: unknown[] = []) => {
      consultas.push({ sql, parametros });
      return Promise.resolve(respuestas[indice++] ?? { rows: [] });
    },
  } as unknown as PoolClient;

  return { cliente, consultas };
}

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const DATOS = {
  nombre: 'María Pérez',
  tipoDocumento: 'CC' as const,
  documento: '52000123',
};

describe('nombresCoinciden — criterio de R27 (T30)', () => {
  it('coincide tras podar, colapsar espacios internos y bajar a minúsculas', () => {
    expect(nombresCoinciden('  maría   PÉREZ ', 'María Pérez')).toBe(true);
    expect(nombresCoinciden('María Pérez', 'María Pérez')).toBe(true);
    expect(nombresCoinciden('\tMARÍA\nPÉREZ  ', 'maría pérez')).toBe(true);
  });

  it('NO pliega tildes: "Maria Perez" y "María Pérez" son distintos', () => {
    // Decisión explícita del humano (PA-5.1): es lo estricto, obliga a escribir
    // bien el nombre legal, y plegar diacríticos sería inventar producto. Este
    // caso dispara el 409 de R9 a propósito.
    expect(nombresCoinciden('Maria Perez', 'María Pérez')).toBe(false);
  });

  it('NO reordena apellidos: "Pérez María" y "María Pérez" son distintos', () => {
    // PA-5.2: resolverlo bien exige un modelo de nombre por partes que hoy no
    // existe (`user.nombre` es texto libre). Es feature propia, no un ajuste
    // de comparación.
    expect(nombresCoinciden('Pérez María', 'María Pérez')).toBe(false);
  });

  it('un nombre distinto sigue siendo distinto', () => {
    expect(nombresCoinciden('María Pérez', 'Carlos Gómez')).toBe(false);
    expect(nombresCoinciden('María Pérez', 'María Pérez Gómez')).toBe(false);
    expect(nombresCoinciden('', 'María Pérez')).toBe(false);
  });

  it('es simétrica y reflexiva', () => {
    expect(nombresCoinciden('María  Pérez', ' maría pérez')).toBe(
      nombresCoinciden(' maría pérez', 'María  Pérez'),
    );
    expect(nombresCoinciden('  ', '')).toBe(true);
  });
});

describe('IdentidadService: forma de las consultas (T12 — R10, R11)', () => {
  const servicio = new IdentidadService();

  it('ninguna consulta filtra `user` por email (R11, deuda D5)', async () => {
    const { cliente, consultas } = clienteEspia([
      { rows: [] }, // búsqueda por documento: no hay identidad previa
      { rows: [{ id: 'nueva-id' }] }, // INSERT ... RETURNING id
      { rows: [] }, // INSERT user_role
    ]);

    await servicio.resolverIdentidad(cliente, DATOS, TENANT_A, 'propietario');

    for (const { sql } of consultas) {
      // El `INSERT` sí nombra la columna `email` (la escribe en NULL): lo que
      // R11 prohíbe es **resolver identidades** por ella, es decir, usarla como
      // criterio de búsqueda.
      expect(sql, `no debe filtrar por email: ${sql}`).not.toMatch(
        /where[\s\S]*\bemail\s*=/i,
      );
    }
  });

  it('la búsqueda es por documento y lleva tenant_id explícito (R10)', async () => {
    const { cliente, consultas } = clienteEspia([
      { rows: [] },
      { rows: [{ id: 'nueva-id' }] },
      { rows: [] },
    ]);

    await servicio.resolverIdentidad(cliente, DATOS, TENANT_A, 'propietario');

    const busqueda = consultas[0]!;
    expect(busqueda.sql).toMatch(/select[\s\S]*from\s+"user"/i);
    expect(busqueda.sql).toMatch(/tipo_documento\s*=\s*\$\d/i);
    expect(busqueda.sql).toMatch(/documento\s*=\s*\$\d/i);
    // La doble barrera: el RLS es la garantía real, este predicado es el que
    // sobrevive a un despliegue mal configurado. Quitarlo es la mutación T27b.
    expect(busqueda.sql).toMatch(/tenant_id\s*=\s*\$\d/i);
    expect(busqueda.parametros).toContain(TENANT_A);
  });

  it('toda consulta va parametrizada: ni un solo valor concatenado', async () => {
    const { cliente, consultas } = clienteEspia([
      { rows: [] },
      { rows: [{ id: 'nueva-id' }] },
      { rows: [] },
    ]);

    await servicio.resolverIdentidad(cliente, DATOS, TENANT_A, 'propietario');

    for (const { sql } of consultas) {
      expect(sql, `SQL con literal interpolado: ${sql}`).not.toMatch(
        new RegExp(`${DATOS.documento}|${TENANT_A}`),
      );
    }
  });

  describe('reutilización de identidad existente (T9 — R3, R4)', () => {
    it('no ejecuta ningún INSERT sobre `user` y sí asegura el rol', async () => {
      const { cliente, consultas } = clienteEspia([
        { rows: [{ id: 'existente-id', nombre: 'María Pérez' }] },
        { rows: [] }, // INSERT user_role
      ]);

      const resuelta = await servicio.resolverIdentidad(
        cliente,
        DATOS,
        TENANT_A,
        'inquilino',
      );

      expect(resuelta).toEqual({ userId: 'existente-id', reutilizada: true });
      expect(
        consultas.some((c) => /insert\s+into\s+"user"/i.test(c.sql)),
        'reutilizar no puede crear una segunda identidad (R1, R2)',
      ).toBe(false);
      expect(
        consultas.some((c) => /insert\s+into\s+user_role/i.test(c.sql)),
      ).toBe(true);
    });

    it('no toca email, password_hash ni nombre de la identidad (R4)', async () => {
      // La credencial es lo que hace de esta persona "una sola persona" en la
      // inmobiliaria. Un UPDATE aquí la pisaría en la segunda alta.
      const { cliente, consultas } = clienteEspia([
        { rows: [{ id: 'existente-id', nombre: 'María Pérez' }] },
        { rows: [] },
      ]);

      await servicio.resolverIdentidad(cliente, DATOS, TENANT_A, 'inquilino');

      expect(consultas.some((c) => /update\s+"user"/i.test(c.sql))).toBe(false);
    });

    it('el rol se inserta con activo = true e idempotente (R3)', async () => {
      const { cliente, consultas } = clienteEspia([
        { rows: [{ id: 'existente-id', nombre: 'María Pérez' }] },
        { rows: [] },
      ]);

      await servicio.resolverIdentidad(cliente, DATOS, TENANT_A, 'inquilino');

      const rol = consultas.find((c) => /insert\s+into\s+user_role/i.test(c.sql))!;
      expect(rol.sql).toMatch(/true/);
      expect(rol.sql).toMatch(/on conflict/i);
      expect(rol.parametros).toEqual(['existente-id', TENANT_A, 'inquilino']);
    });
  });

  describe('nombre discrepante (T29 — R9, R28)', () => {
    it('lanza 409 con los tres datos accionables', async () => {
      const { cliente } = clienteEspia([
        { rows: [{ id: 'existente-id', nombre: 'Maria Perez' }] },
      ]);

      const fallo = await servicio
        .resolverIdentidad(cliente, DATOS, TENANT_A, 'inquilino')
        .catch((e: unknown) => e);

      expect(fallo).toBeInstanceOf(NombreNoCoincideConIdentidadError);
      const error = fallo as NombreNoCoincideConIdentidadError;
      expect(error.httpStatus).toBe(409);
      expect(error.code).toBe('NOMBRE_NO_COINCIDE_CON_IDENTIDAD');
      expect(error.detalles).toEqual({
        user_id: 'existente-id',
        nombre_registrado: 'Maria Perez',
        nombre_recibido: 'María Pérez',
      });
    });

    it('el documento no aparece ni en el mensaje ni en los detalles (Ley 1581)', () => {
      const error = new NombreNoCoincideConIdentidadError(
        'existente-id',
        'Maria Perez',
        'María Pérez',
      );

      expect(error.message).not.toContain(DATOS.documento);
      expect(JSON.stringify(error.detalles)).not.toContain(DATOS.documento);
    });

    it('rechaza ANTES de tocar user_role: no hay nada que deshacer (R9)', async () => {
      const { cliente, consultas } = clienteEspia([
        { rows: [{ id: 'existente-id', nombre: 'Otro Nombre' }] },
      ]);

      await servicio
        .resolverIdentidad(cliente, DATOS, TENANT_A, 'inquilino')
        .catch(() => undefined);

      expect(consultas).toHaveLength(1);
      expect(consultas[0]!.sql).toMatch(/select/i);
    });
  });
});
