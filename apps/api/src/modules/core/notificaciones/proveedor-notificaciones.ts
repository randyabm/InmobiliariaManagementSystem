import type { PoolClient } from 'pg';

/**
 * Interfaz abstracta de proveedores de notificaciones (feature #10, R5).
 *
 * El procesador despacha a través de esta interfaz; los proveedores reales
 * (email/SMS/WhatsApp) se registran detrás de ella sin tocar el procesador
 * (PA-10-2, mismo patrón que la firma en #14). `cliente` es el PoolClient
 * de la transacción del procesador (con `SET LOCAL` del tenant de la fila,
 * R14): lo usan los proveedores que persisten en la base
 * (`ProveedorRegistro`); los externos lo ignoran.
 */
export interface ProveedorNotificaciones {
  readonly canal: string;
  enviar(datos: {
    tenantId: string;
    destinatario: string;
    contenido: unknown;
    cliente: PoolClient;
  }): Promise<void>;
}
