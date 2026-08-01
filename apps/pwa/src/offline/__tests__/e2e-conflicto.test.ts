import { beforeEach, describe, expect, it } from 'vitest';
import { abrirAlmacen, almacen } from '../almacen-local';
import { ClienteApi, type Peticion, type Respuesta, type Transporte } from '../../api/cliente-api';
import { MotorSync } from '../motor-sync';
import { conservarLocal, conservarRemoto, encolarOperacion, marcarConflicto } from '../cola-sync';

/**
 * E2E de conflicto (T12 → R6): si el `updated_at` del servidor difiere de
 * la versión base local, la operación NO se sobrescribe en silencio; el
 * empleado decide «conservar local» o «conservar remoto».
 */
class TransporteDivergente implements Transporte {
  version = '2026-08-01T00:00:00Z';
  recibidas: string[] = [];

  async request(peticion: Peticion): Promise<Respuesta> {
    this.recibidas.push(peticion.ruta);
    return {
      status: 200,
      cuerpo: { updated_at: this.version },
    };
  }
}

describe('E2E — conflicto (T12: R6)', () => {
  let transporte: TransporteDivergente;
  let api: ClienteApi;
  let motor: MotorSync;

  beforeEach(async () => {
    const db = await abrirAlmacen();
    await Promise.all([db.clear('cola'), db.clear('inventarios'), db.clear('cache')]);
    transporte = new TransporteDivergente();
    api = new ClienteApi(transporte);
    motor = new MotorSync(api);
  });

  it('divergencia de updated_at → conflicto; «conservar remoto» descarta la local (R6)', async () => {
    // Operación local con versión base vieja.
    const op = await encolarOperacion({
      tipo: 'responder_item',
      entidad_id: 'item-1',
      inventario_id: 'inv-1',
      datos: { estado_checklist: 'MALO' },
      base_version: '2026-07-31T00:00:00Z',
    });

    // El «servidor» tiene una versión más nueva.
    transporte.version = '2026-08-01T10:00:00Z';
    const resultado = await motor.sincronizar();

    // R6: conflicto, NO sobrescritura muda.
    expect(resultado.conflictos).toBeGreaterThan(0);
    const cola = await almacen.listarCola();
    const enConflicto = cola.find((o) => o.id === op.id);
    expect(enConflicto?.estado).toBe('conflicto');

    // «Conservar remoto»: descarta la operación local.
    await conservarRemoto(op.id);
    expect((await almacen.listarCola()).find((o) => o.id === op.id)).toBeUndefined();
  });

  it('«conservar local» reencola con la versión del servidor como base (R6)', async () => {
    const op = await encolarOperacion({
      tipo: 'responder_item',
      entidad_id: 'item-2',
      inventario_id: 'inv-2',
      datos: { comentario: 'Lo conservo yo' },
      base_version: '2026-07-31T00:00:00Z',
    });
    await marcarConflicto(op.id, 'Versión más nueva en el servidor.');

    transporte.version = '2026-08-01T10:00:00Z';
    await conservarLocal(op.id, transporte.version);

    const reencolada = (await almacen.listarCola()).find((o) => o.id === op.id);
    expect(reencolada?.estado).toBe('pendiente');
    expect(reencolada?.base_version).toBe('2026-08-01T10:00:00Z');

    // La siguiente corrida ya no conflige (la base coincide con el servidor).
    const resultado = await motor.sincronizar();
    expect(resultado.conflictos).toBe(0);
  });
});
