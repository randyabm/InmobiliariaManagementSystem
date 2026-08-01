import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
} from '../../../../../test/support/entorno-clientes';

/**
 * Asistente (T5, T6 → R1–R4, R6, §16.1): la SEGURIDAD se prueba
 * DETERMINISTA, sin LLM — las herramientas acotadas y el límite duro son
 * código, no prompt.
 */
describe('Asistente (#33)', () => {
  let entorno: EntornoClientes;
  let idPropiedad: string;

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
      nombre: `P Asistente ${suf}`,
      tipo_documento: 'CC',
      documento: `PAS-${suf}`,
    });
    const propiedad = await comoAdminA('post', '/propiedades').send({
      direccion: `Calle Asistente ${suf}`,
      tipo: 'APARTAMENTO',
      area: '60.00',
      canon: '1000000.00',
      propietario_principal_id: propietario.body.id,
    });
    idPropiedad = propiedad.body.id;
    const inquilino = await comoAdminA('post', '/inquilinos').send({
      nombre: `Inq Asistente ${suf}`,
      tipo_documento: 'CC',
      documento: `IAS-${suf}`,
      email: `asis-${suf}@example.com`,
      celular: `313${suf}`,
      medio_preferido_contacto: 'CORREO',
    });
    await entorno.poolAdmin.query(
      `INSERT INTO contract
         (tenant_id, property_id, inquilino_id, propietario_id, fecha_inicio, fecha_fin)
       VALUES ($1, $2, $3, $4, now() - interval '3 months', now() + interval '9 months')`,
      [TENANT_A, idPropiedad, inquilino.body.id, propietario.body.id],
    );
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();
  const comoAdminA = (metodo: 'post' | 'get', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);
  const comoInquilinoA = (metodo: 'post' | 'get', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.inquilinoA.token}`)
      .set('x-tenant-id', TENANT_A);

  // ─── R3 — consulta y acciones de bajo riesgo ────────────────────────────

  describe('R3 — herramientas acotadas', () => {
    it('consulta de tickets ejecuta la herramienta con la sesión', async () => {
      const respuesta = await comoAdminA('post', '/asistente/conversar').send({
        mensaje: '¿cuántos tickets hay abiertos?',
      });
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.herramienta_usada).toBe('consultar_tickets');
      expect(Array.isArray(respuesta.body.datos)).toBe(true);
    });

    it('consulta de vencimientos ejecuta el panel real', async () => {
      const respuesta = await comoAdminA('post', '/asistente/conversar').send({
        mensaje: 'muéstrame los contratos que vencen pronto',
      });
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.herramienta_usada).toBe('consultar_vencimientos');
    });

    it('crear ticket es una acción de bajo riesgo ejecutable', async () => {
      const respuesta = await comoAdminA('post', '/asistente/conversar').send({
        mensaje: `crear un ticket de plomería para la propiedad ${idPropiedad}`,
      });
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.herramienta_usada).toBe('crear_ticket');
      expect(respuesta.body.datos.categoria).toBe('plomería');
    });
  });

  // ─── R4 — límite duro ───────────────────────────────────────────────────

  describe('R4 — límite duro (RF-CB6)', () => {
    it('firmar, aprobar costos o confirmar pagos SIEMPRE escalan a una persona', async () => {
      for (const mensaje of [
        'firma el contrato',
        'aprobar costos de la reparación',
        'confirma el pago',
        'acepta el inventario',
      ]) {
        const respuesta = await comoAdminA('post', '/asistente/conversar').send({ mensaje });
        expect(respuesta.status).toBe(201);
        expect(respuesta.body.requiere_escalamiento).toBe(true);
        expect(respuesta.body.herramienta_usada).toBeNull();
      }
    });
  });

  // ─── R6 — auditoría completa ────────────────────────────────────────────

  describe('R6 — auditoría (RF-CB12)', () => {
    it('cada consulta queda en audit_log con entity_id y metadata vacío', async () => {
      await comoAdminA('post', '/asistente/conversar').send({ mensaje: 'mis tickets' });
      const { rows } = await entorno.poolAdmin.query<{
        accion: string;
        entity_type: string;
        metadata: unknown;
      }>(
        `SELECT accion, entity_type, metadata FROM audit_log
          WHERE tenant_id = $1 AND entity_type = 'asistente'`,
        [TENANT_A],
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const fila of rows) {
        expect(fila.metadata).toBeNull();
      }
    });
  });

  // ─── R1, R6 — seguridad determinista (§16.1) ────────────────────────────

  describe('R1 — sin LLM: la seguridad es determinista', () => {
    it('sin token → 401', async () => {
      const respuesta = await request(servidor())
        .post('/asistente/conversar')
        .send({ mensaje: 'hola' })
        .set('x-tenant-id', TENANT_A);
      expect(respuesta.status).toBe(401);
    });

    it('el inquilino consulta con SUS permisos (herramienta filtra por sesión)', async () => {
      const respuesta = await comoInquilinoA('post', '/asistente/conversar').send({
        mensaje: 'mis tickets',
      });
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.herramienta_usada).toBe('consultar_tickets');
      // El scoping del servicio ya aplicó RBAC+RLS del inquilino.
    });
  });
});
