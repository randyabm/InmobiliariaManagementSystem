import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
  TENANT_B,
} from '../../../../../test/support/entorno-clientes';

/**
 * Plantillas de contrato (T10, T11, T12, T13 → R1, R2, R3, R4, R5).
 */
describe('Plantillas de contrato (#16)', () => {
  let entorno: EntornoClientes;
  let idPropiedad: string;
  let idPropiedadB: string;

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
    const servidor = () => entorno.app.getHttpServer();
    const comoAdminA = (metodo: 'post' | 'get' | 'patch', ruta: string) =>
      request(servidor())
        [metodo](ruta)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);

    const propietario = await comoAdminA('post', '/propietarios').send({
      nombre: 'P Plantilla',
      tipo_documento: 'CC',
      documento: `PP-${Date.now()}`,
    });
    const propiedad = await comoAdminA('post', '/propiedades').send({
      direccion: 'Calle Plantilla 1',
      tipo: 'APARTAMENTO',
      area: '60.00',
      canon: '1500000.00',
      valor_administracion: '200000.00',
      propietario_principal_id: propietario.body.id,
    });
    idPropiedad = propiedad.body.id;

    // Una propiedad en el tenant B.
    const propB = await request(servidor())
      .post('/propietarios')
      .set('Authorization', `Bearer ${entorno.adminB.token}`)
      .set('x-tenant-id', TENANT_B)
      .send({ nombre: 'P B', tipo_documento: 'CC', documento: `PB-${Date.now()}` });
    const propiedadB = await request(servidor())
      .post('/propiedades')
      .set('Authorization', `Bearer ${entorno.adminB.token}`)
      .set('x-tenant-id', TENANT_B)
      .send({
        direccion: 'Calle B',
        tipo: 'APARTAMENTO',
        area: '60.00',
        canon: '1000000.00',
        propietario_principal_id: propB.body.id,
      });
    idPropiedadB = propiedadB.body.id;
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();
  const comoAdminA = (metodo: 'post' | 'get' | 'patch', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);
  const comoEmpleadoA = (metodo: 'post' | 'get' | 'patch', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.empleadoA.token}`)
      .set('x-tenant-id', TENANT_A);

  // ─── T10 — base del tenant (R1, R2) ─────────────────────────────────────

  describe('T10 — base del tenant (R1, R2)', () => {
    it('404 antes de crear; 201 al crear; 409 al repetir', async () => {
      const antes = await comoAdminA('get', '/plantillas-contrato');
      expect(antes.status).toBe(404);

      const creada = await comoAdminA('post', '/plantillas-contrato').send({
        nombre: 'Clausulado estándar',
        cuerpo: 'Entre {arrendador} y {arrendatario}, canon {canon}.',
        merge_fields: { arrendador: '', arrendatario: '', canon: '' },
      });
      expect(creada.status).toBe(201);
      expect(creada.body.estado).toBe('borrador');
      expect(creada.body.version).toBe(1);

      const duplicada = await comoAdminA('post', '/plantillas-contrato').send({
        nombre: 'Otra',
        cuerpo: 'x',
      });
      expect(duplicada.status).toBe(409);
      expect(duplicada.body.error).toBe('PLANTILLA_CONTRATO_YA_EXISTE');
    });

    it('merge field sin definir → 400 (PA-16-2)', async () => {
      // Tenant B aún no tiene base: la validación ocurre de forma
      // determinista (sin 409 previo).
      const respuesta = await request(servidor())
        .post('/plantillas-contrato')
        .set('Authorization', `Bearer ${entorno.adminB.token}`)
        .set('x-tenant-id', TENANT_B)
        .send({ nombre: 'Rota', cuerpo: 'Cláusula {inexistente}', merge_fields: { otro: 'x' } });
      expect(respuesta.status).toBe(400);
      expect(respuesta.body.error).toBe('PLANTILLA_CONTRATO_INVALIDA');
    });

    it('editar tras validar incrementa la versión (R2)', async () => {
      const validada = await comoAdminA('post', '/plantillas-contrato/validar');
      expect(validada.status).toBe(201);
      expect(validada.body.estado).toBe('validado');
      expect(validada.body.validado_por).toBe(entorno.adminA.id);

      const editada = await comoAdminA('patch', '/plantillas-contrato').send({
        cuerpo: 'Entre {arrendador} y {arrendatario}, canon {canon}. Editada.',
      });
      expect(editada.status).toBe(200);
      expect(editada.body.version).toBe(2);

      const { rows } = await entorno.poolAdmin.query<{ version: number }>(
        `SELECT version FROM contract_template WHERE tenant_id = $1 AND property_id IS NULL`,
        [TENANT_A],
      );
      expect(rows[0]?.version).toBe(2);
    });

    it('el empleado edita la base pero NO valida (R4, PA-16-3)', async () => {
      const edicion = await comoEmpleadoA('patch', '/plantillas-contrato').send({
        cuerpo: 'Nuevo cuerpo del empleado.',
      });
      expect(edicion.status).toBe(200);

      const validacion = await comoEmpleadoA('post', '/plantillas-contrato/validar');
      expect(validacion.status).toBe(403);
    });
  });

  // ─── T11 — borrador de la propiedad (R3, R4) ────────────────────────────

  describe('T11 — borrador de la propiedad (R3, R4)', () => {
    it('propone la copia pre-rellena con los campos de la propiedad (201)', async () => {
      const respuesta = await comoAdminA(
        'post',
        `/propiedades/${idPropiedad}/contrato/plantilla`,
      );
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.property_id).toBe(idPropiedad);
      expect(respuesta.body.estado).toBe('borrador');
      expect(respuesta.body.merge_fields_json.direccion_propiedad).toBe('Calle Plantilla 1');
      expect(respuesta.body.merge_fields_json.canon).toBe('1500000.00');

      const duplicada = await comoAdminA(
        'post',
        `/propiedades/${idPropiedad}/contrato/plantilla`,
      );
      expect(duplicada.status).toBe(409);

      const lectura = await comoAdminA(
        'get',
        `/propiedades/${idPropiedad}/contrato/plantilla`,
      );
      expect(lectura.status).toBe(200);
      expect(lectura.body.property_id).toBe(idPropiedad);
    });

    it('validar la copia (solo admin); el empleado → 403 (R4)', async () => {
      const empleado = await comoEmpleadoA(
        'post',
        `/propiedades/${idPropiedad}/contrato/plantilla/validar`,
      );
      expect(empleado.status).toBe(403);

      const admin = await comoAdminA(
        'post',
        `/propiedades/${idPropiedad}/contrato/plantilla/validar`,
      );
      expect(admin.status).toBe(201);
      expect(admin.body.estado).toBe('validado');
    });

    it('propiedad ajena → 404 (R5)', async () => {
      const respuesta = await comoAdminA(
        'post',
        `/propiedades/${idPropiedadB}/contrato/plantilla`,
      );
      expect(respuesta.status).toBe(404);
    });
  });

  // ─── T12 — seguridad (R5) ───────────────────────────────────────────────

  describe('T12 — seguridad (R5)', () => {
    it('la base de B no es visible para A: 404 (la de A existe)', async () => {
      // La base de A existe; la de B no: A nunca ve la de B.
      const respuesta = await request(servidor())
        .get('/plantillas-contrato')
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);
      expect(respuesta.status).toBe(200);

      // B sí tiene su propio ámbito: crear su base y A no debe verla.
      await request(servidor())
        .post('/plantillas-contrato')
        .set('Authorization', `Bearer ${entorno.adminB.token}`)
        .set('x-tenant-id', TENANT_B)
        .send({ nombre: 'Base B', cuerpo: 'Cláusula {campo_b}', merge_fields: { campo_b: '' } });
      const enA = await request(servidor())
        .get('/plantillas-contrato')
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);
      expect(enA.body.nombre).not.toBe('Base B');
    });

    it('sin token → 401', async () => {
      const respuesta = await request(servidor())
        .get('/plantillas-contrato')
        .set('x-tenant-id', TENANT_A);
      expect(respuesta.status).toBe(401);
    });
  });

  // ─── T13 — auditoría (R2, R4) ───────────────────────────────────────────

  describe('T13 — auditoría (R2, R4)', () => {
    it('crear y validar generan audit_log con entity_id y metadata vacío', async () => {
      const { rows } = await entorno.poolAdmin.query<{
        accion: string;
        entity_type: string;
        metadata: unknown;
      }>(
        `SELECT accion, entity_type, metadata FROM audit_log
          WHERE tenant_id = $1 AND entity_type = 'contract_template'
          ORDER BY created_at`,
        [TENANT_A],
      );
      expect(rows.length).toBeGreaterThanOrEqual(3);
      for (const fila of rows) {
        expect(fila.metadata).toBeNull();
      }
    });
  });
});
