import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import { ClienteWeb, type Peticion, type Respuesta, type Transporte } from '../api/cliente-web';
import { sesion } from '../sesion/sesion';

/**
 * Paneles (T4–T7 → R2–R5): Dashboard, Inventarios, Contratos y
 * Plantillas contra un transporte mock que responde la API real.
 */

class TransportePaneles implements Transporte {
  llamadas: string[] = [];
  renovado = false;

  async request(peticion: Peticion): Promise<Respuesta> {
    this.llamadas.push(`${peticion.metodo} ${peticion.ruta}`);
    if (peticion.ruta === '/auth/login') {
      return {
        status: 201,
        cuerpo: {
          access_token: 'access',
          refresh_token: 'refresh',
          user: { id: 'u1', email: 'a@x.com', nombre: 'Admin A' },
        },
      };
    }
    if (peticion.ruta === '/propiedades/dashboard') {
      return {
        status: 200,
        cuerpo: {
          por_estado: [
            { estado: 'Disponible', cantidad: 2 },
            { estado: 'Arrendada', cantidad: 1 },
          ],
          propiedades: [{ id: 'p1', direccion: 'Calle 1', estado: 'Disponible' }],
        },
      };
    }
    if (peticion.ruta === '/inventarios' || peticion.ruta.startsWith('/inventarios?')) {
      return {
        status: 200,
        cuerpo: [
          { id: 'inv-1', propiedad_id: 'p1', tipo_evento: 'ENTREGA', estado: 'BORRADOR', created_at: '' },
        ],
      };
    }
    if (peticion.ruta === '/contratos') {
      return {
        status: 200,
        cuerpo: [
          { id: 'c1', property_id: 'p1', inquilino_id: 'i1', fecha_inicio: '2026-01-01', fecha_fin: '2026-12-31', estado: 'vigente' },
        ],
      };
    }
    if (peticion.ruta === '/contratos/vencimientos?dias=90') {
      return {
        status: 200,
        cuerpo: [
          { contract_id: 'c1', propiedad_direccion: 'Calle 1', fecha_fin: '2026-12-31', dias_restantes: 10, estado_gestion: 'sin_gestionar' },
        ],
      };
    }
    if (peticion.ruta.startsWith('/contratos/c1/renovar')) {
      this.renovado = true;
      return { status: 201, cuerpo: { id: 'c2' } };
    }
    if (peticion.ruta === '/plantillas') {
      return {
        status: 200,
        cuerpo: [{ id: 'pl-1', tipo: 'APARTAMENTO', origen: 'SISTEMA', nombre: 'Apartamento' }],
      };
    }
    if (peticion.ruta === '/plantillas/pl-1/clonar') {
      return { status: 201, cuerpo: { id: 'pl-1-copia' } };
    }
    if (peticion.ruta === '/auth/logout') {
      return { status: 200, cuerpo: {} };
    }
    return { status: 200, cuerpo: [] };
  }
}

async function entrar(transporte: Transporte) {
  const api = new ClienteWeb({ transporte });
  render(<App cliente={api} />);
  await userEvent.type(screen.getByLabelText('Inmobiliaria'), 'inmobiliaria-a');
  await userEvent.type(screen.getByLabelText('Correo'), 'admin-a@example.com');
  await userEvent.type(screen.getByLabelText('Contraseña'), 'clave-de-prueba-1234');
  await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
  await screen.findByRole('heading', { name: 'Dashboard de propiedades' });
}

describe('Paneles web (T4–T7: R2–R5)', () => {
  beforeEach(async () => {
    await sesion.limpiar();
  });

  it('Dashboard: tarjetas por estado del ciclo de vida (R2)', async () => {
    const transporte = new TransportePaneles();
    await entrar(transporte);

    expect((await screen.findAllByText('Disponible')).length).toBeGreaterThan(0);
    expect(screen.getByText('Arrendada')).toBeInTheDocument();
    expect(screen.getByText('Calle 1')).toBeInTheDocument();
    expect(transporte.llamadas).toContain('GET /propiedades/dashboard');
  });

  it('Inventarios: navega al panel y muestra la lista (R3)', async () => {
    const transporte = new TransportePaneles();
    await entrar(transporte);

    await userEvent.click(screen.getByRole('button', { name: 'Inventarios' }));
    expect(await screen.findByText('ENTREGA')).toBeInTheDocument();
    expect(transporte.llamadas.some((l) => l.startsWith('GET /inventarios'))).toBe(true);
  });

  it('Contratos: vencimientos visibles y renovar llama a la API (R4)', async () => {
    const transporte = new TransportePaneles();
    await entrar(transporte);

    await userEvent.click(screen.getByRole('button', { name: 'Contratos' }));
    expect(await screen.findByText('sin_gestionar')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Renovar' }));
    await waitFor(() => expect(transporte.renovado).toBe(true));
    expect(transporte.llamadas).toContain('POST /contratos/c1/renovar');
  });

  it('Plantillas: clonar del sistema llama a la API (R5)', async () => {
    const transporte = new TransportePaneles();
    await entrar(transporte);

    await userEvent.click(screen.getByRole('button', { name: 'Plantillas' }));
    expect(await screen.findByText('Apartamento')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clonar para el tenant' }));
    await waitFor(() => {
      expect(transporte.llamadas).toContain('POST /plantillas/pl-1/clonar');
    });
  });

  it('Cerrar sesión limpia el refresh (R6)', async () => {
    const transporte = new TransportePaneles();
    await entrar(transporte);

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(await screen.findByRole('heading', { name: 'Gesti\u00f3n Inmobiliaria' })).toBeInTheDocument();
    expect(await sesion.leerRefresh()).toBeNull();
    if (typeof localStorage !== 'undefined') {
      expect(localStorage.getItem('access_token')).toBeNull();
      expect(localStorage.getItem('refresh_token')).toBeNull();
    }
  });
});

// Aislar los mocks globales de otros archivos.
vi.mock('fake-indexeddb/auto', () => ({}));
