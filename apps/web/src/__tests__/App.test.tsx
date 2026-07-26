import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HEALTH_ENDPOINT, type HealthStatus } from '@inmobiliaria/types';

import { App } from '../App';

/**
 * R3: el shell de `apps/web` se renderiza.
 * R4: el test importa el contrato desde `@inmobiliaria/types` por el alias del
 *     workspace; si el alias no resolviera, este archivo no compilaría.
 */
const SALUD: HealthStatus = { status: 'ok', version: '0.1.0', uptime: 12 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Shell de la aplicación web (R3)', () => {
  it('renderiza el título y el estado de carga mientras consulta la API', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );

    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Gestión Inmobiliaria' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Consultando el estado del servicio…'),
    ).toBeInTheDocument();
  });

  it('muestra la versión cuando el servicio responde', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(SALUD), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(
      await screen.findByText('Servicio disponible (versión 0.1.0).'),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(HEALTH_ENDPOINT);
  });

  it('muestra un estado de error explícito si la API falla', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No fue posible consultar el estado del servicio.',
    );
  });
});
