import { Injectable } from '@nestjs/common';
import type { CuentaBancaria } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import { CuentasBancariasRepository } from './cuentas-bancarias.repository';
import type { CrearCuentaBancariaDto } from './dto/cuenta-bancaria.dto';
import { CuentaDeGiroInvalidaError } from './errors';
import { PropietariosRepository } from './propietarios.repository';

/**
 * Cuentas de giro del canon (RF-C5, RF-P1).
 *
 * Aquí vive el **punto de extensión hacia la feature #6** (design.md §6): la
 * cuenta por defecto es del propietario y la regla de precedencia
 * (`resolverCuentaDeGiro`) ya está escrita y probada, aunque la entidad
 * `Propiedad` que aportará el override todavía no exista.
 */
@Injectable()
export class CuentasBancariasService {
  constructor(
    private readonly repositorio: CuentasBancariasRepository,
    private readonly propietarios: PropietariosRepository,
  ) {}

  /**
   * Registra una cuenta del propietario (**R11**).
   *
   * La **primera** cuenta activa queda automáticamente como predeterminada:
   * un propietario con una sola cuenta y ninguna marcada dejaría el giro del
   * canon irresoluble (R30). El índice único parcial impide que haya dos.
   */
  async crear(
    perfilPropietarioId: string,
    dto: CrearCuentaBancariaDto,
    ctx: ContextoPeticion,
  ): Promise<CuentaBancaria> {
    await this.exigirPropietario(perfilPropietarioId, ctx);

    const yaTienePredeterminada =
      (await this.repositorio.buscarPredeterminada(ctx, perfilPropietarioId)) !== null;

    return this.repositorio.insertar(
      ctx,
      perfilPropietarioId,
      {
        banco: dto.banco,
        tipoCuenta: dto.tipo_cuenta,
        numeroCuenta: dto.numero_cuenta,
        titularNombre: dto.titular_nombre,
        titularTipoDocumento: dto.titular_tipo_documento,
        titularDocumento: dto.titular_documento,
      },
      !yaTienePredeterminada,
    );
  }

  /** **R12** — cuentas activas del propietario. */
  async listar(
    perfilPropietarioId: string,
    ctx: ContextoPeticion,
  ): Promise<CuentaBancaria[]> {
    await this.exigirPropietario(perfilPropietarioId, ctx);
    return this.repositorio.listarActivas(ctx, perfilPropietarioId);
  }

  /**
   * Cambia la cuenta predeterminada (**R15**).
   *
   * Las dos escrituras (quitar la marca a la anterior y ponerla en la nueva)
   * ocurren en **una sola transacción**: la de la petición. Si se hicieran por
   * separado, un fallo entre medias dejaría al propietario con cero cuentas
   * predeterminadas —giro irresoluble— o el índice único parcial abortaría el
   * segundo UPDATE.
   */
  async actualizar(
    perfilPropietarioId: string,
    idCuenta: string,
    ctx: ContextoPeticion,
  ): Promise<CuentaBancaria> {
    await this.exigirPropietario(perfilPropietarioId, ctx);
    const cuenta = await this.exigirCuentaDelPropietario(
      perfilPropietarioId,
      idCuenta,
      ctx,
    );

    await this.repositorio.desmarcarPredeterminadas(ctx, perfilPropietarioId);
    await this.repositorio.marcarPredeterminada(ctx, cuenta.id);

    const actualizada = await this.repositorio.buscarPorId(ctx, cuenta.id);
    if (!actualizada) throw new ResourceNotFoundError();
    return actualizada;
  }

  /**
   * Regla de precedencia de la cuenta de giro (**R27**–**R30**).
   *
   * El override gana sobre la cuenta por defecto; sin override se usa la
   * predeterminada; si el override es ajeno o no hay ninguna cuenta
   * resoluble, **lanza**. Nunca devuelve `null` ni una cuenta arbitraria: un
   * giro del canon a la cuenta equivocada es dinero enviado a otra persona.
   *
   * `cuentaOverrideId` es el punto de extensión de la feature #6, que aportará
   * `propiedad.cuenta_bancaria_id` y llamará aquí con él (design.md §6). La
   * validación de pertenencia (mismo propietario **y** mismo tenant) está
   * aquí precisamente para que #6 no pueda enchufar una cuenta ajena.
   */
  async resolverCuentaDeGiro(
    perfilPropietarioId: string,
    cuentaOverrideId: string | null,
    ctx: ContextoPeticion,
  ): Promise<CuentaBancaria> {
    if (cuentaOverrideId) {
      const override = await this.repositorio.buscarPorId(ctx, cuentaOverrideId);
      // `buscarPorId` ya filtra por tenant (y el RLS también), así que una
      // cuenta de otra inmobiliaria llega aquí como `null`.
      if (!override || override.perfil_propietario_id !== perfilPropietarioId) {
        throw new CuentaDeGiroInvalidaError();
      }
      return override;
    }

    const predeterminada = await this.repositorio.buscarPredeterminada(
      ctx,
      perfilPropietarioId,
    );
    if (!predeterminada) {
      throw new CuentaDeGiroInvalidaError();
    }
    return predeterminada;
  }

  private async exigirPropietario(
    perfilPropietarioId: string,
    ctx: ContextoPeticion,
  ): Promise<void> {
    const perfil = await this.propietarios.buscarPorId(ctx, perfilPropietarioId);
    if (!perfil) {
      // 404 y no 403: no se confirma la existencia de recursos ajenos (R31).
      throw new ResourceNotFoundError();
    }
  }

  private async exigirCuentaDelPropietario(
    perfilPropietarioId: string,
    idCuenta: string,
    ctx: ContextoPeticion,
  ): Promise<CuentaBancaria> {
    const cuenta = await this.repositorio.buscarPorId(ctx, idCuenta);
    if (!cuenta || cuenta.perfil_propietario_id !== perfilPropietarioId) {
      throw new ResourceNotFoundError();
    }
    return cuenta;
  }
}
