import { Injectable } from '@nestjs/common';
import type { DashboardPropiedades, TipoPropiedad } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';

/**
 * Dashboard de gestión (feature #8, RF-P5/RF-PI5/RF-PI6).
 *
 * Conteos y listado leen el estado de las INSTANCIAS del motor (PA-8-1:
 * `propiedad` no tiene columna de estado). El listado viene ordenado por
 * `tiempo_en_estado_segundos` DESC — las propiedades estancadas primero,
 * que es el propósito de RF-PI5.
 */
@Injectable()
export class DashboardService {
  /** R9, R10, R11, R12. */
  async consultar(
    filtros: { estado?: string; tipo?: TipoPropiedad },
    ctx: ContextoPeticion,
  ): Promise<DashboardPropiedades> {
    const condiciones = ['p.tenant_id = $1', 'p.activo = true'];
    const parametros: unknown[] = [ctx.tenantId];
    if (filtros.tipo !== undefined) {
      parametros.push(filtros.tipo);
      condiciones.push(`p.tipo = $${parametros.length}`);
    }
    if (filtros.estado !== undefined) {
      parametros.push(filtros.estado);
      condiciones.push(`e.clave = $${parametros.length}`);
    }
    const where = condiciones.join(' AND ');

    // Conteos por estado (R9). Con filtro de estado, solo ese estado.
    const { rows: conteos } = await ctx.cliente.query<{
      clave: string;
      etiqueta: string;
      cantidad: number;
    }>(
      `SELECT e.clave, e.etiqueta, count(*)::int AS cantidad
         FROM propiedad p
         JOIN workflow_instancia i
           ON i.entidad_tipo = 'propiedad' AND i.entidad_id = p.id
         JOIN workflow_estado e ON e.id = i.estado_actual_id
        WHERE ${where}
        GROUP BY e.clave, e.etiqueta
        ORDER BY e.clave`,
      parametros,
    );

    // Listado con estado, instancia y tiempo en estado (R10, R11, R12).
    const { rows: propiedades } = await ctx.cliente.query(
      `SELECT p.id, p.direccion, p.tipo, p.canon::text AS canon,
              e.clave AS estado_clave, e.etiqueta AS estado_etiqueta,
              i.id::text AS instancia_id, i.updated_at,
              extract(epoch from (now() - i.updated_at))::int
                AS tiempo_en_estado_segundos
         FROM propiedad p
         JOIN workflow_instancia i
           ON i.entidad_tipo = 'propiedad' AND i.entidad_id = p.id
         JOIN workflow_estado e ON e.id = i.estado_actual_id
        WHERE ${where}
        ORDER BY tiempo_en_estado_segundos DESC`,
      parametros,
    );

    return {
      conteos,
      propiedades: propiedades.map((fila) => ({
        id: fila.id,
        direccion: fila.direccion,
        tipo: fila.tipo,
        canon: fila.canon,
        estado_ciclo_vida: {
          clave: fila.estado_clave,
          etiqueta: fila.estado_etiqueta,
          desde: (fila.updated_at as Date).toISOString(),
        },
        instancia_id: fila.instancia_id,
        tiempo_en_estado_segundos: fila.tiempo_en_estado_segundos,
      })),
    };
  }
}
