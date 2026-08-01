import type { JSX } from 'react';
import type { ClienteWeb } from '../api/cliente-web';
import { useApi, VistaEstado } from '../hooks/use-api';

/**
 * Dashboard de propiedades (feature #28, R2, RF-P5): tarjetas por estado
 * del ciclo de vida y la lista de propiedades con su estado.
 */
export function Dashboard(props: { api: ClienteWeb }): JSX.Element {
  const { estado } = useApi<{
    por_estado: Array<{ estado: string; cantidad: number }>;
    propiedades: Array<{ id: string; direccion: string; estado: string }>;
  }>(props.api, 'GET', '/propiedades/dashboard');

  return (
    <section>
      <h2>Dashboard de propiedades</h2>
      <VistaEstado
        estado={estado}
        render={(datos) => (
          <>
            <div className="tarjetas">
              {datos.por_estado.map((fila) => (
                <div className="tarjeta" key={fila.estado}>
                  <strong>{fila.estado}</strong>
                  <span>{fila.cantidad}</span>
                </div>
              ))}
            </div>
            <table>
              <thead>
                <tr>
                  <th>Dirección</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {datos.propiedades.map((p) => (
                  <tr key={p.id}>
                    <td>{p.direccion}</td>
                    <td>{p.estado}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      />
    </section>
  );
}
