import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { ClienteWeb, type Peticion, type Respuesta, type Transporte } from '../api/cliente-web';
import { Login } from '../vistas/Login';

/**
 * Login (T2 → R1): flujo feliz contra el transporte mock y rechazo.
 */

class TransporteMock implements Transporte {
  llamadas: Array<{ metodo: string; ruta: string }> = [];
  falla = false;

  async request(peticion: Peticion): Promise<Respuesta> {
    this.llamadas.push({ metodo: peticion.metodo, ruta: peticion.ruta });
    if (peticion.ruta === '/auth/login' && this.falla) {
      return { status: 401, cuerpo: {} };
    }
    return {
      status: 201,
      cuerpo: {
        access_token: 'access',
        refresh_token: 'refresh',
        user: { id: 'u1', email: 'a@x.com', nombre: 'Admin A' },
      },
    };
  }
}

describe('Login (T2: R1)', () => {
  let transporte: TransporteMock;

  beforeEach(() => {
    transporte = new TransporteMock();
  });

  it('flujo feliz: llama a /auth/login y notifica el usuario', async () => {
    const api = new ClienteWeb({ transporte });
    const onLogin = () => undefined;
    render(<Login api={api} onLogin={onLogin} />);

    await userEvent.type(screen.getByLabelText('Inmobiliaria'), 'inmobiliaria-a');
    await userEvent.type(screen.getByLabelText('Correo'), 'admin-a@example.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'clave-de-prueba-1234');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => {
      expect(transporte.llamadas).toContainEqual({ metodo: 'POST', ruta: '/auth/login' });
    });
    expect(api.autenticado).toBe(true);
  });

  it('credenciales inválidas: muestra el error y no autentica', async () => {
    transporte.falla = true;
    const api = new ClienteWeb({ transporte });
    render(<Login api={api} onLogin={() => undefined} />);

    await userEvent.type(screen.getByLabelText('Inmobiliaria'), 'inmobiliaria-a');
    await userEvent.type(screen.getByLabelText('Correo'), 'admin-a@example.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'mal');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/inválidas/i);
    expect(api.autenticado).toBe(false);
  });
});
