import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { CuentaBancaria } from '@inmobiliaria/types';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CuentasBancariasService } from './cuentas-bancarias.service';
import {
  type CrearCuentaBancariaDto,
  esquemaActualizarCuentaBancaria,
  esquemaCrearCuentaBancaria,
} from './dto/cuenta-bancaria.dto';

/**
 * Cuentas de giro del canon, anidadas bajo el propietario (RF-C5, RF-P1).
 *
 * Comparte el prefijo `propietarios` con `PropietariosController` a propósito:
 * las rutas del spec son `/propietarios/:id/cuentas-bancarias` y
 * `/propietarios/:idPropietario/cuentas-bancarias/:idCuenta` (design.md §5).
 *
 * `numero_cuenta` solo lo devuelven estos endpoints y solo a `admin` y
 * `empleado` (**R32**); nunca aparece en logs ni en `audit_log` (**R36**).
 */
@Controller('propietarios')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado')
export class CuentasBancariasController {
  constructor(private readonly cuentas: CuentasBancariasService) {}

  /** **R11**, R31 — la primera cuenta queda como predeterminada. */
  @Post(':id/cuentas-bancarias')
  @Audit('crear', 'cuenta_bancaria')
  async crear(
    @Param('id') idPropietario: string,
    @Body(new ZodValidationPipe(esquemaCrearCuentaBancaria))
    dto: CrearCuentaBancariaDto,
    @Req() request: unknown,
  ): Promise<CuentaBancaria> {
    return this.cuentas.crear(idPropietario, dto, construirContextoPeticion(request));
  }

  /** **R12**, R31. */
  @Get(':id/cuentas-bancarias')
  async listar(
    @Param('id') idPropietario: string,
    @Req() request: unknown,
  ): Promise<CuentaBancaria[]> {
    return this.cuentas.listar(idPropietario, construirContextoPeticion(request));
  }

  /** **R15**, R31 — cambio de predeterminada en una sola transacción. */
  @Patch(':idPropietario/cuentas-bancarias/:idCuenta')
  @Audit('actualizar', 'cuenta_bancaria')
  async actualizar(
    @Param('idPropietario') idPropietario: string,
    @Param('idCuenta') idCuenta: string,
    @Body(new ZodValidationPipe(esquemaActualizarCuentaBancaria))
    _dto: unknown,
    @Req() request: unknown,
  ): Promise<CuentaBancaria> {
    return this.cuentas.actualizar(
      idPropietario,
      idCuenta,
      construirContextoPeticion(request),
    );
  }
}
