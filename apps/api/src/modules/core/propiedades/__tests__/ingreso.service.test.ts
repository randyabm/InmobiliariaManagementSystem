import { describe, expect, it, vi } from 'vitest';

import { ResourceNotFoundError } from '../../../../common/errors';
import { NombreNoCoincideConIdentidadError } from '../../clientes/errors/nombre-no-coincide.error';
import { AuditService } from '../../audit/audit.service';
import { WorkflowService } from '../../workflows/workflow.service';
import { OcupacionService } from '../ocupacion.service';
import { PropiedadesService } from '../propiedades.service';
import { ResolverPerfilService } from '../resolver-perfil.service';
import { IngresoService } from '../ingreso.service';

/**
 * **T19 — R3, R4, R6.** La orquestación con dobles que registran llamadas:
 * el orden del ingreso, el 409 del nombre divergente sin tocar crear, y el
 * 404 del id ajeno. La integración real está en `ingreso.api.test.ts`.
 */

const CTX = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  actorId: 'user-1',
  cliente: {} as never,
} as never;

const DTO_VACANTE = {
  escenario: 'VACANTE' as const,
  propietario: { datos: { nombre: 'Ana', tipo_documento: 'CC' as const, documento: '1' } },
  propiedad: {
    direccion: 'Calle 1',
    tipo: 'APARTAMENTO' as const,
    area: '60.00',
    canon: '1000000.00',
    parqueaderos: 0,
    depositos: 0,
    canon_incluye_administracion: false,
  },
};

function entorno(sobres: Record<string, unknown> = {}) {
  const resolverPerfil = {
    resolverPropietario: vi.fn().mockResolvedValue({ id: 'propietario-1', creado: true }),
    resolverInquilino: vi.fn().mockResolvedValue({ id: 'inquilino-1', creado: true }),
    ...sobres,
  } as unknown as ResolverPerfilService;

  const propiedades = {
    crear: vi.fn().mockResolvedValue({ id: 'propiedad-1' }),
    obtener: vi.fn().mockResolvedValue({ id: 'propiedad-1', estado_ciclo_vida: { clave: 'arrendada' } }),
  } as unknown as PropiedadesService;

  const ocupacion = {
    asignarInquilinoActual: vi.fn().mockResolvedValue(undefined),
  } as unknown as OcupacionService;

  const workflow = {
    buscarInstanciaDeEntidad: vi.fn().mockResolvedValue({ id: 'instancia-1', definicion_id: 'def-1' }),
    transicionesDeDefinicion: vi.fn().mockResolvedValue([
      { id: 't-1', clave: 'iniciar_checkeo', tipo_ejecucion: 'HUMANA' },
      { id: 't-2', clave: 'enviar_aseguradora', tipo_ejecucion: 'HUMANA' },
      { id: 't-3', clave: 'arrendar', tipo_ejecucion: 'HUMANA' },
    ]),
    ejecutarTransicion: vi.fn().mockResolvedValue({ id: 'instancia-1' }),
  } as unknown as WorkflowService;

  const audit = {
    log: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuditService & { log: ReturnType<typeof vi.fn> };

  const servicio = new IngresoService(
    resolverPerfil,
    propiedades,
    ocupacion,
    workflow,
    audit,
  );
  return { servicio, resolverPerfil, propiedades, ocupacion, workflow, audit };
}

describe('IngresoService (T19: R3, R4, R6)', () => {
  it('escenario VACANTE: resuelve propietario, crea la ficha y audita (R1, R3)', async () => {
    const { servicio, resolverPerfil, propiedades, audit } = entorno();

    await servicio.ingresar(DTO_VACANTE, CTX);

    expect(resolverPerfil.resolverPropietario).toHaveBeenCalled();
    expect(propiedades.crear).toHaveBeenCalledWith(
      expect.objectContaining({ propietario_principal_id: 'propietario-1' }),
      CTX,
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'crear', entityType: 'perfil_propietario' }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'crear', entityType: 'propiedad' }),
    );
  });

  it('un perfil existente NO se audita como creación (R3, R8)', async () => {
    const { servicio, resolverPerfil, audit } = entorno({
      resolverPropietario: vi.fn().mockResolvedValue({ id: 'propietario-1', creado: false }),
    });

    await servicio.ingresar(DTO_VACANTE, CTX);

    expect(resolverPerfil.resolverPropietario).toHaveBeenCalled();
    const llamadas = (audit.log as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0] as { entityType: string },
    );
    expect(llamadas.some((l) => l.entityType === 'perfil_propietario')).toBe(false);
    expect(llamadas.some((l) => l.entityType === 'propiedad')).toBe(true);
  });

  it('un nombre divergente del resolver → 409 y nada se crea (R3, R6)', async () => {
    const { servicio, propiedades } = entorno({
      resolverPropietario: vi.fn().mockRejectedValue(
        new NombreNoCoincideConIdentidadError('p-1', 'Ana', 'Otro'),
      ),
    });

    await expect(servicio.ingresar(DTO_VACANTE, CTX)).rejects.toMatchObject({
      code: 'NOMBRE_NO_COINCIDE_CON_IDENTIDAD',
    });
    expect(propiedades.crear).not.toHaveBeenCalled();
  });

  it('un perfil por id inexistente → 404 y nada se crea (R10)', async () => {
    const { servicio, propiedades } = entorno({
      resolverPropietario: vi.fn().mockRejectedValue(new ResourceNotFoundError()),
    });

    await expect(servicio.ingresar(DTO_VACANTE, CTX)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
    expect(propiedades.crear).not.toHaveBeenCalled();
  });

  it('escenario B: asigna inquilino y ejecuta la cadena por claves en orden (R2, R9)', async () => {
    const { servicio, ocupacion, workflow, audit } = entorno();

    await servicio.ingresar(
      {
        ...DTO_VACANTE,
        escenario: 'ARRENDADA',
        inquilino: {
          datos: {
            nombre: 'Inq',
            tipo_documento: 'CC',
            documento: '2',
            email: 'inq@example.com',
            celular: '3000000000',
            medio_preferido_contacto: 'SMS',
          },
        },
      },
      CTX,
    );

    expect(ocupacion.asignarInquilinoActual).toHaveBeenCalledWith(
      'propiedad-1',
      'inquilino-1',
      CTX,
    );
    const claves = (workflow.ejecutarTransicion as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[1],
    );
    expect(claves).toEqual(['t-1', 't-2', 't-3']);
    // Cada transición audita con entity_id = la propiedad (R8).
    const auditorias = (audit.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as { accion: string; entityType: string })
      .filter((l) => l.accion === 'actualizar');
    expect(auditorias).toHaveLength(3);
  });
});
