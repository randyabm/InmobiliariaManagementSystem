import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import type { ProveedorNotificaciones } from './proveedor-notificaciones';

/**
 * Proveedor MVP (PA-10-2): persiste la entrega en `notificacion_enviada`
 * (append-only, R6) usando el cliente de la transacción del procesador.
 * Es el único proveedor hasta que existan credenciales de email/SMS/
 * WhatsApp; los canales conocidos se despachan aquí.
 */
@Injectable()
export class ProveedorRegistro implements ProveedorNotificaciones {
  readonly canal = '*';

  async enviar(datos: {
    tenantId: string;
    destinatario: string;
    contenido: unknown;
    cliente: PoolClient;
  }): Promise<void> {
    await datos.cliente.query(
      `INSERT INTO notificacion_enviada
         (tenant_id, canal, destinatario, contenido, estado)
       VALUES ($1, $2, $3, $4, 'PROCESADA')`,
      [
        datos.tenantId,
        'CORREO',
        datos.destinatario,
        JSON.stringify(datos.contenido ?? {}),
      ],
    );
  }
}
