import { useState } from 'react';
import type { JSX } from 'react';
import type { ClienteWeb } from '../api/cliente-web';
import { useApi, VistaEstado } from '../hooks/use-api';

interface Plantilla {
  id: string;
  tipo: string;
  origen: string;
  nombre: string;
}

/**
 * Plantillas de inventario (feature #28, R5, #11): listar y clonar.
 */
export function Plantillas(props: { api: ClienteWeb }): JSX.Element {
  const [recarga, setRecarga] = useState(0);
  const { estado } = useApi<Plantilla[]>(props.api, 'GET', '/plantillas', [recarga]);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const clonar = async (id: string) => {
    try {
      const respuesta = await props.api.request('POST', `/plantillas/${id}/clonar`);
      if (respuesta.status >= 400) {
        setMensaje('No se pudo clonar (¿ya existe una copia del tenant?).');
        return;
      }
      setMensaje('Plantilla clonada para el tenant.');
      setRecarga((n) => n + 1);
    } catch {
      setMensaje('No se pudo clonar.');
    }
  };

  return (
    <section>
      <h2>Plantillas de inventario</h2>
      {mensaje ? <p role="status">{mensaje}</p> : null}
      <VistaEstado
        estado={estado}
        render={(lista) => (
          <table>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Nombre</th>
                <th>Origen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id}>
                  <td>{p.tipo}</td>
                  <td>{p.nombre}</td>
                  <td>{p.origen}</td>
                  <td>
                    {p.origen === 'SISTEMA' ? (
                      <button onClick={() => void clonar(p.id)}>Clonar para el tenant</button>
                    ) : null}
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
