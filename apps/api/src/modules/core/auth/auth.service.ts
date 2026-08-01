import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { PoolClient } from 'pg';

import { getDatabasePool } from '../../../database/database.client';
import {
  esCodigoDeInmobiliariaValido,
  normalizarCodigoDeInmobiliaria,
} from './codigo-inmobiliaria';
import { AuditService } from '../audit/audit.service';
import { CodigoDeInmobiliariaInvalidoError } from './errors/codigo-de-inmobiliaria-invalido.error';
import { RolNoDisponibleError } from './errors/rol-no-disponible.error';
import { SesionInvalidaError } from './errors/sesion-invalida.error';
import { hashToken, SesionesService } from './sesiones.service';

interface LoginDto {
  /** Código de la inmobiliaria en la que se entra (**R63**, D-12). */
  codigo?: string | null;
  email?: string | null;
  password?: string | null;
}

interface JwtTokenPayload {
  sub: string;
  email: string | null;
  tenant_id: string;
  roles: Array<{ tenant_id: string; rol: string }>;
  /**
   * Rol con el que la persona ha elegido actuar (**R16**, #26).
   *
   * **Opcional a propósito**: su ausencia es exactamente el comportamiento
   * anterior a esta feature (**R20**), así que ningún token ya emitido queda
   * invalidado y quien no elige rol —empleados, administradores— no nota nada.
   * Cuando está presente, **restringe**; nunca amplía (`roles.guard.ts`).
   */
  rol_activo?: string;
  /**
   * Id de la sesión (**R3**, #27). Obligatorio desde esta feature (R5): la
   * validación por petición lo usa para comprobar que la sesión sigue viva.
   */
  jti: string;
  /** `user.token_version` al emitir (**R3**, #27). Invalidado al revocar un rol (R12). */
  ver: number;
}

/**
 * Normaliza el email recibido en el login (**R8**, D-5).
 *
 * Devuelve `null` si es nulo, ausente, no es texto o queda vacío tras podar
 * espacios. Con `null` NO se consulta la base de datos. Desde D-5 hay muchas
 * identidades con `email IS NULL` (todo propietario registrado sin correo):
 * ninguna petición de login puede llegar a seleccionarlas.
 */
export function normalizarEmailDeLogin(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const limpio = email.trim();
  return limpio === '' ? null : limpio;
}

/**
 * Autenticación (feature #3, reescrita por **D-8** y **D-12**).
 *
 * ## Qué cambió y por qué
 *
 * Con D-8 las identidades no se comparten entre inmobiliarias, así que la
 * `UNIQUE(email)` global desapareció: **el correo ya no identifica a nadie por
 * sí solo**. `POST /auth/login` con `{email, password}` sería ambiguo —dos
 * personas distintas pueden tener el mismo correo en dos inmobiliarias—, y por
 * eso ahora exige además el `codigo` de la inmobiliaria (**R63**, **R65**).
 *
 * ## El login deja de ser la excepción
 *
 * Antes consultaba `user` con el pool crudo, **fuera de toda transacción con
 * contexto de tenant**, que es lo que la revisión señaló en B4.3. Eso era
 * tolerable solo mientras la aplicación fuese superusuario; en cuanto deja de
 * serlo, o devuelve 401 a todo el mundo o lee sin filtro. Ahora el flujo es
 * (**R66**, `design.md` §20.2):
 *
 * ```
 * 1. normalizar(codigo)                     trim + minúsculas (R74)
 * 2. tenant_por_codigo(codigo) → tenant_id  SECURITY DEFINER, exacto (R52)
 * 3. BEGIN; SET LOCAL app.current_tenant
 * 4. SELECT … FROM "user" WHERE email = $1  ya filtrado por RLS
 * ```
 *
 * El paso 2 es la **única** lectura que evita el RLS en todo el sistema, y no
 * toca `user`: devuelve un `uuid` a partir de un código que la propia
 * inmobiliaria reparte a sus usuarios.
 *
 * ## Un solo 401
 *
 * Código inexistente, correo de otra inmobiliaria, identidad sin
 * `password_hash` y contraseña equivocada responden **exactamente lo mismo**
 * (**R64**). El 400 se reserva para lo que es error de forma del `codigo`, que
 * no revela nada de quién es cliente del SaaS.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly audit: AuditService,
    private readonly sesiones: SesionesService,
  ) {}

  async login(dto: LoginDto): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user: { id: string; email: string | null; nombre: string };
  }> {
    // R63: el código es obligatorio y su forma se valida ANTES de tocar la
    // base. 400, y es la única respuesta distinta que da este endpoint.
    const codigo = normalizarCodigoDeInmobiliaria(dto?.codigo);
    if (codigo === null || !esCodigoDeInmobiliariaValido(codigo)) {
      throw new CodigoDeInmobiliariaInvalidoError();
    }

    // R8: email nulo, ausente o vacío -> 401 SIN consultar la base de datos.
    const email = normalizarEmailDeLogin(dto?.email);
    if (email === null) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const cliente = await getDatabasePool(process.env.DATABASE_URL!).connect();
    try {
      const tenantId = await this.resolverTenant(cliente, codigo);
      // R64: un código que no existe responde igual que unas credenciales
      // malas. Cualquier otra cosa convertiría el formulario de acceso en un
      // directorio de los clientes del SaaS.
      if (tenantId === null) {
        throw new UnauthorizedException('Credenciales inválidas');
      }

      return await this.autenticarEnTenant(cliente, tenantId, email, dto?.password);
    } finally {
      cliente.release();
    }
  }

  /**
   * `GET /auth/me`.
   *
   * Corre bajo contexto de tenant por el mismo motivo que el login: cuando la
   * aplicación deje de ser superusuario (T61), una consulta a `user` sin
   * `app.current_tenant` fijado devuelve **cero filas**. El tenant sale del
   * token, que desde **R67** lleva uno solo.
   */
  async getProfile(
    userId: string,
    tenantId: string,
  ): Promise<{
    id: string;
    email: string | null;
    nombre: string;
    roles: Array<{ tenant_id: string; rol: string }>;
  }> {
    const cliente = await getDatabasePool(process.env.DATABASE_URL!).connect();
    try {
      await cliente.query('BEGIN');
      await this.fijarTenant(cliente, tenantId);

      const { rows } = await cliente.query<{
        id: string;
        email: string | null;
        nombre: string;
      }>('SELECT id, email, nombre FROM "user" WHERE id = $1', [userId]);
      const encontrado = rows[0];

      if (!encontrado) {
        throw new UnauthorizedException('Usuario no encontrado');
      }

      const roles = await this.rolesActivos(cliente, userId);
      await cliente.query('COMMIT');
      return { ...encontrado, roles };
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      cliente.release();
    }
  }

  /**
   * `POST /auth/rol-activo` — elegir con qué rol se actúa (**R16**, **R17**,
   * **R19**, **R21**).
   *
   * Emite un `access_token` **nuevo** que declara `rol_activo`. El anterior
   * sigue siendo válido hasta que expire; esta feature no revoca nada.
   *
   * ## El rol se comprueba contra la BASE DE DATOS, no contra el token
   *
   * **R19.** Un token es un dato firmado pero **viejo**: si el rol se revocó
   * después de emitirlo, seguiría listándolo. Aceptar el rol "porque el token
   * lo dice" convertiría cada emisión en una prórroga automática de un permiso
   * que quizá ya no existe. Aquí se consulta `user_role` con `activo = true`
   * dentro del contexto de la inmobiliaria del token.
   *
   * ## Lo que esta feature NO cierra (PA-3, decisión del humano)
   *
   * Si el rol se revoca **después** de emitir este token, el token lo sigue
   * concediendo hasta que expire. Esa ventana **no se acepta**, y **no se
   * cierra aquí**: la cierra la feature **#27 `sesion_y_revocacion`** (refresh
   * tokens, revocación inmediata, cierre de sesión en servidor y auditoría de
   * la revocación), que ya está encolada. **#26 no implementa revocación**: se
   * limita a no empeorar el problema y a dejarle a #27 el claim sobre el que
   * construir.
   */
  async elegirRolActivo(
    userId: string,
    tenantId: string,
    rol: string,
    email: string | null = null,
    jti: string | undefined,
  ): Promise<{ access_token: string; rol_activo: string }> {
    const cliente = await getDatabasePool(process.env.DATABASE_URL!).connect();
    try {
      await cliente.query('BEGIN');
      await this.fijarTenant(cliente, tenantId);

      const roles = await this.rolesActivos(cliente, userId);
      // #27 (R3): la versión actual de la identidad viaja en el token nuevo.
      const { rows: versiones } = await cliente.query<{ token_version: number }>(
        'SELECT token_version FROM "user" WHERE id = $1',
        [userId],
      );
      const ver = versiones[0]?.token_version ?? 0;
      await cliente.query('COMMIT');

      // R17: el rol tiene que estar entre los ACTIVOS de ESTA inmobiliaria.
      // `rolesActivos` corre bajo el contexto de tenant, así que el RLS ya ha
      // descartado los de cualquier otra; el `filter` es la doble barrera de
      // siempre.
      const disponible = roles.some(
        (r) => r.tenant_id === tenantId && r.rol === rol,
      );
      if (!disponible) {
        // Ningún token se emite. El mensaje no dice qué roles sí tiene.
        throw new RolNoDisponibleError();
      }

      // R5: sin sesión declarada no se puede elegir rol (la validación de
      // sesión ya lo habría rechazado, pero el contrato lo exige explícito).
      if (typeof jti !== 'string' || jti === '') {
        throw new SesionInvalidaError();
      }

      const payload: JwtTokenPayload = {
        sub: userId,
        email,
        tenant_id: tenantId,
        roles,
        rol_activo: rol,
        // #27 (R3): MISMA sesión, versión actual. Elegir rol no abre una
        // sesión nueva: la revocación sigue alcanzando al jti original.
        jti,
        ver,
      };

      // R21: acción crítica, se audita. El `metadata` lleva el rol elegido, que
      // no es dato personal.
      await this.audit.log({
        tenantId,
        actorId: userId,
        accion: 'auth.rol_activo_elegido',
        entityType: 'user',
        entityId: userId,
        metadata: { rol },
      });

      return { access_token: this.jwtService.sign(payload), rol_activo: rol };
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      cliente.release();
    }
  }

  /**
   * `POST /auth/refresh` — rotar el refresh y emitir un access nuevo (**R7**,
   * R8, R9, R18, R19).
   *
   * ## Por qué esta ruta es la excepción al contexto de tenant
   *
   * No lleva access token y no puede saber su tenant hasta que encuentra la
   * sesión: el hash se resuelve por `sesion_por_refresh_token` (R18), la
   * única vía previa al contexto junto a `tenant_por_codigo` (R52). Una vez
   * resuelto, TODO se revalida dentro de una transacción con `SET LOCAL` del
   * tenant devuelto (R19): la función solo arranca el contexto, no es la
   * barrera.
   */
  async refrescar(
    refreshToken: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    if (typeof refreshToken !== 'string' || refreshToken === '') {
      throw new SesionInvalidaError();
    }
    const hash = hashToken(refreshToken);

    const cliente = await getDatabasePool(process.env.DATABASE_URL!).connect();
    try {
      // R18: bootstrap por coincidencia exacta de hash, sin contexto.
      const { rows: bootstrap } = await cliente.query<{
        id: string;
        user_id: string;
        tenant_id: string;
        expira_en: Date;
        revocada_at: Date | null;
      }>('SELECT * FROM sesion_por_refresh_token($1)', [hash]);
      const sesion = bootstrap[0];

      // R9: inexistente, expirada o revocada → el mismo 401.
      if (!sesion) throw new SesionInvalidaError();
      if (sesion.revocada_at !== null) throw new SesionInvalidaError();
      if (sesion.expira_en.getTime() <= Date.now()) throw new SesionInvalidaError();

      // R19: relectura completa DENTRO del RLS del tenant resuelto.
      await cliente.query('BEGIN');
      await this.fijarTenant(cliente, sesion.tenant_id);
      const fila = await this.sesiones.buscarPorId(cliente, sesion.id);

      if (!fila) throw new SesionInvalidaError();
      if (fila.revocada_at !== null) throw new SesionInvalidaError();
      if (fila.expira_en.getTime() <= Date.now()) throw new SesionInvalidaError();
      if (fila.user_id !== sesion.user_id || fila.tenant_id !== sesion.tenant_id) {
        // La función y la relectura no coinciden: algo cambió entre medias.
        throw new SesionInvalidaError();
      }

      // R8: reuso de un refresh ya rotado → la sesión completa muere, auditada.
      if (fila.refresh_token_hash_anterior !== null && fila.refresh_token_hash_anterior === hash) {
        await this.sesiones.revocar(cliente, sesion.id, 'refresh_token_reutilizado');
        await cliente.query('COMMIT');
        await this.audit.log({
          tenantId: sesion.tenant_id,
          actorId: sesion.user_id,
          accion: 'auth.sesion_revocada_por_reuso',
          entityType: 'sesion',
          entityId: sesion.id,
          metadata: { motivo: 'refresh_token_reutilizado' },
        });
        throw new SesionInvalidaError();
      }
      if (fila.refresh_token_hash !== hash) {
        // Ni vigente ni huella anterior: no es el token de esta sesión.
        throw new SesionInvalidaError();
      }

      // R7: rotación — el vigente pasa a huella, el nuevo manda.
      const { refreshToken: nuevoRefresh } = await this.sesiones.rotar(cliente, sesion.id);

      const roles = await this.rolesActivos(cliente, sesion.user_id);
      const { rows: versiones } = await cliente.query<{ token_version: number }>(
        'SELECT token_version FROM "user" WHERE id = $1',
        [sesion.user_id],
      );
      const ver = versiones[0]?.token_version ?? 0;

      // R12: tras revocar un rol, el access nuevo sale con el `ver` nuevo y
      // sin el rol revocado; las rutas de ese rol vuelven a exigir 403.
      const payload: JwtTokenPayload = {
        sub: sesion.user_id,
        email: null,
        tenant_id: sesion.tenant_id,
        roles,
        jti: sesion.id,
        ver,
      };
      const accessToken = this.jwtService.sign(payload);
      await cliente.query('COMMIT');

      await this.audit.log({
        tenantId: sesion.tenant_id,
        actorId: sesion.user_id,
        accion: 'auth.refresh_emitido',
        entityType: 'sesion',
        entityId: sesion.id,
      });

      return { access_token: accessToken, refresh_token: nuevoRefresh };
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      cliente.release();
    }
  }

  /**
   * `POST /auth/logout` — revocación de la sesión en el servidor (**R11**,
   * R13). A partir de este momento el access token es 401 (R4): el cliente
   * puede olvidarlo, pero el servidor no depende de que lo haga.
   */
  async cerrarSesion(jti: string, tenantId: string, userId: string): Promise<void> {
    const cliente = await getDatabasePool(process.env.DATABASE_URL!).connect();
    try {
      await cliente.query('BEGIN');
      await this.fijarTenant(cliente, tenantId);
      await this.sesiones.revocar(cliente, jti, 'cierre_de_sesion');
      await cliente.query('COMMIT');
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      cliente.release();
    }

    await this.audit.log({
      tenantId,
      actorId: userId,
      accion: 'auth.sesion_cerrada',
      entityType: 'sesion',
      entityId: jti,
      metadata: { motivo: 'cierre_de_sesion' },
    });
  }

  /**
   * `codigo` → `tenant_id` (**R52**, **R66**).
   *
   * Devuelve `null` si no existe, para que quien llama lo trate como unas
   * credenciales inválidas cualesquiera.
   */
  private async resolverTenant(
    cliente: PoolClient,
    codigo: string,
  ): Promise<string | null> {
    const { rows } = await cliente.query<{ tenant_id: string | null }>(
      'SELECT tenant_por_codigo($1) AS tenant_id',
      [codigo],
    );
    return rows[0]?.tenant_id ?? null;
  }

  /** Pasos 3 y 4: todo lo que toca `user` ocurre dentro del contexto. */
  private async autenticarEnTenant(
    cliente: PoolClient,
    tenantId: string,
    email: string,
    password: unknown,
  ): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user: { id: string; email: string | null; nombre: string };
  }> {
    try {
      await cliente.query('BEGIN');
      await this.fijarTenant(cliente, tenantId);

      // `email = $1` con $1 no nulo nunca casa una fila con `email IS NULL`
      // (en SQL, `NULL = 'algo'` es NULL, no true). R8.
      //
      // **Doble barrera, igual que en los repositorios de clientes** y por el
      // mismo motivo (`propietarios.repository.ts`): el RLS es la garantía
      // real, pero es inerte para un rol superusuario, y el aislamiento no
      // puede depender de un detalle de configuración del despliegue. Aquí eso
      // no es teórico: **hasta T61 la aplicación se conecta como superusuario**,
      // así que sin este `tenant_id = $2` el 401 de R64 no se cumpliría en
      // ejecución y el correo del tenant vecino autenticaría.
      const { rows } = await cliente.query<{
        id: string;
        email: string;
        nombre: string;
        password_hash: string | null;
        token_version: number;
      }>(
        `SELECT id, email, nombre, password_hash, token_version FROM "user"
          WHERE email = $1 AND email IS NOT NULL AND tenant_id = $2`,
        [email, tenantId],
      );
      const encontrado = rows[0];

      if (!encontrado) {
        throw new UnauthorizedException('Credenciales inválidas');
      }

      // R6: una identidad sin credenciales (cliente registrado por la
      // inmobiliaria que aún no activó portal) NO puede iniciar sesión. Se
      // rechaza ANTES de invocar bcrypt: `bcrypt.compare(x, null)` no es una
      // comparación válida y su resultado no debe decidir una autenticación.
      if (encontrado.password_hash === null || encontrado.password_hash === '') {
        throw new UnauthorizedException('Credenciales inválidas');
      }

      const clave = typeof password === 'string' ? password : '';
      if (!(await bcrypt.compare(clave, encontrado.password_hash))) {
        throw new UnauthorizedException('Credenciales inválidas');
      }

      const roles = await this.rolesActivos(cliente, encontrado.id);

      // #27 (R6): el login abre una sesión. El refresh token en claro solo
      // existe en la respuesta; en la base, solo su hash (R10).
      const sesion = await this.sesiones.abrirSesion(cliente, {
        userId: encontrado.id,
        tenantId,
      });

      await cliente.query('COMMIT');

      // R67: el token lleva los roles del ÚNICO tenant del usuario. `RolesGuard`
      // sigue rechazando con 403 cualquier `x-tenant-id` que no coincida (R33).
      const payload: JwtTokenPayload = {
        sub: encontrado.id,
        email: encontrado.email,
        tenant_id: tenantId,
        roles,
        // #27 (R3): la sesión y la versión viajan en el token.
        jti: sesion.id,
        ver: encontrado.token_version,
      };

      // R13: apertura de sesión auditada, sin tokens ni PII en metadata.
      await this.audit.log({
        tenantId,
        actorId: encontrado.id,
        accion: 'auth.sesion_abierta',
        entityType: 'sesion',
        entityId: sesion.id,
      });

      return {
        access_token: this.jwtService.sign(payload),
        refresh_token: sesion.refreshToken,
        expires_in: Number(process.env.JWT_EXPIRATION) || 3600,
        user: {
          id: encontrado.id,
          email: encontrado.email,
          nombre: encontrado.nombre,
        },
      };
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }

  /**
   * `set_config` parametrizado, nunca interpolación de cadenas: el tenant
   * procede de un dato de entrada y no puede llegar concatenado a un SQL
   * (`docs/conventions.md`). Es local a la transacción.
   */
  private async fijarTenant(cliente: PoolClient, tenantId: string): Promise<void> {
    await cliente.query('SELECT set_config($1, $2, true)', [
      'app.current_tenant',
      tenantId,
    ]);
  }

  private async rolesActivos(
    cliente: PoolClient,
    userId: string,
  ): Promise<Array<{ tenant_id: string; rol: string }>> {
    const { rows } = await cliente.query<{ tenant_id: string; rol: string }>(
      'SELECT tenant_id, rol FROM user_role WHERE user_id = $1 AND activo = true',
      [userId],
    );
    return rows;
  }
}
