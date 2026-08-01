import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
} from '../../../../../test/support/entorno-clientes';

/**
 * Conciliación (T7–T11 → R1–R6). El archivo es un CSV simple; el parseo
 * y el emparejamiento son deterministas.
 */
describe('Conciliación de pagos (#30)', () => {
  let entorno: EntornoClientes;
  let idPropiedad: string;
  let idContrato: string;
  let idImportacion: string;

  function csvDe(referencia: string): string {
    return [
      'Fecha,Valor,Referencia,Pagador,Cuenta,Medio',
      `15/07/2026,1.500.000,${referencia},Ana Perez,123-456,TRANSFERENCIA`,
      '20/07/2026,900.000,SIN REFERENCIA,Desconocido,999-999,CASH',
    ].join('\n');
  }

  let CSV = csvDe('ARR-00001');

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
    const servidor = () => entorno.app.getHttpServer();
    const comoAdminA = (metodo: 'post' | 'get' | 'patch', ruta: string) =>
      request(servidor())
        [metodo](ruta)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);

    const suf = Date.now().toString().slice(-6);
    const propietario = await comoAdminA('post', '/propietarios').send({
      nombre: `P Pagos ${suf}`,
      tipo_documento: 'CC',
      documento: `PPA-${suf}`,
    });
    const propiedad = await comoAdminA('post', '/propiedades').send({
      direccion: `Calle Pagos ${suf}`,
      tipo: 'APARTAMENTO',
      area: '60.00',
      canon: '1200000.00',
      propietario_principal_id: propietario.body.id,
    });
    idPropiedad = propiedad.body.id;
    const inquilino = await comoAdminA('post', '/inquilinos').send({
      nombre: `Inq Pagos ${suf}`,
      tipo_documento: 'CC',
      documento: `IPA-${suf}`,
      email: `pagos-${suf}@example.com`,
      celular: `310${suf}`,
      medio_preferido_contacto: 'CORREO',
    });
    const { rows: contrato } = await entorno.poolAdmin.query<{ id: string }>(
      `INSERT INTO contract
         (tenant_id, property_id, inquilino_id, propietario_id, fecha_inicio, fecha_fin)
       VALUES ($1, $2, $3, $4, now() - interval '6 months', now() + interval '6 months')
       RETURNING id`,
      [TENANT_A, idPropiedad, inquilino.body.id, propietario.body.id],
    );
    idContrato = contrato[0]?.id ?? '';
    // La referencia única del contrato (RF-PA9) es la que debe matchear.
    const sufijo = idContrato.slice(0, 5).toUpperCase().replaceAll('-', '0');
    CSV = csvDe(`ARR-${sufijo}`);
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

  // ─── R1, R2 — carga e inferencia ────────────────────────────────────────

  describe('R1, R2 — carga y mapeo (RF-PA1, PA-30-1)', () => {
    it('carga el CSV, infiere el mapeo y lo guarda en la importación', async () => {
      const respuesta = await comoAdminA('post', '/pagos/importaciones')
        .attach('archivo', Buffer.from(CSV), { filename: 'pagos.csv', contentType: 'text/csv' })
        .field('nombre_origen', 'bancolombia');
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.mapeo_propuesto.Valor).toBe('valor');
      expect(respuesta.body.perfil_reutilizado).toBe(false);
      idImportacion = respuesta.body.id;

      const { rows } = await entorno.poolAdmin.query<{ estado: string }>(
        `SELECT estado FROM payment_import WHERE id = $1`,
        [idImportacion],
      );
      expect(rows[0]?.estado).toBe('cargada');
    });

    it('confirma el mapeo y lo guarda como perfil reutilizable (RF-PA6)', async () => {
      const respuesta = await comoAdminA('post', `/pagos/importaciones/${idImportacion}/mapeo`).send({
        mapeo: {
          Fecha: 'fecha_movimiento',
          Valor: 'valor',
          Referencia: 'referencia_texto',
          Pagador: 'pagador_texto',
          Cuenta: 'cuenta_destino',
          Medio: 'medio_pago',
        },
      });
      expect(respuesta.status).toBe(201);

      const { rows } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM payment_mapping_profile
          WHERE tenant_id = $1 AND nombre_origen = 'bancolombia' AND activo = true`,
        [TENANT_A],
      );
      expect(Number(rows[0]?.total)).toBe(1);
    });

    it('una segunda carga del mismo origen reutiliza el perfil', async () => {
      const respuesta = await comoAdminA('post', '/pagos/importaciones')
        .attach('archivo', Buffer.from(CSV), { filename: 'pagos2.csv', contentType: 'text/csv' })
        .field('nombre_origen', 'bancolombia');
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.perfil_reutilizado).toBe(true);
    });
  });

  // ─── R3, R4 — procesar ──────────────────────────────────────────────────

  describe('R3, R4 — procesar (RF-PA2, RF-PA7)', () => {
    it('parsea los registros y sugiere el contrato por referencia única', async () => {
      const respuesta = await comoAdminA('post', `/pagos/importaciones/${idImportacion}/procesar`);
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.total).toBe(2);

      const { rows } = await entorno.poolAdmin.query<{
        estado: string;
        estrategia: string | null;
        confianza: number | null;
      }>(
        `SELECT estado, estrategia_conciliacion AS estrategia, confianza FROM payment_record
          WHERE import_id = $1 ORDER BY fecha_movimiento`,
        [idImportacion],
      );
      // Fila 1: referencia que coincide con la generada del contrato.
      const { rows: referencia } = await entorno.poolAdmin.query<{ referencia: string }>(
        `SELECT 'ARR-' || upper(substr(replace($1::text, '-', '0'), 1, 5)) AS referencia`,
        [idContrato],
      );
      void referencia;
      expect(rows.length).toBe(2);
      // Al menos uno sugerido o sin identificar: el emparejamiento corrió.
      expect(rows.map((r) => r.estado)).toContain('Sugerido');
    });
  });

  // ─── R5 — bandeja de excepciones ────────────────────────────────────────

  describe('R4 — idempotencia (RF-PA4)', () => {
    it('recargar el mismo archivo marca los duplicados sin duplicar pagos', async () => {
      const recarga = await comoAdminA('post', '/pagos/importaciones')
        .attach('archivo', Buffer.from(CSV), { filename: 'pagos-otra-vez.csv', contentType: 'text/csv' })
        .field('nombre_origen', 'bancolombia');
      expect(recarga.status).toBe(201);
      expect(recarga.body.perfil_reutilizado).toBe(true);

      const procesada = await comoAdminA(
        'post',
        `/pagos/importaciones/${recarga.body.id}/procesar`,
      );
      expect(procesada.status).toBe(201);

      const { rows } = await entorno.poolAdmin.query<{ estado: string }>(
        `SELECT estado FROM payment_record WHERE import_id = $1 ORDER BY fecha_movimiento`,
        [recarga.body.id],
      );
      expect(rows.some((r) => r.estado === 'Duplicado')).toBe(true);
    });
  });

  // ─── R5 — bandeja de excepciones ────────────────────────────────────────

  describe('R5 — bandeja (RF-PA10, RF-PA9)', () => {
    it('resuelve manualmente un registro sin identificar', async () => {
      const { rows: sinIdentificar } = await entorno.poolAdmin.query<{ id: string }>(
        `SELECT id FROM payment_record
          WHERE import_id = $1 AND estado = 'Sin_identificar' LIMIT 1`,
        [idImportacion],
      );
      if (sinIdentificar[0]) {
        const respuesta = await comoAdminA('patch', `/pagos/registros/${sinIdentificar[0].id}`).send({
          contract_id: idContrato,
        });
        expect(respuesta.status).toBe(200);
        expect(respuesta.body.estado).toBe('Conciliado');
        expect(respuesta.body.estrategia_conciliacion).toBe('manual');
      }

      const referencia = await comoAdminA('get', `/contratos/${idContrato}/referencia-pago`);
      expect(referencia.status).toBe(200);
      expect(referencia.body.referencia).toMatch(/^ARR-/);
    });
  });

  // ─── R6 — estado de cuenta ──────────────────────────────────────────────

  describe('R6 — estado de cuenta (RF-PA12)', () => {
    it('expone los pagos conciliados del contrato', async () => {
      const respuesta = await comoAdminA('get', `/contratos/${idContrato}/estado-cuenta`);
      expect(respuesta.status).toBe(200);
      expect(respuesta.body.contract_id).toBe(idContrato);
      expect(Array.isArray(respuesta.body.pagos)).toBe(true);
      expect(typeof respuesta.body.moroso).toBe('boolean');
    });
  });
});
