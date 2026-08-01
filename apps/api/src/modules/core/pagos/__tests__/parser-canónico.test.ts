import { describe, expect, it } from 'vitest';

import { parsearFecha, parsearRegistro, parsearValor } from '../parser-canónico';
import { InferidorEstructuraDeterminista, MapeoIncompletoError } from '../inferidor-estructura';

/**
 * T6 (PA-30-2): el parseo de valores es 100% determinista — la salvaguarda
 * de §15.3 (la IA nunca transcribe importes). T5: inferencia determinista.
 */
describe('Parser determinista (T6: PA-30-2)', () => {
  const encabezados = ['Fecha', 'Valor', 'Referencia', 'Pagador', 'Cuenta', 'Medio'];
  const mapeo = {
    Fecha: 'fecha_movimiento',
    Valor: 'valor',
    Referencia: 'referencia_texto',
    Pagador: 'pagador_texto',
    Cuenta: 'cuenta_destino',
    Medio: 'medio_pago',
  };

  it('parsea fechas ISO y DD/MM/YYYY', () => {
    expect(parsearFecha('2026-07-15').toISOString().slice(0, 10)).toBe('2026-07-15');
    expect(parsearFecha('15/07/2026').toISOString().slice(0, 10)).toBe('2026-07-15');
    expect(() => parsearFecha('no-es-fecha')).toThrow();
  });

  it('parsea valores con separadores colombianos ($, miles, coma decimal)', () => {
    expect(parsearValor('1.500.000,50')).toBe(1500000.5);
    expect(parsearValor('$ 900.000')).toBe(900000);
    expect(parsearValor('1200000')).toBe(1200000);
  });

  it('un importe mal formado lanza 400 determinista (sin transcripción de IA)', () => {
    expect(() => parsearRegistro(['2026-07-15', 'abc', '', '', '', ''], encabezados, mapeo)).toThrow();
    expect(() => parsearRegistro(['2026-07-15', '-5', '', '', '', ''], encabezados, mapeo)).toThrow();
  });

  it('el registro canónico queda completo', () => {
    const r = parsearRegistro(
      ['15/07/2026', '1.500.000,50', 'ARR-00001', 'Ana Pérez', '123-456', 'TRANSFERENCIA'],
      encabezados,
      mapeo,
    );
    expect(r.valor).toBe(1500000.5);
    expect(r.referencia_texto).toBe('ARR-00001');
    expect(r.pagador_texto).toBe('Ana Pérez');
  });
});

describe('Inferidor determinista (T5: PA-30-1)', () => {
  it('infiere el mapeo desde encabezados comunes', () => {
    const inferidor = new InferidorEstructuraDeterminista();
    const resultado = inferidor.inferir(
      ['Fecha', 'Valor', 'Referencia', 'Pagador', 'Cuenta', 'Medio'],
      ['01/07/2026', '900000', 'ARR-1', 'Juan', '123', 'CASH'],
    );
    expect(resultado.mapeo.Fecha).toBe('fecha_movimiento');
    expect(resultado.mapeo.Valor).toBe('valor');
    expect(resultado.mapeo.Referencia).toBe('referencia_texto');
  });

  it('lanza MapeoIncompleto si falta un campo canónico (RF-PA6: se exige mapeo manual)', () => {
    const inferidor = new InferidorEstructuraDeterminista();
    expect(() => inferidor.inferir(['Fecha', 'Valor'], ['01/07/2026', '1'])).toThrow(
      MapeoIncompletoError,
    );
  });
});
