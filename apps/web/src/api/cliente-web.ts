/**
 * Cliente de la API para los paneles web (feature #28, R1, R6, PA-28-1).
 *
 * Transporte inyectable (fetch real en producción, mock en tests). El 401
 * rota el refresh token (IndexedDB) y reintenta; si el refresh falla,
 * cierra sesión. El access token vive en memoria (R6).
 */
import { sesion } from '../sesion/sesion';

export interface Peticion {
  metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
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

export class TransporteFetch implements Transporte {
  constructor(
    private readonly baseUrl: string,
    private readonly tenantId: string,
  ) {}

  async request(peticion: Peticion): Promise<Respuesta> {
    const respuesta = await fetch(`${this.baseUrl}${peticion.ruta}`, {
      method: peticion.metodo,
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': this.tenantId,
        ...peticion.headers,
      },
      body: peticion.cuerpo === undefined ? undefined : JSON.stringify(peticion.cuerpo),
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

export interface UsuarioLogueado {
  id: string;
  email: string | null;
  nombre: string;
}

export class ClienteWeb {
  private accessToken: string | null = null;
  private readonly transporte: Transporte;
  private readonly enLogout: () => void;

  constructor(opciones: {
    baseUrl?: string;
    tenantId?: string;
    transporte?: Transporte;
    enLogout?: () => void;
  } = {}) {
    const baseUrl = opciones.baseUrl ?? '';
    const tenantId = opciones.tenantId ?? '';
    this.transporte =
      opciones.transporte ?? new TransporteFetch(baseUrl, tenantId);
    this.enLogout = opciones.enLogout ?? (() => undefined);
  }

  get autenticado(): boolean {
    return this.accessToken !== null;
  }

  /** R1 — login estándar #27; el refresh se guarda en IndexedDB (R6). */
  async login(codigo: string, email: string, password: string): Promise<UsuarioLogueado> {
    const respuesta = await this.transporte.request({
      metodo: 'POST',
      ruta: '/auth/login',
      cuerpo: { codigo, email, password },
    });
    if (respuesta.status !== 201) {
      throw new Error('Credenciales inválidas.');
    }
    const cuerpo = respuesta.cuerpo as {
      access_token: string;
      refresh_token: string;
      user: UsuarioLogueado;
    };
    this.accessToken = cuerpo.access_token;
    await sesion.guardarRefresh(cuerpo.refresh_token);
    return cuerpo.user;
  }

  async cerrarSesion(): Promise<void> {
    try {
      await this.request('POST', '/auth/logout');
    } catch {
      // Sin red o sin sesión: el refresh se limpia igual.
    }
    this.accessToken = null;
    await sesion.limpiar();
    this.enLogout();
  }

  /** R1 — 401 → refresh → reintento; refresh fallido → logout. */
  async request<T = unknown>(
    metodo: Peticion['metodo'],
    ruta: string,
    cuerpo?: unknown,
  ): Promise<{ status: number; cuerpo: T }> {
    const peticion: Peticion = { metodo, ruta, cuerpo };
    if (this.accessToken) {
      peticion.headers = { Authorization: `Bearer ${this.accessToken}` };
    }
    const respuesta = await this.transporte.request(peticion);
    if (respuesta.status === 401 && this.accessToken && ruta !== '/auth/login') {
      const rotado = await this.rotarRefresh();
      if (rotado && this.accessToken) {
        const reintento: Peticion = {
          metodo,
          ruta,
          cuerpo,
          headers: { Authorization: `Bearer ${this.accessToken}` },
        };
        const segunda = await this.transporte.request(reintento);
        return { status: segunda.status, cuerpo: segunda.cuerpo as T };
      }
      await this.cerrarSesion();
      throw new Error('Sesión expirada.');
    }
    return { status: respuesta.status, cuerpo: respuesta.cuerpo as T };
  }

  private async rotarRefresh(): Promise<boolean> {
    const refreshToken = await sesion.leerRefresh();
    if (!refreshToken) return false;
    const respuesta = await this.transporte.request({
      metodo: 'POST',
      ruta: '/auth/refresh',
      cuerpo: { refresh_token: refreshToken },
    });
    if (respuesta.status !== 201) return false;
    const cuerpo = respuesta.cuerpo as { access_token: string; refresh_token: string };
    this.accessToken = cuerpo.access_token;
    await sesion.guardarRefresh(cuerpo.refresh_token);
    return true;
  }
}
