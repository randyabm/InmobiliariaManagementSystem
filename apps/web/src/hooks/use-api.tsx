import { useCallback, useEffect, useState } from 'react';
import type { ClienteWeb } from '../api/cliente-web';

/**
 * Hook de datos (feature #28, R7): los tres estados explícitos de
 * `docs/conventions.md` — cargando / error / listo.
 */
export type EstadoApi<T> =
  | { estado: 'cargando' }
  | { estado: 'error'; mensaje: string }
  | { estado: 'listo'; datos: T };

export function useApi<T>(
  api: ClienteWeb | null,
  metodo: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  ruta: string,
  dependencias: unknown[] = [],
  cuerpo?: unknown,
): { estado: EstadoApi<T>; recargar: () => void } {
  const [estado, setEstado] = useState<EstadoApi<T>>({ estado: 'cargando' });
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let activo = true;
    if (!api) return;
    setEstado({ estado: 'cargando' });
    void (async () => {
      try {
        const respuesta = await api.request<T>(metodo, ruta, cuerpo);
        if (!activo) return;
        if (respuesta.status >= 400) {
          setEstado({ estado: 'error', mensaje: 'La solicitud no pudo completarse.' });
          return;
        }
        setEstado({ estado: 'listo', datos: respuesta.cuerpo });
      } catch {
        if (activo) setEstado({ estado: 'error', mensaje: 'La solicitud no pudo completarse.' });
      }
    })();
    return () => {
      activo = false;
    };
    // `dependencias` se desparrama a propósito: el llamador decide qué
    // cambios recargan la consulta.
  }, [api, metodo, ruta, intento, ...dependencias]);

  const recargar = useCallback(() => setIntentoSiguiente(setIntento), []);

  return { estado, recargar };
}

function setIntentoSiguiente(set: (f: (n: number) => number) => void): void {
  set((n) => n + 1);
}

/** Muestra los tres estados; `render` pinta los datos cuando están listos. */
export function VistaEstado<T>(props: {
  estado: EstadoApi<T>;
  render: (datos: T) => React.ReactNode;
}): React.ReactNode {
  if (props.estado.estado === 'cargando') {
    return <p role="status">Cargando…</p>;
  }
  if (props.estado.estado === 'error') {
    return <p role="alert">{props.estado.mensaje}</p>;
  }
  return <>{props.render(props.estado.datos)}</>;
}
