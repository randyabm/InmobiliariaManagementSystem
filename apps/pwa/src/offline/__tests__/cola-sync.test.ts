import { beforeEach, describe, expect, it } from 'vitest';
import { abrirAlmacen } from '../almacen-local';
import { encolarOperacion, hayPendientes, listarEnOrden, marcarConfirmada } from '../cola-sync';

/**
 * Cola de sincronización (T5 → R4, R8): orden de encolado (padres antes
 * que hijos) y confirmación solo con 2xx (aquí, la marca explícita).
 */
describe('cola-sync (T5: R4, R8)', () => {
  beforeEach(async () => {
    const db = await abrirAlmacen();
    await Promise.all([
      db.clear('cola'),
      db.clear('inventarios'),
      db.clear('cache'),
    ]);
  });

  it('encola en orden y lista padres antes que hijos (R4, R8)', async () => {
    await encolarOperacion({
      tipo: 'crear_inventario',
      entidad_id: 'inv-1',
      inventario_id: 'inv-1',
      datos: {},
      base_version: null,
    });
    await encolarOperacion({
      tipo: 'crear_zona',
      entidad_id: 'zona-1',
      inventario_id: 'inv-1',
      datos: { nombre: 'Sala' },
      base_version: null,
    });
    await encolarOperacion({
      tipo: 'crear_item',
      entidad_id: 'item-1',
      inventario_id: 'inv-1',
      datos: { zona_id: 'zona-1', nombre: 'Paredes' },
      base_version: null,
    });
    await encolarOperacion({
      tipo: 'subir_foto',
      entidad_id: 'item-1',
      inventario_id: 'inv-1',
      datos: { blob: new Blob(['foto']) },
      base_version: null,
    });

    const enOrden = await listarEnOrden();
    expect(enOrden.map((o) => o.tipo)).toEqual([
      'crear_inventario',
      'crear_zona',
      'crear_item',
      'subir_foto',
    ]);
  });

  it('la confirmada deja de contar como pendiente (R8)', async () => {
    const op = await encolarOperacion({
      tipo: 'crear_inventario',
      entidad_id: 'inv-2',
      inventario_id: 'inv-2',
      datos: {},
      base_version: null,
    });
    expect(await hayPendientes()).toBe(true);

    await marcarConfirmada(op.id, '2026-08-01T00:00:00Z');
    expect(await hayPendientes()).toBe(false);
  });
});
