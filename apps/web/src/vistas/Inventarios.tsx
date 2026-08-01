import { useState } from 'react';
import type { JSX } from 'react';
import type { ClienteWeb } from '../api/cliente-web';
import { useApi, VistaEstado } from '../hooks/use-api';

interface FilaInventario {
  id: string;
  propiedad_id: string;
  tipo_evento: string;
  estado: string;
  created_at: string;
}

/**
 * Panel de inventarios (feature #28, R3, RF-I13): lista con filtros y
 * ficha del inventario con su estado.
 */
export function Inventarios(props: { api: ClienteWeb }): JSX.Element {
  const [estadoFiltro, setEstadoFiltro] = useState('');
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const { estado, recargar } = useApi<FilaInventario[]>(
    props.api,
    'GET',
    `/inventarios${estadoFiltro ? `?estado=${estadoFiltro}` : ''}`,
    [estadoFiltro],
  );

  return (
    <section>
      <h2>Inventarios</h2>
      <label>
        Estado
        <select value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value)}>
          <option value="">Todos</option>
          <option value="BORRADOR">Borrador</option>
          <option value="ENVIADO">Enviado</option>
          <option value="EN_REVISION">En revisión</option>
          <option value="EN_NEGOCIACION">En negociación</option>
          <option value="ACORDADO">Acordado</option>
          <option value="FIRMADO">Firmado</option>
          <option value="CERRADO">Cerrado</option>
        </select>
      </label>
      <VistaEstado
        estado={estado}
        render={(lista) => (
          <>
            <table>
              <thead>
                <tr>
                  <th>Propiedad</th>
                  <th>Evento</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lista.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.propiedad_id.slice(0, 8)}</td>
                    <td>{inv.tipo_evento}</td>
                    <td>{inv.estado}</td>
                    <td>
                      <button onClick={() => setSeleccionado(inv.id)}>Ver</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={recargar}>Recargar</button>
          </>
        )}
      />
      {seleccionado ? <FichaInventario api={props.api} id={seleccionado} onCerrar={() => setSeleccionado(null)} /> : null}
    </section>
  );
}

function FichaInventario(props: {
  api: ClienteWeb;
  id: string;
  onCerrar: () => void;
}): JSX.Element {
  const { estado } = useApi<{
    estado: string;
    tipo_evento: string;
    zonas: Array<{
      nombre: string;
      items: Array<{ nombre: string; estado_checklist: string | null; comentario: string | null }>;
    }>;
  }>(props.api, 'GET', `/inventarios/${props.id}`);

  return (
    <article>
      <h3>Inventario {props.id.slice(0, 8)}</h3>
      <VistaEstado
        estado={estado}
        render={(datos) => (
          <>
            <p>
              Estado: <strong>{datos.estado}</strong> — {datos.tipo_evento}
            </p>
            {datos.zonas.map((zona) => (
              <div key={zona.nombre}>
                <h4>{zona.nombre}</h4>
                <ul>
                  {zona.items.map((item) => (
                    <li key={item.nombre}>
                      {item.nombre}: {item.estado_checklist ?? 'sin respuesta'}
                      {item.comentario ? ` — ${item.comentario}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
      />
      <button onClick={props.onCerrar}>Cerrar</button>
    </article>
  );
}
