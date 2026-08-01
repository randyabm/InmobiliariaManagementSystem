import { createHash, randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { PropositoOtp } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { NotificacionesOutboxService } from '../notificaciones/notificaciones-outbox.service';
import { OtpRepository } from './otp.repository';
import { OtpInvalidoError } from './errors/otp-invalido.error';

/**
 * OTP (feature #13, R4, R5, R8, R12).
 *
 * El código (6 dígitos) se guarda como SHA-256 y se entrega por el motor de
 * notificaciones (#10, PA-13-3) al canal preferido del perfil (RF-C4). La
 * verificación es UNIFORME (401, sin distinguir motivo) y de un solo uso.
 * `FIRMA` queda listo para #14 (R8).
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly repositorio: OtpRepository,
    private readonly outbox: NotificacionesOutboxService,
  ) {}

  /** R4 — genera el código, lo guarda hasheado y lo encola por #10. */
  async solicitar(
    ctx: ContextoPeticion,
    datos: { proposito: PropositoOtp },
  ): Promise<{ id: string; expira_en: string }> {
    const userId = ctx.actorId;
    if (!userId) {
      throw new OtpInvalidoError();
    }

    // El canal preferido del perfil (RF-C4): el contacto vive en el perfil
    // (D-9), así que se resuelve aquí dentro del RLS del tenant.
    const { rows: perfil } = await ctx.cliente.query<{
      id: string;
      email_contacto: string | null;
      celular: string | null;
      medio_preferido_contacto: string;
    }>(
      `SELECT id, email_contacto, celular, medio_preferido_contacto
         FROM perfil_inquilino
        WHERE tenant_id = $1 AND user_id = $2`,
      [ctx.tenantId, userId],
    );
    const fila = perfil[0];
    if (!fila) {
      throw new OtpInvalidoError();
    }

    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiraEn = new Date(Date.now() + OTP_EXPIRACION_MS);
    const guardado = await this.repositorio.insertar(ctx, {
      userId,
      proposito: datos.proposito,
      codigoHash: hashOtp(codigo),
      expiraEn,
    });

    // R4, PA-13-3: el código en claro va SOLO en la notificación (R12).
    const canal = fila.medio_preferido_contacto;
    const destinatario =
      canal === 'CORREO' ? fila.email_contacto : fila.celular;
    await this.outbox.crear(
      {
        destinatario: destinatario ?? '',
        canal,
        contenido: {
          asunto: `Tu código de verificación es ${codigo}`,
          codigo,
          proposito: datos.proposito,
          expira_en: expiraEn.toISOString(),
        },
      },
      ctx,
    );

    return { id: guardado.id, expira_en: guardado.expira_en };
  }

  /**
   * R5 — verifica hash + expiración y marca el uso. 401 uniforme: jamás se
   * distingue «código incorrecto» de «expirado» (R12).
   */
  async verificar(
    ctx: ContextoPeticion,
    datos: { codigo: string; proposito: PropositoOtp },
  ): Promise<{ id: string; verificado_en: string }> {
    const userId = ctx.actorId;
    if (!userId) throw new OtpInvalidoError();

    const pendiente = await this.repositorio.buscarPendiente(ctx, {
      userId,
      proposito: datos.proposito,
    });
    if (!pendiente) throw new OtpInvalidoError();
    if (pendiente.expira_en <= new Date().toISOString()) throw new OtpInvalidoError();
    if (hashOtp(datos.codigo) !== pendiente.codigo_hash) throw new OtpInvalidoError();

    const filas = await this.repositorio.marcarVerificado(ctx, pendiente.id);
    if (filas === 0) throw new OtpInvalidoError();

    return { id: pendiente.id, verificado_en: new Date().toISOString() };
  }
}

/** SHA-256 del código: la base nunca ve el valor en claro (R12). */
export function hashOtp(codigo: string): string {
  return createHash('sha256').update(codigo).digest('hex');
}

const OTP_EXPIRACION_MS = 10 * 60 * 1000;
