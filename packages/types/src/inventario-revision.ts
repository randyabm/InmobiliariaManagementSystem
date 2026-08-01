/**
 * Contratos de la revisión del inquilino (feature #13, §8.7, RF-I4, RF-I5,
 * RF-AU2 actualizado, RF-AU3, RF-AU5).
 *
 * La invitación lleva a una CUENTA PERSISTENTE (PA-13-1), nunca a acceso
 * anónimo; el OTP se entrega por el motor de notificaciones (#10, PA-13-3)
 * y la revisión es de una sola ronda (PA-13-2).
 */

export const PROPOSITOS_OTP = ['REGISTRO', 'LOGIN', 'FIRMA'] as const;
export type PropositoOtp = (typeof PROPOSITOS_OTP)[number];

export const RESPUESTAS_REVISION = ['ACEPTADO', 'OBJETADO'] as const;
export type RespuestaRevision = (typeof RESPUESTAS_REVISION)[number];

export interface InvitacionInventario {
  readonly id: string;
  readonly tenant_id: string;
  readonly inventario_id: string;
  readonly perfil_inquilino_id: string;
  readonly expira_en: string;
  readonly usada_en: string | null;
  readonly created_at: string;
}

export interface CodigoOtp {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly proposito: PropositoOtp;
  readonly expira_en: string;
  readonly verificado_en: string | null;
  readonly created_at: string;
}

export interface RevisionItemInventario {
  readonly id: string;
  readonly tenant_id: string;
  readonly item_id: string;
  readonly perfil_inquilino_id: string;
  readonly respuesta: RespuestaRevision;
  readonly comentario: string | null;
  readonly created_at: string;
}
