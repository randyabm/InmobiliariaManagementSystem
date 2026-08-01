import { beforeEach, describe, expect, it, vi } from 'vitest';
import { abrirAlmacen, almacen } from '../../offline/almacen-local';
import { ClienteApi, type Peticion, type Respuesta, type Transporte } from '../cliente-api';

/**
 * E2E de sesión (T13 → R10): 401 → refresh → reintento; refresh fallido →
 * logout revocado. Tokens en IndexedDB, nunca en localStorage.
 */
class TransporteSesion implements Transporte {
  refreshValido = true;
  llamadas: Array<{ ruta: string; headers: Record<string, string> | undefined }> = [];

  async request(peticion: Peticion): Promise<Respuesta> {
    this.llamadas.push({ ruta: peticion.ruta, headers: peticion.headers });
    if (peticion.ruta === '/auth/refresh') {
      if (!this.refreshValido) return { status: 401, cuerpo: {} };
      return {
        status: 201,
        cuerpo: { access_token: 'access-nuevo', refresh_token: 'refresh-nuevo' },
      };
    }
    if (peticion.ruta === '/inventarios') {
      // La primera llamada con el access vencido → 401 (fuerza el refresh).
      if (peticion.headers?.Authorization === 'Bearer access-vencido') {
        return { status: 401, cuerpo: {} };
      }
      return { status: 200, cuerpo: [] };
    }
    if (peticion.ruta === '/auth/logout') {
      return { status: 200, cuerpo: {} };
    }
    return { status: 404, cuerpo: {} };
  }
}

describe('E2E — sesión (T13: R10)', () => {
  let transporte: TransporteSesion;
  let api: ClienteApi;
  const onLogout = vi.fn();

  beforeEach(async () => {
    const db = await abrirAlmacen();
    await Promise.all([db.clear('cola'), db.clear('inventarios'), db.clear('cache')]);
    transporte = new TransporteSesion();
    onLogout.mockClear();
    api = new ClienteApi(transporte, onLogout);
    await almacen.guardarCache('refresh_token', 'vigente', {
      refresh_token: 'refresh-guardado',
    });
  });

  it('401 → refresh → reintento con el access nuevo (R10)', async () => {
    api.setAccessToken('access-vencido');
    const respuesta = await api.request('GET', '/inventarios');

    expect(respuesta.status).toBe(200);
    const rutas = transporte.llamadas.map((l) => l.ruta);
    expect(rutas).toEqual(['/inventarios', '/auth/refresh', '/inventarios']);
    // El refresh rotó y quedó guardado en IndexedDB.
    const guardado = await almacen.leerCache<{ refresh_token: string }>('refresh_token', 'vigente');
    expect(guardado?.refresh_token).toBe('refresh-nuevo');
    expect(onLogout).not.toHaveBeenCalled();
  });

  it('refresh fallido → logout (R10)', async () => {
    transporte.refreshValido = false;
    api.setAccessToken('access-vencido');

    await expect(api.request('GET', '/inventarios')).rejects.toThrow('Sesión expirada');
    expect(onLogout).toHaveBeenCalled();
    expect(await almacen.leerCache('refresh_token', 'vigente')).toBeNull();
  });

  it('los tokens viven en IndexedDB, nunca en localStorage (R10)', async () => {
    const guardado = await almacen.leerCache<{ refresh_token: string }>('refresh_token', 'vigente');
    expect(guardado?.refresh_token).toBe('refresh-guardado');
    // jsdom puede no exponer localStorage; si existe, debe estar vacío.
    if (typeof localStorage !== 'undefined') {
      expect(localStorage.getItem('access_token')).toBeNull();
      expect(localStorage.getItem('refresh_token')).toBeNull();
    }
  });
});
