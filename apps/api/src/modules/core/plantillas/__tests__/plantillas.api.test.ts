import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
} from '../../../../../test/support/entorno-clientes';

/**
 * Plantillas — integración (T10, T11, T12, T13, T14 → R4, R5, R6, R7, R8,
 * R9, R10). Contra PostgreSQL real y la app real.
 */
describe('Plantillas de inmuebles (#11)', () => {
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

  // ─── T10 — el seed por HTTP (R4, R10) ───────────────────────────────────

  describe('T10 — el catálogo base (R4, R10)', () => {
    it('GET /plantillas lista las 6 plantillas del sistema', async () => {
      const respuesta = await comoAdminA('get', '/plantillas');
      expect(respuesta.status).toBe(200);
      const tipos = respuesta.body
        .filter((p: { origen: string }) => p.origen === 'SISTEMA')
        .map((p: { tipo: string }) => p.tipo);
      expect(tipos.sort()).toEqual([
        'APARTAMENTO',
        'BODEGA',
        'CASA',
        'LOCAL',
        'OFICINA',
        'PARQUEADERO',
      ]);
    });

    it('GET /plantillas/:id de APARTAMENTO muestra el ejemplo completo del PRD', async () => {
      const lista = await comoAdminA('get', '/plantillas');
      const apartamento = lista.body.find(
        (p: { tipo: string; origen: string }) =>
          p.tipo === 'APARTAMENTO' && p.origen === 'SISTEMA',
      );

      const detalle = await comoAdminA('get', `/plantillas/${apartamento.id}`);
      expect(detalle.status).toBe(200);
      expect(detalle.body.zonas.map((z: { nombre: string }) => z.nombre)).toEqual([
        'Sala',
        'Cocina',
        'Habitación',
        'Baño',
        'Entrega de llaves',
      ]);
      const habitacion = detalle.body.zonas.find(
        (z: { nombre: string }) => z.nombre === 'Habitación',
      );
      expect(habitacion.repetible).toBe(true);
      const sala = detalle.body.zonas.find((z: { nombre: string }) => z.nombre === 'Sala');
      expect(sala.items.map((i: { nombre: string }) => i.nombre)).toEqual([
        'Paredes',
        'Piso',
        'Techo',
        'Ventanas',
        'Iluminación',
      ]);
      expect(
        sala.items.find((i: { nombre: string }) => i.nombre === 'Ventanas').field_type,
      ).toBe('si_no_estado');
    });
  });

  // ─── T11 — clonar y frontera del sistema (R5, R6) ───────────────────────

  describe('T11 — clonar (R5, R6)', () => {
    it('clonar la plantilla del sistema crea la copia TENANT con sus zonas e ítems', async () => {
      const lista = await comoAdminA('get', '/plantillas');
      const apartamento = lista.body.find(
        (p: { tipo: string; origen: string }) =>
          p.tipo === 'APARTAMENTO' && p.origen === 'SISTEMA',
      );

      const clonada = await comoAdminA('post', `/plantillas/${apartamento.id}/clonar`);
      expect(clonada.status).toBe(201);
      expect(clonada.body.origen).toBe('TENANT');

      const detalle = await comoAdminA('get', `/plantillas/${clonada.body.id}`);
      expect(detalle.body.zonas).toHaveLength(5);
      const sala = detalle.body.zonas.find((z: { nombre: string }) => z.nombre === 'Sala');
      expect(sala.items).toHaveLength(5);
    });

    it('clonar de nuevo el mismo tipo → 409 sin escribir', async () => {
      const lista = await comoAdminA('get', '/plantillas');
      const apartamento = lista.body.find(
        (p: { tipo: string; origen: string }) =>
          p.tipo === 'APARTAMENTO' && p.origen === 'SISTEMA',
      );
      const respuesta = await comoAdminA('post', `/plantillas/${apartamento.id}/clonar`);
      expect(respuesta.status).toBe(409);
    });

    it('editar la plantilla del SISTEMA → 409 PLANTILLA_SISTEMA_NO_EDITABLE sin escribir', async () => {
      const lista = await comoAdminA('get', '/plantillas');
      const apartamento = lista.body.find(
        (p: { tipo: string; origen: string }) =>
          p.tipo === 'APARTAMENTO' && p.origen === 'SISTEMA',
      );
      const respuesta = await comoAdminA(
        'post',
        `/plantillas/${apartamento.id}/zonas`,
      ).send({ nombre: 'Intruso' });
      expect(respuesta.status).toBe(409);
      expect(respuesta.body.error).toBe('PLANTILLA_SISTEMA_NO_EDITABLE');

      const { rows } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM plantilla_zona
          WHERE plantilla_id = $1 AND nombre = 'Intruso'`,
        [apartamento.id],
      );
      expect(Number(rows[0]?.total)).toBe(0);
    });
  });

  // ─── T12, T13, T14 — CRUD en la copia (R7, R8, R9, R10) ─────────────────

  describe('T12+T13+T14 — CRUD en la copia', () => {
    let idCopia: string;
    let idSala: string;

    beforeAll(async () => {
      const lista = await comoAdminA('get', '/plantillas');
      const copia = lista.body.find(
        (p: { tipo: string; origen: string }) =>
          p.tipo === 'APARTAMENTO' && p.origen === 'TENANT',
      );
      idCopia = copia.id;
      const detalle = await comoAdminA('get', `/plantillas/${idCopia}`);
      idSala = detalle.body.zonas.find((z: { nombre: string }) => z.nombre === 'Sala').id;
    });

    it('crea una zona y la actualiza (repetible/obligatoria/orden) con SELECT (R7)', async () => {
      const creada = await comoAdminA('post', `/plantillas/${idCopia}/zonas`).send({
        nombre: 'Zona Nueva',
        repetible: true,
      });
      expect(creada.status).toBe(201);
      expect(creada.body.repetible).toBe(true);

      const actualizada = await comoAdminA(
        'patch',
        `/plantillas/${idCopia}/zonas/${creada.body.id}`,
      ).send({ obligatoria: true, orden: 99 });
      expect(actualizada.status).toBe(200);

      const { rows } = await entorno.poolAdmin.query<{
        repetible: boolean;
        obligatoria: boolean;
      }>('SELECT repetible, obligatoria FROM plantilla_zona WHERE id = $1', [
        creada.body.id,
      ]);
      expect(rows[0]).toEqual({ repetible: true, obligatoria: true });
    });

    it('crea un ítem de selección con opciones y uno de estado (R8, R9)', async () => {
      const seleccion = await comoAdminA(
        'post',
        `/plantillas/${idCopia}/zonas/${idSala}/items`,
      ).send({
        nombre: 'Tipo de piso',
        field_type: 'seleccion',
        opciones_json: ['Cerámica', 'Madera', 'Porcelanato'],
      });
      expect(seleccion.status).toBe(201);
      expect(seleccion.body.opciones_json).toEqual(['Cerámica', 'Madera', 'Porcelanato']);

      const estado = await comoAdminA(
        'post',
        `/plantillas/${idCopia}/zonas/${idSala}/items`,
      ).send({ nombre: 'Rodapié', field_type: 'estado', foto_obligatoria: true });
      expect(estado.status).toBe(201);
      expect(estado.body.foto_obligatoria).toBe(true);
    });

    it('opciones_json incoherente → 400 sin escribir (R9)', async () => {
      const sinSeleccion = await comoAdminA(
        'post',
        `/plantillas/${idCopia}/zonas/${idSala}/items`,
      ).send({ nombre: 'Mal', field_type: 'estado', opciones_json: ['a'] });
      expect(sinSeleccion.status).toBe(400);

      const seleccionSinOpciones = await comoAdminA(
        'post',
        `/plantillas/${idCopia}/zonas/${idSala}/items`,
      ).send({ nombre: 'Mal2', field_type: 'seleccion' });
      expect(seleccionSinOpciones.status).toBe(400);

      const { rows } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM plantilla_item
          WHERE nombre IN ('Mal', 'Mal2')`,
      );
      expect(Number(rows[0]?.total)).toBe(0);
    });

    it('la baja de zona la oculta con sus ítems (R7, R10)', async () => {
      const baja = await comoAdminA('delete', `/plantillas/${idCopia}/zonas/${idSala}`);
      expect(baja.status).toBe(200);

      const detalle = await comoAdminA('get', `/plantillas/${idCopia}`);
      expect(
        detalle.body.zonas.some((z: { nombre: string }) => z.nombre === 'Sala'),
      ).toBe(false);

      const { rows } = await entorno.poolAdmin.query<{ activo: boolean }>(
        'SELECT activo FROM plantilla_zona WHERE id = $1',
        [idSala],
      );
      expect(rows[0]?.activo).toBe(false);
    });

    it('operar sobre una zona ajena o un ítem ajeno → 404 (R11)', async () => {
      const respuesta = await comoAdminA(
        'delete',
        `/plantillas/${idCopia}/zonas/ffffffff-ffff-ffff-ffff-ffffffffffff`,
      );
      expect(respuesta.status).toBe(404);

      const item = await comoAdminA(
        'patch',
        `/plantillas/${idCopia}/zonas/${idSala}/items/ffffffff-ffff-ffff-ffff-ffffffffffff`,
      ).send({ nombre: 'X' });
      expect(item.status).toBe(404);
    });
  });
});
