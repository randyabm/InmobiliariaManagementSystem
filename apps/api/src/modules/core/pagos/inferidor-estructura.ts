import { Injectable } from '@nestjs/common';
import type { MapeoColumnas } from '@inmobiliaria/types';

/**
 * Inferencia de la estructura del archivo (feature #30, R2, PA-30-1).
 *
 * Interfaz abstracta: el MVP es DETERMINISTA (encabezados/filas de ejemplo)
 * y el LLM se enchufa detrás en Fase 4 (#33). La salvaguarda de §15.3 se
 * cumple por construcción: la inferencia decide QUÉ columna es QUÉ; los
 * valores se parsean con código determinista (PA-30-2), nunca por el
 * modelo.
 */

export interface EstructuraInferida {
  mapeo: MapeoColumnas;
  formato_detectado: string;
}

export interface InferidorEstructura {
  inferir(encabezados: string[], filaEjemplo: string[]): EstructuraInferida;
}

const CAMPOS_CANONICOS = [
  'fecha_movimiento',
  'valor',
  'referencia_texto',
  'pagador_texto',
  'cuenta_destino',
  'medio_pago',
] as const;

/** Implementación determinista por heurísticas de encabezado (PA-30-1). */
@Injectable()
export class InferidorEstructuraDeterminista implements InferidorEstructura {
  inferir(encabezados: string[], filaEjemplo: string[]): EstructuraInferida {
    const mapeo: Record<string, string> = {};
    for (let i = 0; i < encabezados.length; i++) {
      const campo = clasificar(encabezados[i] ?? '', filaEjemplo[i] ?? '');
      if (campo) mapeo[encabezados[i] ?? `columna_${i}`] = campo;
    }
    const faltan = CAMPOS_CANONICOS.filter((c) => !Object.values(mapeo).includes(c));
    if (faltan.length > 0) {
      // Sin inferencia completa el parseo no puede ser fiable: se exige el
      // mapeo manual (RF-PA6).
      throw new MapeoIncompletoError(faltan);
    }
    return { mapeo, formato_detectado: 'csv' };
  }
}

function clasificar(encabezado: string, _ejemplo: string): string | null {
  const h = encabezado.toLowerCase();
  if (/fecha|fech/.test(h)) return 'fecha_movimiento';
  if (/valor|monto|importe|pago|abono/i.test(h)) return 'valor';
  if (/referencia|ref\b|descripcion/i.test(h)) return 'referencia_texto';
  if (/pagador|cliente|titular|nombre/i.test(h)) return 'pagador_texto';
  if (/cuenta/i.test(h)) return 'cuenta_destino';
  if (/medio|canal|forma/i.test(h)) return 'medio_pago';
  return null;
}

/** La inferencia no logró cubrir todos los campos canónicos (RF-PA6). */
export class MapeoIncompletoError extends Error {
  readonly code = 'MAPEO_INCOMPLETO';
  readonly faltantes: string[];
  constructor(faltantes: string[]) {
    super(`No se pudieron inferir las columnas: ${faltantes.join(', ')}.`);
    this.faltantes = faltantes;
  }
}
