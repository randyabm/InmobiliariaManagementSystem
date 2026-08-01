# Tasks — property_profile

> Feature #6. Pasos discretos en orden. Las tasks de test son de primera
> clase: los invariantes de seguridad (bloque 5) se verifican con asserts
> deterministas contra PostgreSQL y MinIO reales (Testcontainers), nunca con
> juicio de un modelo.
>
> **Prerrequisitos:** #5, #25 y #27 `done`. Dependencia explícita de #5:
> `resolverCuentaDeGiro` y su validación de pertenencia se reutilizan (R8).
>
> **PA-6 aprobadas en la puerta del spec:** PA-6-1 (almacenamiento MinIO
> dentro de #6), PA-6-2 (propietario principal + puente), PA-6-3 (estado y
> creación en línea fuera de #6).
>
> Cobertura: R1–R22 en 28 tasks (T1–T28), de las cuales 12 son tasks de test.

---

## Bloque 0 — Tipos y esquema Drizzle

- [x] T1 — Crear `packages/types/src/propiedades.ts` con `TipoPropiedad`
  (enum), `Propiedad`, `PropiedadConExtras` (cuenta de giro resuelta +
  propietarios + inquilino actual), `HistorialOcupacion`,
  `PropiedadDocumento`, `PropiedadPropietario`; exportar desde
  `packages/types/src/index.ts`. **Cubre: R1, R2, R3, R4, R6, R9.**

- [x] T2 — Crear los cuatro esquemas Drizzle (`propiedad`,
  `propiedad-propietario`, `historial-ocupacion`, `propiedad-documento`) con
  los CHECKs, UNIQUEs e índices de R1–R4 y exportarlos en
  `schema/index.ts`. **Cubre: R1, R2, R3, R4.**

## Bloque 1 — Migración

- [x] T3 — Escribir `0012_property_profile.sql` (siguiente índice libre),
  forward-only e idempotente: las cuatro tablas con `ENABLE`+`FORCE RLS` y
  política por `tenant_id` en la misma migración, CHECKs de `tipo`/`estrato`/
  `area`/`canon`, índice único parcial de ocupación vigente y UNIQUE de
  clave de storage. Sin columnas de retención ni `estado`. **Cubre: R1, R2,
  R3, R4, R22.**

- [x] T4 — Añadir la entrada al `_journal.json`, `TABLAS_PERMITIDAS` +4 en
  `tests/migrations.test.ts` y test en `apps/api/test/db/migrations.db.test.ts`
  (las cuatro tablas con `relrowsecurity`/`relforcerowsecurity` en `true`,
  políticas por `app.current_tenant`, FKs correctas, UNIQUE de
  `clave_storage` y el índice parcial de ocupación vigente). **Cubre: R22.**

## Bloque 2 — Almacenamiento (PA-6-1)

- [x] T5 — Añadir `minio` (runtime) y `@testcontainers/minio` (dev) a
  `apps/api/package.json` y crear `almacenamiento.service.ts` con `subir`
  (clave `uuid + extensión normalizada`, hash SHA-256 del binario, verificado
  contra el objeto almacenado), `urlTemporal` y `borrar`. **Cubre: R13, R21.**

- [x] T6 — Test del almacenamiento con Testcontainers MinIO: subir devuelve
  clave/hash/tamaño correctos, el hash del binario devuelto por el objeto
  coincide, `urlTemporal` permite leer el objeto, `borrar` lo elimina, y el
  nombre del cliente (con `../` y espacios) nunca aparece en la clave.
  **Cubre: R13, R21.**

## Bloque 3 — CRUD de la ficha

- [x] T7 — DTOs zod `crear-propiedad.dto.ts` y `actualizar-propiedad.dto.ts`
  (grupos de datos de R1, `canon`/`valor_administracion`/`area`/
  `incremento_anual_pactado` como cadenas decimales exactas, `tipo` del enum,
  `cuenta_bancaria_id` opcional). **Cubre: R1, R9.**

- [x] T8 — `propiedades.repository.ts`: `insertar`, `listar`, `buscarPorId`
  (con propietarios activos y `inquilino_actual`), `actualizar`,
  `marcarInactivo`, `cuentaDeGiroResuelta` (override → predeterminada del
  principal → `null`, sin lanzar) y `fotos` (añadir/quitar claves). Sobre el
  `PoolClient` de la transacción (R19). **Cubre: R5, R6, R7, R8, R17.**

- [x] T9 — `propiedades.service.ts`: `crear` (404 si el principal no existe o
  es ajeno; validación del override con `resolverCuentaDeGiro`, R8),
  `obtener` (ficha + extras), `actualizar` (misma validación si cambia la
  cuenta), `darDeBaja` (lógica) y `listar`. **Cubre: R5, R6, R7, R8, R14.**

- [x] T10 — `propiedades.controller.ts` con las 5 rutas de la ficha, guards,
  `@Roles('admin','empleado')` y `@Audit` en las mutaciones. **Cubre: R5, R6,
  R7, R18, R20.**

- [x] T11 — Tests de integración del CRUD (Testcontainers + app real): crear
  con los cuatro grupos (201, verificación con SELECT de columnas y tipos),
  ficha con cuenta de giro resuelta (override gana; sin override → la
  predeterminada del principal; sin cuenta → `null`), PATCH parcial, baja
  lógica (SELECT `activo`), y 404 para un principal inexistente o ajeno.
  **Cubre: R5, R6, R7, R8, R9, R14.**

- [x] T12 — Test determinista del override (dependencia #5): override de
  otro propietario → 400 `CUENTA_DE_GIRO_INVALIDA` sin persistir (SELECT);
  override de otro tenant → 400; y el giro se resuelve contra el override a
  través de la propiedad. **Cubre: R8.**

## Bloque 4 — Propietarios, ocupación, documentos y fotos

- [x] T13 — `propietarios-de-propiedad.{repository,service,controller}.ts`:
  añadir (404 si el perfil no existe o es ajeno) y remover con baja lógica;
  la baja del principal → 409 `PROPIETARIO_PRINCIPAL_NO_REMOVIBLE` sin
  modificar nada. **Cubre: R10, R14, R18, R20.**

- [x] T14 — `ocupacion.{repository,service,controller}.ts`:
  `PATCH /propiedades/:id/inquilino-actual` (cierra la ocupación vigente y
  abre la nueva en la MISMA transacción; `null` cierra sin abrir) y
  `GET /propiedades/:id/historial-ocupacion` (orden `desde` desc, con datos
  básicos del inquilino). **Cubre: R11, R12, R14, R18, R20.**

- [x] T15 — `documentos.{repository,service,controller}.ts`: subir (multipart
  → almacenamiento → fila con hash), listar activos, archivar (baja lógica,
  sin borrar el objeto). **Cubre: R13, R16, R18, R20, R21.**

- [x] T16 — `fotos.{controller,service}.ts`: `POST /propiedades/:id/fotos`
  (sube y añade la clave al array) y `DELETE /propiedades/:id/fotos` con
  `{ clave }` (clave ajena → 400 `FOTO_NO_PERTENECE_A_LA_PROPIEDAD`).
  **Cubre: R17, R18, R20.**

- [x] T17 — Tests de integración de propietarios/ocupación: añadir y remover
  propietario (SELECT de `activo`), 409 del principal (SELECT: nada cambió),
  asignar inquilino actual → `inquilino_actual_id` + línea de historial
  cerrada/abierta (dos SELECT), reasignar → dos períodos, `null` → línea
  cerrada, 404 de perfil ajeno, e historial ordenado. **Cubre: R10, R11,
  R12, R14.**

- [x] T18 — Tests de integración de documentos y fotos (Testcontainers
  MinIO + PostgreSQL): subir documento → fila con `hash_sha256` que coincide
  con el hash del binario leído del almacenamiento (R21); listar; archivar
  (SELECT `activo`, el objeto sigue); subir foto → clave en `fotos` (SELECT);
  quitar clave ajena → 400. **Cubre: R13, R16, R17, R21.**

## Bloque 5 — Invariantes de seguridad (tests deterministas, obligatorios)

- [x] T19 — `apps/api/src/database/__tests__/propiedades-rls.test.ts`
  (Testcontainers, rol sin `BYPASSRLS`, patrón de `clientes-rls.test.ts`):
  `SELECT *` sin `WHERE` sobre las cuatro tablas devuelve solo filas del
  tenant activo; en conexión virgen devuelve 0 filas; pedir por id una fila
  ajena devuelve 0 filas. **Cubre: R14, R19.**

- [x] T20 — Test HTTP de aislamiento: token del tenant A haciendo GET/PATCH/
  DELETE sobre una propiedad, un propietario, un inquilino actual, un
  documento y una foto del tenant B → **404** indistinguible del inexistente,
  sin 403 ni 200 con datos de B (y SELECT: nada se escribió). **Cubre: R14.**

- [x] T21 — Test HTTP de RBAC: usuario con único rol activo `propietario` y
  usuario con `inquilino` → **403** en las 14 rutas; `empleado` → 200/201 en
  las de negocio; sin token → **401**. Asserts por código de estado. **Cubre:
  R18.**

- [x] T22 — Tests de auditoría: cada una de las 10 mutaciones genera
  exactamente una fila en `audit_log` con `tenant_id`, `actor_id`, `accion`,
  `entity_type` y `entity_id` esperados. **Cubre: R20.**

- [x] T23 — Test de PII y binarios: `direccion`, `matricula_inmobiliaria`,
  teléfono/correo de administración y claves de storage no aparecen en
  `audit_log` (serializado completo) ni en los logs capturados; los binarios
  subidos no aparecen en la base (solo el hash) ni en logs. **Cubre: R15.**

## Bloque 6 — Integración y cierre

- [x] T24 — Registrar los módulos en `AppModule`, ampliar `RUTAS_PERMITIDAS`
  con las 14 rutas y `audit.interceptor.ts` con el fallback
  `idDocumento`/`idPropiedad` si las rutas anidadas lo requieren (patrón de
  #25). **Cubre: R22.**

- [x] T25 — Test unitario de `propiedades.service.ts` con doble de
  repositorio que registra SQL: `cuentaDeGiroResuelta` sin override → la
  predeterminada del principal; override presente → gana; la validación de
  R8 delega en `resolverCuentaDeGiro` y traduce su error a 400. **Cubre:
  R8.**

- [x] T26 — Revisar `tests/ddl-en-tests.test.ts`: ningún test crea las
  tablas nuevas ni el bucket; la suite anti-DDL sigue verde. **Cubre:
  gobernanza (C3).**

- [x] T27 — Escribir el mapa de trazabilidad `R1..R22 → test concreto` en
  `progress/impl_property_profile.md`, con las decisiones PA-6 ejecutadas y
  la dependencia #5 cerrada (override probado a través de la propiedad).
  **Cubre: trazabilidad (`docs/specs.md`).**

- [x] T28 — Ejecutar `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm run test:db` y `npm run build`; después `./init.sh` con exit code 0.
  **Verificación final y cierre.**
