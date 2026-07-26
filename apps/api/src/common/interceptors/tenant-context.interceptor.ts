import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
} from '@nestjs/common';
import { catchError, concatMap, type Observable } from 'rxjs';

import { getDatabasePool } from '../../database/database.client';
import {
  HEADER_TENANT,
  type IdentidadDeToken,
  resolverTenantOpcional,
} from '../tenant/resolver-tenant';

/**
 * Abre una transacción por petición y fija en ella `app.current_tenant`, que
 * es lo que leen todas las políticas de RLS (D2, `docs/architecture.md`).
 *
 * **Registrado como `APP_INTERCEPTOR` en `AppModule`** desde la feature #5.
 * Existía desde la #2 pero nadie lo enganchaba: mientras no hubo endpoints de
 * negocio fue inocuo; con `/propietarios` habría sido un agujero de
 * aislamiento (design.md §1).
 *
 * El tenant se resuelve del header `x-tenant-id` validado contra los roles
 * activos del JWT — **no** de `roles[0].tenant_id`, que con una identidad
 * multi-inmobiliaria (RF-AU6) podía escribir en la equivocada (R33).
 *
 * Si la petición no tiene tenant resoluble no se conecta a la base de datos:
 * las rutas públicas (`GET /health`) siguen respondiendo sin PostgreSQL
 * levantado, y cualquier repositorio que se ejecute sin contexto falla con
 * `SinContextoDeTenantError` (R34) en vez de leer sin filtro.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest();

    // `RolesGuard` corre antes que los interceptores y ya dejó aquí el tenant
    // validado en las rutas con `@Roles`. Se reutiliza para no resolverlo dos
    // veces con criterios que pudieran divergir.
    const yaResuelto = request.tenantResuelto as string | undefined;
    const tenantId =
      yaResuelto ??
      resolverTenantOpcional(
        request.user as IdentidadDeToken | undefined,
        request.headers?.[HEADER_TENANT],
      );

    if (!tenantId) {
      return next.handle();
    }
    request.tenantResuelto = tenantId;

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      return next.handle();
    }

    const cliente = await getDatabasePool(databaseUrl).connect();
    let liberado = false;
    const liberar = (): void => {
      if (!liberado) {
        liberado = true;
        cliente.release();
      }
    };

    try {
      await cliente.query('BEGIN');
      // `set_config` parametrizado, no interpolación de cadenas: el tenant
      // viene de un header y nunca debe llegar concatenado a un SQL.
      await cliente.query('SELECT set_config($1, $2, true)', [
        'app.current_tenant',
        tenantId,
      ]);
    } catch (error) {
      liberar();
      throw error;
    }

    request.tenantClient = cliente;
    request.tenantRelease = liberar;

    return next.handle().pipe(
      // `concatMap` y no `tap`: el COMMIT tiene que haber terminado ANTES de
      // que Nest serialice la respuesta. Con `tap` la respuesta podía salir
      // con la transacción todavía abierta.
      concatMap(async (datos) => {
        try {
          await cliente.query('COMMIT');
        } finally {
          liberar();
        }
        return datos;
      }),
      catchError(async (error: unknown) => {
        try {
          await cliente.query('ROLLBACK');
        } finally {
          liberar();
        }
        throw error;
      }),
    );
  }
}
