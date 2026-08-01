import type { JSX } from 'react';
import type { ClienteWeb } from '../api/cliente-web';
import { useApi, VistaEstado } from '../hooks/use-api';

/**
 * Clientes (feature #28, R5, RF-C1): propietarios e inquilinos.
 */
export function Clientes(props: { api: ClienteWeb }): JSX.Element {
  const { estado: propietarios } = useApi<Array<{ id: string; nombre: string; documento: string }>>(
    props.api,
    'GET',
    '/propietarios',
  );
  const { estado: inquilinos } = useApi<Array<{ id: string; nombre: string; documento: string }>>(
    props.api,
    'GET',
    '/inquilinos',
  );

  return (
    <section>
      <h2>Clientes</h2>
      <h3>Propietarios</h3>
      <VistaEstado
        estado={propietarios}
        render={(lista) => (
          <ul>
            {lista.map((p) => (
              <li key={p.id}>
                {p.nombre} — {p.documento}
              </li>
            ))}
          </ul>
        )}
      />
      <h3>Inquilinos</h3>
      <VistaEstado
        estado={inquilinos}
        render={(lista) => (
          <ul>
            {lista.map((i) => (
              <li key={i.id}>
                {i.nombre} — {i.documento}
              </li>
            ))}
          </ul>
        )}
      />
    </section>
  );
}
