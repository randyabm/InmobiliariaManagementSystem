import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';

/**
 * Portales embebibles (feature #32, R2–R5, §6.6, D7).
 * El handshake SSO (RF-INT3) es un token de UN solo uso con expiración de
 * 5 min firmado con el secreto del sistema (PA-32-2).
 */
@Injectable()
export class PortalService {
  private readonly jwt: JwtService;

  constructor() {
    this.jwt = new JwtService({ secret: process.env.JWT_SECRET ?? 'dev' });
  }

  /** PA-32-2 — el contexto externo (WordPress) firma el handshake. */
  firmarHandshake(ctx: ContextoPeticion, dominio: string): string {
    return this.jwt.sign({
      dominio,
      sub: ctx.actorId ?? '',
      roles: ctx.roles ?? [],
      jti: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      exp: Math.floor(Date.now() / 1000) + 300,
    });
  }

  /** R2 — canjear el handshake por un access token real (una sola vez). */
  async canjearHandshake(ctx: ContextoPeticion, token: string): Promise<{
    dominio: string;
    rol: string;
    user_id: string;
    access_token: string;
  }> {
    try {
      const payload = (await this.jwt.verifyAsync(token)) as {
        dominio?: unknown;
        sub?: unknown;
        roles?: Array<{ rol?: unknown }>;
        jti?: unknown;
      };
      if (
        typeof payload.dominio !== 'string' ||
        typeof payload.sub !== 'string' ||
        !Array.isArray(payload.roles)
      ) {
        throw new Error('handshake inválido');
      }

      // Feature flag por tenant (RF-INT6, R5): el dominio debe estar
      // registrado con paquete web.
      const { rows: dominio } = await ctx.cliente.query<{ paquete_web: string; tenant_id: string }>(
        `SELECT paquete_web, tenant_id::text AS tenant_id FROM tenant_dominio
          WHERE tenant_id = $1 AND dominio = $2 AND activo = true`,
        [ctx.tenantId, payload.dominio],
      );
      if (dominio.length === 0) throw new Error('dominio no registrado');

      const rol = payload.roles[0]?.rol;
      if (typeof rol !== 'string') throw new Error('rol inválido');
      const permitido =
        (rol === 'inquilino' && ['portal_inquilino', 'web_completo'].includes(dominio[0]!.paquete_web)) ||
        (rol === 'propietario' && ['portal_propietario', 'web_completo'].includes(dominio[0]!.paquete_web));
      if (!permitido) throw new Error('paquete no cubre el rol');

      return {
        dominio: payload.dominio,
        rol,
        user_id: payload.sub,
        access_token: this.jwt.sign({
          sub: payload.sub,
          roles: payload.roles,
          rol_activo: rol,
          jti: payload.jti,
          ver: 0,
        }),
      };
    } catch {
      throw new ResourceNotFoundError();
    }
  }

  /** R4 — configuración pública del tenant para el portal (theming). */
  async configPublica(ctx: ContextoPeticion, dominio: string): Promise<{
    dominio: string;
    paquete_web: string;
    logo_url: string | null;
    colores: Record<string, string> | null;
  }> {
    const { rows } = await ctx.cliente.query<{
      paquete_web: string;
      logo_url: string | null;
      colores_json: unknown;
    }>(
      `SELECT paquete_web, logo_url, colores_json FROM tenant_dominio
        WHERE tenant_id = $1 AND dominio = $2 AND activo = true`,
      [ctx.tenantId, dominio],
    );
    if (rows.length === 0) throw new ResourceNotFoundError();
    return {
      dominio,
      paquete_web: rows[0]!.paquete_web,
      logo_url: rows[0]!.logo_url,
      colores:
        typeof rows[0]!.colores_json === 'object' && rows[0]!.colores_json !== null
          ? (rows[0]!.colores_json as Record<string, string>)
          : null,
    };
  }
}
