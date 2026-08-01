import { useCallback, useEffect, useState } from 'react';
import { ClienteApi, TransporteFetch } from './api/cliente-api';
import { almacen } from './offline/almacen-local';
import { MotorSync, refrescarCache } from './offline/motor-sync';
import { useSync } from './estado/use-sync';

/**
 * Shell de la PWA de campo (feature #15, R1, R2) con los tres estados
 * explícitos de `docs/conventions.md`: login → lista → editor.
 */
export function App(): React.JSX.Element {
  const [api, setApi] = useState<ClienteApi | null>(null);
  const [motor, setMotor] = useState<MotorSync | null>(null);
  const [vista, setVista] = useState<'login' | 'lista' | 'editor'>('login');
  const [inventarioActivo, setInventarioActivo] = useState<string | null>(null);

  useEffect(() => {
    const cliente = new ClienteApi(
      new TransporteFetch(
        import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
        import.meta.env.VITE_TENANT_ID ?? '',
      ),
    );
    setApi(cliente);
    setMotor(new MotorSync(cliente));
  }, []);

  const iniciarSesion = useCallback(
    async (codigo: string, email: string, password: string) => {
      if (!api || !motor) return;
      await api.login(codigo, email, password);
      await refrescarCache(api); // R3: prefetch de campo
      await motor.sincronizar();
      setVista('lista');
    },
    [api, motor],
  );

  const cerrar = useCallback(async () => {
    await api?.cerrarSesion();
    setVista('login');
  }, [api]);

  const sync = useSync(motor);

  if (vista === 'login' || !api || !motor) {
    return (
      <PantallaLogin
        enLinea={sync.enLinea}
        iniciarSesion={iniciarSesion}
      />
    );
  }

  if (vista === 'editor' && inventarioActivo) {
    return (
      <EditorInventario
        inventarioId={inventarioActivo}
        atras={() => setVista('lista')}
        motor={motor}
      />
    );
  }

  return (
    <ListaBorradores
      enLinea={sync.enLinea}
      pendientes={sync.pendientes}
      conflictos={sync.conflictos}
      sincronizando={sync.sincronizando}
      sincronizarAhora={sync.sincronizarAhora}
      abrir={(id) => {
        setInventarioActivo(id);
        setVista('editor');
      }}
      crearNuevo={async (propiedadId, tipoEvento) => {
        const inv = await motor.crearInventarioLocal(propiedadId, tipoEvento);
        setInventarioActivo(inv.id);
        setVista('editor');
      }}
      cerrar={cerrar}
    />
  );
}

function PantallaLogin(props: {
  enLinea: boolean;
  iniciarSesion: (codigo: string, email: string, password: string) => Promise<void>;
}): React.JSX.Element {
  const [codigo, setCodigo] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    try {
      await props.iniciarSesion(codigo, email, password);
    } catch {
      setError('No se pudo iniciar sesión.');
    }
  };

  return (
    <main>
      <h1>Campo — Gestión Inmobiliaria</h1>
      <p>{props.enLinea ? 'En línea' : 'Sin conexión: la app sigue funcionando.'}</p>
      <form onSubmit={enviar}>
        <label>
          Inmobiliaria
          <input value={codigo} onChange={(e) => setCodigo(e.target.value)} />
        </label>
        <label>
          Correo
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Contraseña
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button type="submit" disabled={!props.enLinea}>
          Entrar
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </main>
  );
}

function ListaBorradores(props: {
  enLinea: boolean;
  pendientes: number;
  conflictos: number;
  sincronizando: boolean;
  sincronizarAhora: () => Promise<void>;
  abrir: (id: string) => void;
  crearNuevo: (propiedadId: string, tipoEvento: 'ENTREGA' | 'DEVOLUCION') => Promise<void>;
  cerrar: () => Promise<void>;
}): React.JSX.Element {
  const [inventarios, setInventarios] = useState<Array<{ id: string; propiedad_id: string; tipo_evento: string; origen: string }>>([]);
  const [propiedades, setPropiedades] = useState<Array<{ id: string; direccion: string }>>([]);

  useEffect(() => {
    void (async () => {
      setInventarios((await almacen.listarInventarios()) as never[]);
      const cacheadas = await almacen.listarCache('propiedades');
      setPropiedades(cacheadas.map((f) => f.datos as { id: string; direccion: string }));
    })();
  }, [props.pendientes]);

  return (
    <main>
      <header>
        <h1>Inventarios</h1>
        {props.pendientes > 0 ? (
          <p role="status">
            {props.pendientes} operaciones pendientes de sincronizar
            {props.conflictos > 0 ? ` (${props.conflictos} en conflicto)` : ''}
          </p>
        ) : (
          <p>Sincronizado</p>
        )}
        <button onClick={() => void props.sincronizarAhora()} disabled={!props.enLinea || props.sincronizando}>
          Sincronizar ahora
        </button>
        <button onClick={() => void props.cerrar()}>Cerrar sesión</button>
      </header>
      <ul>
        {inventarios.map((inv) => (
          <li key={inv.id}>
            <button onClick={() => props.abrir(inv.id)}>
              {inv.propiedad_id} — {inv.tipo_evento} ({inv.origen})
            </button>
          </li>
        ))}
      </ul>
      <select
        data-testid="select-propiedad"
        onChange={(e) => {
          const id = e.target.value;
          if (id) void props.crearNuevo(id, 'ENTREGA');
        }}
      >
        <option value="">Crear inventario en…</option>
        {propiedades.map((p) => (
          <option key={p.id} value={p.id}>
            {p.direccion}
          </option>
        ))}
      </select>
    </main>
  );
}

function EditorInventario(props: { inventarioId: string; atras: () => void; motor: MotorSync }): React.JSX.Element {
  const [inventario, setInventario] = useState<{ id: string; zonas: Array<{ id: string; nombre: string; items: Array<{ id: string; nombre: string }> }> } | null>(null);
  const [foto, setFoto] = useState<File | null>(null);

  useEffect(() => {
    void (async () => {
      const inv = await almacen.obtenerInventario(props.inventarioId);
      if (inv) setInventario(inv as never);
    })();
  }, [props.inventarioId]);

  if (!inventario) return <p>Cargando…</p>;

  return (
    <main>
      <header>
        <button onClick={props.atras}>← Volver</button>
        <h1>Inventario {inventario.id.slice(0, 8)}</h1>
      </header>
      {inventario.zonas.map((zona) => (
        <section key={zona.id}>
          <h2>{zona.nombre}</h2>
          <ul>
            {zona.items.map((item) => (
              <li key={item.id}>
                {item.nombre}
                <button
                  onClick={() => {
                    void props.motor.responderItemLocal(props.inventarioId, item.id, {
                      estado_checklist: 'BUENO',
                    });
                    setInventario({ ...inventario });
                  }}
                >
                  Bueno
                </button>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const archivo = e.target.files?.[0] ?? null;
                    setFoto(archivo);
                    if (archivo) {
                      void props.motor.adjuntarFotoLocal(props.inventarioId, item.id, archivo);
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {foto ? <p>Foto encolada para comprimir y sincronizar.</p> : null}
    </main>
  );
}
