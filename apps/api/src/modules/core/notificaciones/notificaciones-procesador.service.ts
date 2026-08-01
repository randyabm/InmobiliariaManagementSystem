import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { getDatabasePool } from '../../../database/database.client';
import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ProveedorRegistro } from './proveedor-registro';
import { ResolverDestinatarioService } from './resolver-destinatario.service';

/**
 * Procesador de notificaciones (feature #10, R3, R4, R12).
 *
 * - Toma las filas `PENDIENTE` del outbox de TODOS los tenants vía
 *   `notificaciones_pendientes()` (la única vía previa al tenant, R3).
 * - Por fila: `SET LOCAL` de SU tenant, reabre la fila dentro del RLS
 *   (defensa en profundidad), resuelve destinatario/canal (R7: releyendo el
 *   hook de la transición si el disparo fue de workflow), despacha por el
 *   proveedor y marca `PROCESADA` / `FALLIDA` con `intentos` (R4).
 * - Despacha también los recordatorios vencidos (R12).
 *
 * Se ejecuta con un `setInterval` de 60 s desde `onModuleInit` (sin
 * superposición: flag `enProceso`); los tests llaman a
 * `procesarPendientes()` directamente.
 */
@Injectable()
export class NotificacionesProcesadorService {
  private readonly logger = new Logger(NotificacionesProcesadorService.name);
  private enProceso = false;
  private intervalo: NodeJS.Timeout | null = null;

  constructor(
    private readonly resolver: ResolverDestinatarioService,
    private readonly proveedor: ProveedorRegistro,
  ) {}

  async onModuleInit(): Promise<void> {
    const intervaloMs = Number(process.env.NOTIFICACIONES_INTERVALO_MS) || 60_000;
    if (process.env.NODE_ENV === 'test' || intervaloMs <= 0) return;
    this.intervalo = setInterval(() => {
      void this.procesarPendientes();
    }, intervaloMs);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.intervalo) clearInterval(this.intervalo);
  }

  /** R3, R4, R12 — despacha el outbox y los recordatorios vencidos. */
  async procesarPendientes(): Promise<{ procesadas: number; fallidas: number }> {
    if (this.enProceso) return { procesadas: 0, fallidas: 0 };
    this.enProceso = true;
    let procesadas = 0;
    let fallidas = 0;
    try {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) return { procesadas, fallidas };

      // 1) Las filas pendientes de TODOS los tenants (bootstrap, R3).
      const pool = getDatabasePool(databaseUrl);
      const bootstrap = await pool.query<{ id: string; tenant_id: string }>(
        'SELECT id, tenant_id FROM notificaciones_pendientes()',
      );

      for (const fila of bootstrap.rows) {
        const cliente = await pool.connect();
        try {
          await cliente.query('BEGIN');
          await cliente.query('SELECT set_config($1, $2, true)', [
            'app.current_tenant',
            fila.tenant_id,
          ]);
          const ctx = { cliente, tenantId: fila.tenant_id } as ContextoPeticion;

          // Relectura DENTRO del RLS (defensa en profundidad).
          const { rows } = await cliente.query<{
            id: string;
            canal: string | null;
            destinatario: string | null;
            contenido: unknown;
            entidad_tipo: string | null;
            entidad_id: string | null;
            transicion_id: string | null;
            estado: string;
            intentos: number;
          }>(
            `SELECT id, canal, destinatario, contenido,
                    entidad_tipo, entidad_id::text AS entidad_id,
                    transicion_id::text AS transicion_id, estado, intentos
               FROM notificacion_pendiente WHERE id = $1`,
            [fila.id],
          );
          const pendiente = rows[0];
          if (!pendiente || pendiente.estado !== 'PENDIENTE') {
            await cliente.query('COMMIT');
            continue;
          }

          try {
            const resuelto = await this.resolverDestino(pendiente, ctx);
            await this.proveedor.enviar({
              tenantId: fila.tenant_id,
              destinatario: resuelto.destinatario,
              contenido: pendiente.contenido ?? {},
              cliente,
            });
            await cliente.query(
              `UPDATE notificacion_pendiente
                  SET estado = 'PROCESADA', procesada_en = now()
                WHERE id = $1`,
              [fila.id],
            );
            procesadas += 1;
          } catch (error) {
            // R4: intentos acotados y error sin PII (R15).
            const nuevoIntentos = pendiente.intentos + 1;
            await cliente.query(
              `UPDATE notificacion_pendiente
                  SET estado = CASE WHEN $2 >= 3 THEN 'FALLIDA' ELSE 'PENDIENTE' END,
                      intentos = $2,
                      error = CASE WHEN $2 >= 3 THEN $3 ELSE NULL END
                WHERE id = $1`,
              [fila.id, nuevoIntentos, String((error as Error).message ?? 'error')],
            );
            fallidas += 1;
          }

          await this.procesarProgramadasVencidas(cliente);
          await cliente.query('COMMIT');
        } catch (error) {
          await cliente.query('ROLLBACK').catch(() => undefined);
          this.logger.error(`Error procesando notificación ${fila.id}: ${String(error)}`);
        } finally {
          cliente.release();
        }
      }
    } finally {
      this.enProceso = false;
    }
    return { procesadas, fallidas };
  }

  /** R12 — los recordatorios vencidos, dentro del tenant de la fila. */
  private async procesarProgramadasVencidas(cliente: PoolClient): Promise<void> {
    const { rows } = await cliente.query<{ id: string }>(
      `SELECT id FROM notificacion_programada
        WHERE estado = 'PENDIENTE' AND programada_para <= now()`,
    );
    for (const fila of rows) {
      await cliente.query(
        `UPDATE notificacion_programada
            SET estado = 'EJECUTADA', ejecutada_en = now()
          WHERE id = $1`,
        [fila.id],
      );
    }
  }

  /**
   * R7, R8 — el destinatario final.
   *
   * - Disparo manual (R8): la fila ya trae destinatario/canal.
   * - Disparo de transición: se relee el hook de la transición (visible
   *   por RLS, propia o del sistema) y se resuelve por tipo desde la
   *   entidad de la instancia.
   */
  private async resolverDestino(
    pendiente: {
      canal: string | null;
      destinatario: string | null;
      entidad_tipo: string | null;
      entidad_id: string | null;
      transicion_id: string | null;
    },
    ctx: ContextoPeticion,
  ): Promise<{ destinatario: string; canal: string }> {
    if (pendiente.transicion_id === null) {
      if (pendiente.destinatario === null) {
        throw new Error('destinatario_no_resuelto');
      }
      return {
        destinatario: pendiente.destinatario,
        canal: pendiente.canal ?? 'CORREO',
      };
    }

    const { rows } = await ctx.cliente.query<{ notificacion: unknown }>(
      `SELECT notificacion FROM workflow_transicion WHERE id = $1`,
      [pendiente.transicion_id],
    );
    const hook = rows[0]?.notificacion;
    if (typeof hook !== 'object' || hook === null) {
      throw new Error('hook_no_disponible');
    }
    return this.resolver.resolver(
      hook as never,
      pendiente.entidad_tipo,
      pendiente.entidad_id,
      ctx,
    );
  }
}
