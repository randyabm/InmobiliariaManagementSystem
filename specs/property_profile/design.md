# Design — property_profile

> Feature #6. Hoja de vida del inmueble.
> Este documento asume `docs/architecture.md` y `docs/conventions.md`; solo
> documenta los puntos donde la feature roza sus fronteras.

---

## 1. Origen y dependencias

Cierra la dependencia explícita que dejó escrita la feature #5
(`specs/owner_tenant_profiles/design.md` §6): la columna
`propiedad.cuenta_bancaria_id` (override de giro) y el test de integración
del override a través de la propiedad. También recoge los diferidos de #5
(D-1: lista de propiedades del propietario — ver §8 — y R12) y de #25 (la
retención no se duplica en la ficha).

| Elemento entregado por | Uso aquí |
|---|---|
| #5 `perfil_propietario`, `perfil_inquilino`, `cuenta_bancaria` + RLS | FKs de `propiedad` (R1, R2, R3, R4) |
| #5 `resolverCuentaDeGiro(perfilPropietarioId, cuentaOverrideId, ctx)` | Validación del override y resolución de la cuenta de giro (R8) |
| #5 `obtenerClienteTenant` + `SinContextoDeTenantError` | Acceso a datos (R19) |
| #27 guards + validación de sesión | Todas las rutas nuevas |
| `AuditService` + `@Audit` | Las 10 mutaciones (R20) |
| MinIO (`docker-compose.yml`, config `MINIO_*` en `app-config.ts`) | Object storage de fotos y documentos (R13, R17) |

## 2. Ubicación: dos módulos nuevos en `core/`

```
modules/core/
├── almacenamiento/            # objeto compartido, reutilizable por #12 y #18
│   ├── almacenamiento.module.ts
│   ├── almacenamiento.service.ts   # subir, borrar, verificar hash, URL temporal
│   └── __tests__/
└── propiedades/
    ├── propiedades.module.ts       # importa ClientesModule + AlmacenamientoModule
    ├── propiedades.{controller,service,repository}.ts
    ├── propietarios-de-propiedad.{controller,service,repository}.ts  (R10)
    ├── ocupacion.{controller,service,repository}.ts                  (R11, R12)
    ├── documentos.{controller,service,repository}.ts                (R13, R16)
    ├── fotos.{controller,service}.ts                                (R17)
    ├── dto/  (crear-propiedad, actualizar-propiedad, asignar-inquilino,
    │          añadir-propietario, subir-documento, quitar-foto)
    ├── errors/ (propietario-principal-no-removible.error.ts)
    └── __tests__/
```

`propiedades → clientes` es una dependencia legal: `core/clientes` no
depende de ningún módulo y exporta lo que esta feature consume. El
almacenamiento vive aparte porque #12 (fotos de inventario) y #18
(contratos digitalizados) lo consumirán sin tocar `propiedades`.

## 3. Acceso a datos

Idéntico al resto del proyecto: repositorios sobre el `PoolClient` de la
transacción vía `obtenerClienteTenant(request)`, `tenant_id` explícito en
cada consulta como defensa en profundidad sobre el RLS (R14, R19). Los
esquemas Drizzle en `database/schema/` siguen siendo la fuente declarativa.

## 4. Migración (`0012_property_profile.sql`, R22)

Forward-only e idempotente. Contenido:

1. `propiedad` (R1): las 4 FK, CHECKs (`tipo`, `estrato 1..6`, `area > 0`,
   `canon >= 0`), índice `(tenant_id)` y RLS `ENABLE`+`FORCE`+política
   `propiedad_tenant_isolation` en la misma migración.
2. `propiedad_propietario` (R2): UNIQUE `(propiedad_id, perfil_propietario_id)`
   y RLS.
3. `historial_ocupacion` (R3): índice único parcial "una ocupación vigente
   por propiedad" (`WHERE hasta IS NULL`), índice `(propiedad_id, desde)` y
   RLS.
4. `propiedad_documento` (R4): UNIQUE `(clave_storage)`, índice
   `(tenant_id, propiedad_id)` y RLS.

**No** añade columnas de retención (criterio #25 R5) ni `estado` (frontera
#8). Toda cantidad monetaria/área/porcentaje es `numeric` (R9).

## 5. Almacenamiento (PA-6-1)

- Cliente **MinIO** (`minio` SDK) contra `MINIO_*` de configuración
  (bucket por defecto `propiedades`, creado al arrancar).
- `subir(bucket, binario, mime) → { clave, hash_sha256, tamano_bytes }`: la
  clave es `uuid/v4 + extensión normalizada` (nunca un nombre del cliente:
  los nombres de archivo son PII y vectores de path traversal). El hash se
  calcula del binario **antes** de subir y se verifica contra lo que el
  objeto devuelve al almacenarlo (R21).
- `borrar(bucket, clave)`, `urlTemporal(bucket, clave)` para lectura firmada
  (el acceso al objeto no es público; §7 NFR).
- `AlmacenamientoService` NO audita ni registra binarios (R15).

Tests: `@testcontainers/minio` (contenedor real, mismo patrón que
PostgreSQL). Dependencias nuevas: `minio` (runtime) y `@testcontainers/minio`
(dev) — ambas justificadas: el PRD manda object storage y la aceptación
exige el repositorio documental.

## 6. Superficie HTTP (14 rutas)

Todas: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('admin','empleado')`
(R18). Validación zod en el borde. Multipart con `FileInterceptor` de
`@nestjs/platform-express` (multer ya está en el árbol de dependencias).

| Método y ruta | Servicio | R | Auditoría |
|---|---|---|---|
| `POST /propiedades` | `PropiedadesService.crear` | R5, R8, R9 | `@Audit('crear','propiedad')` |
| `GET /propiedades` | `.listar` | R5 (lista) | — |
| `GET /propiedades/:id` | `.obtener` | R6, R8 | — |
| `PATCH /propiedades/:id` | `.actualizar` | R7, R8, R9 | `@Audit('actualizar','propiedad')` |
| `DELETE /propiedades/:id` | `.darDeBaja` | R7 | `@Audit('baja','propiedad')` |
| `POST /propiedades/:id/propietarios` | `PropietariosDePropiedadService.anadir` | R10 | `@Audit('crear','propiedad_propietario')` |
| `DELETE /propiedades/:idPropiedad/propietarios/:idPropietario` | `.remover` | R10 | `@Audit('baja','propiedad_propietario')` |
| `PATCH /propiedades/:id/inquilino-actual` | `OcupacionService.asignarInquilinoActual` | R11 | `@Audit('actualizar','propiedad')` |
| `GET /propiedades/:id/historial-ocupacion` | `.historial` | R12 | — |
| `POST /propiedades/:id/documentos` | `DocumentosService.subir` | R13, R21 | `@Audit('crear','propiedad_documento')` |
| `GET /propiedades/:id/documentos` | `.listar` | R16 | — |
| `DELETE /propiedades/:idPropiedad/documentos/:idDocumento` | `.archivar` | R16 | `@Audit('baja','propiedad_documento')` |
| `POST /propiedades/:id/fotos` | `FotosService.subir` | R17 | `@Audit('actualizar','propiedad')` |
| `DELETE /propiedades/:id/fotos` | `.quitar` | R17 | `@Audit('actualizar','propiedad')` |

Firmas nuevas relevantes:

```ts
// almacenamiento.service.ts
subir(bucket: string, binario: Buffer, mime: string): Promise<{ clave: string; hash_sha256: string; tamano_bytes: number }>;
urlTemporal(bucket: string, clave: string): Promise<string>;
borrar(bucket: string, clave: string): Promise<void>;

// propiedades.service.ts
crear(dto: CrearPropiedadDto, ctx: ContextoPeticion): Promise<Propiedad>;
obtener(id: string, ctx: ContextoPeticion): Promise<PropiedadConExtras>; // cuenta de giro resuelta (R8)
actualizar(id: string, dto: ActualizarPropiedadDto, ctx: ContextoPeticion): Promise<Propiedad>;
darDeBaja(id: string, ctx: ContextoPeticion): Promise<void>;
listar(ctx: ContextoPeticion): Promise<Propiedad[]>;
```

`canon`, `valor_administracion`, `area` e `incremento_anual_pactado` viajan
como `string` (R9, `::text` en el SQL, igual que `porcentaje` en #25).

## 7. El override de cuenta (R8, dependencia #5)

- En `crear`/`actualizar`, si llega `cuenta_bancaria_id`: se invoca
  `resolverCuentaDeGiro(propietarioPrincipalId, overrideId, ctx)` **solo
  como validación**: si lanza `CuentaDeGiroInvalidaError` (override ajeno o
  no resoluble) → 400 sin persistir (R8).
- La ficha resuelve la cuenta con una lectura propia que NO lanza:
  override → predeterminada activa del principal → `null`
  (`cuenta_giro: CuentaBancaria | null` en la respuesta). El error de giro
  sigue existiendo en el punto de calcular dinero (el contrato de #5 no se
  toca).
- Test obligatorio de la dependencia #5: propiedad con override → el giro
  se resuelve contra el override; propiedad sin override → contra la
  predeterminada del principal; override de otro propietario → 400.

## 8. Lista de propiedades del propietario (D-1 de #5)

`GET /propietarios/:id` sigue sin exponer `propiedades` (el contrato R12 de
#5 no se toca: la lista de propiedades **con su estado** requiere #8). Lo
que #6 aporta es el **reverso**: `GET /propiedades` permite filtrar por
`propietario_principal_id`, y la ficha de propiedad lista sus propietarios.
Cuando #8 añada `estado`, la hoja de vida del propietario (RF-C5) se
completa.

## 9. Errores de dominio

| Error | `code` | HTTP | Cuándo |
|---|---|---|---|
| `PropietarioPrincipalNoRemovibleError` (nuevo) | `PROPIETARIO_PRINCIPAL_NO_REMOVIBLE` | 409 | R10 — la baja apunta al principal |
| `CuentaDeGiroInvalidaError` (reutilizado de #5) | `CUENTA_DE_GIRO_INVALIDA` | 400 | R8 — override ajeno |
| `ResourceNotFoundError` (reutilizado) | `RESOURCE_NOT_FOUND` | 404 | R5, R10, R11, R14 — inexistente o de otro tenant |
| `SinContextoDeTenantError` (reutilizado) | `SIN_CONTEXTO_DE_TENANT` | 500 | R19 |
| Foto ajena | `FOTO_NO_PERTENECE_A_LA_PROPIEDAD` | 400 | R17 |

## 10. Auditoría y datos personales (R15, R20)

| `accion` | `entityType` | `entityId` |
|---|---|---|
| `crear` / `actualizar` / `baja` | `propiedad` | id de la propiedad |
| `crear` / `baja` | `propiedad_propietario` | id de la asociación |
| `actualizar` (inquilino actual, fotos) | `propiedad` | id de la propiedad |
| `crear` / `baja` | `propiedad_documento` | id del documento |

`metadata` vacío: ni dirección, ni matrícula, ni teléfonos/correos de
administración, ni claves de storage, ni binarios (R15). El `@Audit` del
interceptor resuelve `entity_id` de la respuesta o de la ruta (patrón ya
ampliado en #25 con `idCodeudor`/`idReferencia`; aquí se añaden `idDocumento`
e `idPropiedad` al fallback si hace falta).

## 11. Archivos

### Se crean

```
apps/api/drizzle/0012_property_profile.sql
apps/api/src/database/schema/{propiedad,propiedad-propietario,historial-ocupacion,propiedad-documento}.ts
apps/api/src/modules/core/almacenamiento/{almacenamiento.module,almacenamiento.service}.ts
apps/api/src/modules/core/propiedades/{propiedades.module,propiedades.controller,propiedades.service,propiedades.repository}.ts
apps/api/src/modules/core/propiedades/{propietarios-de-propiedad.*,ocupacion.*,documentos.*,fotos.*}.ts
apps/api/src/modules/core/propiedades/dto/*.ts
apps/api/src/modules/core/propiedades/errors/propietario-principal-no-removible.error.ts
apps/api/src/modules/core/propiedades/__tests__/*.test.ts
apps/api/src/database/__tests__/propiedades-rls.test.ts
packages/types/src/propiedades.ts
```

### Se modifican

```
apps/api/src/database/schema/index.ts
apps/api/drizzle/meta/_journal.json
tests/migrations.test.ts                     (TABLAS_PERMITIDAS +4)
apps/api/src/modules/core/__tests__/routes-surface.test.ts  (RUTAS_PERMITIDAS +14)
apps/api/test/db/migrations.db.test.ts
apps/api/src/config/app-config.ts            (bucket por defecto, si hace falta)
apps/api/src/modules/core/audit/audit.interceptor.ts  (fallback idDocumento/idPropiedad si aplica)
packages/types/src/index.ts
apps/api/package.json                        (minio; dev: @testcontainers/minio)
feature_list.json                            (#6 → spec_ready)
```

## 12. Alternativas descartadas

1. **Subida diferida (solo metadatos de documentos/fotos).** Descartada: el
   criterio de aceptación "repositorio documental por propiedad" exige la
   subida real, y el PRD (§7 NFR, D6) manda object storage desde el MVP.
   Diferir habría dejado la aceptación a medias y a #12/#18 construyendo el
   almacenamiento dos veces.
2. **Un solo propietario por propiedad.** Descartada: RF-P2 dice
   "propietario(s)". El modelo principal + puente cubre el plural sin
   ambigüedad de giro (PA-6-2).
3. **`estado` en la ficha desde #6.** Descartada: el estado lo gobierna el
   motor de workflows (#8); inventar una columna ahora sería código que #8
   tendría que migrar.
4. **`propiedades` en `GET /propietarios/:id`.** Descartada: R12 de #5 lo
   prohíbe y la lista con estado es de #8 (§8).
5. **Almacenamiento como endpoint polimórfico** (`/archivos?entidad=..`).
   Descartada: el módulo de servicio es más simple y cada consumidor decide
   su contrato (fotos vs. documentos difieren en el vínculo: array vs.
   tabla).

## 13. Estado de las ambigüedades

Tres decisiones quedan para la puerta del spec (PA-6-1, PA-6-2, PA-6-3).
Ninguna otra ambigüedad de producto pendiente: donde el PRD no define (tipo
de documento libre, taxonomía de tipo de propiedad reutilizando la de #11),
no se inventa.
