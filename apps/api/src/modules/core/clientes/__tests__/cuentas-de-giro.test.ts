import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ContextoPeticion } from '../../../../common/database/cliente-tenant';
import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
  TENANT_B,
} from '../../../../../test/support/entorno-clientes';
import { CuentasBancariasService } from '../cuentas-bancarias.service';
import { CuentaDeGiroInvalidaError } from '../errors';

/**
 * Regla de precedencia de la cuenta de giro del canon (T30 → **R27–R30**).
 *
 * Es el **punto de extensión hacia la feature #6** (design.md §6): la entidad
 * `Propiedad` no existe todavía, pero la regla que decide a qué cuenta se gira
 * el canon —y la validación que impide enchufar una cuenta ajena— se prueba
 * hoy de forma determinista contra PostgreSQL real.
 *
 * Cuando #6 añada `propiedad.cuenta_bancaria_id`, llamará a
 * `resolverCuentaDeGiro(propiedad.perfil_propietario_id, propiedad.cuenta_bancaria_id)`
 * y añadirá su propio test del override *a través de* la propiedad.
 */
describe('resolverCuentaDeGiro (#5 R27, R28, R29, R30)', () => {
  let entorno: EntornoClientes;
  let servicio: CuentasBancariasService;

  /** Propietario A1 con cuenta predeterminada + una alternativa. */
  let a1 = '';
  let cuentaPredeterminadaA1 = '';
  let cuentaAlternativaA1 = '';
  /** Propietario A2 del mismo tenant, con su propia cuenta. */
  let a2 = '';
  let cuentaA2 = '';
  /** Propietario A3 sin ninguna cuenta. */
  let a3 = '';
  /** Propietario del tenant B con su cuenta. */
  let cuentaTenantB = '';

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
    servicio = entorno.app.get(CuentasBancariasService);

    const crearPropietario = async (token: string, tenantId: string, documento: string) => {
      const { body } = await request(entorno.app.getHttpServer())
        .post('/propietarios')
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', tenantId)
        .send({ nombre: `Propietario ${documento}`, tipo_documento: 'CC', documento })
        .expect(201);
      return body.id as string;
    };

    const crearCuenta = async (
      token: string,
      tenantId: string,
      idPropietario: string,
      numero: string,
    ) => {
      const { body } = await request(entorno.app.getHttpServer())
        .post(`/propietarios/${idPropietario}/cuentas-bancarias`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', tenantId)
        .send({
          banco: 'Bancolombia',
          tipo_cuenta: 'AHORROS',
          numero_cuenta: numero,
          titular_nombre: 'Titular',
          titular_tipo_documento: 'CC',
          titular_documento: '999',
        })
        .expect(201);
      return body.id as string;
    };

    const tokenA = entorno.adminA.token;
    const tokenB = entorno.adminB.token;

    a1 = await crearPropietario(tokenA, TENANT_A, 'G1');
    cuentaPredeterminadaA1 = await crearCuenta(tokenA, TENANT_A, a1, 'G1-1');
    cuentaAlternativaA1 = await crearCuenta(tokenA, TENANT_A, a1, 'G1-2');

    a2 = await crearPropietario(tokenA, TENANT_A, 'G2');
    cuentaA2 = await crearCuenta(tokenA, TENANT_A, a2, 'G2-1');

    a3 = await crearPropietario(tokenA, TENANT_A, 'G3');

    const propietarioB = await crearPropietario(tokenB, TENANT_B, 'GB');
    cuentaTenantB = await crearCuenta(tokenB, TENANT_B, propietarioB, 'GB-1');
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  /** Ejecuta `fn` con el mismo contrato de contexto que usa un controller. */
  async function conContexto<T>(
    tenantId: string,
    fn: (ctx: ContextoPeticion) => Promise<T>,
  ): Promise<T> {
    const cliente = await entorno.poolAdmin.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query('SELECT set_config($1, $2, true)', [
        'app.current_tenant',
        tenantId,
      ]);
      const resultado = await fn({ cliente, tenantId });
      await cliente.query('COMMIT');
      return resultado;
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      cliente.release();
    }
  }

  it('(a) con override válido devuelve el override, no la predeterminada (R27)', async () => {
    const cuenta = await conContexto(TENANT_A, (ctx) =>
      servicio.resolverCuentaDeGiro(a1, cuentaAlternativaA1, ctx),
    );

    expect(cuenta.id).toBe(cuentaAlternativaA1);
    expect(cuenta.id).not.toBe(cuentaPredeterminadaA1);
    expect(cuenta.es_predeterminada).toBe(false);
  });

  it('(b) sin override devuelve la predeterminada activa (R28)', async () => {
    const cuenta = await conContexto(TENANT_A, (ctx) =>
      servicio.resolverCuentaDeGiro(a1, null, ctx),
    );

    expect(cuenta.id).toBe(cuentaPredeterminadaA1);
    expect(cuenta.es_predeterminada).toBe(true);
    expect(cuenta.activa).toBe(true);
  });

  it('(c) el override de OTRO propietario del mismo tenant se rechaza (R29)', async () => {
    await expect(
      conContexto(TENANT_A, (ctx) => servicio.resolverCuentaDeGiro(a1, cuentaA2, ctx)),
    ).rejects.toBeInstanceOf(CuentaDeGiroInvalidaError);
  });

  it('(d) el override de OTRO tenant se rechaza (R29)', async () => {
    // Girar el canon a una cuenta de otra inmobiliaria es dinero enviado a
    // otra persona: el aislamiento aquí es económico, no solo informativo.
    await expect(
      conContexto(TENANT_A, (ctx) =>
        servicio.resolverCuentaDeGiro(a1, cuentaTenantB, ctx),
      ),
    ).rejects.toBeInstanceOf(CuentaDeGiroInvalidaError);
  });

  it('(e) sin predeterminada y sin override lanza, NUNCA devuelve null (R30)', async () => {
    const resultado = await conContexto(TENANT_A, async (ctx) => {
      try {
        return { ok: await servicio.resolverCuentaDeGiro(a3, null, ctx) };
      } catch (error) {
        return { error };
      }
    });

    expect(resultado).not.toHaveProperty('ok');
    expect(resultado.error).toBeInstanceOf(CuentaDeGiroInvalidaError);
  });

  it('un override inexistente se rechaza igual que uno ajeno (R29)', async () => {
    await expect(
      conContexto(TENANT_A, (ctx) =>
        servicio.resolverCuentaDeGiro(a1, '00000000-0000-0000-0000-000000000000', ctx),
      ),
    ).rejects.toBeInstanceOf(CuentaDeGiroInvalidaError);
  });

  it('tras cambiar la predeterminada, la resolución sin override sigue la nueva (R15, R28)', async () => {
    await request(entorno.app.getHttpServer())
      .patch(`/propietarios/${a1}/cuentas-bancarias/${cuentaAlternativaA1}`)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A)
      .send({ es_predeterminada: true })
      .expect(200);

    const cuenta = await conContexto(TENANT_A, (ctx) =>
      servicio.resolverCuentaDeGiro(a1, null, ctx),
    );

    expect(cuenta.id).toBe(cuentaAlternativaA1);
  });

  it('el error de cuenta de giro es 400 con código estable (R29, R30)', () => {
    const error = new CuentaDeGiroInvalidaError();
    expect(error.httpStatus).toBe(400);
    expect(error.code).toBe('CUENTA_DE_GIRO_INVALIDA');
  });
});
