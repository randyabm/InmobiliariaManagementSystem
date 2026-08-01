import { describe, expect, it, vi } from 'vitest';

import { CuentaDeGiroInvalidaError } from '../../clientes/errors';
import { PropietariosService } from '../../clientes/propietarios.service';
import { WorkflowService } from '../../workflows/workflow.service';
import { PropiedadesRepository } from '../propiedades.repository';
import { PropiedadesService } from '../propiedades.service';

/**
 * **T25 — R8.** El override de cuenta se valida delegando en
 * `CuentasBancariasService.resolverCuentaDeGiro` (#5), la regla única de
 * precedencia: el service de #6 no duplica la lógica, solo la invoca en el
 * alta y la traduce a lectura nullable en la ficha.
 *
 * El doble registra llamadas: la integración real (override gana, ajeno →
 * 400) está en `propiedades.api.test.ts` T12 contra PostgreSQL real.
 */

const TENANT_CTX = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  actorId: undefined,
  cliente: {} as never,
};

const PROPIEDAD_BASE = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  tenant_id: TENANT_CTX.tenantId,
  direccion: 'Calle 1',
  tipo: 'APARTAMENTO' as const,
  area: '60.00',
  matricula_inmobiliaria: null,
  estrato: null,
  parqueaderos: 0,
  depositos: 0,
  fotos: [],
  canon: '1000000.00',
  valor_administracion: null,
  canon_incluye_administracion: false,
  incremento_anual_pactado: null,
  nombre_conjunto: null,
  contacto_admin_nombre: null,
  contacto_admin_telefono: null,
  contacto_admin_correo: null,
  propietario_principal_id: 'principal-1',
  cuenta_bancaria_id: null,
  inquilino_actual_id: null,
  activo: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('PropiedadesService — override de cuenta (T25: R8)', () => {
  it('crear con override delega la validación en resolverCuentaDeGiro (R8)', async () => {
    const resolver = vi.fn().mockResolvedValue({ id: 'cuenta-1' });
    const servicio = new PropiedadesService(
      { insertar: vi.fn().mockResolvedValue(PROPIEDAD_BASE) } as unknown as PropiedadesRepository,
      { obtener: vi.fn().mockResolvedValue({}) } as unknown as PropietariosService,
      { resolverCuentaDeGiro: resolver } as never,
      {
        resolverDefinicionParaTenant: vi.fn().mockResolvedValue({ id: 'def-1' }),
        crearInstancia: vi.fn().mockResolvedValue({ id: 'inst-1' }),
      } as unknown as WorkflowService,
    );

    await servicio.crear(
      {
        direccion: 'Calle 1',
        tipo: 'APARTAMENTO',
        area: '60.00',
        canon: '1000000.00',
        propietario_principal_id: 'principal-1',
        cuenta_bancaria_id: 'cuenta-1',
        parqueaderos: 0,
        depositos: 0,
        canon_incluye_administracion: false,
      },
      TENANT_CTX,
    );

    expect(resolver).toHaveBeenCalledWith('principal-1', 'cuenta-1', TENANT_CTX);
  });

  it('crear con override AJENO lanza el error de #5 (400) sin persistir (R8)', async () => {
    const resolver = vi.fn().mockRejectedValue(new CuentaDeGiroInvalidaError());
    const insertar = vi.fn();
    const servicio = new PropiedadesService(
      { insertar } as unknown as PropiedadesRepository,
      { obtener: vi.fn().mockResolvedValue({}) } as unknown as PropietariosService,
      { resolverCuentaDeGiro: resolver } as never,
      {} as unknown as WorkflowService,
    );

    await expect(
      servicio.crear(
        {
          direccion: 'Calle 1',
          tipo: 'APARTAMENTO',
          area: '60.00',
          canon: '1000000.00',
          propietario_principal_id: 'principal-1',
          cuenta_bancaria_id: 'cuenta-ajena',
          parqueaderos: 0,
          depositos: 0,
          canon_incluye_administracion: false,
        },
        TENANT_CTX,
      ),
    ).rejects.toBeInstanceOf(CuentaDeGiroInvalidaError);

    expect(insertar).not.toHaveBeenCalled();
  });

  it('la ficha traduce el error de giro a cuenta_giro null, sin lanzar (R8)', async () => {
    const resolver = vi.fn().mockRejectedValue(new CuentaDeGiroInvalidaError());
    const servicio = new PropiedadesService(
      {
        buscarPorId: vi.fn().mockResolvedValue({
          ...PROPIEDAD_BASE,
          cuenta_bancaria_id: 'override-perdido',
        }),
        propietariosActivos: vi.fn().mockResolvedValue([]),
        nombreDelInquilinoActual: vi.fn().mockResolvedValue(null),
        estadoCicloVida: vi.fn().mockResolvedValue(null),
      } as unknown as PropiedadesRepository,
      {} as unknown as PropietariosService,
      { resolverCuentaDeGiro: resolver } as never,
      {} as unknown as WorkflowService,
    );

    const ficha = await servicio.obtener(PROPIEDAD_BASE.id, TENANT_CTX);

    expect(ficha.cuenta_giro).toBeNull();
    expect(ficha.propietarios).toEqual([]);
  });

  it('sin override, la ficha expone la cuenta del principal (R8)', async () => {
    const resolver = vi.fn().mockResolvedValue({ id: 'predeterminada-1' });
    const servicio = new PropiedadesService(
      {
        buscarPorId: vi.fn().mockResolvedValue(PROPIEDAD_BASE),
        propietariosActivos: vi.fn().mockResolvedValue([]),
        nombreDelInquilinoActual: vi.fn().mockResolvedValue(null),
        estadoCicloVida: vi.fn().mockResolvedValue({
          clave: 'disponible',
          etiqueta: 'Disponible / Vacante',
          desde: '2026-01-01T00:00:00.000Z',
        }),
      } as unknown as PropiedadesRepository,
      {} as unknown as PropietariosService,
      { resolverCuentaDeGiro: resolver } as never,
      {} as unknown as WorkflowService,
    );

    const ficha = await servicio.obtener(PROPIEDAD_BASE.id, TENANT_CTX);

    expect(ficha.cuenta_giro).toEqual({ id: 'predeterminada-1' });
    expect(resolver).toHaveBeenCalledWith('principal-1', null, TENANT_CTX);
  });
});
