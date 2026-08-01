import { Injectable } from '@nestjs/common';
import type { PropiedadConExtras } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { AuditService } from '../audit/audit.service';
import { WorkflowService } from '../workflows/workflow.service';
import { TransicionNoDisponibleError } from '../workflows/errors';
import { OcupacionService } from './ocupacion.service';
import { PropiedadesService } from './propiedades.service';
import { ResolverPerfilService } from './resolver-perfil.service';
import type { IngresoPropiedadDto } from './dto/ingreso.dto';
import type { CrearPropiedadDto } from './dto/crear-propiedad.dto';

/**
 * Ingreso de propiedad (feature #9, RF-PI1/RF-PI2/RF-PI4, PA-9-4).
 *
 * Orquesta —sin duplicar lógica— lo que ya existe: resuelve/crea perfiles
 * (R3/R4), crea la ficha con su instancia (#6/#8) y, en el escenario B,
 * asigna el inquilino actual y recorre la cadena por claves hasta
 * `arrendada` (R2/R7).
 *
 * ## Atomicidad (PA-9-4)
 *
 * Todo corre en la transacción de la petición: cualquier fallo (incluida
 * una cadena bloqueada por la personalización del tenant) revierte el
 * ingreso completo (R6).
 *
 * ## Auditoría (R8)
 *
 * Las mutaciones ocurren DENTRO del servicio, así que el `AuditInterceptor`
 * no las ve: cada perfil creado, la propiedad y cada transición se auditan
 * explícitamente con `AuditService.log` y `metadata` vacío (R12).
 */
@Injectable()
export class IngresoService {
  constructor(
    private readonly resolverPerfil: ResolverPerfilService,
    private readonly propiedades: PropiedadesService,
    private readonly ocupacion: OcupacionService,
    private readonly workflow: WorkflowService,
    private readonly audit: AuditService,
  ) {}

  async ingresar(dto: IngresoPropiedadDto, ctx: ContextoPeticion): Promise<PropiedadConExtras> {
    const propietario = await this.resolverPerfil.resolverPropietario(
      dto.propietario,
      ctx,
    );
    await this.auditarSiCreo(propietario.creado, 'perfil_propietario', propietario.id, ctx);

    const propiedadDto: CrearPropiedadDto = {
      ...dto.propiedad,
      propietario_principal_id: propietario.id,
      parqueaderos: dto.propiedad.parqueaderos ?? 0,
      depositos: dto.propiedad.depositos ?? 0,
      canon_incluye_administracion: dto.propiedad.canon_incluye_administracion ?? false,
    };
    const propiedad = await this.propiedades.crear(propiedadDto, ctx);
    await this.auditarSiCreo(true, 'propiedad', propiedad.id, ctx);

    if (dto.escenario === 'VACANTE') {
      // R1/R7: la instancia ya nació en `disponible` (R1 de #8).
      return this.propiedades.obtener(propiedad.id, ctx);
    }

    // Escenario B (R2): inquilino en línea → ocupación → cadena a arrendada.
    const inquilino = await this.resolverPerfil.resolverInquilino(dto.inquilino, ctx);
    await this.auditarSiCreo(inquilino.creado, 'perfil_inquilino', inquilino.id, ctx);

    await this.ocupacion.asignarInquilinoActual(propiedad.id, inquilino.id, ctx);

    const instancia = await this.workflow.buscarInstanciaDeEntidad(
      'propiedad',
      propiedad.id,
      ctx,
    );
    if (!instancia) {
      throw new Error('La propiedad recién creada no tiene instancia.');
    }

    // La cadena por claves (el camino de #8): cada transición se audita y
    // escribe su log en el motor (R9). Si la copia del tenant desactivó
    // alguna, esto lanza 409 y revierte TODO el ingreso (R6).
    const transiciones = await this.workflow.transicionesDeDefinicion(
      instancia.definicion_id,
      ctx,
    );
    for (const clave of ['iniciar_checkeo', 'enviar_aseguradora', 'arrendar']) {
      const transicion = transiciones.find(
        (t) => t.clave === clave && t.tipo_ejecucion === 'HUMANA',
      );
      if (!transicion) {
        throw new TransicionNoDisponibleError(
          `La cadena del ingreso requiere la transición '${clave}'.`,
        );
      }
      await this.workflow.ejecutarTransicion(
        instancia.id,
        transicion.id,
        {},
        ctx.actorId ?? '',
        ctx,
      );
      await this.audit.log({
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        accion: 'actualizar',
        entityType: 'propiedad',
        entityId: propiedad.id,
      });
    }

    return this.propiedades.obtener(propiedad.id, ctx);
  }

  /** R8 — audita solo las creaciones reales, con metadata vacío. */
  private async auditarSiCreo(
    creado: boolean,
    entityType: string,
    entityId: string,
    ctx: ContextoPeticion,
  ): Promise<void> {
    if (!creado) return;
    await this.audit.log({
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      accion: 'crear',
      entityType,
      entityId,
    });
  }
}
