import type { JSX } from 'react';
import type { ClienteWeb } from '../api/cliente-web';
import { useApi, VistaEstado } from '../hooks/use-api';

interface DashboardDatos {
  conteos: Array<{ clave: string; etiqueta: string; cantidad: number }>;
  propiedades: Array<{
    id: string;
    direccion: string;
    estado_ciclo_vida: string | null;
  }>;
}

/**
 * Dashboard de propiedades (feature #28, R2, RF-P5): tarjetas por estado
 * del ciclo de vida y la lista de propiedades con su estado.
 */
export function Dashboard(props: { api: ClienteWeb }): JSX.Element {
  const { estado } = useApi<DashboardDatos>(props.api, 'GET', '/propiedades/dashboard');

  return (
    <section>
      <h2>Dashboard de propiedades</h2>
      <VistaEstado
        estado={estado}
        render={(datos) => (
          <>
            <div className="tarjetas">
              {datos.conteos.map((fila) => (
                <div className="tarjeta" key={fila.clave}>
                  <strong>{fila.etiqueta}</strong>
                  <span>{fila.cantidad}</span>
                </div>
              ))}
              {datos.conteos.length === 0 ? <p>Aún no hay propiedades.</p> : null}
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
                    <td>{p.estado_ciclo_vida ?? 'sin estado'}</td>
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
