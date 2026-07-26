import { useEffect, useState } from 'react';
import type { HealthStatus } from '@inmobiliaria/types';

import { fetchHealth } from '../api/health-client';

/**
 * Estado explícito de carga y error (docs/conventions.md, "Frontend": toda
 * vista que consulte la API debe tenerlos).
 */
export type HealthState =
  | { readonly estado: 'cargando' }
  | { readonly estado: 'listo'; readonly datos: HealthStatus }
  | { readonly estado: 'error'; readonly mensaje: string };

export function useHealth(): HealthState {
  const [estado, setEstado] = useState<HealthState>({ estado: 'cargando' });

  useEffect(() => {
    let activo = true;

    fetchHealth()
      .then((datos) => {
        if (activo) setEstado({ estado: 'listo', datos });
      })
      .catch((error: unknown) => {
        if (!activo) return;
        setEstado({
          estado: 'error',
          mensaje:
            error instanceof Error
              ? error.message
              : 'No fue posible contactar el servicio.',
        });
      });

    return () => {
      activo = false;
    };
  }, []);

  return estado;
}
