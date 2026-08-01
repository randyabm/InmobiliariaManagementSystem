import { Injectable } from '@nestjs/common';
import type { CodeudorInquilino } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import { CodeudoresRepository } from './codeudores.repository';
import type { ActualizarCodeudorDto } from './dto/actualizar-codeudor.dto';
import type { CrearCodeudorDto } from './dto/crear-codeudor.dto';
import { CodeudorYaExisteError } from './errors/codeudor-ya-existe.error';
import { InquilinosRepository } from './inquilinos.repository';
import { esViolacionDeUnicidad } from './propietarios.service';

/**
 * Codeudores y coarrendatarios del inquilino (RF-C4, D-6).
 *
 * Es **captura de datos** de la hoja de vida: no exige contrato ni firma
 * (R17) y no hay ninguna FK hacia entidades de contrato, firma, inventario u
 * OTP (R18, verificada en T21). El amarre codeudor ↔ firmante lo añadirán
 * #14/#17 desde la tabla de firmas.
 *
 * El inquilino de la ruta se exige primero: si no existe o es de otro tenant
 * → 404 indistinguible (R19). El documento repetido dentro del mismo
 * inquilino → 409 `CODEUDOR_YA_EXISTE` (R14).
 */
@Injectable()
export class CodeudoresService {
  constructor(
    private readonly repositorio: CodeudoresRepository,
    private readonly inquilinos: InquilinosRepository,
  ) {}

  /** **R12**, R14, R17. */
  async crear(
    perfilInquilinoId: string,
    dto: CrearCodeudorDto,
    ctx: ContextoPeticion,
  ): Promise<CodeudorInquilino> {
    await this.exigirInquilino(perfilInquilinoId, ctx);

    try {
      return await this.repositorio.insertar(ctx, {
        perfilInquilinoId,
        tipo: dto.tipo,
        nombre: dto.nombre,
        tipoDocumento: dto.tipo_documento,
        documento: dto.documento,
        email: dto.email ?? null,
        celular: dto.celular ?? null,
      });
    } catch (error) {
      if (esViolacionDeUnicidad(error)) {
        throw new CodeudorYaExisteError();
      }
      throw error;
    }
  }

  /** **R13** — solo activos. */
  async listar(
    perfilInquilinoId: string,
    ctx: ContextoPeticion,
  ): Promise<CodeudorInquilino[]> {
    await this.exigirInquilino(perfilInquilinoId, ctx);
    return this.repositorio.listar(ctx, perfilInquilinoId);
  }

  /** **R13** — PATCH parcial. */
  async actualizar(
    id: string,
    dto: ActualizarCodeudorDto,
    ctx: ContextoPeticion,
  ): Promise<CodeudorInquilino> {
    const afectadas = await this.repositorio.actualizar(ctx, id, {
      ...(dto.tipo !== undefined ? { tipo: dto.tipo } : {}),
      ...(dto.nombre !== undefined ? { nombre: dto.nombre } : {}),
      ...(dto.email !== undefined ? { email: dto.email } : {}),
      ...(dto.celular !== undefined ? { celular: dto.celular } : {}),
    });

    // "0 filas afectadas" = inexistente o de otro tenant → 404, sin revelar
    // cuál (R19).
    if (afectadas === 0) {
      throw new ResourceNotFoundError();
    }

    const actualizado = await this.repositorio.buscarPorId(ctx, id);
    if (!actualizado) {
      throw new ResourceNotFoundError();
    }
    return actualizado;
  }

  /** **R13** — baja lógica: la fila queda con `activo = false`. */
  async darDeBaja(id: string, ctx: ContextoPeticion): Promise<void> {
    const afectadas = await this.repositorio.marcarInactivo(ctx, id);
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
