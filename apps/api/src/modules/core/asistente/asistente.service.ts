import { Injectable } from '@nestjs/common';
import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { rolEfectivo } from '../../../common/database/cliente-tenant';
import { TicketsService } from '../tickets/tickets.service';
import { RenovacionesService } from '../contratos/renovaciones.service';
import { ImportacionesService } from '../pagos/importaciones.service';

/**
 * Asistente conversacional (feature #33, R1–R7, §14, D8).
 *
 * El orquestador es una INTERFAZ (PA-33-1); el proveedor LLM se enchufa
 * detrás. Las HERRAMIENTAS acotadas (PA-33-2) llaman a los SERVICIOS con
 * la sesión del usuario: RBAC + RLS del que pregunta, imposible devolver
 * datos fuera de scope por construcción (RF-CB10/CB11). Sin RAG en esta
 * iteración (PA-33-3).
 */

export interface Herramienta {
  readonly nombre: string;
  readonly descripcion: string;
  ejecutar(ctx: ContextoPeticion, argumentos: Record<string, unknown>): Promise<unknown>;
}

export interface RespuestaAsistente {
  readonly respuesta: string;
  readonly herramienta_usada: string | null;
  readonly datos: unknown;
  readonly requiere_escalamiento: boolean;
}

/** Interfaz del orquestador (PA-33-1): el LLM se enchufa detrás. */
export interface AsistenteConversacional {
  responder(ctx: ContextoPeticion, mensaje: string): Promise<RespuestaAsistente>;
}

/**
 * Orquestador MVP SIN LLM: interpreta el mensaje por palabras clave y
 * ejecuta la herramienta acotada. El proveedor conversacional real
 * reemplaza `interpretar` sin tocar las herramientas ni la auditoría.
 */
@Injectable()
export class AsistenteService implements AsistenteConversacional {
  constructor(
    private readonly tickets: TicketsService,
    private readonly renovaciones: RenovacionesService,
    private readonly pagos: ImportacionesService,
  ) {}

  private get herramientas(): Herramienta[] {
    return [
      {
        nombre: 'consultar_tickets',
        descripcion: 'Lista los tickets de mantenimiento visibles para el usuario.',
        ejecutar: (ctx) => this.tickets.listar(ctx),
      },
      {
        nombre: 'consultar_vencimientos',
        descripcion: 'Contratos próximos a vencer (90 días).',
        ejecutar: (ctx) => this.renovaciones.panelVencimientos(ctx, 90),
      },
      {
        nombre: 'consultar_estado_cuenta',
        descripcion: 'Estado de cuenta de un contrato (solo del propio inquilino o autorizado).',
        ejecutar: (ctx, args) => {
          const contractId = typeof args.contract_id === 'string' ? args.contract_id : '';
          return this.pagos.estadoDeCuenta(ctx, contractId, rolEfectivo(ctx) ?? 'admin');
        },
      },
      {
        nombre: 'crear_ticket',
        descripcion: 'Acción de bajo riesgo: crea un ticket de mantenimiento (requiere confirmación).',
        ejecutar: (ctx, args) => {
          const propertyId = typeof args.propiedad_id === 'string' ? args.propiedad_id : '';
          const categoria = typeof args.categoria === 'string' ? args.categoria : '';
          const descripcion = typeof args.descripcion === 'string' ? args.descripcion : categoria;
          if (!propertyId || !categoria) {
            return Promise.reject(new Error('Faltan argumentos para crear_ticket.'));
          }
          return this.tickets.crear(ctx, propertyId, { categoria, descripcion });
        },
      },
    ];
  }

  /** R1–R4 — responder con herramientas acotadas (MVP sin LLM). */
  async responder(ctx: ContextoPeticion, mensaje: string): Promise<RespuestaAsistente> {
    const texto = mensaje.toLowerCase();

    // Límite duro (R4, RF-CB6): las acciones irreversibles SIEMPRE escalan.
    if (/firm\w*|aprobar costos|modificar contrato|confirm\w*\s+(el\s+)?pago|acept\w*\s+(el\s+)?inventario/.test(texto)) {
      return {
        respuesta: 'Esa acción no la puede ejecutar el asistente: requiere una persona.',
        herramienta_usada: null,
        datos: null,
        requiere_escalamiento: true,
      };
    }

    const herramienta = this.seleccionar(texto);
    if (!herramienta) {
      return {
        respuesta: 'No entendí la solicitud. Puedo consultar tickets, vencimientos o pagos.',
        herramienta_usada: null,
        datos: null,
        requiere_escalamiento: false,
      };
    }

    const argumentos = this.argumentosDe(texto);
    try {
      const datos = await herramienta.ejecutar(ctx, argumentos);
      return {
        respuesta: `Consulta ejecutada con ${herramienta.nombre}.`,
        herramienta_usada: herramienta.nombre,
        datos,
        requiere_escalamiento: false,
      };
    } catch {
      return {
        respuesta: 'No pude completar la consulta con tus permisos actuales.',
        herramienta_usada: herramienta.nombre,
        datos: null,
        requiere_escalamiento: false,
      };
    }
  }

  private seleccionar(texto: string): Herramienta | null {
    if (/ticket|reclamo|reparacion|mantenimiento/.test(texto)) {
      const crear = /crear|abrir|nuevo/.test(texto);
      return crear ? this.herramientas.find((h) => h.nombre === 'crear_ticket') ?? null : this.herramientas[0]!;
    }
    if (/vencimient|renovar|contrato/.test(texto)) {
      return this.herramientas[1]!;
    }
    if (/pago|cuenta|estado de cuenta/.test(texto)) {
      return this.herramientas[2]!;
    }
    return null;
  }

  private argumentosDe(texto: string): Record<string, unknown> {
    const args: Record<string, unknown> = {};
    const contract = /contrato\s+([0-9a-f-]{36})/.exec(texto);
    if (contract) args.contract_id = contract[1];
    const propiedad = /propiedad\s+([0-9a-f-]{36})/.exec(texto);
    if (propiedad) args.propiedad_id = propiedad[1];
    const categoria = /ticket\s+de\s+([a-záéíóúñü ]+?)(?:\s+para|$)/.exec(texto);
    if (categoria && categoria[1]) args.categoria = categoria[1].trim();
    return args;
  }
}
