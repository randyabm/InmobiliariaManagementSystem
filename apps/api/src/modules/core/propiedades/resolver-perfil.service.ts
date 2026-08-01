import { Injectable } from '@nestjs/common';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { InquilinosService } from '../clientes/inquilinos.service';
import { PropietariosService } from '../clientes/propietarios.service';
import { NombreNoCoincideConIdentidadError } from '../clientes/errors/nombre-no-coincide.error';
import { nombresCoinciden } from '../clientes/identidad.service';
import type { CrearInquilinoDto } from '../clientes/dto/inquilino.dto';
import type { CrearPropietarioDto } from '../clientes/dto/propietario.dto';

/**
 * Resolución de perfiles del ingreso (feature #9, R3/R4, PA-9-3).
 *
 * Por id → se valida (404 si inexistente/ajeno). Por datos en línea →
 * buscar por documento en el tenant; si existe y el nombre coincide
 * (criterio `nombresCoinciden` de #26, sin plegar tildes) se reutiliza; si
 * existe con otro nombre → 409 `NOMBRE_NO_COINCIDE_CON_IDENTIDAD` sin
 * escribir nada; si no existe → se crea.
 */
@Injectable()
export class ResolverPerfilService {
  constructor(
    private readonly propietarios: PropietariosService,
    private readonly inquilinos: InquilinosService,
  ) {}

  /** R3 — id o datos del propietario → id del perfil + si se creó. */
  async resolverPropietario(
    entrada: { perfil_id?: string; datos?: CrearPropietarioDto },
    ctx: ContextoPeticion,
  ): Promise<{ id: string; creado: boolean }> {
    if (entrada.perfil_id !== undefined) {
      // `obtener` traduce la ausencia (o la ajenidad) a 404 (R10).
      const perfil = await this.propietarios.obtener(entrada.perfil_id, ctx);
      return { id: perfil.id, creado: false };
    }
    return this.porDatos(entrada.datos!, ctx, 'propietario');
  }

  /** R4 — id o datos del inquilino → id del perfil + si se creó. */
  async resolverInquilino(
    entrada: { perfil_id?: string; datos?: CrearInquilinoDto },
    ctx: ContextoPeticion,
  ): Promise<{ id: string; creado: boolean }> {
    if (entrada.perfil_id !== undefined) {
      const perfil = await this.inquilinos.obtener(entrada.perfil_id, ctx);
      return { id: perfil.id, creado: false };
    }
    return this.porDatos(entrada.datos!, ctx, 'inquilino');
  }

  private async porDatos(
    datos: CrearPropietarioDto | CrearInquilinoDto,
    ctx: ContextoPeticion,
    tipo: 'propietario' | 'inquilino',
  ): Promise<{ id: string; creado: boolean }> {
    const existentes =
      tipo === 'propietario'
        ? await this.propietarios.buscarPorDocumento(
            datos.tipo_documento,
            datos.documento,
            ctx,
          )
        : await this.inquilinos.buscarPorDocumento(
            datos.tipo_documento,
            datos.documento,
            ctx,
          );

    if (existentes.length > 0) {
      // PA-9-3: reutilizar SOLO si la persona es la misma. Un nombre
      // divergente significa que una de las fichas está mal (mismo criterio
      // de la deduplicación de #26).
      if (!nombresCoinciden(existentes[0]!.nombre, datos.nombre)) {
        throw new NombreNoCoincideConIdentidadError(
          existentes[0]!.user_id,
          existentes[0]!.nombre,
          datos.nombre,
        );
      }
      return { id: existentes[0]!.id, creado: false };
    }

    // No existe: se crea en línea (RF-C6). Los servicios de #5 auditan la
    // reutilización de identidad interna; la creación del perfil la audita
    // `IngresoService` (R8).
    const creado =
      tipo === 'propietario'
        ? await this.propietarios.crear(datos as CrearPropietarioDto, ctx)
        : await this.inquilinos.crear(datos as CrearInquilinoDto, ctx);
    return { id: creado.id, creado: true };
  }
}
