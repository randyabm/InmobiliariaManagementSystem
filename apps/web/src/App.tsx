import { useState } from 'react';
import type { JSX } from 'react';

import { ClienteWeb } from './api/cliente-web';
import { Login } from './vistas/Login';
import { Layout, type Vista } from './vistas/Layout';
import { Dashboard } from './vistas/Dashboard';
import { Inventarios } from './vistas/Inventarios';
import { Contratos } from './vistas/Contratos';
import { Clientes } from './vistas/Clientes';
import { Plantillas } from './vistas/Plantillas';
import { Pagos, Tickets } from './vistas/Operaciones';

/**
 * Panel web de administración (feature #28, PA-28-1): navegación por
 * estado, sin router. Login → Layout con las vistas.
 */
export function App(props: { cliente?: ClienteWeb } = {}): JSX.Element {
  const [api] = useState(
    () =>
      props.cliente ??
      new ClienteWeb({
        baseUrl: import.meta.env.VITE_API_URL ?? '/api',
        tenantId: import.meta.env.VITE_TENANT_ID ?? '',
      }),
  );
  const [usuario, setUsuario] = useState<{ nombre: string } | null>(null);
  const [vista, setVista] = useState<Vista>('dashboard');

  if (!usuario) {
    return <Login api={api} onLogin={(u) => setUsuario({ nombre: u.nombre })} />;
  }

  const contenido: Record<Vista, JSX.Element> = {
    dashboard: <Dashboard api={api} />,
    inventarios: <Inventarios api={api} />,
    contratos: <Contratos api={api} />,
    tickets: <Tickets api={api} />,
    pagos: <Pagos api={api} />,
    clientes: <Clientes api={api} />,
    plantillas: <Plantillas api={api} />,
  };

  return (
    <Layout
      vista={vista}
      onNavegar={setVista}
      usuario={usuario}
      onCerrarSesion={() => {
        void api.cerrarSesion();
        setUsuario(null);
      }}
    >
      {contenido[vista]}
    </Layout>
  );
}
