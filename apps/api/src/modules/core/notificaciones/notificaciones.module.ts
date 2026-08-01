import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ClientesModule } from '../clientes/clientes.module';
import { NotificacionesController } from './notificaciones.controller';
import { NotificacionesOutboxService } from './notificaciones-outbox.service';
import { NotificacionesProcesadorService } from './notificaciones-procesador.service';
import { ProveedorRegistro } from './proveedor-registro';
import { ResolverDestinatarioService } from './resolver-destinatario.service';

/**
 * Motor de notificaciones (feature #10, RF-N1/N2/RF-W3).
 *
 * - `NotificacionesOutboxService`: el gancho transaccional que el motor #7
 *   consume (PA-10-4) y el envío manual.
 * - `NotificacionesProcesadorService`: despacha el outbox y los
 *   recordatorios vencidos (R3, R12).
 * - `ResolverDestinatarioService` + `ProveedorRegistro`: destinatarios
 *   (R7) y la interfaz de proveedores (R5) con su implementación MVP.
 *
 * `WorkflowsModule` importa este módulo (el gancho); este módulo importa
 * `ClientesModule` para resolver los perfiles. Sin circularidad.
 */
@Module({
  imports: [ClientesModule, AuditModule],
  controllers: [NotificacionesController],
  providers: [
    NotificacionesOutboxService,
    NotificacionesProcesadorService,
    ResolverDestinatarioService,
    ProveedorRegistro,
  ],
  exports: [NotificacionesOutboxService],
})
export class NotificacionesModule {}
