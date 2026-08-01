# Tasks — inventory_templates

> Feature #11. Pasos discretos en orden. Las tasks de test son de primera
> clase: los invariantes de seguridad (bloque 5) se verifican con asserts
> deterministas contra PostgreSQL real (Testcontainers).
>
> **Prerrequisitos:** #6 (el enum de tipos de propiedad) y #7 (el patrón de
> plantillas del sistema, PA-11-1).
>
> **PA-11 aprobadas en la puerta del spec:** PA-11-1 (tenant reservado +
> RLS con OR/WITH CHECK, patrón #7), PA-11-2 (seed: Apartamento completo,
> las otras cinco sin zonas), PA-11-3 (materialización fuera, es #12),
> PA-11-4 (gestión solo admin).
>
> Cobertura: R1–R15 en 22 tasks (T1–T22), de las cuales 11 son tasks de test.

---

## Bloque 0 — Tipos y esquema Drizzle

- [x] T1 — Crear `packages/types/src/plantillas.ts` con `FieldType` (6),
  `PlantillaInmueble`, `PlantillaZona`, `PlantillaItem`,
  `PlantillaCompleta` y exportar desde el index. **Cubre: R1, R2, R3, R10.**

- [x] T2 — Crear los tres esquemas Drizzle (plantilla-inmueble,
  plantilla-zona, plantilla-item) con CHECKs (tipo, origen, field_type,
  opciones↔seleccion), UNIQUEs e índices; exportarlos en `schema/index.ts`.
  **Cubre: R1, R2, R3, R9.**

## Bloque 1 — Migración y seed

- [x] T3 — Escribir `0015_inventory_templates.sql` (siguiente índice libre):
  las tres tablas con `ENABLE`+`FORCE RLS` (la de plantilla con el OR del
  sistema y `WITH CHECK`; las de zona/ítem por subconsulta con `WITH CHECK`
  propio), CHECKs, UNIQUEs y el **seed** del catálogo (R4): APARTAMENTO con
  el ejemplo completo del PRD §8.8.5 y las otras cinco sin zonas.
  **Cubre: R1, R2, R3, R4, R9, R14.**

- [x] T4 — Añadir la entrada al `_journal.json`, `TABLAS_PERMITIDAS` +3 en
  `tests/migrations.test.ts` y test en `migrations.db.test.ts` (las tres
  tablas con RLS `true`/`true`, la política de plantilla con el OR del
  sistema y `WITH CHECK` sin el tenant reservado, y el seed: 6 plantillas
  SISTEMA, la de APARTAMENTO con sus zonas e ítems y field_types del
  ejemplo). **Cubre: R1, R2, R3, R4, R14.**

## Bloque 2 — Servicios

- [x] T5 — `plantillas.repository.ts`: `listar`, `buscarCompleta` (zonas e
  ítems activos), `insertarPlantilla`, `copiarPlantilla` (clon con zonas e
  ítems), `insertarZona`, `actualizarZona`, `marcarZonaInactiva`,
  `insertarItem`, `actualizarItem`, `marcarItemInactivo`,
  `buscarPlantillaPorTipo` y `origenDePlantilla`. Sin contexto →
  `SinContextoDeTenantError`. **Cubre: R1-R3, R5-R8, R12.**

- [x] T6 — `plantillas.service.ts`: `listar`, `obtener` (completa),
  `clonar` (R5: 404 ajena, 409 tipo duplicado), `exigirEditable` (R6: 404
  ajena, 409 SISTEMA) y el CRUD de zonas/ítems con la validación de
  pertenencia (la zona cuelga de `:id`, el ítem de `:idZona`) y de
  `opciones_json` (R9). **Cubre: R5, R6, R7, R8, R9.**

- [x] T7 — Crear el error `PlantillaSistemaNoEditableError`
  (`PLANTILLA_SISTEMA_NO_EDITABLE`, 409). **Cubre: R6.**

## Bloque 3 — Controller y rutas

- [x] T8 — `plantillas.controller.ts` con las 9 rutas del design §4,
  guards, `@Roles` (gestión solo `admin`; lectura admin/empleado) y
  `@Audit` en las mutaciones. **Cubre: R5-R8, R11, R13.**

- [x] T9 — Registrar el módulo en `CoreModule`, los DTOs zod (crear/
  actualizar zona e ítem, con la regla de `opciones_json`), ampliar
  `RUTAS_PERMITIDAS` (+9) y el fallback del `AuditInterceptor` con
  `idZona`/`idItem`. **Cubre: R9, R14, R13.**

## Bloque 4 — Tests de integración

- [x] T10 — El seed por HTTP: `GET /plantillas` lista las 6 del sistema y
  `GET /plantillas/:id` de la de APARTAMENTO muestra el ejemplo completo
  (SELECT de zonas/ítems con field_types y banderas). **Cubre: R4, R10.**

- [x] T11 — Clonar: 201 con copia TENANT y sus zonas/ítems (SELECT); clonar
  de nuevo el mismo tipo → 409; clonar la ajena → 404; editar la SISTEMA →
  409 `PLANTILLA_SISTEMA_NO_EDITABLE` sin escribir (SELECT). **Cubre: R5,
  R6.**

- [x] T12 — CRUD de zonas en la copia: crear, actualizar (nombre,
  repetible, obligatoria, orden — SELECT), baja lógica (SELECT `activo`) y
  404 de zona ajena. **Cubre: R7.**

- [x] T13 — CRUD de ítems: crear con `field_type = 'seleccion'` y
  `opciones_json` (201, SELECT), `opciones_json` con otro field_type → 400
  sin escribir, `seleccion` sin opciones → 400, actualizar y baja lógica.
  **Cubre: R8, R9.**

- [x] T14 — La zona inactiva no se lista en la plantilla completa y sus
  ítems quedan inertes (R7): después de la baja, `GET /plantillas/:id` no
  incluye la zona ni sus ítems (SELECT). **Cubre: R7, R10.**

## Bloque 5 — Invariantes de seguridad (tests deterministas, obligatorios)

- [x] T15 — `apps/api/src/database/__tests__/plantillas-rls.test.ts`
  (Testcontainers, rol sin `BYPASSRLS`): `SELECT *` sobre las tres tablas
  devuelve solo filas del tenant (o del sistema en plantilla_inmueble);
  conexión virgen → 0 filas; INSERT de una fila del sistema desde un
  contexto de tenant → rechazado (WITH CHECK); INSERT de zona/ítem contra
  una plantilla del sistema → rechazado. **Cubre: R11, R12.**

- [x] T16 — Test HTTP de aislamiento (R11): la plantilla de B accedida por
  A → 404 indistinguible (GET completa, clonar, gestión); nada se escribe
  (SELECT). **Cubre: R11.**

- [x] T17 — Test HTTP de RBAC (R11): `propietario`/`inquilino` → 403 en las
  9 rutas; `empleado` → 403 en la gestión y 200 en la lectura; sin token →
  401. **Cubre: R11.**

- [x] T18 — Test de auditoría (R13): clonar y cada mutación generan una
  fila en `audit_log` con `tenant_id`, `actor_id`, `accion`,
  `entity_type`/`entity_id` correctos y `metadata` vacío. **Cubre: R13.**

## Bloque 6 — Integración y cierre

- [x] T19 — Unit test de `plantillas.service.ts` con dobles: `exigirEditable`
  distingue 404 de 409; `clonar` copia zonas/ítems activos y no los
  inactivos; la validación de `opciones_json` rechaza antes de insertar.
  **Cubre: R5, R6, R9.**

- [x] T20 — Revisar `tests/ddl-en-tests.test.ts`: ningún test crea las
  tablas nuevas; la suite anti-DDL sigue verde. **Cubre: R14 (C3).**

- [x] T21 — Escribir el mapa de trazabilidad `R1..R15 → test concreto` en
  `progress/impl_inventory_templates.md`, con las decisiones PA-11
  ejecutadas y la dependencia registrada para #12/#14. **Cubre:
  trazabilidad (`docs/specs.md`).**

- [x] T22 — Ejecutar `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm run test:db` y `npm run build`; después `./init.sh` con exit code 0.
  **Verificación final y cierre.**
