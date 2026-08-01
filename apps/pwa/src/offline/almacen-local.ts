import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/**
 * Almacenamiento local de la PWA de campo (feature #15, R2, R3, R10).
 *
 * IndexedDB con tres stores:
 * - `inventarios`: borradores descargados (versión base = `updated_at` del
 *   servidor) y creados en campo (`origen: 'local'` hasta el primer sync).
 * - `cola`: operaciones pendientes (R4).
 * - `cache`: propiedades, plantillas por tipo y el refresh token (R10).
 *
 * Los tokens NUNCA van a `localStorage` (R10): viven en esta base.
 */

export interface InventarioLocal {
  id: string;
  propiedad_id: string;
  tipo_evento: 'ENTREGA' | 'DEVOLUCION';
  estado: string;
  origen: 'servidor' | 'local';
  /** Versión base: `updated_at` del servidor en el último sync (R4, R6). */
  base_version: string | null;
  updated_at: string | null;
  zonas: Array<{
    id: string;
    nombre: string;
    repetible: boolean;
    orden: number;
    items: Array<{
      id: string;
      nombre: string;
      field_type: string;
      estado_checklist: string | null;
      comentario: string | null;
      valor_respuesta: Record<string, unknown> | null;
      fotos: Array<{ id: string; datos: Blob; mime: string }>;
    }>;
  }>;
}

export type TipoOperacion =
  | 'crear_inventario'
  | 'crear_zona'
  | 'editar_zona'
  | 'crear_item'
  | 'responder_item'
  | 'subir_foto';

export interface OperacionCola {
  id: string;
  tipo: TipoOperacion;
  /** id local de la entidad; para fotos, el id del ítem + sufijo. */
  entidad_id: string;
  /** id del inventario padre (orden R8: padres antes que hijos). */
  inventario_id: string;
  datos: Record<string, unknown>;
  base_version: string | null;
  orden: number;
  estado: 'pendiente' | 'confirmada' | 'conflicto';
  error: string | null;
  created_at: string;
}

export interface CacheValor {
  tipo: 'propiedades' | 'plantillas' | 'refresh_token';
  id: string;
  datos: unknown;
  guardado_en: string;
}

interface EsquemaLocal extends DBSchema {
  inventarios: {
    key: string;
    value: InventarioLocal;
  };
  cola: {
    key: string;
    value: OperacionCola;
    indexes: { 'por-orden': number };
  };
  cache: {
    key: string;
    value: CacheValor;
    indexes: { 'por-tipo': string };
  };
}

let db: IDBPDatabase<EsquemaLocal> | null = null;

export async function abrirAlmacen(): Promise<IDBPDatabase<EsquemaLocal>> {
  if (db) return db;
  db = await openDB<EsquemaLocal>('campo-offline', 1, {
    upgrade(laDb) {
      const cola = laDb.createObjectStore('cola', { keyPath: 'id' });
      cola.createIndex('por-orden', 'orden');
      laDb.createObjectStore('inventarios', { keyPath: 'id' });
      const cache = laDb.createObjectStore('cache', { keyPath: 'id' });
      cache.createIndex('por-tipo', 'tipo');
    },
  });
  return db;
}

export const almacen = {
  async guardarInventario(inv: InventarioLocal): Promise<void> {
    const laDb = await abrirAlmacen();
    await laDb.put('inventarios', inv);
  },
  async obtenerInventario(id: string): Promise<InventarioLocal | undefined> {
    const laDb = await abrirAlmacen();
    return laDb.get('inventarios', id);
  },
  async listarInventarios(): Promise<InventarioLocal[]> {
    const laDb = await abrirAlmacen();
    return laDb.getAll('inventarios');
  },
  async borrarInventario(id: string): Promise<void> {
    const laDb = await abrirAlmacen();
    await laDb.delete('inventarios', id);
  },

  async encolar(op: Omit<OperacionCola, 'id' | 'orden' | 'estado' | 'error' | 'created_at'>): Promise<OperacionCola> {
    const laDb = await abrirAlmacen();
    const previos = await laDb.getAll('cola');
    const orden = previos.reduce((m, o) => Math.max(m, o.orden), -1) + 1;
    const operacion: OperacionCola = {
      ...op,
      id: crypto.randomUUID(),
      orden,
      estado: 'pendiente',
      error: null,
      created_at: new Date().toISOString(),
    };
    await laDb.put('cola', operacion);
    return operacion;
  },
  async listarCola(): Promise<OperacionCola[]> {
    const laDb = await abrirAlmacen();
    const todas = await laDb.getAllFromIndex('cola', 'por-orden');
    return todas.sort((a, b) => a.orden - b.orden);
  },
  async pendientes(): Promise<OperacionCola[]> {
    const todas = await this.listarCola();
    return todas.filter((o) => o.estado !== 'confirmada');
  },
  async marcarConfirmada(id: string, baseVersion: string | null): Promise<void> {
    const laDb = await abrirAlmacen();
    const op = await laDb.get('cola', id);
    if (!op) return;
    await laDb.put('cola', { ...op, estado: 'confirmada', base_version: baseVersion, error: null });
  },
  async marcarConflicto(id: string, error: string): Promise<void> {
    const laDb = await abrirAlmacen();
    const op = await laDb.get('cola', id);
    if (!op) return;
    await laDb.put('cola', { ...op, estado: 'conflicto', error });
  },
  async reencolar(id: string): Promise<void> {
    const laDb = await abrirAlmacen();
    const op = await laDb.get('cola', id);
    if (!op) return;
    await laDb.put('cola', { ...op, estado: 'pendiente', error: null });
  },
  async reencolarConBase(id: string, baseVersion: string): Promise<void> {
    const laDb = await abrirAlmacen();
    const op = await laDb.get('cola', id);
    if (!op) return;
    await laDb.put('cola', { ...op, estado: 'pendiente', error: null, base_version: baseVersion });
  },
  async borrarOperacion(id: string): Promise<void> {
    const laDb = await abrirAlmacen();
    await laDb.delete('cola', id);
  },
  async vaciarCola(): Promise<void> {
    const laDb = await abrirAlmacen();
    const todas = await laDb.getAll('cola');
    await Promise.all(todas.map((o) => laDb.delete('cola', o.id)));
  },

  async guardarCache(tipo: CacheValor['tipo'], id: string, datos: unknown): Promise<void> {
    const laDb = await abrirAlmacen();
    await laDb.put('cache', {
      tipo,
      id: `${tipo}:${id}`,
      datos,
      guardado_en: new Date().toISOString(),
    });
  },
  async leerCache<T>(tipo: CacheValor['tipo'], id: string): Promise<T | null> {
    const laDb = await abrirAlmacen();
    const fila = await laDb.get('cache', `${tipo}:${id}`);
    return fila ? (fila.datos as T) : null;
  },
  async listarCache(tipo: CacheValor['tipo']): Promise<CacheValor[]> {
    const laDb = await abrirAlmacen();
    const todas = await laDb.getAllFromIndex('cache', 'por-tipo');
    return todas.filter((f) => f.tipo === tipo);
  },
  async limpiarCache(tipo: CacheValor['tipo']): Promise<void> {
    const laDb = await abrirAlmacen();
    const filas = await laDb.getAllFromIndex('cache', 'por-tipo');
    await Promise.all(
      filas.filter((f) => f.tipo === tipo).map((f) => laDb.delete('cache', f.id)),
    );
  },
};
