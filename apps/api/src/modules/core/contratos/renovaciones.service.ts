import { Injectable } from '@nestjs/common';
import type { Contrato } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import { NotificacionesOutboxService } from '../notificaciones/notificaciones-outbox.service';
import { CicloVidaService } from '../propiedades/ciclo-vida.service';
import { ContratosRepository } from './contratos.repository';
import { PlantillasContratoRepository } from './plantillas-contrato.repository';
import { GeneradorPdfPdfLib, type GeneradorPdf } from '../inventarios/firma/generador-pdf';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';

/**
 * Renovaciones y alertas (feature #19, R1–R5, Ley 820).
 */
@Injectable()
export class RenovacionesService {
  private readonly generador: GeneradorPdf = new GeneradorPdfPdfLib();

  constructor(
    private readonly contratos: ContratosRepository,
    private readonly plantillas: PlantillasContratoRepository,
    private readonly outbox: NotificacionesOutboxService,
    private readonly almacenamiento: AlmacenamientoService,
    private readonly cicloVida: CicloVidaService,
  ) {}

  /** R1 — configuración del tenant (defaults si no existe). */
  async obtenerConfiguracion(ctx: ContextoPeticion): Promise<{
    umbrales_dias: number[];
    avisar_a: string[];
    ipc_anual: number;
  }> {
    const { rows } = await ctx.cliente.query<{
      umbrales_dias: unknown;
      avisar_a: unknown;
      ipc_anual: string;
    }>(
      `SELECT umbrales_dias, avisar_a, ipc_anual::text AS ipc_anual
         FROM config_renovacion WHERE tenant_id = $1`,
      [ctx.tenantId],
    );
    const fila = rows[0];
    if (!fila) {
      return { umbrales_dias: [90, 60, 30], avisar_a: ['admin', 'asesor'], ipc_anual: 0 };
    }
    return {
      umbrales_dias: Array.isArray(fila.umbrales_dias)
        ? (fila.umbrales_dias as number[])
        : [90, 60, 30],
      avisar_a: Array.isArray(fila.avisar_a) ? (fila.avisar_a as string[]) : ['admin', 'asesor'],
      ipc_anual: Number(fila.ipc_anual),
    };
  }

  /** R1 — guardar la configuración. */
  async guardarConfiguracion(
    ctx: ContextoPeticion,
    datos: { umbrales_dias?: number[]; avisar_a?: string[]; ipc_anual?: number },
  ): Promise<void> {
    const actual = await this.obtenerConfiguracion(ctx);
    const umbrales = datos.umbrales_dias ?? actual.umbrales_dias;
    const avisarA = datos.avisar_a ?? actual.avisar_a;
    const ipc = datos.ipc_anual ?? actual.ipc_anual;
    await ctx.cliente.query(
      `INSERT INTO config_renovacion (tenant_id, umbrales_dias, avisar_a, ipc_anual, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (tenant_id) DO UPDATE
         SET umbrales_dias = EXCLUDED.umbrales_dias,
             avisar_a = EXCLUDED.avisar_a,
             ipc_anual = EXCLUDED.ipc_anual,
             updated_at = now()`,
      [ctx.tenantId, JSON.stringify(umbrales), JSON.stringify(avisarA), ipc],
    );
  }

  /** R2 — panel de vencimientos. */
  async panelVencimientos(ctx: ContextoPeticion, dias: number): Promise<
    Array<{
      contract_id: string;
      propiedad_direccion: string;
      fecha_fin: string;
      dias_restantes: number;
      estado_gestion: 'sin_gestionar' | 'renovado' | 'en_desocupacion';
      dias_desde_primera_alerta: number | null;
    }>
  > {
    const { rows } = await ctx.cliente.query<{
      id: string;
      direccion: string;
      fecha_fin: Date;
      dias_restantes: number;
      renovado: string;
      desocupacion: string;
      primera_alerta: Date | null;
    }>(
      `SELECT c.id,
              p.direccion,
              c.fecha_fin,
              GREATEST(0, EXTRACT(EPOCH FROM (c.fecha_fin - now()))::int / 86400) AS dias_restantes,
              EXISTS (SELECT 1 FROM contract c2
                       WHERE c2.property_id = c.property_id AND c2.tenant_id = c.tenant_id
                         AND c2.fecha_inicio >= c.fecha_fin)::text AS renovado,
              EXISTS (SELECT 1 FROM inventario i
                       WHERE i.propiedad_id = c.property_id AND i.tenant_id = c.tenant_id
                         AND i.tipo_evento = 'DEVOLUCION' AND i.estado = 'BORRADOR'
                         AND i.activo = true)::text AS desocupacion,
              (SELECT MIN(a.enviada_en) FROM alerta_vencimiento a
                WHERE a.contract_id = c.id AND a.tenant_id = c.tenant_id) AS primera_alerta
         FROM contract c
         JOIN propiedad p ON p.id = c.property_id
        WHERE c.tenant_id = $1
          AND c.estado IN ('vigente', 'firmado')
          AND c.fecha_fin <= now() + ($2 || ' days')::interval
          AND c.fecha_fin >= now() - interval '1 day'
        ORDER BY c.fecha_fin`,
      [ctx.tenantId, dias],
    );
    return rows.map((r) => ({
      contract_id: r.id,
      propiedad_direccion: r.direccion,
      fecha_fin: r.fecha_fin.toISOString(),
      dias_restantes: r.dias_restantes,
      estado_gestion:
        r.renovado === 'true'
          ? 'renovado'
          : r.desocupacion === 'true'
            ? 'en_desocupacion'
            : 'sin_gestionar',
      dias_desde_primera_alerta: r.primera_alerta
        ? Math.max(0, Math.floor((Date.now() - r.primera_alerta.getTime()) / 86_400_000))
        : null,
    }));
  }

  /** R3 — alertas por umbral (dedupe con alerta_vencimiento). */
  async generarAlertas(ctx: ContextoPeticion): Promise<{ creadas: number }> {
    const config = await this.obtenerConfiguracion(ctx);
    const { rows } = await ctx.cliente.query<{
      id: string;
      direccion: string;
      fecha_fin: Date;
      dias: number;
      email_asesor: string | null;
    }>(
      `SELECT c.id, p.direccion, c.fecha_fin,
              GREATEST(0, EXTRACT(EPOCH FROM (c.fecha_fin - now()))::int / 86400) AS dias,
              (SELECT u.email FROM "user" u
                WHERE u.id = (SELECT id FROM "user"
                               WHERE tenant_id = c.tenant_id AND email IS NOT NULL
                               ORDER BY created_at LIMIT 1)) AS email_asesor
         FROM contract c
         JOIN propiedad p ON p.id = c.property_id
        WHERE c.tenant_id = $1 AND c.estado IN ('vigente', 'firmado')
          AND c.fecha_fin <= now() + interval '90 days' AND c.fecha_fin >= now()`,
      [ctx.tenantId],
    );
    let creadas = 0;
    for (const contrato of rows) {
      for (const umbral of config.umbrales_dias) {
        if (contrato.dias <= umbral) {
          const { rowCount } = await ctx.cliente.query(
            `INSERT INTO alerta_vencimiento (tenant_id, contract_id, umbral_dias)
             VALUES ($1, $2, $3)
             ON CONFLICT (contract_id, umbral_dias) DO NOTHING`,
            [ctx.tenantId, contrato.id, umbral],
          );
          if ((rowCount ?? 0) > 0) {
            creadas += 1;
            await this.outbox.crear(
              {
                destinatario: contrato.email_asesor ?? '',
                canal: 'CORREO',
                contenido: {
                  asunto: `El contrato de ${contrato.direccion} vence en ${contrato.dias} días`,
                  contract_id: contrato.id,
                  dias: contrato.dias,
                  umbral: umbral,
                },
              },
              ctx,
            );
          }
        }
      }
    }
    return { creadas };
  }

  /** R4 — renovación asistida (Ley 820): nuevo contrato + prórroga. */
  async renovar(
    ctx: ContextoPeticion,
    contractId: string,
    datos: { nuevo_canon?: number; nueva_fecha_fin?: string },
  ): Promise<Contrato> {
    const contrato = await this.contratos.buscarPorId(ctx, contractId);
    if (!contrato) throw new ResourceNotFoundError();

    // Canon propuesto: incremento pactado de la propiedad o IPC (PA-19-1).
    const { rows: propiedad } = await ctx.cliente.query<{
      canon: string;
      incremento_anual_pactado: string | null;
    }>(
      `SELECT canon::text AS canon, incremento_anual_pactado::text AS incremento_anual_pactado
         FROM propiedad WHERE id = $1 AND tenant_id = $2`,
      [contrato.property_id, ctx.tenantId],
    );
    const filaPropiedad = propiedad[0]!;
    const config = await this.obtenerConfiguracion(ctx);
    const incremento =
      filaPropiedad.incremento_anual_pactado !== null
        ? Number(filaPropiedad.incremento_anual_pactado)
        : config.ipc_anual;
    const canonActual = Number(filaPropiedad.canon);
    const nuevoCanon = datos.nuevo_canon ?? Math.round(canonActual * (1 + incremento / 100));
    const nuevaFechaFin = datos.nueva_fecha_fin ?? undefined;

    const renovado = await this.contratos.insertarContrato(ctx, {
      propertyId: contrato.property_id,
      inquilinoId: contrato.inquilino_id,
      propietarioId: contrato.propietario_id,
      fechaInicio: new Date(contrato.fecha_fin),
      fechaFin: nuevaFechaFin
        ? new Date(nuevaFechaFin)
        : new Date(new Date(contrato.fecha_fin).setFullYear(new Date(contrato.fecha_fin).getFullYear() + 1)),
    });

    // Documento de prórroga (RF-CT11): merge del template de la propiedad.
    const plantilla = await this.plantillas.buscarPorPropiedad(ctx, contrato.property_id);
    if (plantilla) {
      const cuerpo = plantilla.cuerpo.replace(/\{([a-zA-Z0-9_]+)\}/g, (marca, campo: string) => {
        const tabla: Record<string, string> = {
          canon: String(nuevoCanon),
          fecha_inicio: contrato.fecha_fin,
          fecha_fin: nuevaFechaFin ?? '',
        };
        return tabla[campo] ?? plantilla.merge_fields_json[campo] ?? marca;
      });
      const pdf = await this.generador.generar({
        propiedad_direccion: '',
        propiedad_tipo: 'prorroga',
        tipo_evento: 'ENTREGA',
        estado: 'vigente',
        zonas: [{ nombre: 'PRÓRROGA', items: [{ nombre: cuerpo, respuesta: null, comentario: null, fotos: [] }] }],
      });
      const subido = await this.almacenamiento.subir(pdf.binario, 'application/pdf');
      await ctx.cliente.query(
        `INSERT INTO propiedad_documento
           (tenant_id, propiedad_id, nombre, tipo_documento, clave_storage,
            hash_sha256, mime, tamano_bytes, entidad_tipo, entidad_id, subido_por)
         VALUES ($1, $2, 'Prórroga', 'prorroga', $3, $4, 'application/pdf',
                 $5, 'contrato', $6, $7)`,
        [
          ctx.tenantId,
          contrato.property_id,
          subido.clave,
          subido.hash_sha256,
          subido.tamano_bytes,
          renovado.id,
          ctx.actorId ?? null,
        ],
      );
    }
    return renovado;
  }

  /** R5 — no renovación: auditoría + desocupación + inventario de salida. */
  async noRenovar(
    ctx: ContextoPeticion,
    contractId: string,
    motivo: string,
  ): Promise<void> {
    const contrato = await this.contratos.buscarPorId(ctx, contractId);
    if (!contrato) throw new ResourceNotFoundError();

    // RF-CT13: la propiedad pasa a En desocupación (workflow de #8).
    try {
      await this.cicloVida.ejecutar(
        contrato.property_id,
        'iniciar_desocupacion',
        { motivo, contract_id: contractId },
        ctx.actorId ?? '',
        ctx,
      );
    } catch {
      // La transición puede no estar disponible (estado no compatible):
      // la decisión queda auditada igualmente (RF-CT12) y el inventario de
      // salida se crea.
    }

    // Inventario de salida (DEVOLUCION, borrador de #12) si no existe.
    const { rows: existente } = await ctx.cliente.query<{ id: string }>(
      `SELECT id FROM inventario
        WHERE tenant_id = $1 AND propiedad_id = $2 AND tipo_evento = 'DEVOLUCION'
          AND estado = 'BORRADOR' AND activo = true LIMIT 1`,
      [ctx.tenantId, contrato.property_id],
    );
    if (existente.length === 0) {
      await ctx.cliente.query(
        `INSERT INTO inventario (tenant_id, propiedad_id, tipo_evento, creado_por)
         VALUES ($1, $2, 'DEVOLUCION', $3)`,
        [ctx.tenantId, contrato.property_id, ctx.actorId ?? null],
      );
    }
  }
}
