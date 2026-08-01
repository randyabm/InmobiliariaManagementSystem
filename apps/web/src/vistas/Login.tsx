import { useState } from 'react';
import type { JSX } from 'react';
import type { ClienteWeb } from '../api/cliente-web';

/**
 * Login (feature #28, R1): código de inmobiliaria + correo + contraseña
 * contra el flujo estándar #27. Tres estados explícitos.
 */
export function Login(props: {
  api: ClienteWeb;
  onLogin: (usuario: { nombre: string }) => void;
}): JSX.Element {
  const [codigo, setCodigo] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const usuario = await props.api.login(codigo, email, password);
      props.onLogin(usuario);
    } catch {
      setError('Credenciales inválidas o servicio no disponible.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <main className="login">
      <h1>Gestión Inmobiliaria</h1>
      <form onSubmit={enviar}>
        <label>
          Inmobiliaria
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            autoComplete="organization"
          />
        </label>
        <label>
          Correo
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <button type="submit" disabled={enviando || !codigo || !email || !password}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </main>
  );
}
