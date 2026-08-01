import { describe, expect, it } from 'vitest';

import { validarMergeFields } from '../plantillas-contrato.service';
import { PlantillaContratoInvalidaError } from '../errors/plantilla-contrato-invalida.error';

/**
 * T9 — PA-16-2: cada `{campo}` del cuerpo debe existir en los merge fields.
 */
describe('validarMergeFields (T9: PA-16-2)', () => {
  it('acepta un cuerpo sin campos variables', () => {
    expect(() => validarMergeFields('Cláusula fija sin variables.', {})).not.toThrow();
  });

  it('acepta un cuerpo cuyos campos están definidos', () => {
    expect(() =>
      validarMergeFields(
        'Entre {arrendador} y {arrendatario}, canon {canon}.',
        { arrendador: 'X', arrendatario: 'Y', canon: '1.000.000' },
      ),
    ).not.toThrow();
  });

  it('rechaza un {campo} sin definición (400)', () => {
    expect(() =>
      validarMergeFields('Canon {canon}, dirección {direccion}.', { canon: '1' }),
    ).toThrow(PlantillaContratoInvalidaError);
  });
});
