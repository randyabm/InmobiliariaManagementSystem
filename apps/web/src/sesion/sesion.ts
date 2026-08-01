import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/**
 * Sesión del panel web (feature #28, R1, R6).
 *
 * El refresh token vive en IndexedDB — NUNCA en localStorage (patrón de
 * #15); el access token se conserva en memoria en `ClienteWeb`.
 */

interface EsquemaSesion extends DBSchema {
  sesion: {
    key: string;
    value: { id: string; refresh_token: string; guardado_en: string };
  };
}

let db: IDBPDatabase<EsquemaSesion> | null = null;

async function abrir(): Promise<IDBPDatabase<EsquemaSesion>> {
  if (db) return db;
  db = await openDB<EsquemaSesion>('panel-web-sesion', 1, {
    upgrade(laDb) {
      laDb.createObjectStore('sesion', { keyPath: 'id' });
    },
  });
  return db;
}

export const sesion = {
  async guardarRefresh(refreshToken: string): Promise<void> {
    const laDb = await abrir();
    await laDb.put('sesion', {
      id: 'vigente',
      refresh_token: refreshToken,
      guardado_en: new Date().toISOString(),
    });
  },
  async leerRefresh(): Promise<string | null> {
    const laDb = await abrir();
    const fila = await laDb.get('sesion', 'vigente');
    return fila?.refresh_token ?? null;
  },
  async limpiar(): Promise<void> {
    const laDb = await abrir();
    await laDb.delete('sesion', 'vigente');
  },
};
