import type { JSX } from 'react';

export type Vista =
  | 'dashboard'
  | 'inventarios'
  | 'contratos'
  | 'clientes'
  | 'plantillas';

/**
 * Layout del panel (feature #28, R2–R5): sidebar con las secciones y el
 * usuario de la sesión.
 */
export function Layout(props: {
  vista: Vista;
  onNavegar: (vista: Vista) => void;
  usuario: { nombre: string };
  onCerrarSesion: () => void;
  children: JSX.Element;
}): JSX.Element {
  const secciones: Array<{ clave: Vista; etiqueta: string }> = [
    { clave: 'dashboard', etiqueta: 'Dashboard' },
    { clave: 'inventarios', etiqueta: 'Inventarios' },
    { clave: 'contratos', etiqueta: 'Contratos' },
    { clave: 'clientes', etiqueta: 'Clientes' },
    { clave: 'plantillas', etiqueta: 'Plantillas' },
  ];

  return (
    <div className="panel">
      <nav>
        <h1>Gestión Inmobiliaria</h1>
        <ul>
          {secciones.map((s) => (
            <li key={s.clave}>
              <button
                className={props.vista === s.clave ? 'activo' : ''}
                onClick={() => props.onNavegar(s.clave)}
              >
                {s.etiqueta}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="contenido">
        <header>
          <span>{props.usuario.nombre}</span>
          <button onClick={props.onCerrarSesion}>Cerrar sesión</button>
        </header>
        {props.children}
      </div>
    </div>
  );
}
