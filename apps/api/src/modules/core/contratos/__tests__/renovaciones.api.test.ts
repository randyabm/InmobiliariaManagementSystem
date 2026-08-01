import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
} from '../../../../../test/support/entorno-clientes';

/**
 * Renovaciones y alertas (T10–T14 → R1–R5, Ley 820).
 */
describe('Renovaciones y alertas (#19)', () => {
  let entorno: EntornoClientes;
  let idPropiedad: string;
  let idInquilino: string;
  let idContrato: string;

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
    const servidor = () => entorno.app.getHttpServer();
    const comoAdminA = (metodo: 'post' | 'get' | 'put', ruta: string) =>
      request(servidor())
        [metodo](ruta)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);

    const suf = Date.now().toString().slice(-6);
    const propietario = await comoAdminA('post', '/propietarios').send({
      nombre: `P Ren ${suf}`,
      tipo_documento: 'CC',
      documento: `PR-${suf}`,
    });
    const propiedad = await comoAdminA('post', '/propiedades').send({
      direccion: `Calle Ren ${suf}`,
      tipo: 'APARTAMENTO',
      area: '60.00',
      canon: '1000000.00',
      incremento_anual_pactado: '8.00',
      propietario_principal_id: propietario.body.id,
    });
    idPropiedad = propiedad.body.id;
    const inquilino = await comoAdminA('post', '/inquilinos').send({
      nombre: `Inq Ren ${suf}`,
      tipo_documento: 'CC',
      documento: `IR-${suf}`,
      email: `ren-${suf}@example.com`,
      celular: `308${suf}`,
      medio_preferido_contacto: 'CORREO',
    });
    idInquilino = inquilino.body.id;

    // Un contrato que vence pronto (panel y alertas).
    const inicio = new Date();
    const fin = new Date(Date.now() + 45 * 86_400_000);
    const { rows: contrato } = await entorno.poolAdmin.query<{ id: string }>(
      `INSERT INTO contract
         (tenant_id, property_id, inquilino_id, propietario_id, fecha_inicio, fecha_fin)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [TENANT_A, idPropiedad, idInquilino, propietario.body.id, inicio, fin],
    );
    idContrato = contrato[0]?.id ?? '';
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();
  const comoAdminA = (metodo: 'post' | 'get' | 'put', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);
  const comoEmpleadoA = (metodo: 'post' | 'get', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.empleadoA.token}`)
      .set('x-tenant-id', TENANT_A);

  // ─── R1 — configuración ─────────────────────────────────────────────────

  describe('R1 — configuración (RF-CT8)', () => {
    it('defaults si no existe; PUT la guarda (solo admin)', async () => {
      const defaults = await comoAdminA('get', '/configuracion-renovacion');
      expect(defaults.status).toBe(200);
      expect(defaults.body.umbrales_dias).toEqual([90, 60, 30]);

      const guardada = await comoAdminA('put', '/configuracion-renovacion').send({
        umbrales_dias: [120, 90],
        avisar_a: ['admin', 'asesor', 'propietario'],
        ipc_anual: 7.5,
      });
      expect(guardada.status).toBe(200);
      expect(guardada.body.umbrales_dias).toEqual([120, 90]);
      expect(guardada.body.ipc_anual).toBe(7.5);

      const { rows } = await entorno.poolAdmin.query<{ ipc_anual: string }>(
        `SELECT ipc_anual::text AS ipc_anual FROM config_renovacion WHERE tenant_id = $1`,
        [TENANT_A],
      );
      expect(rows[0]?.ipc_anual).toBe('7.50');

      const empleado = await comoEmpleadoA('get', '/configuracion-renovacion');
      expect(empleado.status).toBe(403);
    });
  });

  // ─── R2 — panel de vencimientos ─────────────────────────────────────────

  describe('R2 — panel (RF-CT10)', () => {
    it('lista el contrato que vence en 45 días con dias_restantes', async () => {
      const respuesta = await comoAdminA('get', '/contratos/vencimientos?dias=90');
      expect(respuesta.status).toBe(200);
      const fila = respuesta.body.find(
        (c: { contract_id: string }) => c.contract_id === idContrato,
      );
      expect(fila).toBeDefined();
      expect(fila.dias_restantes).toBeLessThanOrEqual(45);
      expect(fila.estado_gestion).toBe('sin_gestionar');
      expect(fila.dias_desde_primera_alerta).toBeNull();
    });
  });

  // ─── R3 — alertas (RF-CT9, RF-CT12) ─────────────────────────────────────

  describe('R3 — alertas (RF-CT9)', () => {
    it('genera la alerta de los umbrales cruzados sin duplicar', async () => {
      const primera = await comoAdminA('post', '/contratos/vencimientos/alertas');
      expect(primera.status).toBe(201);
      expect(primera.body.creadas).toBeGreaterThanOrEqual(1);

      const { rows } = await entorno.poolAdmin.query<{ umbral_dias: number }>(
        `SELECT umbral_dias FROM alerta_vencimiento WHERE contract_id = $1`,
        [idContrato],
      );
      // La config de R1 quedó en [120, 90]: con 45 días restantes se
      // cruzan ambos umbrales.
      expect(rows.map((r) => r.umbral_dias).sort((a, b) => a - b)).toEqual([90, 120]);

      // El outbox tiene la entrega.
      const { rows: entregas } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM notificacion_pendiente
          WHERE contenido::text LIKE $1`,
        [`%${idContrato}%`],
      );
      expect(Number(entregas[0]?.total)).toBeGreaterThanOrEqual(1);

      // Repetir NO duplica (dedupe por contract+umbral).
      const segunda = await comoAdminA('post', '/contratos/vencimientos/alertas');
      expect(segunda.body.creadas).toBe(0);
      const { rows: despues } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM alerta_vencimiento WHERE contract_id = $1`,
        [idContrato],
      );
      expect(Number(despues[0]?.total)).toBe(2);

      const empleado = await comoEmpleadoA('post', '/contratos/vencimientos/alertas');
      expect(empleado.status).toBe(403);
    });
  });

  // ─── R4 — renovación (RF-CT11, Ley 820) ─────────────────────────────────

  describe('R4 — renovación (RF-CT11)', () => {
    it('renueva con el incremento pactado (8%) → contrato nuevo + prórroga', async () => {
      const respuesta = await comoAdminA('post', `/contratos/${idContrato}/renovar`).send({});
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.property_id).toBe(idPropiedad);
      expect(respuesta.body.inquilino_id).toBe(idInquilino);

      const { rows } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM contract WHERE property_id = $1 AND tenant_id = $2`,
        [idPropiedad, TENANT_A],
      );
      expect(Number(rows[0]?.total)).toBe(2);

      // Auditoría de la decisión (RF-CT12).
      const { rows: auditoria } = await entorno.poolAdmin.query<{ accion: string }>(
        `SELECT accion FROM audit_log
          WHERE tenant_id = $1 AND entity_type = 'contract' AND accion = 'renovar'`,
        [TENANT_A],
      );
      expect(auditoria.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── R5 — no renovación (RF-CT13) ───────────────────────────────────────

  describe('R5 — no renovación (RF-CT13)', () => {
    it('motivo obligatorio; con motivo crea el inventario de salida', async () => {
      const sinMotivo = await comoAdminA('post', `/contratos/${idContrato}/no-renovar`).send({});
      expect(sinMotivo.status).toBe(400);

      const respuesta = await comoAdminA('post', `/contratos/${idContrato}/no-renovar`).send({
        motivo: 'El inquilino no renueva por traslado.',
      });
      expect(respuesta.status).toBe(201);

      // Inventario de salida (DEVOLUCION, borrador).
      const { rows } = await entorno.poolAdmin.query<{ tipo_evento: string; estado: string }>(
        `SELECT tipo_evento, estado FROM inventario
          WHERE propiedad_id = $1 AND tenant_id = $2 AND activo = true`,
        [idPropiedad, TENANT_A],
      );
      expect(
        rows.some((r) => r.tipo_evento === 'DEVOLUCION' && r.estado === 'BORRADOR'),
      ).toBe(true);

      // Auditoría de la decisión.
      const { rows: auditoria } = await entorno.poolAdmin.query<{ accion: string }>(
        `SELECT accion FROM audit_log
          WHERE tenant_id = $1 AND entity_type = 'contract' AND accion = 'no_renovar'`,
        [TENANT_A],
      );
      expect(auditoria.length).toBeGreaterThanOrEqual(1);
    });
  });
});
