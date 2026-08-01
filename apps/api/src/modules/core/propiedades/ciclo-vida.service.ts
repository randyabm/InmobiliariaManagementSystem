import { Injectable } from '@nestjs/common';
import type { CicloVidaDePropiedad } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import { WorkflowService } from '../workflows/workflow.service';
import { TransicionNoDisponibleError } from '../workflows/errors';
import { PropiedadesRepository } from './propiedades.repository';
import { PropiedadesService } from './propiedades.service';

/**
 * Ciclo de vida de la propiedad (feature #8, RF-P4/RF-PI6).
 *
 * Es la capa de NEGOCIO sobre el motor (#7): valida la propiedad (404 si
 * ajena/inexistente), resuelve la instancia y las transiciones por `clave`
 * estable, y delega la ejecución en `WorkflowService` — el motor sigue
 * genérico (RF-A4) y aquí no se duplica ninguna validación de la máquina.
 */
@Injectable()
export class CicloVidaService {
  constructor(
    private readonly propiedades: PropiedadesService,
    private readonly repositorio: PropiedadesRepository,
    private readonly workflow: WorkflowService,
  ) {}

  /** R4 — estado actual + transiciones humanas disponibles para el actor. */
  async consultar(
    propiedadId: string,
    actorId: string,
    ctx: ContextoPeticion,
  ): Promise<CicloVidaDePropiedad> {
    const propiedad = await this.propiedades.exigir(propiedadId, ctx);
    const instancia = await this.resolverInstancia(propiedad.id, ctx);

    const { instancia: _i, transiciones_disponibles } =
      await this.workflow.consultarInstancia(instancia.id, actorId, ctx);

    const estado = await this.repositorio.estadoCicloVida(ctx, propiedad.id);
    if (!estado) {
      throw new ResourceNotFoundError();
    }

    return { estado, transiciones_disponibles };
  }

  /** R5 — ejecutar la acción del estado por su clave estable. */
  async ejecutar(
    propiedadId: string,
    claveTransicion: string,
    contexto: Record<string, unknown>,
    actorId: string,
    ctx: ContextoPeticion,
  ): Promise<{ propiedad_id: string; instancia: { id: string } }> {
    const propiedad = await this.propiedades.exigir(propiedadId, ctx);
    const instancia = await this.resolverInstancia(propiedad.id, ctx);

    // Resuelve la transición por clave dentro de la definición de la
    // instancia; 409 indistinguible si no existe o no es humana (R5).
    const transiciones = await this.workflow.transicionesDeDefinicion(
      instancia.definicion_id,
      ctx,
    );
    const transicion = transiciones.find(
      (t) => t.clave === claveTransicion && t.tipo_ejecucion === 'HUMANA',
    );
    if (!transicion) {
      throw new TransicionNoDisponibleError();
    }

    const resultado = await this.workflow.ejecutarTransicion(
      instancia.id,
      transicion.id,
      contexto,
      actorId,
      ctx,
    );

    // `propiedad_id` acompaña a la instancia para que el @Audit del borde
    // registre `entity_id` = id de la PROPIEDAD (R7), no el de la máquina.
    return { propiedad_id: propiedad.id, instancia: resultado };
  }

  /** La instancia del motor para la propiedad; 404 si aún no existe. */
  private async resolverInstancia(
    propiedadId: string,
    ctx: ContextoPeticion,
  ): Promise<{ id: string; definicion_id: string }> {
    const instancia = await this.workflow.buscarInstanciaDeEntidad(
      'propiedad',
      propiedadId,
      ctx,
    );
    if (!instancia) {
      // Caso dev/pre-backfill: la propiedad no tiene máquina.
      throw new ResourceNotFoundError();
    }
    return instancia;
  }
}
