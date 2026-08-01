import { Injectable } from '@nestjs/common';
import type { NotificacionHook } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { InquilinosService } from '../clientes/inquilinos.service';
import { PropietariosService } from '../clientes/propietarios.service';
import { NotificacionNoResolubleError } from './errors/notificacion-no-resoluble.error';

export interface DestinatarioResuelto {
  readonly destinatario: string;
  readonly canal: string;
}

/**
 * Resolución de destinatarios y canales (feature #10, R7, PA-10-3).
 *
 * - `destinatario.tipo = 'inquilino_actual'` → el perfil del inquilino
 *   actual de la entidad; `'propietario_principal'` → el perfil del
 *   propietario principal de la entidad (solo propiedades: las entidades
 *   del motor son la ficha y su máquina).
 * - `destinatario.email` / `celular` → directos.
 * - Canal: el del hook o, si falta, el `medio_preferido_contacto` del
 *   perfil (RF-C4). `LLAMADA` se entrega como canal válido del registro.
 */
@Injectable()
export class ResolverDestinatarioService {
  constructor(
    private readonly inquilinos: InquilinosService,
    private readonly propietarios: PropietariosService,
  ) {}

  async resolver(
    hook: NotificacionHook,
    entidadTipo: string | null,
    entidadId: string | null,
    ctx: ContextoPeticion,
  ): Promise<DestinatarioResuelto> {
    const destinatario = hook.destinatario;
    const canal = hook.canal ?? null;

    // Destinatario directo (email/celular).
    if (destinatario?.email !== undefined) {
      return { destinatario: destinatario.email, canal: canal ?? 'CORREO' };
    }
    if (destinatario?.celular !== undefined) {
      return { destinatario: destinatario.celular, canal: canal ?? 'SMS' };
    }

    // Destinatario por tipo, resuelto desde la entidad de la instancia.
    const tipo = destinatario?.tipo;
    if (tipo === undefined || tipo === null) {
      throw new NotificacionNoResolubleError();
    }
    if (entidadTipo !== 'propiedad' || entidadId === null) {
      throw new NotificacionNoResolubleError();
    }

    if (tipo === 'inquilino_actual') {
      const ficha = await this.propiedadesFicha(entidadId, ctx);
      if (!ficha.inquilino_actual_id) {
        throw new NotificacionNoResolubleError();
      }
      const perfil = await this.inquilinos.obtener(ficha.inquilino_actual_id, ctx);
      return {
        destinatario: perfil.email_contacto,
        canal: canal ?? perfil.medio_preferido_contacto,
      };
    }

    // propietario_principal
    const ficha = await this.propiedadesFicha(entidadId, ctx);
    const perfil = await this.propietarios.obtener(ficha.propietario_principal_id, ctx);
    const contacto = perfil.email_contacto ?? perfil.telefono_contacto;
    if (!contacto) {
      throw new NotificacionNoResolubleError();
    }
    return {
      destinatario: contacto,
      canal: canal ?? 'CORREO',
    };
  }

  private async propiedadesFicha(
    entidadId: string,
    ctx: ContextoPeticion,
  ): Promise<{ inquilino_actual_id: string | null; propietario_principal_id: string }> {
    const { rows } = await ctx.cliente.query<{
      inquilino_actual_id: string | null;
      propietario_principal_id: string;
    }>(
      `SELECT inquilino_actual_id::text AS inquilino_actual_id,
              propietario_principal_id::text AS propietario_principal_id
         FROM propiedad
        WHERE id = $1 AND tenant_id = $2`,
      [entidadId, ctx.tenantId],
    );
    if (!rows[0]) {
      throw new NotificacionNoResolubleError();
    }
    return rows[0];
  }
}
