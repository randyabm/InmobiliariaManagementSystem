import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
  TENANT_B,
} from '../../../../../test/support/entorno-clientes';
import { TarifaRetencionNoConfiguradaError } from '../errors/tarifa-retencion-no-configurada.error';
import { RetencionService } from '../retencion.service';

/**
 * Tarifa de retención por tenant y año (T12, T13 → R6, R7, R8, R9, R10, R11).
 *
 * Los casos HTTP van contra PostgreSQL real (Testcontainers) y la app NestJS
 * real; los del service, contra un doble del repositorio que solo registra
 * llamadas — el aislamiento se mide en `retencion-codeudor-rls.test.ts` y en
 * T23, no aquí.
 */

const TENANT_CTX_A = {
  tenantId: TENANT_A,
  actorId: undefined,
  cliente: {} as never,
};

const TARIFA_2026 = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  tenant_id: TENANT_A,
  anio: 2026,
  porcentaje: '3.50',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('RetencionService — resolución (T12c, T13)', () => {
  it('resolverPorcentaje devuelve el porcentaje EXACTO como cadena, sin pasar por number (R11)', async () => {
    const repositorio = {
      buscarPorAnio: vi.fn().mockResolvedValue(TARIFA_2026),
    };
    const servicio = new RetencionService(repositorio as never);

    const porcentaje = await servicio.resolverPorcentaje(2026, TENANT_CTX_A);

    expect(porcentaje).toBe('3.50');
    expect(typeof porcentaje).toBe('string');
  });

  it('resolverPorcentaje de un año sin configurar lanza TarifaRetencionNoConfiguradaError y no asume ningún valor por defecto (R9)', async () => {
    const repositorio = {
      buscarPorAnio: vi.fn().mockResolvedValue(null),
    };
    const servicio = new RetencionService(repositorio as never);

    await expect(servicio.resolverPorcentaje(2025, TENANT_CTX_A)).rejects.toBeInstanceOf(
      TarifaRetencionNoConfiguradaError,
    );
    await expect(servicio.resolverPorcentaje(2025, TENANT_CTX_A)).rejects.toMatchObject({
      httpStatus: 409,
    });
  });

  it('un propietario con sujeto_retencion = false obtiene { aplica: false } SIN consultar tarifa_retencion (R10)', async () => {
    const repositorio = {
      sujetoDeRetencion: vi.fn().mockResolvedValue(false),
      buscarPorAnio: vi.fn(),
    };
    const servicio = new RetencionService(repositorio as never);

    const resolucion = await servicio.resolverRetencionDePropietario(
      'perfil-1',
      2026,
      TENANT_CTX_A,
    );

    expect(resolucion).toEqual({ aplica: false, porcentaje: null });
    // R10: la tarifa es config del tenant que solo se consulta cuando aplica.
    expect(repositorio.buscarPorAnio).not.toHaveBeenCalled();
  });

  it('un propietario sujeto a retención resuelve la tarifa del año (R8)', async () => {
    const repositorio = {
      sujetoDeRetencion: vi.fn().mockResolvedValue(true),
      buscarPorAnio: vi.fn().mockResolvedValue(TARIFA_2026),
    };
    const servicio = new RetencionService(repositorio as never);

    const resolucion = await servicio.resolverRetencionDePropietario(
      'perfil-1',
      2026,
      TENANT_CTX_A,
    );

    expect(resolucion).toEqual({ aplica: true, porcentaje: '3.50' });
  });

  it('un propietario inexistente o de otro tenant produce 404, no "no aplica" (R19)', async () => {
    const repositorio = {
      sujetoDeRetencion: vi.fn().mockResolvedValue(null),
      buscarPorAnio: vi.fn(),
    };
    const servicio = new RetencionService(repositorio as never);

    await expect(
      servicio.resolverRetencionDePropietario('ajeno', 2026, TENANT_CTX_A),
    ).rejects.toMatchObject({ httpStatus: 404 });
    expect(repositorio.buscarPorAnio).not.toHaveBeenCalled();
  });
});

describe('Retención — HTTP contra PostgreSQL real (T12a, T12b, T13a)', () => {
  let entorno: EntornoClientes;

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();

  const comoAdminA = (metodo: 'get' | 'put', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);

  it('PUT crea la tarifa y, repetido para el mismo año, la reemplaza dejando UNA sola fila (R6)', async () => {
    const primera = await comoAdminA('put', '/configuracion/retencion/2026').send({
      porcentaje: '3.50',
    });

    expect(primera.status).toBe(200);
    expect(primera.body.anio).toBe(2026);
    expect(primera.body.porcentaje).toBe('3.50');
    expect(primera.body.tenant_id).toBe(TENANT_A);

    const segunda = await comoAdminA('put', '/configuracion/retencion/2026').send({
      porcentaje: '4.25',
    });
    expect(segunda.status).toBe(200);
    expect(segunda.body.porcentaje).toBe('4.25');

    const { rows } = await entorno.poolAdmin.query<{ total: string; porcentaje: string }>(
      `SELECT count(*)::text AS total, max(porcentaje)::text AS porcentaje
         FROM tarifa_retencion WHERE tenant_id = $1 AND anio = 2026`,
      [TENANT_A],
    );
    expect(Number(rows[0]?.total)).toBe(1);
    expect(rows[0]?.porcentaje).toBe('4.25');
  });

  it('GET devuelve solo las tarifas del tenant de la petición, ordenadas por año descendente (R7)', async () => {
    await comoAdminA('put', '/configuracion/retencion/2027').send({ porcentaje: '5.00' });

    const respuesta = await comoAdminA('get', '/configuracion/retencion');
    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toHaveLength(2);
    expect(respuesta.body.map((t: { anio: number }) => t.anio)).toEqual([2027, 2026]);
    expect(respuesta.body.every((t: { tenant_id: string }) => t.tenant_id === TENANT_A)).toBe(
      true,
    );

    const deB = await request(servidor())
      .get('/configuracion/retencion')
      .set('Authorization', `Bearer ${entorno.adminB.token}`)
      .set('x-tenant-id', TENANT_B);
    expect(deB.status).toBe(200);
    // El tenant B nunca configuró nada y no ve las tarifas de A (R19).
    expect(deB.body).toEqual([]);
  });

  it("un porcentaje como '3.50' viaja y regresa como '3.50' exacto (R11)", async () => {
    const respuesta = await comoAdminA('put', '/configuracion/retencion/2028').send({
      porcentaje: '3.50',
    });

    expect(respuesta.body.porcentaje).toBe('3.50');
    expect(typeof respuesta.body.porcentaje).toBe('string');
  });
});
