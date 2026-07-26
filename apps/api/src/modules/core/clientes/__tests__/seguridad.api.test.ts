import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
  TENANT_B,
} from '../../../../../test/support/entorno-clientes';

/**
 * Invariantes de seguridad de la feature #5 (T39–T42 → **R31, R32, R33, R35,
 * R36**), CHECKPOINTS.md §C7.
 *
 * Todo se comprueba de forma **determinista** contra PostgreSQL real y la app
 * real: códigos de estado y `SELECT`. Ningún invariante de seguridad se valida
 * con el juicio de un modelo (docs/verification.md).
 */
describe('Invariantes de seguridad de clientes (#5)', () => {
  let entorno: EntornoClientes;

  /** Recursos del tenant B, que el tenant A nunca debe poder tocar. */
  let propietarioB = '';
  let inquilinoB = '';
  let cuentaB = '';
  /** Recursos del tenant A, para las rutas que necesitan un id válido. */
  let propietarioA = '';
  let inquilinoA = '';
  let cuentaA = '';

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
    const servidor = entorno.app.getHttpServer();

    const crear = async (token: string, tenantId: string, sufijo: string) => {
      const prop = await request(servidor)
        .post('/propietarios')
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', tenantId)
        .send({ nombre: `Prop ${sufijo}`, tipo_documento: 'CC', documento: `S-${sufijo}` })
        .expect(201);

      const cuenta = await request(servidor)
        .post(`/propietarios/${prop.body.id}/cuentas-bancarias`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', tenantId)
        .send({
          banco: 'Bancolombia',
          tipo_cuenta: 'AHORROS',
          numero_cuenta: `NC-${sufijo}`,
          titular_nombre: `Prop ${sufijo}`,
          titular_tipo_documento: 'CC',
          titular_documento: `S-${sufijo}`,
        })
        .expect(201);

      const inq = await request(servidor)
        .post('/inquilinos')
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', tenantId)
        .send({
          nombre: `Inq ${sufijo}`,
          tipo_documento: 'CC',
          documento: `SI-${sufijo}`,
          email: `inq-${sufijo}@example.com`,
          celular: '3009998877',
          medio_preferido_contacto: 'SMS',
        })
        .expect(201);

      return { prop: prop.body.id, cuenta: cuenta.body.id, inq: inq.body.id };
    };

    const enA = await crear(entorno.adminA.token, TENANT_A, 'A');
    const enB = await crear(entorno.adminB.token, TENANT_B, 'B');

    propietarioA = enA.prop;
    cuentaA = enA.cuenta;
    inquilinoA = enA.inq;
    propietarioB = enB.prop;
    cuentaB = enB.cuenta;
    inquilinoB = enB.inq;
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();

  // ─── T39 — aislamiento por tenant sobre HTTP (R31) ──────────────────────

  describe('aislamiento por tenant: 404, nunca 403 ni 200 (R31)', () => {
    /**
     * Nueve accesos del tenant A a recursos del tenant B.
     *
     * `cuenta_bancaria` no tiene ruta DELETE en esta feature (design.md §5),
     * así que sus tres accesos son listar, crear y actualizar: cubren igual
     * las tres operaciones expuestas.
     */
    const casos = (ids: {
      propietarioB: string;
      inquilinoB: string;
      cuentaB: string;
    }) =>
      [
        ['GET perfil_propietario ajeno', 'get', `/propietarios/${ids.propietarioB}`, undefined],
        ['PATCH perfil_propietario ajeno', 'patch', `/propietarios/${ids.propietarioB}`, { ciudad: 'Robada' }],
        ['DELETE perfil_propietario ajeno', 'delete', `/propietarios/${ids.propietarioB}`, undefined],
        ['GET perfil_inquilino ajeno', 'get', `/inquilinos/${ids.inquilinoB}`, undefined],
        ['PATCH perfil_inquilino ajeno', 'patch', `/inquilinos/${ids.inquilinoB}`, { celular: '3000000000' }],
        ['DELETE perfil_inquilino ajeno', 'delete', `/inquilinos/${ids.inquilinoB}`, undefined],
        ['GET cuentas de propietario ajeno', 'get', `/propietarios/${ids.propietarioB}/cuentas-bancarias`, undefined],
        [
          'POST cuenta a propietario ajeno',
          'post',
          `/propietarios/${ids.propietarioB}/cuentas-bancarias`,
          {
            banco: 'Banco Intruso',
            tipo_cuenta: 'AHORROS',
            numero_cuenta: '000',
            titular_nombre: 'Intruso',
            titular_tipo_documento: 'CC',
            titular_documento: '000',
          },
        ],
        [
          'PATCH cuenta_bancaria ajena',
          'patch',
          `/propietarios/${ids.propietarioB}/cuentas-bancarias/${ids.cuentaB}`,
          { es_predeterminada: true },
        ],
      ] as const;

    it('los 9 accesos cruzados devuelven 404', async () => {
      const resultados: Array<[string, number]> = [];

      for (const [nombre, metodo, ruta, cuerpo] of casos({
        propietarioB,
        inquilinoB,
        cuentaB,
      })) {
        const peticion = request(servidor())
          [metodo](ruta)
          .set('Authorization', `Bearer ${entorno.adminA.token}`)
          .set('x-tenant-id', TENANT_A);

        const respuesta = cuerpo ? await peticion.send(cuerpo) : await peticion;
        resultados.push([nombre, respuesta.status]);
      }

      // 404 y no 403: un 403 confirmaría que el recurso existe en otra
      // inmobiliaria (docs/conventions.md, PRD §11.3).
      expect(resultados).toEqual(resultados.map(([n]) => [n, 404]));
    });

    it('ningún acceso cruzado modificó los datos del tenant B', async () => {
      const { rows: prop } = await entorno.poolAdmin.query<{ activo: boolean; ciudad: string | null }>(
        'SELECT activo, ciudad FROM perfil_propietario WHERE id = $1',
        [propietarioB],
      );
      expect(prop[0]?.activo).toBe(true);
      expect(prop[0]?.ciudad).toBeNull();

      const { rows: inq } = await entorno.poolAdmin.query<{ activo: boolean; celular: string }>(
        'SELECT activo, celular FROM perfil_inquilino WHERE id = $1',
        [inquilinoB],
      );
      expect(inq[0]?.activo).toBe(true);
      expect(inq[0]?.celular).toBe('3009998877');

      const { rows: cuentas } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM cuenta_bancaria WHERE perfil_propietario_id = $1`,
        [propietarioB],
      );
      expect(Number(cuentas[0]?.total)).toBe(1);
    });

    it('la búsqueda por documento no revela perfiles del otro tenant (R23, R31)', async () => {
      const respuesta = await request(servidor())
        .get('/propietarios?tipo_documento=CC&documento=S-B')
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual([]);
    });
  });

  // ─── T40 — RBAC en el backend (R32) y resolución del tenant (R33) ───────

  const RUTAS: Array<[string, 'get' | 'post' | 'patch' | 'delete', () => string]> = [
    ['POST /propietarios', 'post', () => '/propietarios'],
    ['GET /propietarios', 'get', () => '/propietarios?tipo_documento=CC&documento=x'],
    ['GET /propietarios/:id', 'get', () => `/propietarios/${propietarioA}`],
    ['PATCH /propietarios/:id', 'patch', () => `/propietarios/${propietarioA}`],
    ['DELETE /propietarios/:id', 'delete', () => `/propietarios/${propietarioA}`],
    ['POST /propietarios/:id/cuentas-bancarias', 'post', () => `/propietarios/${propietarioA}/cuentas-bancarias`],
    ['GET /propietarios/:id/cuentas-bancarias', 'get', () => `/propietarios/${propietarioA}/cuentas-bancarias`],
    [
      'PATCH /propietarios/:idPropietario/cuentas-bancarias/:idCuenta',
      'patch',
      () => `/propietarios/${propietarioA}/cuentas-bancarias/${cuentaA}`,
    ],
    ['POST /inquilinos', 'post', () => '/inquilinos'],
    ['GET /inquilinos', 'get', () => '/inquilinos?tipo_documento=CC&documento=x'],
    ['GET /inquilinos/:id', 'get', () => `/inquilinos/${inquilinoA}`],
    ['PATCH /inquilinos/:id', 'patch', () => `/inquilinos/${inquilinoA}`],
    ['DELETE /inquilinos/:id', 'delete', () => `/inquilinos/${inquilinoA}`],
  ];

  describe('RBAC validado en el backend (R32)', () => {
    it('las 13 rutas están cubiertas por esta tabla (R37)', () => {
      expect(RUTAS).toHaveLength(13);
    });

    it('un usuario cuyo único rol activo es `propietario` recibe 403 en las 13 rutas', async () => {
      const estados: number[] = [];
      for (const [, metodo, ruta] of RUTAS) {
        const respuesta = await request(servidor())
          [metodo](ruta())
          .set('Authorization', `Bearer ${entorno.propietarioA.token}`)
          .set('x-tenant-id', TENANT_A)
          .send({});
        estados.push(respuesta.status);
      }

      // El backend rechaza; ocultar el botón en el frontend no es autorizar.
      expect(estados).toEqual(Array(13).fill(403));
    });

    it('un usuario cuyo único rol activo es `inquilino` recibe 403 en las 13 rutas', async () => {
      const estados: number[] = [];
      for (const [, metodo, ruta] of RUTAS) {
        const respuesta = await request(servidor())
          [metodo](ruta())
          .set('Authorization', `Bearer ${entorno.inquilinoA.token}`)
          .set('x-tenant-id', TENANT_A)
          .send({});
        estados.push(respuesta.status);
      }

      expect(estados).toEqual(Array(13).fill(403));
    });

    it('sin token, las 13 rutas devuelven 401', async () => {
      const estados: number[] = [];
      for (const [, metodo, ruta] of RUTAS) {
        const respuesta = await request(servidor())[metodo](ruta()).send({});
        estados.push(respuesta.status);
      }

      expect(estados).toEqual(Array(13).fill(401));
    });

    it('el rechazo por rol no dejó ningún efecto en los datos', async () => {
      const { rows } = await entorno.poolAdmin.query<{ activo: boolean }>(
        'SELECT activo FROM perfil_propietario WHERE id = $1',
        [propietarioA],
      );
      expect(rows[0]?.activo).toBe(true);
    });
  });

  describe('resolución del tenant de la petición (R33)', () => {
    it('un x-tenant-id sin rol activo en el JWT devuelve 403, no 404 ni 200', async () => {
      const respuesta = await request(servidor())
        .get(`/propietarios/${propietarioB}`)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_B);

      expect(respuesta.status).toBe(403);
      expect(respuesta.body.error).toBe('TENANT_NO_AUTORIZADO');
    });

    it('una identidad multi-tenant SIN header recibe 403: no se elige por ella', async () => {
      // Antes de #5 se usaba `roles[0].tenant_id` y la petición habría escrito
      // en una inmobiliaria elegida por el orden del array (RF-AU6).
      const respuesta = await request(servidor())
        .post('/propietarios')
        .set('Authorization', `Bearer ${entorno.multiTenant.token}`)
        .send({ nombre: 'Ambiguo', tipo_documento: 'CC', documento: 'AMB-1' });

      expect(respuesta.status).toBe(403);

      const { rows } = await entorno.poolAdmin.query(
        'SELECT id FROM perfil_propietario WHERE documento = $1',
        ['AMB-1'],
      );
      expect(rows).toHaveLength(0);
    });

    it('esa misma identidad multi-tenant CON header escribe en el tenant indicado', async () => {
      const respuesta = await request(servidor())
        .post('/propietarios')
        .set('Authorization', `Bearer ${entorno.multiTenant.token}`)
        .set('x-tenant-id', TENANT_B)
        .send({ nombre: 'Explicito', tipo_documento: 'CC', documento: 'AMB-2' });

      expect(respuesta.status).toBe(201);
      expect(respuesta.body.tenant_id).toBe(TENANT_B);

      const { rows } = await entorno.poolAdmin.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM perfil_propietario WHERE documento = $1',
        ['AMB-2'],
      );
      expect(rows[0]?.tenant_id).toBe(TENANT_B);
    });
  });

  // ─── T41 — auditoría de las 8 mutaciones (R35) ──────────────────────────

  describe('auditoría de las mutaciones (R35)', () => {
    it('cada una de las 8 mutaciones deja exactamente una entrada en audit_log', async () => {
      const auth = (peticion: request.Test) =>
        peticion
          .set('Authorization', `Bearer ${entorno.adminA.token}`)
          .set('x-tenant-id', TENANT_A);

      const desde = new Date().toISOString();

      const prop = await auth(
        request(servidor()).post('/propietarios'),
      ).send({ nombre: 'Auditado', tipo_documento: 'CC', documento: 'AUD-1' });
      expect(prop.status).toBe(201);

      const cuenta1 = await auth(
        request(servidor()).post(`/propietarios/${prop.body.id}/cuentas-bancarias`),
      ).send({
        banco: 'Bancolombia',
        tipo_cuenta: 'AHORROS',
        numero_cuenta: 'AUD-NC-1',
        titular_nombre: 'Auditado',
        titular_tipo_documento: 'CC',
        titular_documento: 'AUD-1',
      });
      expect(cuenta1.status).toBe(201);

      const cuenta2 = await auth(
        request(servidor()).post(`/propietarios/${prop.body.id}/cuentas-bancarias`),
      ).send({
        banco: 'Davivienda',
        tipo_cuenta: 'CORRIENTE',
        numero_cuenta: 'AUD-NC-2',
        titular_nombre: 'Auditado',
        titular_tipo_documento: 'CC',
        titular_documento: 'AUD-1',
      });
      expect(cuenta2.status).toBe(201);

      const patchCuenta = await auth(
        request(servidor()).patch(
          `/propietarios/${prop.body.id}/cuentas-bancarias/${cuenta2.body.id}`,
        ),
      ).send({ es_predeterminada: true });
      expect(patchCuenta.status).toBe(200);

      const patchProp = await auth(
        request(servidor()).patch(`/propietarios/${prop.body.id}`),
      ).send({ ciudad: 'Pereira' });
      expect(patchProp.status).toBe(200);

      const inq = await auth(request(servidor()).post('/inquilinos')).send({
        nombre: 'Inq Auditado',
        tipo_documento: 'CC',
        documento: 'AUD-I-1',
        email: 'aud-inq@example.com',
        celular: '3005554433',
        medio_preferido_contacto: 'LLAMADA',
      });
      expect(inq.status).toBe(201);

      const patchInq = await auth(
        request(servidor()).patch(`/inquilinos/${inq.body.id}`),
      ).send({ medio_preferido_contacto: 'CORREO' });
      expect(patchInq.status).toBe(200);

      const bajaInq = await auth(request(servidor()).delete(`/inquilinos/${inq.body.id}`));
      expect(bajaInq.status).toBe(200);

      const bajaProp = await auth(
        request(servidor()).delete(`/propietarios/${prop.body.id}`),
      );
      expect(bajaProp.status).toBe(200);

      const esperadas: Array<[string, string, string]> = [
        ['crear', 'perfil_propietario', prop.body.id],
        ['actualizar', 'perfil_propietario', prop.body.id],
        ['baja', 'perfil_propietario', prop.body.id],
        ['crear', 'cuenta_bancaria', cuenta1.body.id],
        ['crear', 'cuenta_bancaria', cuenta2.body.id],
        ['actualizar', 'cuenta_bancaria', cuenta2.body.id],
        ['crear', 'perfil_inquilino', inq.body.id],
        ['actualizar', 'perfil_inquilino', inq.body.id],
        ['baja', 'perfil_inquilino', inq.body.id],
      ];

      for (const [accion, entityType, entityId] of esperadas) {
        const { rows } = await entorno.poolAdmin.query<{
          total: string;
          tenant_id: string;
          actor_id: string;
        }>(
          `SELECT count(*)::text AS total,
                  min(tenant_id::text) AS tenant_id,
                  min(actor_id::text)  AS actor_id
             FROM audit_log
            WHERE accion = $1 AND entity_type = $2 AND entity_id = $3
              AND created_at >= $4`,
          [accion, entityType, entityId, desde],
        );

        expect(
          Number(rows[0]?.total),
          `${accion}/${entityType}/${entityId}`,
        ).toBe(1);
        expect(rows[0]?.tenant_id).toBe(TENANT_A);
        expect(rows[0]?.actor_id).toBe(entorno.adminA.id);
      }
    });

    it('la auditoría se escribe en el tenant resuelto, no en roles[0] (R33, R35)', async () => {
      const respuesta = await request(servidor())
        .post('/propietarios')
        .set('Authorization', `Bearer ${entorno.multiTenant.token}`)
        .set('x-tenant-id', TENANT_B)
        .send({ nombre: 'Auditoria Multi', tipo_documento: 'CC', documento: 'AUD-MT' });

      expect(respuesta.status).toBe(201);

      const { rows } = await entorno.poolAdmin.query<{ tenant_id: string }>(
        `SELECT tenant_id::text FROM audit_log WHERE entity_id = $1`,
        [respuesta.body.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenant_id).toBe(TENANT_B);
    });
  });

  // ─── T42 — datos personales fuera de auditoría y logs (R36) ─────────────

  describe('datos personales fuera de auditoría y logs (R36, Ley 1581 de 2012)', () => {
    const DATOS_PERSONALES = {
      documento: 'PII-DOC-9876',
      titular_documento: 'PII-TIT-5432',
      celular: 'PII-CEL-3001112233',
      telefono: 'PII-TEL-6041234567',
      email: 'pii-persona@example.com',
      numero_cuenta: 'PII-NC-0001112223',
    };

    it('ni audit_log.metadata ni la salida del proceso contienen datos personales', async () => {
      const capturado: string[] = [];
      const espiaStdout = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk: unknown) => {
          capturado.push(String(chunk));
          return true;
        });
      const espiaStderr = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation((chunk: unknown) => {
          capturado.push(String(chunk));
          return true;
        });

      let idPropietario = '';
      try {
        const auth = (peticion: request.Test) =>
          peticion
            .set('Authorization', `Bearer ${entorno.adminA.token}`)
            .set('x-tenant-id', TENANT_A);

        const prop = await auth(request(servidor()).post('/propietarios')).send({
          nombre: 'Persona Con PII',
          tipo_documento: 'CC',
          documento: DATOS_PERSONALES.documento,
          email: DATOS_PERSONALES.email,
          telefono: DATOS_PERSONALES.telefono,
        });
        idPropietario = prop.body.id;

        await auth(
          request(servidor()).post(`/propietarios/${idPropietario}/cuentas-bancarias`),
        ).send({
          banco: 'Bancolombia',
          tipo_cuenta: 'AHORROS',
          numero_cuenta: DATOS_PERSONALES.numero_cuenta,
          titular_nombre: 'Persona Con PII',
          titular_tipo_documento: 'CC',
          titular_documento: DATOS_PERSONALES.titular_documento,
        });

        await auth(request(servidor()).post('/inquilinos')).send({
          nombre: 'Inquilino Con PII',
          tipo_documento: 'CE',
          documento: `${DATOS_PERSONALES.documento}-I`,
          email: `i-${DATOS_PERSONALES.email}`,
          celular: DATOS_PERSONALES.celular,
          medio_preferido_contacto: 'SMS',
        });

        await auth(request(servidor()).delete(`/propietarios/${idPropietario}`));
      } finally {
        espiaStdout.mockRestore();
        espiaStderr.mockRestore();
      }

      // 1) Auditoría: se serializa TODA la fila, no solo `metadata`, para que
      //    el test siga siendo válido si alguien añade una columna.
      const { rows } = await entorno.poolAdmin.query(
        `SELECT to_jsonb(audit_log) AS fila FROM audit_log`,
      );
      const auditoria = JSON.stringify(rows);

      for (const [campo, valor] of Object.entries(DATOS_PERSONALES)) {
        expect(auditoria, `audit_log contiene ${campo}`).not.toContain(valor);
      }

      // 2) `metadata` no lleva nada: hoy no hay ningún dato que sea seguro
      //    volcar ahí sin revisarlo campo a campo.
      const { rows: metadatos } = await entorno.poolAdmin.query<{ metadata: unknown }>(
        `SELECT metadata FROM audit_log WHERE metadata IS NOT NULL`,
      );
      expect(metadatos).toEqual([]);

      // 3) Logs de la aplicación.
      const salida = capturado.join('');
      for (const [campo, valor] of Object.entries(DATOS_PERSONALES)) {
        expect(salida, `los logs contienen ${campo}`).not.toContain(valor);
      }
    });

    it('el 404 de un recurso ajeno no filtra datos ni SQL (R31, R36)', async () => {
      const respuesta = await request(servidor())
        .get(`/propietarios/${propietarioB}`)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);

      const cuerpo = JSON.stringify(respuesta.body);
      expect(respuesta.status).toBe(404);
      expect(cuerpo).not.toContain('S-B');
      expect(cuerpo).not.toContain(TENANT_B);
      expect(cuerpo).not.toMatch(/SELECT|perfil_propietario|tenant_id/i);
      expect(respuesta.body).not.toHaveProperty('stack');
    });
  });
});
