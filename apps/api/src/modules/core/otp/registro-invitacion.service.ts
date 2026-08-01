import { createHash, randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { getDatabasePool } from '../../../database/database.client';
import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { IdentidadService } from '../clientes/identidad.service';
import { NotificacionesOutboxService } from '../notificaciones/notificaciones-outbox.service';
import { InvitacionesRepository } from '../invitaciones/invitaciones.repository';
import { InvitacionInvalidaError } from '../invitaciones/errors/invitacion-invalida.error';
import { OtpRepository } from '../otp/otp.repository';

/**
 * Registro del inquilino desde la invitación (feature #13, R3-R5, PA-13-1).
 *
 * El flujo es CUENTA PERSISTENTE, nunca acceso anónimo (RF-AU5): la
 * identidad se resuelve por documento (#26, dedup), recibe `password_hash`
 * (bcrypt) y rol `inquilino`, y el email/celular verificado por OTP pasa al
 * perfil (D-9). El login posterior es el estándar #27.
 */
@Injectable()
export class RegistroInvitacionService {
  constructor(
    private readonly invitaciones: InvitacionesRepository,
    private readonly identidad: IdentidadService,
    private readonly otp: OtpRepository,
    private readonly outbox: NotificacionesOutboxService,
  ) {}

  /**
   * R3-R5 — crea la cuenta persistente desde una invitación válida y
   * solicita el OTP de REGISTRO. 401 uniforme si la invitación falla.
   */
  async registrarDesdeInvitacion(datos: {
    token: string;
    nombre: string;
    tipo_documento: string;
    documento: string;
    password: string;
    email?: string;
    celular?: string;
  }): Promise<{ otp_solicitado: true; expira_en: string }> {
    if (datos.password.length < 8) throw new InvitacionInvalidaError();

    const tokenHash = hashToken(datos.token);
    const cliente = await getDatabasePool(process.env.DATABASE_URL!).connect();
    try {
      const bootstrapFila = await this.invitaciones.buscarPorHash(cliente, tokenHash);
      if (!bootstrapFila) throw new InvitacionInvalidaError();
      if (bootstrapFila.usada_en !== null) throw new InvitacionInvalidaError();
      if (bootstrapFila.expira_en.getTime() <= Date.now()) {
        throw new InvitacionInvalidaError();
      }

      await cliente.query('BEGIN');
      await cliente.query(`SET LOCAL app.current_tenant = '${bootstrapFila.tenant_id}'`);
      const ctx: ContextoPeticion = { cliente, tenantId: bootstrapFila.tenant_id };

      const vigente = await this.invitaciones.buscarActiva(ctx, bootstrapFila.id);
      if (!vigente) throw new InvitacionInvalidaError();

      // R3: el documento del registro debe coincidir con el del perfil
      // invitado — la invitación es PERSONAL.
      const { rows: perfil } = await cliente.query<{
        id: string;
        user_id: string;
        tipo_documento: string;
        documento: string;
      }>(
        `SELECT id, user_id, tipo_documento, documento
           FROM perfil_inquilino
          WHERE id = $1 AND tenant_id = $2`,
        [vigente.perfil_inquilino_id, ctx.tenantId],
      );
      const filaPerfil = perfil[0];
      if (!filaPerfil) throw new InvitacionInvalidaError();
      if (
        filaPerfil.tipo_documento !== datos.tipo_documento ||
        filaPerfil.documento !== datos.documento
      ) {
        throw new InvitacionInvalidaError();
      }

      // Cuenta persistente: identidad por documento (#26) + rol inquilino.
      const passwordHash = await bcrypt.hash(datos.password, 10);
      const identidad = await this.identidad.resolverIdentidad(
        cliente,
        {
          nombre: datos.nombre,
          tipoDocumento: datos.tipo_documento as 'CC' | 'CE' | 'NIT' | 'PASAPORTE',
          documento: datos.documento,
        },
        ctx.tenantId,
        'inquilino',
      );

      await cliente.query(
        `UPDATE "user" SET password_hash = $2, email = COALESCE($3, email)
          WHERE id = $1 AND tenant_id = $4`,
        [identidad.userId, passwordHash, datos.email ?? null, ctx.tenantId],
      );

      // El contacto verificado por OTP pasa al perfil (D-9, RF-C4).
      await cliente.query(
        `UPDATE perfil_inquilino
            SET email_contacto = COALESCE($2, email_contacto),
                celular = COALESCE($3, celular)
          WHERE id = $1 AND tenant_id = $4`,
        [vigente.perfil_inquilino_id, datos.email ?? null, datos.celular ?? null, ctx.tenantId],
      );

      // R3: la invitación se consume una sola vez.
      await this.invitaciones.usar(ctx, vigente.id);

      // OTP de REGISTRO (R4): hash en la base, código en claro solo en la
      // notificación (R12, PA-13-3).
      const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const expiraEn = new Date(Date.now() + OTP_EXPIRACION_MS);
      const { rows: canalFila } = await cliente.query<{
        email_contacto: string | null;
        celular: string | null;
        medio_preferido_contacto: string;
      }>(
        `SELECT email_contacto, celular, medio_preferido_contacto
           FROM perfil_inquilino WHERE id = $1`,
        [vigente.perfil_inquilino_id],
      );
      const canalFilaActual = canalFila[0]!;
      const canal = canalFilaActual.medio_preferido_contacto;
      const destinatario = canal === 'CORREO' ? canalFilaActual.email_contacto : canalFilaActual.celular;

      await this.otp.insertar(ctx, {
        userId: identidad.userId,
        proposito: 'REGISTRO',
        codigoHash: createHash('sha256').update(codigo).digest('hex'),
        expiraEn,
      });
      await this.outbox.crear(
        {
          destinatario: destinatario ?? '',
          canal,
          contenido: {
            asunto: `Tu código de verificación es ${codigo}`,
            codigo,
            proposito: 'REGISTRO',
            expira_en: expiraEn.toISOString(),
          },
        },
        ctx,
      );

      await cliente.query('COMMIT');
      return { otp_solicitado: true, expira_en: expiraEn.toISOString() };
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      cliente.release();
    }
  }
}

/** SHA-256 del token: la base nunca ve el valor en claro (R12). */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const OTP_EXPIRACION_MS = 10 * 60 * 1000;
