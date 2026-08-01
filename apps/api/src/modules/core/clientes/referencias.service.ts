import { Injectable } from '@nestjs/common';
import type { ReferenciaInquilino } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import type { ActualizarReferenciaDto } from './dto/actualizar-referencia.dto';
import type { CrearReferenciaDto } from './dto/crear-referencia.dto';
import { InquilinosRepository } from './inquilinos.repository';
import { ReferenciasRepository } from './referencias.repository';

/**
 * Referencias personales del inquilino (RF-C4, D-6).
 *
 * Mismas fronteras que los codeudores: captura de datos sin exigencias de
 * contrato o firma (R17), sin FK hacia contrato, firma, inventario u OTP
 * (R18), y el inquilino de la ruta inexistente o ajeno → 404 indistinguible
 * (R19).
 */
@Injectable()
export class ReferenciasService {
  constructor(
    private readonly repositorio: ReferenciasRepository,
    private readonly inquilinos: InquilinosRepository,
  ) {}

  /** **R15**, R17. */
  async crear(
    perfilInquilinoId: string,
    dto: CrearReferenciaDto,
    ctx: ContextoPeticion,
  ): Promise<ReferenciaInquilino> {
    await this.exigirInquilino(perfilInquilinoId, ctx);

    return this.repositorio.insertar(ctx, {
      perfilInquilinoId,
      nombre: dto.nombre,
      telefono: dto.telefono,
      relacion: dto.relacion ?? null,
      email: dto.email ?? null,
    });
  }

  /** **R16** — solo activas. */
  async listar(
    perfilInquilinoId: string,
    ctx: ContextoPeticion,
  ): Promise<ReferenciaInquilino[]> {
    await this.exigirInquilino(perfilInquilinoId, ctx);
    return this.repositorio.listar(ctx, perfilInquilinoId);
  }

  /** **R16** — PATCH parcial. */
  async actualizar(
    id: string,
    dto: ActualizarReferenciaDto,
    ctx: ContextoPeticion,
  ): Promise<ReferenciaInquilino> {
    const afectadas = await this.repositorio.actualizar(ctx, id, {
      ...(dto.nombre !== undefined ? { nombre: dto.nombre } : {}),
      ...(dto.telefono !== undefined ? { telefono: dto.telefono } : {}),
      ...(dto.relacion !== undefined ? { relacion: dto.relacion } : {}),
      ...(dto.email !== undefined ? { email: dto.email } : {}),
    });

    if (afectadas === 0) {
      throw new ResourceNotFoundError();
    }

    const actualizada = await this.repositorio.buscarPorId(ctx, id);
    if (!actualizada) {
      throw new ResourceNotFoundError();
    }
    return actualizada;
  }

  /** **R16** — baja lógica: la fila queda con `activo = false`. */
  async darDeBaja(id: string, ctx: ContextoPeticion): Promise<void> {
    const afectadas = await this.repositorio.marcarInactiva(ctx, id);
    if (afectadas === 0) {
      throw new ResourceNotFoundError();
    }
  }

  private async exigirInquilino(
    perfilInquilinoId: string,
    ctx: ContextoPeticion,
  ): Promise<void> {
    const inquilino = await this.inquilinos.buscarPorId(ctx, perfilInquilinoId);
    if (!inquilino) {
      throw new ResourceNotFoundError();
    }
  }
}
