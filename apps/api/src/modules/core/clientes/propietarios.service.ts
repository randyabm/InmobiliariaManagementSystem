import { Injectable } from '@nestjs/common';
import type {
  HojaDeVidaPropietario,
  PerfilPropietario,
  TipoDocumento,
} from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import { CuentasBancariasRepository } from './cuentas-bancarias.repository';
import type {
  ActualizarPropietarioDto,
  CrearPropietarioDto,
} from './dto/propietario.dto';
import { PerfilYaExisteError } from './errors';
import { IdentidadService, normalizarEmail } from './identidad.service';
import { PropietariosRepository } from './propietarios.repository';

/**
 * Hoja de vida del propietario (RF-C5, RF-C1, RF-C6).
 *
 * **Frontera con la feature #25 (R17, D-2):** aquí `sujeto_retencion` se
 * captura y se devuelve, y nada más. Esta clase no calcula, resuelve ni aplica
 * ningún porcentaje de retención en la fuente; la tarifa por tenant y año es
 * alcance de #25.
 *
 * **Frontera con la feature #6 (R12, D-1):** la hoja de vida no expone la
 * lista de propiedades, ni siquiera como array vacío reservado. La entidad
 * `Propiedad` no existe todavía y un campo reservado sería API muerta.
 */
@Injectable()
export class PropietariosService {
  constructor(
    private readonly repositorio: PropietariosRepository,
    private readonly cuentas: CuentasBancariasRepository,
    private readonly identidad: IdentidadService,
  ) {}

  /**
   * Crea el propietario (**R10**, **R16**, **R22**, **R24**, **R25**, **R26**).
   *
   * La identidad (`user`), el rol del tenant (`user_role`) y el perfil se
   * escriben en **una sola transacción** —la que abrió el
   * `TenantContextInterceptor`—, de modo que un fallo parcial no deja ninguna
   * de las tres filas persistida (**R22**).
   */
  async crear(
    dto: CrearPropietarioDto,
    ctx: ContextoPeticion,
  ): Promise<PerfilPropietario> {
    // D-4: sin upsert. Se comprueba y se rechaza con 409 explícito (R24).
    await this.rechazarSiDocumentoRepetido(ctx, dto.tipo_documento, dto.documento);

    const { userId } = await this.identidad.crearIdentidad(
      ctx.cliente,
      {
        nombre: dto.nombre,
        email: normalizarEmail(dto.email),
        telefono: dto.telefono ?? null,
      },
      ctx.tenantId,
      'propietario',
    );

    try {
      return await this.repositorio.insertar(ctx, {
        userId,
        tipoDocumento: dto.tipo_documento,
        documento: dto.documento,
        direccionNotificacion: dto.direccion_notificacion ?? null,
        ciudad: dto.ciudad ?? null,
        sujetoRetencion: dto.sujeto_retencion ?? false,
      });
    } catch (error) {
      // Carrera entre la comprobación previa y el INSERT: la restricción
      // UNIQUE del tenant es la que manda, y el cliente ve el mismo 409.
      if (esViolacionDeUnicidad(error)) {
        throw new PerfilYaExisteError();
      }
      throw error;
    }
  }

  /**
   * Hoja de vida completa (**R12**).
   *
   * Devuelve datos personales, `sujeto_retencion`, las cuentas bancarias
   * activas y cuál es la predeterminada. **Sin** `propiedades` (D-1), **sin**
   * certificados fiscales (D-3) y **sin** ningún porcentaje de retención
   * (R17, D-2).
   */
  async obtener(id: string, ctx: ContextoPeticion): Promise<HojaDeVidaPropietario> {
    const perfil = await this.exigirPerfil(id, ctx);
    const cuentasBancarias = await this.cuentas.listarActivas(ctx, perfil.id);
    const predeterminada = cuentasBancarias.find((c) => c.es_predeterminada);

    return {
      ...perfil,
      cuentas_bancarias: cuentasBancarias,
      cuenta_predeterminada_id: predeterminada?.id ?? null,
    };
  }

  /** Búsqueda previa por documento, solo dentro del tenant (**R23**, D-4). */
  async buscarPorDocumento(
    tipo: TipoDocumento,
    documento: string,
    ctx: ContextoPeticion,
  ): Promise<PerfilPropietario[]> {
    return this.repositorio.buscarPorDocumento(ctx, tipo, documento);
  }

  /** PATCH parcial (**R13**, **R16**). */
  async actualizar(
    id: string,
    dto: ActualizarPropietarioDto,
    ctx: ContextoPeticion,
  ): Promise<PerfilPropietario> {
    const perfil = await this.exigirPerfil(id, ctx);

    await this.repositorio.actualizar(ctx, id, {
      ...('direccion_notificacion' in dto
        ? { direccionNotificacion: dto.direccion_notificacion ?? null }
        : {}),
      ...('ciudad' in dto ? { ciudad: dto.ciudad ?? null } : {}),
      ...(dto.sujeto_retencion !== undefined
        ? { sujetoRetencion: dto.sujeto_retencion }
        : {}),
    });

    const identidadesEscritas = await this.repositorio.actualizarContacto(
      ctx,
      perfil.user_id,
      {
        ...(dto.nombre !== undefined ? { nombre: dto.nombre } : {}),
        ...('email' in dto ? { email: normalizarEmail(dto.email) } : {}),
        ...('telefono' in dto ? { telefono: dto.telefono ?? null } : {}),
      },
    );
    exigirIdentidadDelTenant(identidadesEscritas);

    return this.exigirPerfil(id, ctx);
  }

  /** Baja lógica (**R14**). */
  async darDeBaja(id: string, ctx: ContextoPeticion): Promise<void> {
    await this.exigirPerfil(id, ctx);
    await this.repositorio.marcarInactivo(ctx, id);
  }

  /**
   * 404 —no 403— cuando el perfil no existe **o es de otro tenant**
   * (**R31**, `docs/conventions.md`): no se confirma la existencia de
   * recursos ajenos.
   */
  private async exigirPerfil(
    id: string,
    ctx: ContextoPeticion,
  ): Promise<PerfilPropietario> {
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

/**
 * Traduce el resultado de `actualizarContacto` a la respuesta HTTP (**T51**,
 * **R38**, **R31**).
 *
 * - `null` → no había contacto que escribir (el PATCH solo tocaba el perfil).
 * - `0` → la sentencia no encontró ninguna identidad **de este tenant** con
 *   ese `id`. Se responde **404**, igual que ante cualquier recurso ajeno:
 *   confirmar que la identidad existe en otra inmobiliaria sería la fuga que
 *   `docs/conventions.md` y R31 prohíben.
 *
 * **No** existe `IdentidadCompartidaNoEditableError`: R39 quedó eliminado por
 * **D-8** (las identidades nunca se comparten entre inmobiliarias), así que un
 * 409 sería código muerto que nada puede disparar.
 */
export function exigirIdentidadDelTenant(filasAfectadas: number | null): void {
  if (filasAfectadas === 0) {
    throw new ResourceNotFoundError();
  }
}

/** `23505` = unique_violation en PostgreSQL. */
export function esViolacionDeUnicidad(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '23505'
  );
}
