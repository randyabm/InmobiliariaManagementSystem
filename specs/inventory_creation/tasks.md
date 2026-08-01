# Tasks — inventory_creation

> Feature #12. Pasos discretos en orden. Las tasks de test son de primera
> clase: los invariantes de seguridad (bloque 5) se verifican con asserts
> deterministas contra PostgreSQL y MinIO reales (Testcontainers).
>
> **Prerrequisitos:** #11, #6 y #10 `done`.
>
> **PA-12 aprobadas en la puerta del spec:** PA-12-1 (estado como columna
> con CHECK), PA-12-2 (un borrador por propiedad+tipo_evento), PA-12-3
> (plantilla de la propiedad: TENANT o SISTEMA), PA-12-4 (borrado de foto
> lógico, el objeto se conserva).
>
> Cobertura: R1–R11 en 24 tasks (T1–T24), de las cuales 12 son tasks de test.

---

## Bloque 0 — Tipos y esquema Drizzle

- [ ] T1 — Crear `packages/types/src/inventarios.ts` con `TipoEventoInventario`,
  `EstadoInventario` (7), `EstadoChecklist`, `Inventario`, `InventarioZona`,
  `InventarioItem`, `InventarioItemFoto` y `InventarioCompleto`; exportar
  desde el index. **Cubre: R1, R2, R3.**

- [ ] T2 — Crear los cuatro esquemas Drizzle (inventario, inventario-zona,
  inventario-item, inventario-item-foto) con CHECKs, índices y `activo` en
  la foto; exportarlos en `schema/index.ts`. **Cubre: R1, R2, R3.**

## Bloque 1 — Migración

- [ ] T3 — Escribir `0016_inventory_creation.sql` (siguiente índice libre):
  las cuatro tablas con `ENABLE`+`FORCE RLS` y política por `tenant_id` en
  la misma migración, CHECKs e índices. **Cubre: R1, R2, R3, R11.**

- [ ] T4 — Añadir la entrada al `_journal.json`, `TABLAS_PERMITIDAS` +4 en
  `tests/migrations.test.ts` y test en `migrations.db.test.ts` (las cuatro
  tablas con RLS `true`/`true`, políticas por `app.current_tenant` y los
  CHECKs de estado/tipo_evento/field_type/autor). **Cubre: R11.**

## Bloque 2 — Servicios

- [ ] T5 — `PlantillasService.resolverPlantillaParaTenant(tipo, ctx)`:
  copia TENANT si existe, si no SISTEMA (patrón PA-8-3). Unit test con
  doble. **Cubre: R4, PA-12-3.**

- [ ] T6 — `inventarios.repository.ts`: `insertarInventario`,
  `buscarInventarioPorId` (con zonas/ítems/fotos), `listar` (filtros),
  `buscarBorradorPorPropiedad`, `insertarZona`, `insertarItem`,
  `actualizarZona`, `actualizarItem`, `marcarZonaInactiva`,
  `marcarItemInactivo`, `reordenar` y el copiado de la plantilla
  (`materializarPlantilla`). Sin contexto → `SinContextoDeTenantError`.
  **Cubre: R1-R4, R6, R9.**

- [ ] T7 — `inventarios.service.ts`: `crear` (R4: 404 propiedad ajena,
  409 borrador duplicado, materialización en la misma transacción),
  `obtener`, `listar`, y el CRUD de zonas/ítems con pertenencia (la zona
  cuelga de `:id`, el ítem de la zona) y `reordenar`. **Cubre: R4, R6, R7,
  R8.**

- [ ] T8 — `fotos.service.ts`: `subir` (AlmacenamientoService → fila con
  clave/hash/autor `EMPLEADO`) y `quitar` (baja lógica de la fila, el
  objeto se conserva). **Cubre: R3, R5, PA-12-4.**

- [ ] T9 — Crear el error `InventarioBorradorYaExisteError`
  (`INVENTARIO_BORRADOR_YA_EXISTE`, 409). **Cubre: R4.**

## Bloque 3 — Controller y rutas

- [ ] T10 — `inventarios.controller.ts` y `fotos.controller.ts` con las 12
  rutas del design §3, guards, `@Roles('admin','empleado')` y `@Audit` en
  las mutaciones; DTOs zod. **Cubre: R4-R8, R10.**

- [ ] T11 — Registrar el módulo en `CoreModule`, ampliar `RUTAS_PERMITIDAS`
  (+12) y el fallback del `AuditInterceptor` con `idFoto`. **Cubre: R11.**

## Bloque 4 — Tests de integración

- [ ] T12 — Crear inventario: 201 con `BORRADOR`, snapshot de la plantilla
  (zonas/ítems copiados con SELECT y `plantilla_*_id` de origen); editar la
  plantilla después NO altera el inventario (SELECT). **Cubre: R4, RF-I24.**

- [ ] T13 — Un borrador por propiedad+tipo_evento: repetir → 409
  `INVENTARIO_BORRADOR_YA_EXISTE`; otra propiedad o el otro tipo_evento →
  201. Propiedad ajena → 404. **Cubre: R4, R8.**

- [ ] T14 — Libertad ad-hoc: crear zona nueva en el inventario (201, la
  plantilla NO cambia — SELECT), PATCH de orden/nombre, DELETE (baja
  lógica, SELECT `activo`), ítems nuevos con respuesta
  (`estado_checklist`, `valor_respuesta`, `comentario`). **Cubre: R6.**

- [ ] T15 — Fotos: subir (201 con clave `uuid+ext`, hash SHA-256 en la
  fila), el binario NO está en la base (SELECT), DELETE deja la fila
  `activo = false` y el objeto sigue (SELECT con poolAdmin), 404 de foto
  ajena. **Cubre: R3, R5.**

- [ ] T16 — Listado y ficha: `GET /inventarios` con filtros
  (`propiedad_id`, `estado`, `tipo_evento`) y la ficha con zonas/ítems/
  fotos; solo `BORRADOR` se puede editar estructuralmente (una transición
  de estado a mano por poolAdmin → PATCH de ítem da 409/403 según R7 —
  verificar con SELECT). **Cubre: R7.**

## Bloque 5 — Invariantes de seguridad (tests deterministas, obligatorios)

- [ ] T17 — `apps/api/src/database/__tests__/inventarios-rls.test.ts`
  (Testcontainers, rol sin `BYPASSRLS`): `SELECT *` sin `WHERE` sobre las
  cuatro tablas devuelve solo filas del tenant activo; conexión virgen → 0
  filas; pedir por id una fila ajena → 0 filas. **Cubre: R8, R9.**

- [ ] T18 — Test HTTP de aislamiento (R8): inventario de B accedido por A →
  404 indistinguible (GET ficha, PATCH ítem, DELETE zona, POST foto); nada
  se escribe (SELECT). **Cubre: R8.**

- [ ] T19 — Test HTTP de RBAC (R8): `propietario`/`inquilino` → 403 en las
  12 rutas; sin token → 401; `empleado` → 201. **Cubre: R8.**

- [ ] T20 — Test de auditoría y PII (R10): crear inventario y subir foto
  generan una fila en `audit_log` cada uno con `entity_id` correcto y
  `metadata` vacío; un comentario distintivo del ítem no aparece en logs ni
  en `audit_log`. **Cubre: R10.**

## Bloque 6 — Integración y cierre

- [ ] T21 — Unit test de `inventarios.service.ts` con dobles: 404 de
  propiedad ajena, 409 de borrador duplicado, materialización llamando a la
  plantilla resuelta (registro de llamadas), y pertenencia zona/ítem.
  **Cubre: R4, R6.**

- [ ] T22 — Revisar `tests/ddl-en-tests.test.ts`: ningún test crea las
  tablas nuevas; la suite anti-DDL sigue verde. **Cubre: R11 (C3).**

- [ ] T23 — Escribir el mapa de trazabilidad `R1..R11 → test concreto` en
  `progress/impl_inventory_creation.md`, con las decisiones PA-12 y las
  fronteras #13/#14/#21/#22 anotadas. **Cubre: trazabilidad.**

- [ ] T24 — Ejecutar `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm run test:db` y `npm run build`; después `./init.sh` exit 0.
  **Verificación final y cierre.**
