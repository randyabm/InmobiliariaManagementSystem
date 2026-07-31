import { describe, expect, it } from 'vitest';

import {
  CODIGOS_RESERVADOS,
  esCodigoDeInmobiliariaValido,
  normalizarCodigoDeInmobiliaria,
} from '../codigo-inmobiliaria';

/**
 * **T73 (parte unitaria) — R73, R74, R75.**
 *
 * La barrera real es el `CHECK` de `0007_identidad_por_tenant.sql`, y se prueba
 * contra PostgreSQL en `test/db/migrations.db.test.ts`. Lo de aquí es la misma
 * regla en la capa HTTP, que es la que permite responder **400** a un `codigo`
 * mal formado sin llegar a consultar la base (R63).
 *
 * Las dos comprobaciones tienen que decir lo mismo: si divergen, el motor
 * aceptaría códigos que el login rechaza, o al revés. El test de la migración
 * usa deliberadamente los mismos casos límite.
 */
describe('Código de inmobiliaria (#5 R73, R74, R75, D-12)', () => {
  describe('normalización (R74)', () => {
    it('recorta espacios y pasa a minúsculas', () => {
      expect(normalizarCodigoDeInmobiliaria('  Arrendamientos-Sion ')).toBe(
        'arrendamientos-sion',
      );
      expect(normalizarCodigoDeInmobiliaria('ARRENDAMIENTOS-SION')).toBe(
        'arrendamientos-sion',
      );
    });

    it('devuelve null para lo que no es un código utilizable', () => {
      expect(normalizarCodigoDeInmobiliaria(undefined)).toBeNull();
      expect(normalizarCodigoDeInmobiliaria(null)).toBeNull();
      expect(normalizarCodigoDeInmobiliaria('')).toBeNull();
      expect(normalizarCodigoDeInmobiliaria('   ')).toBeNull();
      expect(normalizarCodigoDeInmobiliaria(42)).toBeNull();
      expect(normalizarCodigoDeInmobiliaria({})).toBeNull();
    });
  });

  describe('formato de etiqueta DNS (R73)', () => {
    it('acepta el caso del spec', () => {
      expect(esCodigoDeInmobiliariaValido('arrendamientos-sion')).toBe(true);
      expect(esCodigoDeInmobiliariaValido('abc')).toBe(true);
      expect(esCodigoDeInmobiliariaValido('a1-b2-c3')).toBe(true);
      expect(esCodigoDeInmobiliariaValido('a'.repeat(63))).toBe(true);
    });

    const invalidos: Array<[string, string]> = [
      ['mayúsculas', 'Arrendamientos'],
      ['tilde', 'arrendamientos-sión'],
      ['eñe', 'compañia'],
      ['guion inicial', '-arrendamientos'],
      ['guion final', 'arrendamientos-'],
      ['dos guiones seguidos', 'arre--ndamientos'],
      ['espacio interior', 'arrendamientos sion'],
      ['punto', 'arrendamientos.sion'],
      ['barra baja', 'arrendamientos_sion'],
      ['menos de 3 caracteres', 'ab'],
      ['más de 63 caracteres', 'a'.repeat(64)],
    ];

    it.each(invalidos)('rechaza %s', (_nombre, codigo) => {
      expect(esCodigoDeInmobiliariaValido(codigo)).toBe(false);
    });
  });

  describe('códigos reservados (R75)', () => {
    it('la lista es exactamente la del requirement', () => {
      expect([...CODIGOS_RESERVADOS].sort()).toEqual(
        ['admin', 'api', 'app', 'cdn', 'mail', 'portal', 'static', 'www'].sort(),
      );
    });

    it.each(CODIGOS_RESERVADOS)('rechaza el subdominio de servicio %s', (codigo) => {
      // Son formalmente válidos como etiqueta DNS: por eso hace falta la lista.
      expect(esCodigoDeInmobiliariaValido(codigo)).toBe(false);
    });

    it('no rechaza un código que solo CONTIENE un nombre reservado', () => {
      // `api-inmobiliaria` no colisiona con el subdominio `api`.
      expect(esCodigoDeInmobiliariaValido('api-inmobiliaria')).toBe(true);
      expect(esCodigoDeInmobiliariaValido('mi-portal')).toBe(true);
    });
  });
});
