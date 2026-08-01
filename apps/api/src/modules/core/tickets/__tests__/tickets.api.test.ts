import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
  CODIGO_TENANT_A,
  CLAVE_DE_PRUEBA,
} from '../../../../../test/support/entorno-clientes';

/**
 * Tickets (T3–T8 → R1–R6, §6.5).
 */
describe('Tickets de mantenimiento (#31)', () => {
  let entorno: EntornoClientes;
  let idPropiedad: string;
  let idInquilino: string;
  let idTicket: string;
  let tokenInquilino: string;
  let tokenPropietario: string;

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
    const servidor = () => entorno.app.getHttpServer();
    const comoAdminA = (metodo: 'post' | 'get', ruta: string) =>
      request(servidor())
        [metodo](ruta)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);

    const suf = Date.now().toString().slice(-6);
    const propietario = await comoAdminA('post', '/propietarios').send({
      nombre: `P Tickets ${suf}`,
      tipo_documento: 'CC',
      documento: `PTI-${suf}`,
    });
    const propiedad = await comoAdminA('post', '/propiedades').send({
      direccion: `Calle Tickets ${suf}`,
      tipo: 'APARTAMENTO',
      area: '60.00',
      canon: '1000000.00',
      propietario_principal_id: propietario.body.id,
    });
    idPropiedad = propiedad.body.id;
    const email = `tickets-${suf}@example.com`;
    const inquilino = await comoAdminA('post', '/inquilinos').send({
      nombre: `Inq Tickets ${suf}`,
      tipo_documento: 'CC',
      documento: `ITI-${suf}`,
      email,
      celular: `311${suf}`,
      medio_preferido_contacto: 'CORREO',
    });
    idInquilino = inquilino.body.id;

    // Contrato vigente para que el inquilino pueda crear tickets (R1).
    const { rows: contrato } = await entorno.poolAdmin.query<{ id: string }>(
      `INSERT INTO contract
         (tenant_id, property_id, inquilino_id, propietario_id, fecha_inicio, fecha_fin)
       VALUES ($1, $2, $3, $4, now() - interval '3 months', now() + interval '9 months')
       RETURNING id`,
      [TENANT_A, idPropiedad, idInquilino, propietario.body.id],
    );
    void contrato;

    // Inquilino con credenciales (rol_activo inquilino en el token).
    const hash = await import('bcrypt').then((b) => b.hash(CLAVE_DE_PRUEBA, 10));
    await entorno.poolAdmin.query(
      `UPDATE "user"
          SET password_hash = $2,
              email = (SELECT email_contacto FROM perfil_inquilino WHERE id = $1)
        WHERE id = (SELECT user_id FROM perfil_inquilino WHERE id = $1)`,
      [idInquilino, hash],
    );
    const login = await request(servidor())
      .post('/auth/login')
      .send({ codigo: CODIGO_TENANT_A, email, password: CLAVE_DE_PRUEBA });
    tokenInquilino = login.body.access_token;

    // Propietario con credenciales.
    const emailProp = `prop-tickets-${suf}@example.com`;
    await entorno.poolAdmin.query(
      `UPDATE "user"
          SET password_hash = $2,
              email = $3
        WHERE id = (SELECT user_id FROM perfil_propietario WHERE id = $1)`,
      [propietario.body.id, hash, emailProp],
    );
    const loginProp = await request(servidor())
      .post('/auth/login')
      .send({ codigo: CODIGO_TENANT_A, email: emailProp, password: CLAVE_DE_PRUEBA });
    tokenPropietario = loginProp.body.access_token;
  }, 240_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();
  const comoAdminA = (metodo: 'post' | 'get', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);
  const comoInquilino = (metodo: 'post' | 'get', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${tokenInquilino}`)
      .set('x-tenant-id', TENANT_A);
  const comoPropietario = (metodo: 'post' | 'get', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${tokenPropietario}`)
      .set('x-tenant-id', TENANT_A);

  // ─── R1 — crear (scoping del inquilino) ─────────────────────────────────

  describe('R1 — crear (RF-M1)', () => {
    it('el inquilino de la propiedad crea el ticket en Recibida', async () => {
      const respuesta = await comoInquilino('post', `/propiedades/${idPropiedad}/tickets`).send({
        categoria: 'PLOMERIA',
        descripcion: 'Fuga en el baño principal.',
      });
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.estado).toBe('recibida');
      expect(respuesta.body.categoria).toBe('PLOMERIA');
      idTicket = respuesta.body.id;
    });

    it('un inquilino SIN contrato vigente en la propiedad → 404', async () => {
      const suf = Date.now().toString().slice(-6);
      const otro = await comoAdminA('post', '/inquilinos').send({
        nombre: `Inq Ajeno ${suf}`,
        tipo_documento: 'CC',
        documento: `IAJ-${suf}`,
        email: `ajeno-${suf}@example.com`,
        celular: `312${suf}`,
        medio_preferido_contacto: 'CORREO',
      });
      const hash = await import('bcrypt').then((b) => b.hash(CLAVE_DE_PRUEBA, 10));
      await entorno.poolAdmin.query(
        `UPDATE "user"
            SET password_hash = $2, email = $3
          WHERE id = (SELECT user_id FROM perfil_inquilino WHERE id = $1)`,
        [otro.body.id, hash, `ajeno-${suf}@example.com`],
      );
      const login = await request(servidor())
        .post('/auth/login')
        .send({ codigo: CODIGO_TENANT_A, email: `ajeno-${suf}@example.com`, password: CLAVE_DE_PRUEBA });
      const respuesta = await request(servidor())
        .post(`/propiedades/${idPropiedad}/tickets`)
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .set('x-tenant-id', TENANT_A)
        .send({ categoria: 'X', descripcion: 'Y' });
      expect(respuesta.status).toBe(404);
    });
  });

  // ─── R2 — consulta con scoping ──────────────────────────────────────────

  describe('R2 — consulta (RF-M2, RF-M7)', () => {
    it('el inquilino ve su ticket; el admin ve todos', async () => {
      const delInquilino = await comoInquilino('get', '/tickets');
      expect(delInquilino.status).toBe(200);
      expect(delInquilino.body.map((t: { id: string }) => t.id)).toContain(idTicket);

      const delAdmin = await comoAdminA('get', '/tickets');
      expect(delAdmin.body.map((t: { id: string }) => t.id)).toContain(idTicket);
    });

    it('el propietario ve los tickets de SUS propiedades', async () => {
      const delPropietario = await comoPropietario('get', '/tickets');
      expect(delPropietario.status).toBe(200);
      expect(delPropietario.body.map((t: { id: string }) => t.id)).toContain(idTicket);
    });
  });

  // ─── R5 — gestión y aprobación de costos ────────────────────────────────

  describe('R5 — gestión (RF-M5, RF-M6)', () => {
    it('admin asigna y pone en curso; el propietario aprueba costos', async () => {
      const asignar = await comoAdminA('post', `/tickets/${idTicket}/transiciones/asignar`);
      expect(asignar.status).toBe(201);

      const aprobar = await comoPropietario('post', `/tickets/${idTicket}/costos/aprobar`).send({
        aprobado: true,
      });
      expect(aprobar.status).toBe(201);

      const detalle = await comoAdminA('get', `/tickets/${idTicket}`);
      expect(detalle.body.estado).toBe('en_curso');
      expect(detalle.body.costo_aprobado).toBe(true);
    });

    it('el inquilino NO puede asignar (rol no permitido)', async () => {
      const respuesta = await comoInquilino('post', `/tickets/${idTicket}/transiciones/asignar`);
      expect(respuesta.status).toBe(403);
    });
  });

  // ─── R4 — resolución y reapertura ───────────────────────────────────────

  describe('R4 — resolución (RF-M4)', () => {
    it('marcar resuelta → el inquilino acepta → cerrada', async () => {
      await comoAdminA('post', `/tickets/${idTicket}/transiciones/marcar_resuelta`);
      const aceptar = await comoInquilino('post', `/tickets/${idTicket}/resolucion`).send({
        aceptada: true,
      });
      expect(aceptar.status).toBe(201);

      const detalle = await comoAdminA('get', `/tickets/${idTicket}`);
      expect(detalle.body.estado).toBe('cerrada');
    });

    it('rechazar la resolución reabre el ticket', async () => {
      const suf = Date.now().toString().slice(-6);
      const nuevo = await comoInquilino('post', `/propiedades/${idPropiedad}/tickets`).send({
        categoria: 'ELECTRICA',
        descripcion: 'Toma corriente sin energía.',
      });
      await comoAdminA('post', `/tickets/${nuevo.body.id}/transiciones/asignar`);
      await comoAdminA('post', `/tickets/${nuevo.body.id}/transiciones/iniciar_curso`);
      await comoAdminA('post', `/tickets/${nuevo.body.id}/transiciones/marcar_resuelta`);

      const rechazar = await comoInquilino('post', `/tickets/${nuevo.body.id}/resolucion`).send({
        aceptada: false,
      });
      expect(rechazar.status).toBe(201);

      const detalle = await comoAdminA('get', `/tickets/${nuevo.body.id}`);
      expect(detalle.body.estado).toBe('en_curso');
      void suf;
    });
  });

  // ─── R6 — aislamiento ───────────────────────────────────────────────────

  describe('R6 — aislamiento', () => {
    it('un ticket inexistente → 404; sin token → 401', async () => {
      const inexistente = await comoAdminA('get', '/tickets/00000000-0000-0000-0000-000000000000');
      expect(inexistente.status).toBe(404);

      const sinToken = await request(servidor()).get('/tickets').set('x-tenant-id', TENANT_A);
      expect(sinToken.status).toBe(401);
    });
  });
});
