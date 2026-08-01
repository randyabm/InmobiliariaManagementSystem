import { Injectable } from '@nestjs/common';
import type { CuentaBancaria, Propiedad, PropiedadConExtras } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import { CuentasBancariasService } from '../clientes/cuentas-bancarias.service';
import { PropietariosService } from '../clientes/propietarios.service';
import { WorkflowService } from '../workflows/workflow.service';
import type {
  ActualizarPropiedadDto,
  CrearPropiedadDto,
} from './dto/crear-propiedad.dto';
import { PropiedadesRepository, aPropiedadConExtras } from './propiedades.repository';

/**
 * Hoja de vida del inmueble (RF-P1, RF-P2, RF-P3). Feature #6.
 *
 * ## El override de cuenta (R8, dependencia #5)
 *
 * La regla de precedencia **override → predeterminada del principal →
 * error** vive en `CuentasBancariasService.resolverCuentaDeGiro` (#5) y se
 * reutiliza sin duplicarla:
 *
 * - En `crear`/`actualizar`, como **validación**: si el override no pertenece
 *   al principal (o no es resoluble), lanza 400 `CUENTA_DE_GIRO_INVALIDA` y
 *   no se persiste nada.
 * - En `obtener`, como **lectura nullable**: la ficha puede no tener cuenta
 *   todavía, así que el error de giro se traduce a `null` (el error de
 *   verdad queda para el momento de calcular dinero, #5 no se toca).
 *
 * ## Fronteras (PA-6-3)
 *
 * No hay `estado` (ciclo de vida = #8) ni creación en línea (RF-C6 = #9):
 * el principal se exige con 404 si no existe o es de otro tenant (R14).
 */
@Injectable()
export class PropiedadesService {
  constructor(
    private readonly repositorio: PropiedadesRepository,
    private readonly propietarios: PropietariosService,
    private readonly cuentas: CuentasBancariasService,
    private readonly workflow: WorkflowService,
  ) {}

  /** R5, R8. */
  async crear(dto: CrearPropiedadDto, ctx: ContextoPeticion): Promise<Propiedad> {
    await this.exigirPrincipal(dto.propietario_principal_id, ctx);
    await this.validarOverride(dto.propietario_principal_id, dto.cuenta_bancaria_id ?? null, ctx);

    const propiedad = await this.repositorio.insertar(ctx, {
      direccion: dto.direccion,
      tipo: dto.tipo,
      area: dto.area,
      matriculaInmobiliaria: dto.matricula_inmobiliaria ?? null,
      estrato: dto.estrato ?? null,
      parqueaderos: dto.parqueaderos,
      depositos: dto.depositos,
      canon: dto.canon,
      valorAdministracion: dto.valor_administracion ?? null,
      canonIncluyeAdministracion: dto.canon_incluye_administracion,
      incrementoAnualPactado: dto.incremento_anual_pactado ?? null,
      nombreConjunto: dto.nombre_conjunto ?? null,
      contactoAdminNombre: dto.contacto_admin_nombre ?? null,
      contactoAdminTelefono: dto.contacto_admin_telefono ?? null,
      contactoAdminCorreo: dto.contacto_admin_correo ?? null,
      propietarioPrincipalId: dto.propietario_principal_id,
      cuentaBancariaId: dto.cuenta_bancaria_id ?? null,
    });

    // R1 (feature #8): la propiedad nace con su máquina. En la MISMA
    // transacción de la petición: si la instancia falla, la excepción hace
    // rollback de la ficha también (PA-8-2).
    const definicion = await this.workflow.resolverDefinicionParaTenant(
      'ciclo_vida_propiedad',
      ctx,
    );
    if (!definicion) {
      throw new Error('No hay definición de ciclo de vida disponible.');
    }
    await this.workflow.crearInstancia(
      definicion.id,
      { entidadTipo: 'propiedad', entidadId: propiedad.id, contexto: {} },
      ctx,
    );

    return propiedad;
  }

  async listar(ctx: ContextoPeticion): Promise<Propiedad[]> {
    return this.repositorio.listar(ctx);
  }

  /** R6, R8, R3 (#8). */
  async obtener(id: string, ctx: ContextoPeticion): Promise<PropiedadConExtras> {
    const propiedad = await this.exigir(id, ctx);

    const [propietarios, cuentaGiro, inquilinoActualNombre, estadoCicloVida] =
      await Promise.all([
        this.repositorio.propietariosActivos(ctx, id),
        this.cuentaDeGiroNullable(propiedad.propietario_principal_id, propiedad.cuenta_bancaria_id, ctx),
        propiedad.inquilino_actual_id
          ? this.repositorio.nombreDelInquilinoActual(ctx, propiedad.inquilino_actual_id)
          : Promise.resolve(null),
        // R3 (#8): el estado se lee del motor, nunca de una columna propia.
        this.repositorio.estadoCicloVida(ctx, id),
      ]);

    return aPropiedadConExtras(propiedad, {
      propietarios,
      cuentaGiro,
      inquilinoActualNombre,
      estadoCicloVida,
    });
  }

  /** R7, R8 — PATCH parcial, con validación del override contra el principal (nuevo si cambia). */
  async actualizar(
    id: string,
    dto: ActualizarPropiedadDto,
    ctx: ContextoPeticion,
  ): Promise<Propiedad> {
    const propiedad = await this.exigir(id, ctx);

    if (dto.cuenta_bancaria_id !== undefined) {
      const principal =
        dto.propietario_principal_id ?? propiedad.propietario_principal_id;
      await this.validarOverride(principal, dto.cuenta_bancaria_id ?? null, ctx);
    }

    const afectadas = await this.repositorio.actualizar(ctx, id, {
      ...(dto.direccion !== undefined ? { direccion: dto.direccion } : {}),
      ...(dto.tipo !== undefined ? { tipo: dto.tipo } : {}),
      ...(dto.area !== undefined ? { area: dto.area } : {}),
      ...(dto.matricula_inmobiliaria !== undefined
        ? { matriculaInmobiliaria: dto.matricula_inmobiliaria }
        : {}),
      ...(dto.estrato !== undefined ? { estrato: dto.estrato } : {}),
      ...(dto.parqueaderos !== undefined ? { parqueaderos: dto.parqueaderos } : {}),
      ...(dto.depositos !== undefined ? { depositos: dto.depositos } : {}),
      ...(dto.canon !== undefined ? { canon: dto.canon } : {}),
      ...(dto.valor_administracion !== undefined
        ? { valorAdministracion: dto.valor_administracion }
        : {}),
      ...(dto.canon_incluye_administracion !== undefined
        ? { canonIncluyeAdministracion: dto.canon_incluye_administracion }
        : {}),
      ...(dto.incremento_anual_pactado !== undefined
        ? { incrementoAnualPactado: dto.incremento_anual_pactado }
        : {}),
      ...(dto.nombre_conjunto !== undefined
        ? { nombreConjunto: dto.nombre_conjunto }
        : {}),
      ...(dto.contacto_admin_nombre !== undefined
        ? { contactoAdminNombre: dto.contacto_admin_nombre }
        : {}),
      ...(dto.contacto_admin_telefono !== undefined
        ? { contactoAdminTelefono: dto.contacto_admin_telefono }
        : {}),
      ...(dto.contacto_admin_correo !== undefined
        ? { contactoAdminCorreo: dto.contacto_admin_correo }
        : {}),
      ...(dto.propietario_principal_id !== undefined
        ? { propietarioPrincipalId: dto.propietario_principal_id }
        : {}),
      ...(dto.cuenta_bancaria_id !== undefined
        ? { cuentaBancariaId: dto.cuenta_bancaria_id }
        : {}),
    });

    if (afectadas === 0) {
      throw new ResourceNotFoundError();
    }

    const actualizada = await this.exigir(id, ctx);
    return actualizada;
  }

  /** R7 — baja lógica. */
  async darDeBaja(id: string, ctx: ContextoPeticion): Promise<void> {
    await this.exigir(id, ctx);
    await this.repositorio.marcarInactivo(ctx, id);
  }

  /** 404 —no 403— también para el recurso de otro tenant (R14). */
  async exigir(id: string, ctx: ContextoPeticion): Promise<Propiedad> {
    const propiedad = await this.repositorio.buscarPorId(ctx, id);
    if (!propiedad) {
      throw new ResourceNotFoundError();
    }
    return propiedad;
  }

  private async exigirPrincipal(
    perfilPropietarioId: string,
    ctx: ContextoPeticion,
  ): Promise<void> {
    // `PropietariosService.obtener` traduce la ausencia (o la ajenidad, por
    // RLS) a 404 indistinguible (R14).
    await this.propietarios.obtener(perfilPropietarioId, ctx);
  }

  /** R8 — la regla de #5 es la autoridad; el 400 sale de ella sin duplicarla. */
  private async validarOverride(
    principalId: string,
    overrideId: string | null,
    ctx: ContextoPeticion,
  ): Promise<void> {
    if (overrideId === null) return;
    await this.cuentas.resolverCuentaDeGiro(principalId, overrideId, ctx);
  }

  /** R8 — lectura nullable para la ficha: el error de giro se traduce a null. */
  private async cuentaDeGiroNullable(
    principalId: string,
    overrideId: string | null,
    ctx: ContextoPeticion,
  ): Promise<CuentaBancaria | null> {
    try {
      return await this.cuentas.resolverCuentaDeGiro(principalId, overrideId, ctx);
    } catch (error) {
      if (esCuentaDeGiroInvalida(error)) return null;
      throw error;
    }
  }
}

function esCuentaDeGiroInvalida(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'CUENTA_DE_GIRO_INVALIDA'
  );
}
