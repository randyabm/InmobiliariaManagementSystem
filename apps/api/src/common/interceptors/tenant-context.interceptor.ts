import { Injectable, type NestInterceptor, type ExecutionContext, type CallHandler } from '@nestjs/common';
import { type Observable, tap } from 'rxjs';

import { getDatabasePool } from '../../database/database.client';

const HEADER_TENANT = 'x-tenant-id';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> | Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest();

    // Prioridad: JWT (user.roles[0].tenant_id) > header x-tenant-id
    let tenantId: string | undefined;

    const user = request.user as { roles?: Array<{ tenant_id: string }> } | undefined;
    if (user?.roles?.[0]?.tenant_id) {
      tenantId = user.roles[0].tenant_id;
    } else {
      tenantId = request.headers[HEADER_TENANT] as string | undefined;
    }

    if (!tenantId || !UUID_REGEX.test(tenantId)) {
      return next.handle();
    }

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      return next.handle();
    }

    const pool = getDatabasePool(databaseUrl);

    return new Promise<Observable<unknown>>((resolve) => {
      pool.connect((err, client, release) => {
        if (err || !client || !release) {
          release?.();
          resolve(next.handle());
          return;
        }

        client.query('BEGIN', () => {
          client.query(`SET LOCAL app.current_tenant = '${tenantId}'`, () => {
            request.tenantClient = client;
            request.tenantRelease = release;

            resolve(
              next.handle().pipe(
                tap({
                  complete: () => {
                    client.query('COMMIT', () => release());
                  },
                  error: () => {
                    client.query('ROLLBACK', () => release());
                  },
                }),
              ),
            );
          });
        });
      });
    });
  }
}
