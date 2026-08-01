import { useState } from 'react';
import type { JSX } from 'react';
import type { ClienteWeb } from '../api/cliente-web';
import { useApi, VistaEstado } from '../hooks/use-api';

interface Contrato {
  id: string;
  property_id: string;
  inquilino_id: string | null;
  fecha_inicio: string;
  fecha_fin: string;
  estado: string;
}

interface Vencimiento {
  contract_id: string;
  propiedad_direccion: string;
  fecha_fin: string;
  dias_restantes: number;
  estado_gestion: string;
}

/**
 * Contratos (feature #28, R4, #19): lista, vencimientos y acciones de
 * renovar / no renovar contra la API real (PA-28-3).
 */
export function Contratos(props: { api: ClienteWeb }): JSX.Element {
  const [recarga, setRecarga] = useState(0);
  const { estado } = useApi<Contrato[]>(props.api, 'GET', '/contratos', [recarga]);
  const { estado: vencimientos } = useApi<Vencimiento[]>(
    props.api,
    'GET',
    '/contratos/vencimientos?dias=90',
    [recarga],
  );
  const [mensaje, setMensaje] = useState<string | null>(null);

  const ejecutar = async (
    ruta: string,
    cuerpo: Record<string, unknown>,
    exito: string,
  ) => {
    try {
      const respuesta = await props.api.request('POST', ruta, cuerpo);
      if (respuesta.status >= 400) {
        setMensaje('La acción no pudo completarse.');
        return;
      }
      setMensaje(exito);
      setRecarga((n) => n + 1);
    } catch {
      setMensaje('La acción no pudo completarse.');
    }
  };

  return (
    <section>
      <h2>Contratos</h2>
      {mensaje ? <p role="status">{mensaje}</p> : null}
      <h3>Vencimientos próximos (90 días)</h3>
      <VistaEstado
        estado={vencimientos}
        render={(lista) => (
          <table>
            <thead>
              <tr>
                <th>Propiedad</th>
                <th>Vence</th>
                <th>Días</th>
                <th>Gestión</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((v) => (
                <tr key={v.contract_id}>
                  <td>{v.propiedad_direccion}</td>
                  <td>{v.fecha_fin.slice(0, 10)}</td>
                  <td>{v.dias_restantes}</td>
                  <td>{v.estado_gestion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      />
      <h3>Todos</h3>
      <VistaEstado
        estado={estado}
        render={(lista) => (
          <table>
            <thead>
              <tr>
                <th>Propiedad</th>
                <th>Inicio</th>
                <th>Fin</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id}>
                  <td>{c.property_id.slice(0, 8)}</td>
                  <td>{c.fecha_inicio.slice(0, 10)}</td>
                  <td>{c.fecha_fin.slice(0, 10)}</td>
                  <td>{c.estado}</td>
                  <td>
                    <button
                      onClick={() =>
                        void ejecutar(`/contratos/${c.id}/renovar`, {}, 'Contrato renovado.')
                      }
                    >
                      Renovar
                    </button>{' '}
                    <button
                      onClick={() =>
                        void ejecutar(
                          `/contratos/${c.id}/no-renovar`,
                          { motivo: 'No renovación desde el panel.' },
                          'No renovación registrada.',
                        )
                      }
                    >
                      No renovar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      />
    </section>
  );
}
