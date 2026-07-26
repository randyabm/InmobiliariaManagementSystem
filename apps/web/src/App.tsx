import type { JSX } from 'react';

import { useHealth } from './hooks/use-health';

/**
 * Shell mínimo de la aplicación web.
 *
 * Los tres estados (cargando / error / listo) son explícitos y visibles: es
 * requisito de docs/conventions.md para cualquier vista que consulte la API.
 */
export function App(): JSX.Element {
  const salud = useHealth();

  return (
    <main>
      <h1>Gestión Inmobiliaria</h1>

      {salud.estado === 'cargando' && (
        <p role="status">Consultando el estado del servicio…</p>
      )}

      {salud.estado === 'error' && (
        <p role="alert">
          No fue posible consultar el estado del servicio. {salud.mensaje}
        </p>
      )}

      {salud.estado === 'listo' && (
        <p role="status">
          Servicio disponible (versión {salud.datos.version}).
        </p>
      )}
    </main>
  );
}
