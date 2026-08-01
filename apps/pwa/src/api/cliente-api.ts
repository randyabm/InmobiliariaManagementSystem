/**
 * Cliente de la API (feature #15, R10) — transporte inyectable.
 *
 * El E2E (R11) inyecta un transporte mock que «pierde la conexión»; en
 * producción es `fetch` contra la API real. El 401 dispara refresh → un
 * reintento → logout si el refresh falla (R10). Los tokens viven en
 * IndexedDB (`caché`), nunca en `localStorage` (R10).
 */
import { almacen } from '../offline/almacen-local';

export interface Peticion {
  metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  ruta: string;
  cuerpo?: unknown;
  headers?: Record<string, string>;
}

export interface Respuesta {
  status: number;
  cuerpo: unknown;
}

export interface Transporte {
  request(peticion: Peticion): Promise<Respuesta>;
}

/** Transporte real: fetch contra la API con el tenant en cabecera. */
export class TransporteFetch implements Transporte {
  constructor(
    private readonly baseUrl: string,
    private readonly tenantId: string,
  ) {}

  async request(peticion: Peticion): Promise<Respuesta> {
    const esFormData = peticion.cuerpo instanceof FormData;
    const respuesta = await fetch(`${this.baseUrl}${peticion.ruta}`, {
      method: peticion.metodo,
      headers: {
        ...(esFormData ? {} : { 'Content-Type': 'application/json' }),
        'x-tenant-id': this.tenantId,
        ...peticion.headers,
      },
      body:
        peticion.cuerpo === undefined
          ? undefined
          : esFormData
            ? (peticion.cuerpo as FormData)
            : JSON.stringify(peticion.cuerpo),
    });
    let cuerpo: unknown = null;
    const texto = await respuesta.text();
    if (texto) {
      try {
        cuerpo = JSON.parse(texto);
      } catch {
        cuerpo = texto;
      }
    }
    return { status: respuesta.status, cuerpo };
  }
}

export interface SesionActiva {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email: string | null; nombre: string };
}

export class ClienteApi {
  private accessToken: string | null = null;

  constructor(
    private readonly transporte: Transporte,
    private readonly enLogout: () => Promise<void> | void = () => undefined,
  ) {}

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  /** R10 — login estándar #27; el refresh se guarda en IndexedDB. */
  async login(codigo: string, email: string, password: string): Promise<SesionActiva> {
    const respuesta = await this.transporte.request({
      metodo: 'POST',
      ruta: '/auth/login',
      cuerpo: { codigo, email, password },
    });
    if (respuesta.status !== 201) {
      throw new Error('Credenciales inválidas.');
    }
    const sesion = respuesta.cuerpo as SesionActiva;
    this.accessToken = sesion.access_token;
    await almacen.guardarCache('refresh_token', 'vigente', {
      refresh_token: sesion.refresh_token,
    });
    return sesion;
  }

  async cerrarSesion(): Promise<void> {
    try {
      await this.request('POST', '/auth/logout', undefined);
    } catch {
      // Sin conexión: la sesión se revoca en el servidor en el próximo sync.
    }
    this.accessToken = null;
    await almacen.limpiarCache('refresh_token');
    await this.enLogout();
  }

  /** R10 — 401 → refresh → reintento; refresh fallido → logout. */
  async request<T = unknown>(
    metodo: Peticion['metodo'],
    ruta: string,
    cuerpo?: unknown,
  ): Promise<{ status: number; cuerpo: T }> {
    const ejecutar = (token: string | null): Promise<Respuesta> =>
      this.transporte.request({
        metodo,
        ruta,
        cuerpo,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

    let respuesta = await ejecutar(this.accessToken);
    if (respuesta.status === 401 && ruta !== '/auth/login') {
      const rotado = await this.rotarRefresh();
      if (rotado) {
        respuesta = await ejecutar(this.accessToken);
      } else {
        await this.cerrarSesion();
        throw new Error('Sesión expirada.');
      }
    }
    return { status: respuesta.status, cuerpo: respuesta.cuerpo as T };
  }

  private async rotarRefresh(): Promise<boolean> {
    const guardado = await almacen.leerCache<{ refresh_token: string }>(
      'refresh_token',
      'vigente',
    );
    if (!guardado) return false;
    const respuesta = await this.transporte.request({
      metodo: 'POST',
      ruta: '/auth/refresh',
      cuerpo: { refresh_token: guardado.refresh_token },
    });
    if (respuesta.status !== 201) return false;
    const cuerpo = respuesta.cuerpo as { access_token: string; refresh_token: string };
    this.accessToken = cuerpo.access_token;
    await almacen.guardarCache('refresh_token', 'vigente', {
      refresh_token: cuerpo.refresh_token,
    });
    return true;
  }
}
