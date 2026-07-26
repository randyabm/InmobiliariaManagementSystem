import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

/**
 * Valida el cuerpo (o la query) en el **borde** con zod
 * (`docs/architecture.md`: el controller valida la entrada y no tiene lógica
 * de negocio).
 *
 * El detalle del fallo NO viaja al cliente: `AllExceptionsFilter` traduce todo
 * 400 a "La solicitud no es válida." Un mensaje de zod podría citar el valor
 * rechazado, que en estos DTOs incluye documentos y celulares (Ley 1581 de
 * 2012, **R36**).
 */
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly esquema: T) {}

  transform(valor: unknown): z.infer<T> {
    const resultado = this.esquema.safeParse(valor);
    if (!resultado.success) {
      throw new BadRequestException('La solicitud no es válida.');
    }
    return resultado.data;
  }
}
