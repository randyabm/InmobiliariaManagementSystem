import { describe, expect, it, vi } from 'vitest';

import { ResourceNotFoundError } from '../../../../common/errors';
import { InventarioBorradorYaExisteError } from '../errors/inventario-borrador-ya-existe.error';
import { InventariosRepository } from '../inventarios.repository';
import { InventariosService } from '../inventarios.service';
import type { PlantillasService } from '../../plantillas/plantillas.service';
import type { AlmacenamientoService } from '../../almacenamiento/almacenamiento.service';

/**
 * **T21 — R1, R4, R6, R8.** Unit test de `InventariosService` con dobles
 * que registran llamadas: 404 de propiedad ajena, 409 de borrador
 * duplicado, la materialización usa la plantilla RESUELTA por
 * `resolverPlantillaParaTenant` (PA-12-3), y la pertenencia zona/ítem.
 * La integración real está en `inventarios.api.test.ts`.
 */

const CTX = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  actorId: 'user-1',
  cliente: { query: vi.fn() } as { query: ReturnType<typeof vi.fn> },
} as never;

const PLANTILLA_RESUELTA = {
  id: 'plantilla-1',
  tenant_id: '00000000-0000-0000-0000-000000000000',
  tipo: 'APARTAMENTO',
  nombre: 'Apartamento',
  origen: 'SISTEMA',
  version: 1,
  activo: true,
  created_at: '',
  updated_at: '',
};

const clienteQuery = (CTX as { cliente: { query: ReturnType<typeof vi.fn> } }).cliente.query;

const INVENTARIO_BASICO = {
  id: 'inv-1',
  tenant_id: '11111111-1111-1111-1111-111111111111',
  propiedad_id: 'prop-1',
  tipo_evento: 'ENTREGA',
  estado: 'BORRADOR',
  creado_por: 'user-1',
  revision_completada_en: null,
  activo: true,
  created_at: '',
  updated_at: '',
  zonas: [],
};

function entorno(sobres: Record<string, unknown> = {}) {
  const repositorio = {
    buscarBorrador: vi.fn(),
    insertarInventario: vi.fn(),
    materializarPlantilla: vi.fn(),
    buscarCompleto: vi.fn(),
    buscarZona: vi.fn(),
    buscarItem: vi.fn(),
    actualizarZona: vi.fn(),
    actualizarItem: vi.fn(),
    reordenarZonas: vi.fn(),
    subirFoto: vi.fn(),
    ...sobres,
  } as unknown as InventariosRepository;
  const plantillas = {
    resolverPlantillaParaTenant: vi.fn(),
  } as unknown as PlantillasService;
  const almacenamiento = {
    subir: vi.fn(),
  } as unknown as AlmacenamientoService;
  const servicio = new InventariosService(repositorio, plantillas, almacenamiento);
  return { repositorio, plantillas, almacenamiento, servicio };
}

describe('InventariosService — unit (T21: R1, R4, R6, R8)', () => {
  it('crear lanza 404 si la propiedad no existe o es ajena (R8)', async () => {
    const { repositorio, servicio } = entorno();
    repositorio.buscarBorrador = vi.fn().mockResolvedValue(null);
    clienteQuery.mockResolvedValue({ rowCount: 0 });

    await expect(
      servicio.crear({ propiedadId: 'prop-ajena', tipoEvento: 'ENTREGA' }, CTX),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    // No se llegó a materializar nada.
    expect(repositorio.insertarInventario).not.toHaveBeenCalled();
  });

  it('crear lanza 409 si ya existe un borrador para el par (PA-12-2, R1)', async () => {
    const { repositorio, servicio } = entorno();
    repositorio.buscarBorrador = vi
      .fn()
      .mockResolvedValue({ ...INVENTARIO_BASICO, id: 'borrador-existente' });

    await expect(
      servicio.crear({ propiedadId: 'prop-1', tipoEvento: 'ENTREGA' }, CTX),
    ).rejects.toBeInstanceOf(InventarioBorradorYaExisteError);
    expect(repositorio.insertarInventario).not.toHaveBeenCalled();
  });

  it('crear materializa la plantilla que resolverPlantillaParaTenant devolvió (R4, PA-12-3)', async () => {
    const { repositorio, plantillas, servicio } = entorno();
    repositorio.buscarBorrador = vi.fn().mockResolvedValue(null);
    clienteQuery.mockResolvedValue({ rowCount: 1, rows: [{ id: 'prop-1', tipo: 'APARTAMENTO' }] });
    plantillas.resolverPlantillaParaTenant = vi.fn().mockResolvedValue(PLANTILLA_RESUELTA);
    repositorio.insertarInventario = vi.fn().mockResolvedValue(INVENTARIO_BASICO);
    repositorio.materializarPlantilla = vi.fn().mockResolvedValue(undefined);
    repositorio.buscarCompleto = vi.fn().mockResolvedValue({ ...INVENTARIO_BASICO, zonas: [] });

    const resultado = await servicio.crear(
      { propiedadId: 'prop-1', tipoEvento: 'ENTREGA' },
      CTX,
    );

    expect(plantillas.resolverPlantillaParaTenant).toHaveBeenCalledWith('APARTAMENTO', CTX);
    expect(repositorio.materializarPlantilla).toHaveBeenCalledWith(
      clienteQuery.mock.instances[0],
      PLANTILLA_RESUELTA.id,
      'inv-1',
      '11111111-1111-1111-1111-111111111111',
    );
    expect(resultado.estado).toBe('BORRADOR');
  });

  it('responderItem rechaza un ítem que no pertenece al inventario (R8)', async () => {
    const { repositorio, servicio } = entorno();
    repositorio.buscarItem = vi.fn().mockResolvedValue({ id: 'item-ajeno', zona_id: 'zona-ajena' });
    repositorio.buscarZona = vi.fn().mockResolvedValue({
      id: 'zona-ajena',
      inventario_id: 'otro-inventario',
    });
    repositorio.buscarInventarioPorId = vi.fn().mockResolvedValue(INVENTARIO_BASICO);

    await expect(
      servicio.responderItem(
        CTX,
        'inv-1',
        'item-ajeno',
        { comentario: 'X' },
      ),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(repositorio.actualizarItem).not.toHaveBeenCalled();
  });
});
