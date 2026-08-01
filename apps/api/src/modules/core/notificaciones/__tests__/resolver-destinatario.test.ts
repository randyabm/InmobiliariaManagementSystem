import { describe, expect, it, vi } from 'vitest';

import { InquilinosService } from '../../clientes/inquilinos.service';
import { PropietariosService } from '../../clientes/propietarios.service';
import { NotificacionNoResolubleError } from '../errors/notificacion-no-resoluble.error';
import { ResolverDestinatarioService } from '../resolver-destinatario.service';

/**
 * **T22 — R7.** Los cuatro casos del hook: inquilino_actual,
 * propietario_principal, email directo y celular directo; canal preferido
 * (RF-C4); e irresoluble → error sin PII.
 */

const CTX = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  actorId: undefined,
  cliente: {
    query: vi.fn().mockResolvedValue({
      rows: [
        {
          inquilino_actual_id: 'inq-1',
          propietario_principal_id: 'prop-1',
        },
      ],
    }),
  },
} as never;

function entorno(sobres: Record<string, unknown> = {}) {
  const inquilinos = {
    obtener: vi.fn().mockResolvedValue({
      id: 'inq-1',
      email_contacto: 'inquilino@example.com',
      medio_preferido_contacto: 'WHATSAPP',
    }),
    ...sobres,
  } as unknown as InquilinosService;

  const propietarios = {
    obtener: vi.fn().mockResolvedValue({
      id: 'prop-1',
      email_contacto: 'propietario@example.com',
      telefono_contacto: '3001112222',
    }),
  } as unknown as PropietariosService;

  const servicio = new ResolverDestinatarioService(inquilinos, propietarios);
  return { servicio, inquilinos, propietarios };
}

describe('ResolverDestinatarioService (T22: R7)', () => {
  it('inquilino_actual: perfil + medio preferido de contacto (RF-C4)', async () => {
    const { servicio } = entorno();
    const resuelto = await servicio.resolver(
      { destinatario: { tipo: 'inquilino_actual' } },
      'propiedad',
      'propiedad-1',
      CTX,
    );
    expect(resuelto).toEqual({
      destinatario: 'inquilino@example.com',
      canal: 'WHATSAPP',
    });
  });

  it('propietario_principal: email o teléfono del perfil', async () => {
    const { servicio } = entorno();
    const resuelto = await servicio.resolver(
      { destinatario: { tipo: 'propietario_principal' } },
      'propiedad',
      'propiedad-1',
      CTX,
    );
    expect(resuelto.destinatario).toBe('propietario@example.com');
  });

  it('email directo: se usa tal cual, con el canal del hook', async () => {
    const { servicio } = entorno();
    const resuelto = await servicio.resolver(
      { canal: 'CORREO', destinatario: { email: 'directo@example.com' } },
      null,
      null,
      CTX,
    );
    expect(resuelto).toEqual({ destinatario: 'directo@example.com', canal: 'CORREO' });
  });

  it('celular directo: canal SMS por defecto', async () => {
    const { servicio } = entorno();
    const resuelto = await servicio.resolver(
      { destinatario: { celular: '3009998877' } },
      null,
      null,
      CTX,
    );
    expect(resuelto).toEqual({ destinatario: '3009998877', canal: 'SMS' });
  });

  it('sin tipo ni contacto directo → error sin PII (R7, R15)', async () => {
    const { servicio } = entorno();
    await expect(
      servicio.resolver({}, null, null, CTX),
    ).rejects.toBeInstanceOf(NotificacionNoResolubleError);

    await expect(
      servicio.resolver({ destinatario: { tipo: 'inquilino_actual' } }, 'otra_entidad', 'x', CTX),
    ).rejects.toBeInstanceOf(NotificacionNoResolubleError);
  });

  it('un inquilino_actual inexistente (ficha sin inquilino) → error', async () => {
    const { servicio } = entorno();
    const clienteSinInquilino = {
      query: vi.fn().mockResolvedValue({
        rows: [{ inquilino_actual_id: null, propietario_principal_id: 'prop-1' }],
      }),
    };
    await expect(
      servicio.resolver(
        { destinatario: { tipo: 'inquilino_actual' } },
        'propiedad',
        'propiedad-1',
        { tenantId: '11111111-1111-1111-1111-111111111111', actorId: undefined, cliente: clienteSinInquilino } as never,
      ),
    ).rejects.toBeInstanceOf(NotificacionNoResolubleError);
  });
});
