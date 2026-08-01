import { Module } from '@nestjs/common';

import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module';
import { AuditModule } from '../audit/audit.module';
import { ClientesModule } from '../clientes/clientes.module';
import { PropiedadesController } from './propiedades.controller';
import { PropiedadesRepository } from './propiedades.repository';
import { PropiedadesService } from './propiedades.service';

/**
 * Hoja de vida del inmueble (feature #6).
 *
 * Depende de `core/clientes` (perfiles, cuentas de giro) y de
 * `core/almacenamiento` (fotos y documentos). Ambas son dependencias
 * legales: `core/clientes` no depende de ningún módulo y `core/almacenamiento`
 * es un servicio compartido de `core/`.
 *
 * Los submódulos de la feature (propietarios adicionales, ocupación,
 * documentos, fotos) se registran en sus respectivas tasks del bloque 4.
 */
@Module({
  imports: [ClientesModule, AlmacenamientoModule, AuditModule],
  controllers: [PropiedadesController],
  providers: [PropiedadesRepository, PropiedadesService],
  exports: [PropiedadesService],
})
export class PropiedadesModule {}
