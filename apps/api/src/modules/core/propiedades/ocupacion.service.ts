import { Injectable } from '@nestjs/common';
import type { HistorialOcupacion } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { InquilinosService } from '../clientes/inquilinos.service';
import { PropiedadesService } from './propiedades.service';

/**
 * Ocupación de la propiedad (RF-P3, R11, R12).
 *
 * Asignar el inquilino actual y escribir el historial ocurren en la **misma
 * transacción**: no existe el instante en que `propiedad.inquilino_actual_id`
 * y la línea vigente de `historial_ocupacion` discrepen. El índice único
 * parcial de la migración (una ocupación vigente por propiedad) es la
 * garantía del motor.
 */
@Injectable()
export class OcupacionService {
  constructor(
    private readonly propiedades: PropiedadesService,
    private readonly inquilinos: InquilinosService,
  ) {}

  /** R11 — asignar (o liberar) el inquilino actual, cerrando/abriendo la línea. */
  async asignarInquilinoActual(
    propiedadId: string,
    perfilInquilinoId: string | null,
    ctx: ContextoPeticion,
  ): Promise<void> {
    // Atomicidad: las tres escrituras corren en la transacción de la petición
    // (la abre `TenantContextInterceptor`); si cualquiera falla, todo se
    // deshace. No hay BEGIN propio: la transacción ya está abierta.
    const cliente = ctx.cliente;

    // 404 —no 403— si la propiedad no existe o es de otro tenant (R14).
    await this.propiedades.exigir(propiedadId, ctx);

    if (perfilInquilinoId !== null) {
      // 404 —no 403— si el perfil no existe o es de otro tenant (R14).
      await this.inquilinos.obtener(perfilInquilinoId, ctx);
    }

    // Cierra la ocupación vigente (si la hay).
    await cliente.query(
      `UPDATE historial_ocupacion SET hasta = now()
        WHERE propiedad_id = $1 AND hasta IS NULL`,
      [propiedadId],
    );

    if (perfilInquilinoId !== null) {
      // Abre la nueva línea.
      await cliente.query(
        `INSERT INTO historial_ocupacion
           (tenant_id, propiedad_id, perfil_inquilino_id, desde)
         VALUES ($1, $2, $3, now())`,
        [ctx.tenantId, propiedadId, perfilInquilinoId],
      );
    }

    // Actualiza la ficha en la misma transacción.
    await cliente.query(
      `UPDATE propiedad SET inquilino_actual_id = $2, updated_at = now()
        WHERE id = $1 AND tenant_id = $3`,
      [propiedadId, perfilInquilinoId, ctx.tenantId],
    );
  }

  /** R12 — la línea de tiempo, con el nombre del inquilino de cada período. */
  async historial(
    propiedadId: string,
    ctx: ContextoPeticion,
  ): Promise<HistorialOcupacion[]> {
    await this.propiedades.exigir(propiedadId, ctx);

    const { rows } = await ctx.cliente.query(
      `SELECT h.id, h.tenant_id, h.propiedad_id, h.perfil_inquilino_id,
              h.desde, h.hasta, u.nombre AS inquilino_nombre
         FROM historial_ocupacion h
         JOIN perfil_inquilino p ON p.id = h.perfil_inquilino_id
         JOIN "user" u ON u.id = p.user_id
        WHERE h.tenant_id = $1 AND h.propiedad_id = $2
        ORDER BY h.desde DESC`,
      [ctx.tenantId, propiedadId],
    );
    return rows.map((fila) => aHistorial(fila));
  }
}

interface FilaHistorial {
  id: string;
  tenant_id: string;
  propiedad_id: string;
  perfil_inquilino_id: string;
  desde: Date;
  hasta: Date | null;
  inquilino_nombre: string | null;
}

function aHistorial(fila: unknown): HistorialOcupacion {
  const f = fila as FilaHistorial;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    propiedad_id: f.propiedad_id,
    perfil_inquilino_id: f.perfil_inquilino_id,
    desde: f.desde.toISOString(),
    hasta: f.hasta ? f.hasta.toISOString() : null,
    inquilino_nombre: f.inquilino_nombre,
  };
}
