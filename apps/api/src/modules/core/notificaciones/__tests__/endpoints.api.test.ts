import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
} from '../../../../../test/support/entorno-clientes';

/**
 * Endpoints de notificaciones (T16 → R8, R9, R11). Contra PostgreSQL real y
 * la app real; aserciones con SELECTs independientes.
 */
describe('Endpoints de notificaciones (T16)', () => {
  let entorno: EntornoClientes;

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();

  const comoAdminA = (metodo: 'post' | 'get' | 'delete', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);

  it('POST /notificaciones crea la fila del outbox (R8)', async () => {
    const respuesta = await comoAdminA('post', '/notificaciones').send({
      destinatario: 'manual@example.com',
      canal: 'CORREO',
      contenido: { asunto: 'Aviso manual' },
    });
    expect(respuesta.status).toBe(201);
    expect(respuesta.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(respuesta.body.estado).toBe('PENDIENTE');

    const { rows } = await entorno.poolAdmin.query<{ destinatario: string }>(
      'SELECT destinatario FROM notificacion_pendiente WHERE id = $1',
      [respuesta.body.id],
    );
    expect(rows[0]?.destinatario).toBe('manual@example.com');
  });

  it('GET /notificaciones lista pendientes y enviadas del tenant (R9)', async () => {
    // El procesador no corre en test, así que la fila sigue pendiente.
    await comoAdminA('post', '/notificaciones').send({
      destinatario: 'lista@example.com',
      contenido: { asunto: 'Para listar' },
    });

    const listado = await comoAdminA('get', '/notificaciones');
    expect(listado.status).toBe(200);
    expect(Array.isArray(listado.body.pendientes)).toBe(true);
    expect(Array.isArray(listado.body.enviadas)).toBe(true);
    expect(
      listado.body.pendientes.some(
        (p: { destinatario: string }) => p.destinatario === 'lista@example.com',
      ),
    ).toBe(true);
  });

  it('POST /notificaciones/programadas crea y GET lista (R11)', async () => {
    const creada = await comoAdminA('post', '/notificaciones/programadas').send({
      programada_para: new Date(Date.now() + 86_400_000).toISOString(),
      destinatario: 'recordatorio@example.com',
      canal: 'CORREO',
      plantilla: 'recordatorio_generico',
    });
    expect(creada.status).toBe(201);
    expect(creada.body.estado).toBe('PENDIENTE');

    const listado = await comoAdminA('get', '/notificaciones/programadas');
    expect(listado.status).toBe(200);
    expect(
      listado.body.some(
        (p: { destinatario: string }) => p.destinatario === 'recordatorio@example.com',
      ),
    ).toBe(true);
  });

  it('DELETE cancela el recordatorio sin borrarlo (R11)', async () => {
    const creada = await comoAdminA('post', '/notificaciones/programadas').send({
      programada_para: new Date(Date.now() + 86_400_000).toISOString(),
      destinatario: 'cancelar@example.com',
      canal: 'SMS',
    });

    const baja = await comoAdminA(
      'delete',
      `/notificaciones/programadas/${creada.body.id}`,
    );
    expect(baja.status).toBe(200);

    const { rows } = await entorno.poolAdmin.query<{ estado: string }>(
      'SELECT estado FROM notificacion_programada WHERE id = $1',
      [creada.body.id],
    );
    expect(rows[0]?.estado).toBe('CANCELADA');
  });

  it('cancelar un recordatorio inexistente es 404 (R14)', async () => {
    const baja = await comoAdminA(
      'delete',
      '/notificaciones/programadas/ffffffff-ffff-ffff-ffff-ffffffffffff',
    );
    expect(baja.status).toBe(404);
  });
});
