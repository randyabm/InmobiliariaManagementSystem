import type { INestApplication, Type } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { crearAppDePrueba } from '../../../../test/support/create-test-app';
import { usarEntornoDePrueba } from '../../../../test/support/test-env';

/**
 * Superficie HTTP pública permitida en esta fase (R16).
 *
 * Cualquier endpoint nuevo obliga a actualizar esta lista *y* a añadirle sus
 * tres tests (camino feliz autorizado, rechazo por rol, rechazo por tenant
 * ajeno) en cuanto existan roles y tenants (features #2 y #3).
 */
const RUTAS_PERMITIDAS = [
  'GET /auth/me',
  'GET /health',
  'POST /auth/login',
  // ─── Feature #27 sesion_y_revocacion: 2 rutas (R20, design.md §7) ───────
  // `POST /auth/refresh` es pública: es el camino de recuperación cuando el
  // access expira o se revoca; el credencial presentado es el refresh mismo.
  // `POST /auth/logout` lleva JwtAuthGuard y revoca la sesión del jti.
  'POST /auth/refresh',
  'POST /auth/logout',
  // ─── Feature #26 identidad_multirol_cliente: 1 ruta (R16, design.md §5) ──
  // Elegir con qué rol se actúa. Solo `JwtAuthGuard`: cualquier identidad
  // autenticada elige entre SUS roles, y el 403 de R17 lo decide el servicio
  // contra `user_role` en base de datos, no un `@Roles(...)` en el borde.
  'POST /auth/rol-activo',
  // ─── Feature #5 owner_tenant_profiles: 13 rutas (R37, design.md §5) ─────
  // Todas con @UseGuards(JwtAuthGuard, RolesGuard) y @Roles('admin','empleado').
  // Sus tres tests obligatorios (camino feliz autorizado, rechazo por rol y
  // rechazo por tenant ajeno) están en `modules/core/clientes/__tests__/`.
  'POST /propietarios',
  'GET /propietarios',
  'GET /propietarios/:id',
  'PATCH /propietarios/:id',
  'DELETE /propietarios/:id',
  'POST /propietarios/:id/cuentas-bancarias',
  'GET /propietarios/:id/cuentas-bancarias',
  'PATCH /propietarios/:idPropietario/cuentas-bancarias/:idCuenta',
  'POST /inquilinos',
  'GET /inquilinos',
  'GET /inquilinos/:id',
  'PATCH /inquilinos/:id',
  'DELETE /inquilinos/:id',
  // ─── Feature #6 property_profile: 14 rutas (R22, design.md §6) ──────────
  // Todas con @UseGuards(JwtAuthGuard, RolesGuard) y @Roles('admin','empleado')
  // (R18). Sus tests obligatorios están en `modules/core/propiedades/__tests__/`.
  'POST /propiedades',
  'GET /propiedades',
  'GET /propiedades/:id',
  // ─── Feature #8 property_lifecycle: 3 rutas (R16, design.md §3) ─────────
  // El dashboard se registra antes que `GET /propiedades/:id` (el segmento
  // `dashboard` nunca es un uuid). Las acciones se ejecutan por clave.
  'GET /propiedades/dashboard',
  'GET /propiedades/:id/ciclo-vida',
  'POST /propiedades/:id/ciclo-vida/transiciones/:claveTransicion',
  // ─── Feature #9 property_intake: 1 ruta (R13, design.md §5) ────────────
  'POST /propiedades/ingreso',
  // ─── Feature #10 notifications: 5 rutas (R17, design.md §5) ─────────────
  'POST /notificaciones',
  'GET /notificaciones',
  'POST /notificaciones/programadas',
  'GET /notificaciones/programadas',
  'DELETE /notificaciones/programadas/:id',
  // ─── Feature #11 inventory_templates: 9 rutas (R14, design.md §4) ───────
  // Gestión (clonar/zonas/items): solo `admin` (PA-11-4); lectura:
  // admin/empleado.
  'GET /plantillas',
  'GET /plantillas/:id',
  'POST /plantillas/:id/clonar',
  'POST /plantillas/:id/zonas',
  'PATCH /plantillas/:id/zonas/:idZona',
  'DELETE /plantillas/:id/zonas/:idZona',
  'POST /plantillas/:id/zonas/:idZona/items',
  'PATCH /plantillas/:id/zonas/:idZona/items/:idItem',
  'DELETE /plantillas/:id/zonas/:idZona/items/:idItem',
  'PATCH /propiedades/:id',
  'DELETE /propiedades/:id',
  'POST /propiedades/:idPropiedad/propietarios',
  'DELETE /propiedades/:idPropiedad/propietarios/:idPropietario',
  'PATCH /propiedades/:id/inquilino-actual',
  'GET /propiedades/:id/historial-ocupacion',
  'POST /propiedades/:idPropiedad/documentos',
  'GET /propiedades/:idPropiedad/documentos',
  'DELETE /propiedades/:idPropiedad/documentos/:idDocumento',
  'POST /propiedades/:id/fotos',
  'DELETE /propiedades/:id/fotos',
  // ─── Feature #12 inventory_creation: 15 rutas (R14, design.md §6) ───────
  // Todas con @UseGuards(JwtAuthGuard, RolesGuard) y @Roles('admin','empleado')
  // (R8). `@Audit` en las mutaciones; `idFoto` alimenta el fallback del
  // AuditInterceptor para la baja de fotos (R10).
  'POST /inventarios',
  'GET /inventarios',
  'GET /inventarios/:id',
  'POST /inventarios/:id/zonas',
  'PATCH /inventarios/:id/zonas/orden',
  'PATCH /inventarios/:id/zonas/:zonaId',
  'DELETE /inventarios/:id/zonas/:zonaId',
  'POST /inventarios/:id/zonas/:zonaId/items',
  'PATCH /inventarios/:id/items/:itemId',
  'DELETE /inventarios/:id/items/:idItem',
  'POST /inventarios/:id/items/:itemId/fotos',
  'DELETE /inventarios/:id/fotos/:idFoto',
  'DELETE /inventarios/:id',
  // ─── Feature #13 inventory_tenant_review: 7 rutas (R15, design.md §6) ──
  // `POST /inventarios/:id/invitaciones` es admin/empleado; el bootstrap y
  // el registro son públicos (sin sesión, R3); las dos rutas de `inquilino/`
  // son las primeras de CLIENTE con `@Roles('inquilino')` + scoping por
  // perfil (R9); `auth/otp/*` exige sesión (#27).
  'POST /inventarios/:id/invitaciones',
  'GET /invitaciones/:token',
  'POST /invitaciones/:token/registro',
  'GET /inquilino/inventarios/:id',
  'POST /inquilino/inventarios/:id/items/:idItem/revision',
  'POST /auth/otp/solicitar',
  'POST /auth/otp/verificar',
  // ─── Feature #14 inventory_signature_pdf: 5 rutas (R12, design.md §6) ──
  // `confirmar-acuerdo`, `pdf` (POST y GET) y la firma del empleado son
  // admin/empleado; la firma del inquilino es `@Roles('inquilino')` con
  // scoping por perfil (#13, R9) + OTP de FIRMA reciente (R4).
  'POST /inventarios/:id/confirmar-acuerdo',
  'POST /inventarios/:id/pdf',
  'POST /inventarios/:id/firmas/empleado',
  'POST /inventarios/:id/firmas/inquilino',
  'GET /inventarios/:id/pdf',
  // ─── Feature #16 contract_templates: 7 rutas (R6, design.md §2) ────────
  // Lectura/edición de la base y propuesta por propiedad: admin/empleado.
  // La validación (base y copia): solo `admin` (PA-16-3).
  'GET /plantillas-contrato',
  'POST /plantillas-contrato',
  'PATCH /plantillas-contrato',
  'POST /plantillas-contrato/validar',
  'POST /propiedades/:id/contrato/plantilla',
  'GET /propiedades/:id/contrato/plantilla',
  'POST /propiedades/:id/contrato/plantilla/validar',
  // ─── Feature #7 workflow_engine: 9 rutas (R17, design.md §8) ───────────
  // Gestión de definiciones: solo `admin` (RF-W2). Instancias y ejecución:
  // `@Roles('admin','empleado')`.
  'GET /workflows',
  'GET /workflows/:id',
  'POST /workflows/:id/clonar',
  'POST /workflows/:id/transiciones',
  'DELETE /workflows/:idDefinicion/transiciones/:idTransicion',
  'POST /workflows/:id/instancias',
  'GET /workflows/instancias/:idInstancia',
  'POST /workflows/instancias/:idInstancia/transiciones/:idTransicion',
  'GET /workflows/instancias/:idInstancia/historial',
  // ─── Feature #25 retencion_codeudor_referencias: 10 rutas (R25, design §5) ─
  // `@Roles('admin','empleado')` (R20). Todas con @UseGuards(JwtAuthGuard,
  // RolesGuard). Sus tres tests obligatorios están en `retencion.test.ts`,
  // `codeudores.test.ts` y `referencias.test.ts`.
  'GET /configuracion/retencion',
  'PUT /configuracion/retencion/:anio',
  'POST /inquilinos/:idInquilino/codeudores',
  'GET /inquilinos/:idInquilino/codeudores',
  'PATCH /inquilinos/:idInquilino/codeudores/:idCodeudor',
  'DELETE /inquilinos/:idInquilino/codeudores/:idCodeudor',
  'POST /inquilinos/:idInquilino/referencias',
  'GET /inquilinos/:idInquilino/referencias',
  'PATCH /inquilinos/:idInquilino/referencias/:idReferencia',
  'DELETE /inquilinos/:idInquilino/referencias/:idReferencia',
] as const;

function normalizar(segmento: unknown): string {
  const valor = typeof segmento === 'string' ? segmento : '';
  return valor.replace(/^\/+|\/+$/g, '');
}

/** Enumera las rutas realmente registradas en el contenedor de NestJS. */
function enumerarRutas(app: INestApplication): string[] {
  const discovery = app.get(DiscoveryService);
  const rutas: string[] = [];

  for (const wrapper of discovery.getControllers()) {
    const metatype = wrapper.metatype as Type<object> | undefined;
    if (!metatype) continue;

    const prefijo = normalizar(Reflect.getMetadata(PATH_METADATA, metatype));
    const prototipo = metatype.prototype as Record<string, unknown>;

    for (const nombre of Object.getOwnPropertyNames(prototipo)) {
      if (nombre === 'constructor') continue;
      const handler = prototipo[nombre];
      if (typeof handler !== 'function') continue;

      const metodo = Reflect.getMetadata(METHOD_METADATA, handler) as
        number | undefined;
      if (metodo === undefined) continue;

      const sufijo = normalizar(Reflect.getMetadata(PATH_METADATA, handler));
      const ruta = ['', prefijo, sufijo].filter(Boolean).join('/');
      rutas.push(`${RequestMethod[metodo]} /${ruta.replace(/^\/+/, '')}`);
    }
  }

  return rutas.sort();
}

describe('Superficie HTTP expuesta (R16)', () => {
  let app: INestApplication;
  let restaurarEntorno: () => void;

  beforeAll(async () => {
    restaurarEntorno = usarEntornoDePrueba();
    app = await crearAppDePrueba({ imports: [DiscoveryModule] });
  });

  afterAll(async () => {
    await app.close();
    restaurarEntorno();
  });

  it('no registra ninguna ruta fuera de la lista blanca', () => {
    expect(enumerarRutas(app)).toEqual([...RUTAS_PERMITIDAS].sort());
  });

  it('una ruta inexistente devuelve 404 en español y sin traza de pila', async () => {
    // `no-existe/...` no puede colisionar con la lista blanca: es un prefijo
    // que ninguna feature registra. Antes se sondaba `/propiedades/secretas`,
    // que desde #6 es un `GET /propiedades/:id` legítimo (401 sin token).
    const respuesta = await request(app.getHttpServer()).get(
      '/no-existe/secretas',
    );

    expect(respuesta.status).toBe(404);
    expect(respuesta.body.message).toBe('El recurso solicitado no existe.');
    expect(respuesta.body.error).toBe('RESOURCE_NOT_FOUND');
    expect(respuesta.body).not.toHaveProperty('stack');

    const serializado = JSON.stringify(respuesta.body);
    expect(serializado).not.toContain('Cannot GET');
    expect(serializado).not.toMatch(/\.ts:\d+|node_modules|at Object\./);
  });

  it('un método no soportado tampoco filtra texto del framework', async () => {
    const respuesta = await request(app.getHttpServer()).post('/health');

    expect(respuesta.status).toBe(404);
    expect(JSON.stringify(respuesta.body)).not.toContain('Cannot POST');
  });
});
