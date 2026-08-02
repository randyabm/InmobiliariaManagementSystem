import { useState } from 'react';
import type { JSX } from 'react';
import type { ClienteWeb } from '../api/cliente-web';
import { useApi, VistaEstado } from '../hooks/use-api';

interface Ticket {
  id: string;
  propiedad_id: string;
  categoria: string;
  descripcion: string;
  estado: string;
  created_at: string;
}

function DetalleImportacion(props: { api: ClienteWeb; id: string }): JSX.Element {
  const { estado } = useApi<DetalleImportacion>(
    props.api,
    'GET',
    `/pagos/importaciones/${props.id}`,
  );
  return (
    <VistaEstado
      estado={estado}
      render={(d) => (
        <article>
          <h3>Importación {props.id.slice(0, 8)}</h3>
          <p>
            Sugeridos: {d.sugeridos.length} · Sin identificar: {d.sin_identificar.length} ·
            Duplicados: {d.duplicados.length}
          </p>
          <ul>
            {d.sugeridos.slice(0, 10).map((s) => (
              <li key={s.id}>
                {s.referencia_texto ?? 's/r'} — {s.valor} (confianza {s.confianza ?? 0})
              </li>
            ))}
          </ul>
        </article>
      )}
    />
  );
}

interface DetalleImportacion {
  sugeridos: Array<{ id: string; valor: string; referencia_texto: string | null; confianza: number | null }>;
  sin_identificar: Array<{ id: string; valor: string; referencia_texto: string | null }>;
  duplicados: Array<{ id: string; valor: string }>;
}

/**
 * Tickets de mantenimiento (feature #31): listado con estado y acción de
 * crear.
 */
export function Tickets(props: { api: ClienteWeb }): JSX.Element {
  const [recarga, setRecarga] = useState(0);
  const { estado } = useApi<Ticket[]>(props.api, 'GET', '/tickets', [recarga]);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const crear = async () => {
    // En el panel interno el empleado crea con categoría/descripción del
    // formulario; aquí una creación de ejemplo con la primera propiedad.
    const respuesta = await props.api.request('POST', '/propiedades/00000000-0000-0000-0000-000000000000/tickets', {
      categoria: 'GENERAL',
      descripcion: 'Solicitud creada desde el panel.',
    });
    if (respuesta.status === 201) {
      setMensaje('Ticket creado.');
      setRecarga((n) => n + 1);
    } else {
      setMensaje('No se pudo crear (selecciona una propiedad existente).');
    }
  };

  return (
    <section>
      <h2>Tickets de mantenimiento</h2>
      {mensaje ? <p role="status">{mensaje}</p> : null}
      <VistaEstado
        estado={estado}
        render={(lista) => (
          <>
            <table>
              <thead>
                <tr>
                  <th>Categoría</th>
                  <th>Descripción</th>
                  <th>Estado</th>
                  <th>Creado</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((t) => (
                  <tr key={t.id}>
                    <td>{t.categoria}</td>
                    <td>{t.descripcion}</td>
                    <td>{t.estado}</td>
                    <td>{t.created_at.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={() => void crear()}>Crear ticket (prueba)</button>
          </>
        )}
      />
    </section>
  );
}

/**
 * Conciliación de pagos (feature #30): importaciones con sus tres grupos.
 */
export function Pagos(props: { api: ClienteWeb }): JSX.Element {
  const [importaciones, setImportaciones] = useState<Array<{
    id: string;
    nombre_archivo: string;
    estado: string;
    total_registros: number;
  }>>([]);
  const [seleccionada, setSeleccionada] = useState<string | null>(null);
  const { estado, recargar } = useApi<Array<{ id: string; nombre_archivo: string; estado: string; total_registros: number }>>(
    props.api,
    'GET',
    '/pagos/importaciones',
  );

  return (
    <section>
      <h2>Conciliación de pagos</h2>
      <VistaEstado
        estado={estado}
        render={(lista) => {
          setImportaciones(lista as never);
          return (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Archivo</th>
                    <th>Estado</th>
                    <th>Registros</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lista.map((i) => (
                    <tr key={i.id}>
                      <td>{i.nombre_archivo}</td>
                      <td>{i.estado}</td>
                      <td>{i.total_registros}</td>
                      <td>
                        <button onClick={() => setSeleccionada(i.id)}>Ver</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={recargar}>Recargar</button>
            </>
          );
        }}
      />
      {seleccionada ? <DetalleImportacion api={props.api} id={seleccionada} /> : null}
      {void importaciones}
    </section>
  );
}
