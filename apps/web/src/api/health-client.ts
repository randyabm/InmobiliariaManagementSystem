import { HEALTH_ENDPOINT, type HealthStatus } from '@inmobiliaria/types';

/**
 * Cliente del healthcheck.
 *
 * docs/conventions.md ("Frontend"): la lógica no vive en el componente. El
 * componente solo pinta estados; quien habla con la API es este módulo.
 *
 * Importa el contrato desde `@inmobiliaria/types` por el alias del workspace
 * (R4): la forma de la respuesta no se duplica en el frontend.
 */
export async function fetchHealth(
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): Promise<HealthStatus> {
  const respuesta = await fetchImpl(`${baseUrl}${HEALTH_ENDPOINT}`);

  if (!respuesta.ok) {
    throw new Error(
      `El servicio respondió con estado ${String(respuesta.status)}.`,
    );
  }

  return (await respuesta.json()) as HealthStatus;
}
