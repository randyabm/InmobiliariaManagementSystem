import { Module } from '@nestjs/common';

import { AlmacenamientoService } from './almacenamiento.service';

/**
 * Object storage compartido (feature #6, PA-6-1).
 *
 * Vive en `core/` porque lo consumirán módulos de los tres dominios: fotos
 * de propiedad (#6), fotos de inventario (#12) y contratos digitalizados
 * (#18). Se exporta el servicio; nadie toca MinIO fuera de este módulo.
 */
@Module({
  providers: [AlmacenamientoService],
  exports: [AlmacenamientoService],
})
export class AlmacenamientoModule {}
