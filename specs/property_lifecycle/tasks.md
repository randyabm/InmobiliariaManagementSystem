# Tasks — property_lifecycle

> Feature #8. Pasos discretos en orden. Las tasks de test son de primera
> clase: los invariantes de seguridad (bloque 4) se verifican con asserts
> deterministas contra PostgreSQL real (Testcontainers).
>
> **Prerrequisitos:** #7 `done` (el motor y su seed `ciclo_vida_propiedad`)
> y #6 `done` (la ficha). **Sin migración**: el estado vive en las tablas
> del motor (PA-8-1); `TABLAS_PERMITIDAS` no cambia (R16).
>
> **PA-8 aprobadas en la puerta del spec:** PA-8-1 (estado solo en el
> motor, ficha por join), PA-8-2 (instancia al crear la propiedad, misma
> transacción), PA-8-3 (copia TENANT o SISTEMA), PA-8-4 (rutas de negocio
> que envuelven al motor).
>
> Cobertura: R1–R16 en 24 tasks (T1–T24), de las cuales 12 son tasks de test.

---

## Bloque 0 — Tipos y resolución de la definición

- [x] T1 — Crear `packages/types/src/ciclo-vida.ts` con `EstadoCicloVida`
  (`clave`, `etiqueta`, `desde`), `CicloVidaDePropiedad` (estado +
  transiciones disponibles por clave), `DashboardFila` y
  `DashboardPropiedades` (conteos + filas); ampliar `PropiedadConExtras`
  con `estado_ciclo_vida: EstadoCicloVida | null`; exportar desde el index.
  **Cubre: R3, R9, R12.**

- [x] T2 — Añadir `buscarDefinicionParaTenant(ctx, tipo)` al
  `WorkflowRepository` del motor: la copia `TENANT` del tenant primero, la
  `SISTEMA` si no (PA-8-3). Unit test con doble que registra las consultas.
  **Cubre: R2.**

## Bloque 1 — Vínculo propiedad ↔ instancia

- [x] T3 — Extender `PropiedadesService.crear`: tras el INSERT de la
  ficha, resolver la definición (T2) y crear la instancia del motor en la
  misma transacción con `entidad_tipo = 'propiedad'` y `entidad_id` = id de
  la ficha. Si la instancia falla, la excepción aborta todo. **Cubre: R1,
  R2.**

- [x] T4 — Extender `PropiedadesRepository.buscarPorId`/`obtener` para
  resolver `estado_ciclo_vida` (clave, etiqueta, `desde` = `updated_at` de
  la instancia) por join con el motor; `null` si la propiedad no tiene
  instancia. **Cubre: R3.**

- [x] T5 — Tests de integración del vínculo: crear una propiedad → existe
  su instancia en `disponible` (SELECT con poolAdmin) y la ficha la expone
  (`estado_ciclo_vida.clave = 'disponible'`); si la instancia no existe
  (fila sembrada a mano), la ficha muestra `null`. **Cubre: R1, R3.**

- [x] T6 — Test de la precedencia de definición (PA-8-3): con la copia
  TENANT existente, la instancia nueva cuelga de la COPIA; sin copia, de la
  SISTEMA (SELECT de `definicion_id` con el id de cada una). **Cubre: R2.**

## Bloque 2 — Ciclo de vida desde la ficha

- [x] T7 — `ciclo-vida.service.ts`: `consultar` (exige la propiedad,
  resuelve la instancia y delega en `WorkflowService.consultarInstancia`,
  devolviendo estado + disponibles por clave) y `ejecutar` (exige la
  propiedad, resuelve la transición por clave dentro de la definición —
  409 si no existe o no es HUMANA — y delega en
  `WorkflowService.ejecutarTransicion`). **Cubre: R4, R5, R6, R13.**

- [x] T8 — `ciclo-vida.controller.ts` con `GET /propiedades/:id/ciclo-vida`
  y `POST /propiedades/:id/ciclo-vida/transiciones/:claveTransicion`
  (contexto opcional con zod, `@Audit('actualizar','propiedad')` en el
  POST) y guards `@Roles('admin','empleado')`. **Cubre: R4, R5, R7, R13.**

- [x] T9 — `dashboard.service.ts` + `dashboard.controller.ts`:
  `GET /propiedades/dashboard` con conteos por estado (de propiedades
  activas), listado con `estado_ciclo_vida`, `instancia_id`,
  `tiempo_en_estado_segundos` (now() - updated_at) y filtros `estado`/
  `tipo`. El controller se registra ANTES de `PropiedadesController` en el
  módulo (orden de emparejado). **Cubre: R9, R10, R11, R12, R13.**

- [x] T10 — Registrar `WorkflowsModule` en `propiedades.module.ts`, los
  controllers/servicios nuevos y ampliar `RUTAS_PERMITIDAS` (+3) en
  `routes-surface.test.ts`. **Cubre: R16.**

- [x] T11 — Tests de integración del ciclo de vida: crear propiedad →
  GET ciclo-vida (estado `disponible` + disponibles con `iniciar_checkeo`);
  ejecutar `iniciar_checkeo` por clave → 200 y estado `en_checkeo`
  (verificado con SELECT de la instancia Y del log del motor); ejecutar
  desde `en_checkeo` la clave `arrendar` (de otro estado) → 409
  `TRANSICION_NO_DISPONIBLE` sin cambiar el estado ni escribir log (SELECT);
  clave inexistente → 409 indistinguible. **Cubre: R4, R5, R6, R7.**

- [x] T12 — Test de la rama condicional desde la propiedad: ejecutar
  `cerrar_entrega_ok` con `contexto: { entrega_ok: true }` tras recorrer
  hasta `en_desocupacion` → `disponible`; sin el dato → 409. **Cubre: R5.**

- [x] T13 — Test de la auditoría (R7): la ejecución por la ruta de #8
  genera exactamente una fila en `audit_log` con `entity_type =
  'propiedad'`, `entity_id` = id de la propiedad y `metadata` vacío, y la
  fila correspondiente en `workflow_transicion_log`. **Cubre: R7.**

## Bloque 3 — Dashboard

- [x] T14 — Test del dashboard: con propiedades en distintos estados (se
  transicionan por la ruta de #8), los conteos coinciden con SELECTs
  independientes; las propiedades sin instancia NO aparecen; el listado
  incluye `estado_ciclo_vida`, `instancia_id` y `tiempo_en_estado_segundos`
  ≥ 0. **Cubre: R9, R12.**

- [x] T15 — Test de filtros: `?estado=en_checkeo` limita conteos y listado;
  `?tipo=APARTAMENTO` limita el listado; ambos combinados. **Cubre: R10.**

- [x] T16 — Test del orden: el listado del dashboard viene ordenado por
  `tiempo_en_estado_segundos` DESC (una propiedad transicionada hace más
  tiempo aparece antes). **Cubre: R11.**

## Bloque 4 — Invariantes de seguridad (tests deterministas, obligatorios)

- [x] T17 — Test HTTP de aislamiento (R13): el ciclo de vida y el dashboard
  del tenant A no revelan propiedades del tenant B — GET ciclo-vida de una
  propiedad de B → 404 indistinguible; POST de una transición de B → 404 y
  nada escrito (SELECT); el dashboard de A no incluye filas de B (SELECT de
  los `entidad_id`). **Cubre: R13.**

- [x] T18 — Test HTTP de RBAC (R13): `propietario`/`inquilino` → 403 en las
  3 rutas (y en `GET /propiedades/:id` con estado); `empleado` → 200/201;
  sin token → 401. **Cubre: R13.**

- [x] T19 — Test de auditoría y PII (R15): un `contexto` con valores
  distintivos no aparece en `audit_log` (serializado completo) ni en los
  logs capturados; la ficha del dashboard no filtra direcciones en
  `metadata`. **Cubre: R15.**

- [x] T20 — Test de la frontera R8: las transiciones del seed declaran
  `notificacion` como dato (SELECT) y su ejecución NO produce ningún
  registro fuera del motor y de `audit_log` (no hay tabla de
  notificaciones). **Cubre: R8.**

## Bloque 5 — Integración y cierre

- [x] T21 — Unit test de `ciclo-vida.service` con dobles: 404 de propiedad
  ajena/inexistente, 409 de clave no encontrada, delegación al motor con
  los ids correctos (registro de llamadas). **Cubre: R5, R13.**

- [x] T22 — Revisar `tests/ddl-en-tests.test.ts`: ningún test crea tablas
  ni columnas nuevas; la suite anti-DDL sigue verde. **Cubre: R16 (C3).**

- [x] T23 — Escribir el mapa de trazabilidad `R1..R16 → test concreto` en
  `progress/impl_property_lifecycle.md`, con las decisiones PA-8 ejecutadas
  y la frontera #10/#9/#20 anotada. **Cubre: trazabilidad (`docs/specs.md`).**

- [x] T24 — Ejecutar `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm run test:db` y `npm run build`; después `./init.sh` con exit code 0.
  **Verificación final y cierre.**
