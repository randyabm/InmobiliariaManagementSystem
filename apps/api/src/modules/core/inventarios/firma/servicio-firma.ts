import type { FirmaInventario, FirmanteTipo } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../../common/database/cliente-tenant';

/**
 * Firma electrónica (feature #14, R3, D4, PA-14-4).
 *
 * Interfaz abstracta: la implementación MVP registra la evidencia en
 * `inventario_firma` (Ley 527 de 1999: timestamp, IP, verificación de
 * identidad y hash del documento); un proveedor certificado se enchufa
 * detrás de esta interfaz sin tocar el servicio (mismo patrón que #10).
 */
export interface ServicioFirma {
  firmar(datos: {
    ctx: ContextoPeticion;
    inventarioId: string;
    firmanteTipo: FirmanteTipo;
    firmanteUserId: string;
    hashDocumento: string;
    ip: string;
    otpVerificadoEn?: Date;
  }): Promise<FirmaInventario>;
}
