import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ResourceNotFoundError } from '../../../../common/errors';
import { PlantillaSistemaNoEditableError } from '../errors/plantilla-sistema-no-editable.error';
import { PlantillasRepository } from '../plantillas.repository';
import { PlantillasService } from '../plantillas.service';

/**
 * **T19 — R5, R6, R9.** `exigirEditable` distingue 404 de 409; `clonar`
 * copia solo zonas/ítems ACTIVOS; la validación de opciones rechaza antes
 * de insertar. El doble registra llamadas; la integración real está en
 * `plantillas.api.test.ts`.
 */

const CTX = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  actorId: undefined,
  cliente: {} as never,
} as never;

const PLANTILLA_SISTEMA = {
  id: 'plant-1',
  tenant_id: '00000000-0000-0000-0000-000000000000',
  tipo: 'APARTAMENTO',
  nombre: 'Apartamento',
  origen: 'SISTEMA',
  version: 1,
  activo: true,
  created_at: '',
  updated_at: '',
  zonas: [
    {
      id: 'zona-1',
      plantilla_id: 'plant-1',
      nombre: 'Sala',
      repetible: false,
      obligatoria: true,
      orden: 1,
      activo: true,
      created_at: '',
      items: [
        { id: 'item-1', zona_id: 'zona-1', nombre: 'Paredes', field_type: 'estado', opciones_json: null, obligatorio: true, foto_obligatoria: false, orden: 1, activo: true, created_at: '' },
      ],
    },
    {
      id: 'zona-2',
      plantilla_id: 'plant-1',
      nombre: 'Zona Inactiva',
      repetible: false,
      obligatoria: false,
      orden: 2,
      activo: false,
      created_at: '',
      items: [],
    },
  ],
};

function entorno(sobres: Record<string, unknown> = {}) {
  const busquedas = [
    PLANTILLA_SISTEMA,
    { ...PLANTILLA_SISTEMA, id: 'copia-1', origen: 'TENANT', tenant_id: '11111111-1111-1111-1111-111111111111' },
  ];
  const repositorio = {
    buscarCompleta: vi
      .fn()
      .mockImplementation(async () => busquedas.shift() ?? PLANTILLA_SISTEMA),
    buscarPlantillaPorTipo: vi.fn().mockResolvedValue(null),
    insertarPlantilla: vi.fn().mockResolvedValue({ id: 'copia-1' }),
    copiarPlantilla: vi.fn().mockResolvedValue(undefined),
    origenDePlantilla: vi.fn().mockResolvedValue('TENANT'),
    insertarItem: vi.fn().mockResolvedValue({ id: 'item-nuevo' }),
    buscarZona: vi.fn().mockResolvedValue({
      id: 'zona-1',
      plantilla_id: 'plant-1',
      nombre: 'Sala',
      repetible: false,
      obligatoria: true,
      orden: 1,
      activo: true,
      created_at: '',
    }),
    buscarItem: vi.fn().mockResolvedValue({
      id: 'item-1',
      zona_id: 'zona-1',
      nombre: 'Paredes',
      field_type: 'estado',
      opciones_json: null,
      obligatorio: true,
      foto_obligatoria: false,
      orden: 1,
      activo: true,
      created_at: '',
    }),
    insertarZona: vi.fn().mockResolvedValue({ id: 'zona-nueva' }),
    ...sobres,
  } as unknown as PlantillasRepository;

  const servicio = new PlantillasService(repositorio);
  return { servicio, repositorio };
}

describe('PlantillasService (T19: R5, R6, R9)', () => {
  it('una plantilla ajena o inexistente es 404 (R6)', async () => {
    const { servicio } = entorno({
      origenDePlantilla: vi.fn().mockResolvedValue(null),
    });
    await expect(
      servicio.crearZona('ajena', { nombre: 'X', repetible: false, obligatoria: false, orden: 0 }, CTX),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it('una plantilla del SISTEMA es 409 sin escribir (R6)', async () => {
    const { servicio, repositorio } = entorno({
      origenDePlantilla: vi.fn().mockResolvedValue('SISTEMA'),
    });
    await expect(
      servicio.crearZona('plant-1', { nombre: 'X', repetible: false, obligatoria: false, orden: 0 }, CTX),
    ).rejects.toBeInstanceOf(PlantillaSistemaNoEditableError);
    expect(repositorio.insertarItem).not.toHaveBeenCalled();
  });

  it('clonar copia solo zonas/ítems ACTIVOS (R5)', async () => {
    const { servicio, repositorio } = entorno();
    const resultado = await servicio.clonar('plant-1', CTX);

    expect(resultado.id).toBe('copia-1');
    expect(repositorio.insertarPlantilla).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ origen: 'TENANT', tipo: 'APARTAMENTO' }),
    );
    // La zona inactiva NO debe copiarse: la consulta del repositorio filtra
    // `activo = true` (verificado en la integración con SELECT).
    expect(repositorio.copiarPlantilla).toHaveBeenCalledWith(
      expect.anything(),
      'plant-1',
      'copia-1',
    );
  });

  it('validarOpciones rechaza antes de insertar (R9)', async () => {
    const { servicio, repositorio } = entorno();
    await expect(
      servicio.crearItem(
        'zona-1',
        { nombre: 'Mal', fieldType: 'estado', opcionesJson: ['a'], obligatorio: false, fotoObligatoria: false, orden: 0 },
        CTX,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      servicio.crearItem(
        'zona-1',
        { nombre: 'Mal2', fieldType: 'seleccion', opcionesJson: null, obligatorio: false, fotoObligatoria: false, orden: 0 },
        CTX,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repositorio.insertarItem).not.toHaveBeenCalled();
  });

  it('un ítem cuya zona no cuelga de la plantilla de la ruta es 404', async () => {
    const { servicio } = entorno();
    await expect(
      servicio.actualizarItem(
        'zona-ajena',
        'item-1',
        { nombre: 'X' },
        CTX,
      ),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });
});
