import { BadRequestException, Injectable } from '@nestjs/common';
import type { InventarioCompleto } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import { InventariosRepository } from './inventarios.repository';

/**
 * Comparación entrada vs salida (feature #21, R1–R3, RF-I10).
 * Solo lectura: no escribe nada (R2).
 */
@Injectable()
export class ComparacionInventariosService {
  constructor(private readonly inventarios: InventariosRepository) {}

  /** R1 — comparar ítem por ítem entre el de entrada y el de salida. */
  async comparar(
    ctx: ContextoPeticion,
    idEntrada: string,
    idSalida: string,
  ): Promise<ComparacionResultado> {
    if (idEntrada === idSalida) {
      throw new BadRequestException('No se puede comparar un inventario consigo mismo.');
    }
    const entrada = await this.inventarios.buscarCompleto(ctx, idEntrada);
    const salida = await this.inventarios.buscarCompleto(ctx, idSalida);
    if (!entrada || !salida) {
      throw new ResourceNotFoundError();
    }

    const zonas: ComparacionZona[] = [];
    let iguales = 0;
    let diferentes = 0;
    let ausentes = 0;

    for (const zonaEntrada of entrada.zonas) {
      const zonaSalida = salida.zonas.find((z) => z.nombre === zonaEntrada.nombre);
      const items: ComparacionItem[] = [];
      for (const itemEntrada of zonaEntrada.items) {
        const pareja = zonaSalida?.items.find(
          (i) =>
            (itemEntrada.plantilla_item_id !== null &&
              i.plantilla_item_id === itemEntrada.plantilla_item_id) ||
            (itemEntrada.plantilla_item_id === null &&
              i.nombre === itemEntrada.nombre),
        );
        if (!pareja) {
          ausentes += 1;
          items.push({
            nombre: itemEntrada.nombre,
            veredicto: 'ausente_en_salida',
            entrada: respuestaDe(itemEntrada),
            salida: null,
            comentario_entrada: itemEntrada.comentario,
            comentario_salida: null,
          });
          continue;
        }
        const respEntrada = respuestaDe(itemEntrada);
        const respSalida = respuestaDe(pareja);
        if (respEntrada === respSalida) {
          iguales += 1;
          items.push({
            nombre: itemEntrada.nombre,
            veredicto: 'igual',
            entrada: respEntrada,
            salida: respSalida,
            comentario_entrada: itemEntrada.comentario,
            comentario_salida: pareja.comentario,
          });
        } else {
          diferentes += 1;
          items.push({
            nombre: itemEntrada.nombre,
            veredicto: 'diferente',
            entrada: respEntrada,
            salida: respSalida,
            comentario_entrada: itemEntrada.comentario,
            comentario_salida: pareja.comentario,
          });
        }
      }
      zonas.push({ zona: zonaEntrada.nombre, items });
    }

    return {
      inventario_entrada_id: idEntrada,
      inventario_salida_id: idSalida,
      total_entrada: entrada.zonas.reduce((n, z) => n + z.items.length, 0),
      iguales,
      diferentes,
      ausentes,
      zonas,
    };
  }
}

function respuestaDe(item: InventarioCompleto['zonas'][number]['items'][number]): string {
  if (item.estado_checklist) return item.estado_checklist;
  if (item.valor_respuesta) return JSON.stringify(item.valor_respuesta);
  return 'sin respuesta';
}

export interface ComparacionItem {
  nombre: string;
  veredicto: 'igual' | 'diferente' | 'ausente_en_salida';
  entrada: string;
  salida: string | null;
  comentario_entrada: string | null;
  comentario_salida: string | null;
}

export interface ComparacionZona {
  zona: string;
  items: ComparacionItem[];
}

export interface ComparacionResultado {
  inventario_entrada_id: string;
  inventario_salida_id: string;
  total_entrada: number;
  iguales: number;
  diferentes: number;
  ausentes: number;
  zonas: ComparacionZona[];
}
