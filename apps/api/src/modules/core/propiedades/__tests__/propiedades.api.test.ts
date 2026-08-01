import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
  TENANT_B,
} from '../../../../../test/support/entorno-clientes';

/**
 * CRUD de la hoja de vida del inmueble contra PostgreSQL real y la app real
 * (T11, T12 → R5, R6, R7, R8, R9, R14).
 *
 * Las aserciones sobre el efecto se hacen con `SELECT` independientes, no
 * con el código de respuesta.
 */

interface PropiedadCreada {
  id: string;
  propietarioPrincipalId: string;
  cuentaA: string;
}

describe('Propiedades — CRUD y cuenta de giro (#6)', () => {
  let entorno: EntornoClientes;

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();

  const comoAdminA = (metodo: 'post' | 'get' | 'patch' | 'delete', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);

  /** Crea un propietario (con cuenta de giro) y devuelve su ficha. */
  async function crearPropietario(
    sufijo: string,
    conCuenta = true,
  ): Promise<{ id: string; cuentaId: string | null }> {
    const prop = await comoAdminA('post', '/propietarios').send({
      nombre: `Propietario P${sufijo}`,
      tipo_documento: 'CC',
      documento: `P6-${sufijo}`,
    });
    expect(prop.status).toBe(201);

    if (!conCuenta) return { id: prop.body.id, cuentaId: null };

    const cuenta = await comoAdminA(
      'post',
      `/propietarios/${prop.body.id}/cuentas-bancarias`,
    ).send({
      banco: 'Bancolombia',
      tipo_cuenta: 'AHORROS',
      numero_cuenta: `NC-6-${sufijo}`,
      titular_nombre: `Propietario P${sufijo}`,
      titular_tipo_documento: 'CC',
      titular_documento: `P6-${sufijo}`,
      // Sin `es_predeterminada`: la primera cuenta del propietario queda
      // predeterminada por R11 de la #5.
    });
    expect(cuenta.status).toBe(201);

    return { id: prop.body.id, cuentaId: cuenta.body.id };
  }

  /** Crea una propiedad completa en el tenant A. */
  async function crearPropiedad(principal: string, cuentaId: string | null): Promise<PropiedadCreada> {
    const respuesta = await comoAdminA('post', '/propiedades').send({
      direccion: 'Calle 10 #43-20, Medellin',
      tipo: 'APARTAMENTO',
      area: '72.50',
      matricula_inmobiliaria: '001-123456',
      estrato: 4,
      parqueaderos: 1,
      depositos: 0,
      canon: '1500000.00',
      valor_administracion: '250000.00',
      canon_incluye_administracion: false,
      incremento_anual_pactado: '5.00',
      nombre_conjunto: 'Torres del Parque',
      contacto_admin_nombre: 'Adm. Torres',
      contacto_admin_telefono: '6041112233',
      contacto_admin_correo: 'admin@torres.example.com',
      propietario_principal_id: principal,
      ...(cuentaId ? { cuenta_bancaria_id: cuentaId } : {}),
    });
    expect(respuesta.status).toBe(201);
    return {
      id: respuesta.body.id,
      propietarioPrincipalId: principal,
      cuentaA: cuentaId ?? '',
    };
  }

  // ─── T11 — CRUD (R5, R6, R7, R9, R14) ──────────────────────────────────

  describe('CRUD (R5, R6, R7, R9)', () => {
    it('crea la propiedad con los cuatro grupos y responde 201 (R5, R9)', async () => {
      const principal = await crearPropietario('01');
      const respuesta = await comoAdminA('post', '/propiedades').send({
        direccion: 'Calle 11 #44-21',
        tipo: 'CASA',
        area: '120.00',
        canon: '2000000.00',
        propietario_principal_id: principal.id,
      });

      expect(respuesta.status).toBe(201);
      expect(respuesta.body.tipo).toBe('CASA');
      expect(respuesta.body.area).toBe('120.00');
      expect(respuesta.body.canon).toBe('2000000.00');
      expect(respuesta.body.tenant_id).toBe(TENANT_A);
      expect(respuesta.body.activo).toBe(true);
      expect(respuesta.body.fotos).toEqual([]);

      // Verificación independiente: la fila existe con los valores exactos.
      const { rows } = await entorno.poolAdmin.query<{
        tenant_id: string;
        canon: string;
        area: string;
      }>('SELECT tenant_id::text AS tenant_id, canon::text AS canon, area::text AS area FROM propiedad WHERE id = $1', [
        respuesta.body.id,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenant_id).toBe(TENANT_A);
      expect(rows[0]?.canon).toBe('2000000.00');
      expect(rows[0]?.area).toBe('120.00');
    });

    it('404 si el propietario principal no existe o es de otro tenant (R5, R14)', async () => {
      const inexistente = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      const respuesta = await comoAdminA('post', '/propiedades').send({
        direccion: 'Calle Fantasma',
        tipo: 'LOCAL',
        area: '30.00',
        canon: '800000.00',
        propietario_principal_id: inexistente,
      });
      expect(respuesta.status).toBe(404);

      // Un propietario del tenant B también es 404 (R14: indistinguible).
      const propB = await request(servidor())
        .post('/propietarios')
        .set('Authorization', `Bearer ${entorno.adminB.token}`)
        .set('x-tenant-id', TENANT_B)
        .send({ nombre: 'Prop B', tipo_documento: 'CC', documento: 'P6-B' });
      expect(propB.status).toBe(201);

      const conAjeno = await comoAdminA('post', '/propiedades').send({
        direccion: 'Calle Ajena',
        tipo: 'LOCAL',
        area: '30.00',
        canon: '800000.00',
        propietario_principal_id: propB.body.id,
      });
      expect(conAjeno.status).toBe(404);

      const { rows } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM propiedad WHERE direccion IN ('Calle Fantasma', 'Calle Ajena')`,
      );
      expect(Number(rows[0]?.total)).toBe(0);
    });

    it('la ficha expone propietarios, cuenta de giro resuelta e inquilino actual (R6, R8)', async () => {
      const principal = await crearPropietario('02');
      const creada = await crearPropiedad(principal.id, principal.cuentaId);

      const ficha = await comoAdminA('get', `/propiedades/${creada.id}`);
      expect(ficha.status).toBe(200);
      expect(ficha.body.propietario_principal_id).toBe(principal.id);
      expect(ficha.body.propietarios).toEqual([]);
      // R8: sin override → la predeterminada del principal.
      expect(ficha.body.cuenta_giro?.id).toBe(principal.cuentaId);
      expect(ficha.body.inquilino_actual_nombre).toBeNull();
      // R9: las cantidades viajan como cadenas exactas.
      expect(typeof ficha.body.canon).toBe('string');
      expect(typeof ficha.body.area).toBe('string');
    });

    it('PATCH parcial actualiza y DELETE es baja lógica (R7)', async () => {
      const principal = await crearPropietario('03');
      const creada = await crearPropiedad(principal.id, principal.cuentaId);

      const patch = await comoAdminA('patch', `/propiedades/${creada.id}`).send({
        canon: '1650000.00',
        contacto_admin_telefono: '6049998877',
      });
      expect(patch.status).toBe(200);
      expect(patch.body.canon).toBe('1650000.00');

      const { rows: fila } = await entorno.poolAdmin.query<{ canon: string; telefono: string }>(
        'SELECT canon::text AS canon, contacto_admin_telefono AS telefono FROM propiedad WHERE id = $1',
        [creada.id],
      );
      expect(fila[0]?.canon).toBe('1650000.00');
      expect(fila[0]?.telefono).toBe('6049998877');

      const baja = await comoAdminA('delete', `/propiedades/${creada.id}`);
      expect(baja.status).toBe(200);

      const { rows: despues } = await entorno.poolAdmin.query<{ activo: boolean }>(
        'SELECT activo FROM propiedad WHERE id = $1',
        [creada.id],
      );
      expect(despues).toHaveLength(1);
      expect(despues[0]?.activo).toBe(false);

      // La baja lógica desaparece del listado.
      const listado = await comoAdminA('get', '/propiedades');
      expect(listado.body.some((p: { id: string }) => p.id === creada.id)).toBe(false);
    });
  });

  // ─── T12 — el override de cuenta (R8, dependencia #5) ───────────────────

  describe('override de cuenta de giro (R8, dependencia #5)', () => {
    it('el override gana sobre la predeterminada del principal (R8)', async () => {
      const principal = await crearPropietario('04');

      // Una segunda cuenta del mismo propietario, NO predeterminada: es el
      // override legítimo.
      const segunda = await comoAdminA(
        'post',
        `/propietarios/${principal.id}/cuentas-bancarias`,
      ).send({
        banco: 'Nequi',
        tipo_cuenta: 'AHORROS',
        numero_cuenta: 'NC-6-04b',
        titular_nombre: 'Propietario P04',
        titular_tipo_documento: 'CC',
        titular_documento: 'P6-04',
      });
      expect(segunda.status).toBe(201);

      const creada = await crearPropiedad(principal.id, segunda.body.id);
      const ficha = await comoAdminA('get', `/propiedades/${creada.id}`);
      expect(ficha.status).toBe(200);
      expect(ficha.body.cuenta_giro?.id).toBe(segunda.body.id);
    });

    it('override de OTRO propietario → 400 CUENTA_DE_GIRO_INVALIDA sin persistir (R8)', async () => {
      const principal = await crearPropietario('05');
      const otro = await crearPropietario('06');

      const respuesta = await comoAdminA('post', '/propiedades').send({
        direccion: 'Calle Invalida',
        tipo: 'OFICINA',
        area: '40.00',
        canon: '900000.00',
        propietario_principal_id: principal.id,
        cuenta_bancaria_id: otro.cuentaId,
      });

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.error).toBe('CUENTA_DE_GIRO_INVALIDA');

      const { rows } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM propiedad WHERE direccion = 'Calle Invalida'`,
      );
      expect(Number(rows[0]?.total)).toBe(0);
    });

    it('sin ninguna cuenta del principal, la ficha expone cuenta_giro null (R8)', async () => {
      const sinCuenta = await crearPropietario('07', false);
      const creada = await crearPropiedad(sinCuenta.id, null);

      const ficha = await comoAdminA('get', `/propiedades/${creada.id}`);
      expect(ficha.status).toBe(200);
      expect(ficha.body.cuenta_giro).toBeNull();
    });
  });
});
