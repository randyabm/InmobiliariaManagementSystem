import { Injectable } from '@nestjs/common';
import type { TarifaRetencion } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import { TarifaRetencionNoConfiguradaError } from './errors/tarifa-retencion-no-configurada.error';
import { RetencionRepository } from './retencion.repository';

export interface ResolucionRetencion {
  readonly aplica: boolean;
  readonly porcentaje: string | null;
}

/**
 * Tarifa de retención en la fuente por tenant y año (**D-2**).
 *
 * Resuelve **cuánto por ciento aplica** (R8, R9, R10). No calcula dinero:
 * aplicar el porcentaje a un canon concreto pertenece al módulo de
 * pagos/contable (design.md §6). Punto único de verdad: `tarifa_retencion`.
 *
 * `porcentaje` viaja como `string` en toda frontera pública (**R11**).
 */
@Injectable()
export class RetencionService {
  constructor(private readonly repositorio: RetencionRepository) {}

  /** **R6** — registrar o reemplazar la tarifa de ESTE tenant para ese año. */
  establecer(
    anio: number,
    porcentaje: string,
    ctx: ContextoPeticion,
  ): Promise<TarifaRetencion> {
    return this.repositorio.establecer(ctx, anio, porcentaje);
  }

  /** **R7** — las tarifas del tenant de la petición, año descendente. */
  listar(ctx: ContextoPeticion): Promise<TarifaRetencion[]> {
    return this.repositorio.listar(ctx);
  }

  /**
   * **R8**, R9 — el porcentaje del año indicado para el tenant de la petición.
   *
   * Lanza `TarifaRetencionNoConfiguradaError` (409) si el año no está
   * configurado: **jamás** asume un valor por defecto, porque un cálculo
   * silenciosamente incorrecto es peor que uno que se detiene.
   */
  async resolverPorcentaje(anio: number, ctx: ContextoPeticion): Promise<string> {
    const tarifa = await this.repositorio.buscarPorAnio(ctx, anio);
    if (!tarifa) {
      throw new TarifaRetencionNoConfiguradaError();
    }
    return tarifa.porcentaje;
  }

  /**
   * **R10** — la retención aplicable a un propietario concreto.
   *
   * - `sujeto_retencion = false` → `{ aplica: false, porcentaje: null }` **sin
   *   consultar `tarifa_retencion`** (verificado con espía en T13).
   * - `sujeto_retencion = true` → resuelve la tarifa del año (R8, R9).
   * - El propietario no existe o es de otro tenant → 404 indistinguible (R19).
   */
  async resolverRetencionDePropietario(
    perfilPropietarioId: string,
    anio: number,
    ctx: ContextoPeticion,
  ): Promise<ResolucionRetencion> {
    const sujeto = await this.repositorio.sujetoDeRetencion(ctx, perfilPropietarioId);
    if (sujeto === null) {
      throw new ResourceNotFoundError();
    }
    if (!sujeto) {
      return { aplica: false, porcentaje: null };
    }
    const porcentaje = await this.resolverPorcentaje(anio, ctx);
    return { aplica: true, porcentaje };
  }
}
