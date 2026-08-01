import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '../App';

/**
 * R3: el shell de `apps/web` renderiza el login (la app ya no es solo el
 * healthcheck; feature #28).
 */
describe('Shell de la aplicación web (R3)', () => {
  it('renderiza el login como primera pantalla', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Gesti\u00f3n Inmobiliaria' })).toBeInTheDocument();
    expect(screen.getByLabelText('Inmobiliaria')).toBeInTheDocument();
    expect(screen.getByLabelText('Correo')).toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument();
  });
});
