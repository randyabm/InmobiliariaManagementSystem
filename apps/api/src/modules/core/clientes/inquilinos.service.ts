import { Injectable } from '@nestjs/common';
import type { PerfilInquilino, TipoDocumento } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import type {
  ActualizarInquilinoDto,
  CrearInquilinoDto,
} from './dto/inquilino.dto';
import { PerfilYaExisteError } from './errors';
import { IdentidadService, normalizarEmail } from './identidad.service';
import { InquilinosRepository } from './inquilinos.repository';
import {
  esViolacionDeUnicidad,
  exigirIdentidadDelTenant,
} from './propietarios.service';

/**
 * Hoja de vida del inquilino (RF-C4, RF-C1, RF-C6).
 *
 * Mismo patrón que `PropietariosService`: creación atómica de identidad, rol y
 * perfil (**R22**), 409 `PERFIL_YA_EXISTE` por documento repetido en el tenant
 * (**R24**, D-4) y baja lógica (**R21**).
 *
 * **Frontera con la feature #25 (D-6):** los codeudores, coarrendatarios y
 * referencias del inquilino NO se implementan aquí. Esta feature no crea sus
 * tablas ni sus rutas.
 */
@Injectable()
export class InquilinosService {
  constructor(
    private readonly repositorio: InquilinosRepository,
    private readonly identidad: IdentidadService,
  ) {}

  /** **R18**, R22, R24, R25. */
  async crear(
    dto: CrearInquilinoDto,
    ctx: ContextoPeticion,
  ): Promise<PerfilInquilino> {
    await this.rechazarSiDocumentoRepetido(ctx, dto.tipo_documento, dto.documento);

    // D-9 (R71): la identidad se crea SIN correo; el de contacto va al perfil.
    const { userId } = await this.identidad.crearIdentidad(
      ctx.cliente,
      { nombre: dto.nombre },
      ctx.tenantId,
      'inquilino',
    );

    try {
      return await this.repositorio.insertar(ctx, {
        userId,
        tipoDocumento: dto.tipo_documento,
        documento: dto.documento,
        emailContacto: normalizarEmail(dto.email)!,
        celular: dto.celular,
        medioPreferidoContacto: dto.medio_preferido_contacto,
      });
    } catch (error) {
      if (esViolacionDeUnicidad(error)) {
        throw new PerfilYaExisteError();
      }
      throw error;
    }
  }

  async obtener(id: string, ctx: ContextoPeticion): Promise<PerfilInquilino> {
    return this.exigirPerfil(id, ctx);
  }

  /** **R23**, D-4. */
  async buscarPorDocumento(
    tipo: TipoDocumento,
    documento: string,
    ctx: ContextoPeticion,
  ): Promise<PerfilInquilino[]> {
    return this.repositorio.buscarPorDocumento(ctx, tipo, documento);
  }

  /** **R20** — PATCH parcial, incluido `medio_preferido_contacto`. */
  async actualizar(
    id: string,
    dto: ActualizarInquilinoDto,
    ctx: ContextoPeticion,
  ): Promise<PerfilInquilino> {
    const perfil = await this.exigirPerfil(id, ctx);

    await this.repositorio.actualizar(ctx, id, {
      // D-9 (R69): el correo del inquilino vive en el perfil.
      ...(dto.email !== undefined
        ? { emailContacto: normalizarEmail(dto.email)! }
        : {}),
      ...(dto.celular !== undefined ? { celular: dto.celular } : {}),
      ...(dto.medio_preferido_contacto !== undefined
        ? { medioPreferidoContacto: dto.medio_preferido_contacto }
        : {}),
    });

    // T51/R38: "0 filas afectadas" significa que esa identidad no es de este
    // tenant → 404, sin confirmar que exista en otra inmobiliaria (R31).
    const identidadesEscritas = await this.repositorio.actualizarContacto(
      ctx,
      perfil.user_id,
      { ...(dto.nombre !== undefined ? { nombre: dto.nombre } : {}) },
    );
    exigirIdentidadDelTenant(identidadesEscritas);

    return this.exigirPerfil(id, ctx);
  }

  /** **R21** — baja lógica. */
  async darDeBaja(id: string, ctx: ContextoPeticion): Promise<void> {
    await this.exigirPerfil(id, ctx);
    await this.repositorio.marcarInactivo(ctx, id);
  }

  /** 404 —no 403— también para el recurso de otro tenant (**R31**). */
  private async exigirPerfil(
    id: string,
    ctx: ContextoPeticion,
  ): Promise<PerfilInquilino> {
    const perfil = await this.repositorio.buscarPorId(ctx, id);
    if (!perfil) {
      throw new ResourceNotFoundError();
    }
    return perfil;
  }

  private async rechazarSiDocumentoRepetido(
    ctx: ContextoPeticion,
    tipo: TipoDocumento,
    documento: string,
  ): Promise<void> {
    const existentes = await this.repositorio.buscarPorDocumento(ctx, tipo, documento);
    if (existentes.length > 0) {
      throw new PerfilYaExisteError();
    }
  }
}
