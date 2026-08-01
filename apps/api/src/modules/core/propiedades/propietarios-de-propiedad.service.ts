import { Injectable } from '@nestjs/common';
import type { PropiedadPropietario } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import { PropietariosService } from '../clientes/propietarios.service';
import { PropietarioPrincipalNoRemovibleError } from './errors/propietario-principal-no-removible.error';
import { PropiedadesService } from './propiedades.service';
import { PropietariosDePropiedadRepository } from './propietarios-de-propiedad.repository';

/**
 * Propietarios adicionales de la propiedad (RF-P2, R10).
 *
 * El **principal** se exige con 404 si no existe o es de otro tenant (R14) y
 * NO puede removerse (409): es contra quien se resuelve la cuenta de giro
 * (R8). Los adicionales se dan de baja lógicamente.
 */
@Injectable()
export class PropietariosDePropiedadService {
  constructor(
    private readonly repositorio: PropietariosDePropiedadRepository,
    private readonly propiedades: PropiedadesService,
    private readonly propietarios: PropietariosService,
  ) {}

  /** R10 — asociar un propietario adicional. */
  async anadir(
    propiedadId: string,
    perfilPropietarioId: string,
    ctx: ContextoPeticion,
  ): Promise<PropiedadPropietario> {
    const propiedad = await this.propiedades.exigir(propiedadId, ctx);

    if (perfilPropietarioId === propiedad.propietario_principal_id) {
      // El principal ya está asociado por definición: duplicarlo sería un
      // estado contradictorio (R1 + R2).
      throw new PropietarioPrincipalNoRemovibleError(
        'El propietario principal ya está asociado a la propiedad.',
      );
    }

    // 404 —no 403— si el perfil no existe o es de otro tenant (R14).
    await this.propietarios.obtener(perfilPropietarioId, ctx);

    const existente = await this.repositorio.buscarActiva(
      ctx,
      propiedadId,
      perfilPropietarioId,
    );
    if (existente) {
      // Idempotente: ya está asociado y activo.
      return existente;
    }

    return this.repositorio.insertar(ctx, {
      propiedadId,
      perfilPropietarioId,
    });
  }

  /** R10 — remover un propietario adicional (baja lógica). */
  async remover(
    propiedadId: string,
    idAsociacion: string,
    ctx: ContextoPeticion,
  ): Promise<void> {
    const propiedad = await this.propiedades.exigir(propiedadId, ctx);

    // `:idPropietario` de la ruta es el id de la FILA de la puente, no el del
    // perfil (design.md §6, tabla de rutas).
    const asociacion = await this.repositorio.buscarPorId(ctx, idAsociacion);
    if (!asociacion || !asociacion.activo || asociacion.propiedad_id !== propiedadId) {
      throw new ResourceNotFoundError();
    }

    // El principal nunca tiene fila en la puente (se validó en `anadir`).
    // Doble barrera: si un id llegara a referenciar al principal (estado
    // imposible por R1), el servicio lo bloquea con 409.
    if (asociacion.perfil_propietario_id === propiedad.propietario_principal_id) {
      throw new PropietarioPrincipalNoRemovibleError();
    }

    await this.repositorio.marcarInactiva(ctx, idAsociacion);
  }
}
