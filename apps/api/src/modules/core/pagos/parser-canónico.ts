import { BadRequestException } from '@nestjs/common';
import type { MapeoColumnas } from '@inmobiliaria/types';

/**
 * Parser determinista del modelo canónico (feature #30, R3, PA-30-2).
 *
 * La salvaguarda de §15.3 es ESTRUCTURAL: el mapeo decide qué columna es
 * qué, pero los VALORES (fechas, importes) se parsean aquí, en código,
 * nunca por un modelo. Un importe mal transcrito por IA sería un error
 * invisible y de alto impacto.
 */

export interface RegistroCanonico {
  fecha_movimiento: Date;
  valor: number;
  referencia_texto: string | null;
  pagador_texto: string | null;
  cuenta_destino: string | null;
  medio_pago: string | null;
}

export function parsearRegistro(
  fila: string[],
  encabezados: string[],
  mapeo: MapeoColumnas,
): RegistroCanonico {
  const indiceDe = (campo: string): number => {
    const columna = Object.keys(mapeo).find((c) => mapeo[c] === campo);
    const idx = columna === undefined ? -1 : encabezados.indexOf(columna);
    if (idx < 0) throw new BadRequestException(`Falta la columna para ${campo}.`);
    return idx;
  };
  const texto = (campo: string): string => (fila[indiceDe(campo)] ?? '').trim();

  const fecha = parsearFecha(texto('fecha_movimiento'));
  const valor = parsearValor(texto('valor'));
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new BadRequestException(`Valor no válido: ${texto('valor')}.`);
  }

  return {
    fecha_movimiento: fecha,
    valor,
    referencia_texto: texto('referencia_texto') || null,
    pagador_texto: texto('pagador_texto') || null,
    cuenta_destino: texto('cuenta_destino') || null,
    medio_pago: texto('medio_pago') || null,
  };
}

export function parsearFecha(texto: string): Date {
  // Acepta ISO y DD/MM/YYYY (formato común en Colombia).
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) {
    const fecha = new Date(`${texto.slice(0, 10)}T12:00:00Z`);
    if (!Number.isNaN(fecha.getTime())) return fecha;
  }
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(texto);
  if (m) {
    const fecha = new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00Z`);
    if (!Number.isNaN(fecha.getTime())) return fecha;
  }
  throw new BadRequestException(`Fecha no válida: ${texto}.`);
}

export function parsearValor(texto: string): number {
  // Quita moneda y espacios. Con coma decimal (formato colombiano):
  // se eliminan los puntos de miles y la coma pasa a punto. Sin coma,
  // los puntos se conservan (JS los acepta como separador o decimal).
  const sinMoneda = texto.replace(/[$\s]/g, '');
  const limpio = sinMoneda.includes(',')
    ? sinMoneda.replace(/\./g, '').replace(',', '.')
    : /^(\d{1,3})(\.\d{3})+(\.\d{3})?$/.test(sinMoneda) ||
      /^\d{1,3}(\.\d{3})+$/.test(sinMoneda)
      ? sinMoneda.replace(/\./g, '')
      : sinMoneda;
  return Number(limpio);
}
