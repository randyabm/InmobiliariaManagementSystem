/**
 * Contratos de la firma electrónica y el PDF del inventario (feature #14,
 * RF-I8, RF-I9, RF-I12, D4, §10.1 Ley 527).
 *
 * La firma registra evidencia INMUTABLE (append-only): firmante, timestamp,
 * IP, hash SHA-256 del documento y (para el inquilino) la verificación OTP.
 * El proveedor certificado se enchufa detrás de `ServicioFirma` (D4).
 */

export const FIRMANTES = ['EMPLEADO', 'INQUILINO'] as const;
export type FirmanteTipo = (typeof FIRMANTES)[number];

export interface FirmaInventario {
  readonly id: string;
  readonly tenant_id: string;
  readonly inventario_id: string;
  readonly firmante_tipo: FirmanteTipo;
  readonly firmante_user_id: string;
  readonly hash_documento: string;
  readonly ip: string;
  readonly otp_verificado_en: string | null;
  readonly created_at: string;
}
