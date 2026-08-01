import { Injectable } from '@nestjs/common';
import type { Propiedad } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { AppError } from '../../../common/errors';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';
import { PropiedadesRepository } from './propiedades.repository';
import { PropiedadesService } from './propiedades.service';

/**
 * La clave no pertenece a esta propiedad (R17).
 */
export class FotoNoPerteneceError extends AppError {
  readonly code = 'FOTO_NO_PERTENECE_A_LA_PROPIEDAD';
  readonly httpStatus = 400;

  constructor(message = 'La foto no pertenece a esta propiedad.') {
    super(message);
  }
}

/**
 * Fotos de la propiedad (RF-P1, R17).
 *
 * Las claves viven en `propiedad.fotos` (text[]); el binario, en object
 * storage. Añadir = subir y anexar la clave; quitar = retirar la clave del
 * array (el objeto se puede conservar: la auditoría de quién subió qué no
 * depende del array actual).
 */
@Injectable()
export class FotosService {
  constructor(
    private readonly propiedades: PropiedadesService,
    private readonly repositorio: PropiedadesRepository,
    private readonly almacenamiento: AlmacenamientoService,
  ) {}

  /** R17 — subir una foto y anexar su clave al array. */
  async subir(propiedadId: string, binario: Buffer, mime: string, ctx: ContextoPeticion): Promise<Propiedad> {
    await this.propiedades.exigir(propiedadId, ctx);

    const { clave } = await this.almacenamiento.subir(binario, mime);

    await ctx.cliente.query(
      `UPDATE propiedad SET fotos = array_append(fotos, $2), updated_at = now()
        WHERE id = $1 AND tenant_id = $3`,
      [propiedadId, clave, ctx.tenantId],
    );

    return this.propiedades.exigir(propiedadId, ctx);
  }

  /** R17 — quitar una clave del array; clave ajena → 400. */
  async quitar(propiedadId: string, clave: string, ctx: ContextoPeticion): Promise<Propiedad> {
    const propiedad = await this.propiedades.exigir(propiedadId, ctx);

    if (!propiedad.fotos.includes(clave)) {
      throw new FotoNoPerteneceError();
    }

    await ctx.cliente.query(
      `UPDATE propiedad
          SET fotos = array_remove(fotos, $2), updated_at = now()
        WHERE id = $1 AND tenant_id = $3`,
      [propiedadId, clave, ctx.tenantId],
    );

    return this.propiedades.exigir(propiedadId, ctx);
  }
}
