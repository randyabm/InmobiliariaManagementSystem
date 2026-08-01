# Tasks — workflow_engine

> Feature #7. Pasos discretos en orden. Las tasks de test son de primera
> clase: los invariantes de seguridad (bloque 5) se verifican con asserts
> deterministas contra PostgreSQL real (Testcontainers).
>
> **Prerrequisitos:** #27, #3, #4 y #6 `done`. El primer consumidor (el #8)
> transicionará sobre el motor que esta feature siembra como datos.
>
> **PA-7 aprobadas en la puerta del spec:** PA-7-1 (plantillas del sistema
> con tenant reservado + RLS con OR/WITH CHECK), PA-7-2 (condiciones JSONB
> whitelisted, fail closed), PA-7-3 (cascada automática en la misma
> transacción, máx. 10), PA-7-4 (RF-W2 base: clonar + editar la copia).
>
> Cobertura: R1–R17 en 27 tasks (T1–T27), de las cuales 14 son tasks de test.

---

## Bloque 0 — Tipos y esquema Drizzle

- [ ] T1 — Crear `packages/types/src/workflows.ts` con `OrigenDefinicion`,
  `TipoEjecucion`, `CondicionClausula`, `WorkflowDefinicion`,
  `WorkflowEstado`, `WorkflowTransicion`, `WorkflowInstancia`,
  `WorkflowTransicionLog` y `DefinicionCompleta`; exportar desde el index.
  **Cubre: R1, R2, R3, R6, R10.**

- [ ] T2 — Crear los cinco esquemas Drizzle (definicion, estado,
  transicion, instancia, transicion-log) con UNIQUEs, CHECKs e índices de
  R1, R2, R6 y R12, y exportarlos en `schema/index.ts`. **Cubre: R1, R2,
  R12.**

## Bloque 1 — Migración y seed

- [ ] T3 — Escribir `0013_workflow_engine.sql` (siguiente índice libre),
  forward-only e idempotente: las cinco tablas con
  `ENABLE`+`FORCE RLS` y política por `tenant_id` en la misma migración; la
  política de `workflow_definicion` con el OR del sistema y `WITH CHECK`
  propio (PA-7-1); los triggers append-only de `workflow_transicion_log`;
  y el **seed** de `ciclo_vida_propiedad` (R17: estados y transiciones del
  RF-P4, con la rama condicional de `entrega_ok` como datos). **Cubre: R1,
  R2, R3, R10, R13, R17.**

- [ ] T4 — Añadir la entrada al `_journal.json`, `TABLAS_PERMITIDAS` +5 en
  `tests/migrations.test.ts` y test en `migrations.db.test.ts` (las cinco
  tablas con RLS `true`/`true`, políticas, triggers append-only que
  rechazan UPDATE/DELETE incluso para el dueño, y el seed:
  `ciclo_vida_propiedad` existe como SISTEMA con sus 6 estados y la rama
  condicional). **Cubre: R13, R17.**

- [ ] T5 — Test de la política del sistema (PA-7-1): con el rol de
  aplicación, un tenant lee la definición del sistema; INSERTAR una fila
  con el tenant reservado desde un contexto de tenant es rechazado
  (WITH CHECK). **Cubre: R13.**

## Bloque 2 — Evaluador y núcleo de ejecución

- [ ] T6 — Crear `evaluador-condiciones.ts` (puro): cláusulas
  `{campo, operador, valor}` con ruta de puntos sobre el contexto;
  operadores `igual`, `distinto`, `es_nulo`, `no_nulo`, `mayor_que`,
  `menor_que`; condición vacía = verdadera; operador desconocido o forma
  inválida = **falsa** (fail closed). **Cubre: R3.**

- [ ] T7 — Unit test del evaluador: los seis operadores, ruta anidada,
  tipos (número vs. texto), condición vacía, `mayor_que` sobre no-número →
  falso, y operador desconocido → falso sin lanzar. **Cubre: R3.**

- [ ] T8 — `workflow.repository.ts`: `insertarDefinicion` (con estados y
  transiciones en la misma transacción), `buscarDefinicion` (completa),
  `insertarInstancia`, `buscarInstanciaPorEntidad`, `buscarInstanciaPorId`,
  `transicionesDe` (con origen, activas y sus condiciones),
  `actualizarEstado`, `insertarLog`. Sin contexto → `SinContextoDeTenantError`
  (nada de pool crudo). **Cubre: R6, R12, R15.**

- [ ] T9 — `workflow.service.ts`: `crearInstancia` (estado inicial, 409 si
  ya existe), `consultarInstancia` (estado + transiciones humanas
  disponibles para el actor: origen, activo, condición y rol), y
  `ejecutarTransicion` con la cascada automática (R8: máx. 10 → 409
  `CICLO_AUTOMATICO` y rollback de todo; los logs en cascada escriben
  `automatica = true`, `actor_id = NULL`). **Cubre: R6, R7, R8, R9, R10.**

- [ ] T10 — Crear los errores `InstanciaYaExisteError`,
  `TransicionNoDisponibleError`, `DefinicionSistemaNoEditableError` y
  `CicloAutomaticoError` (todos 409, heredando de `AppError`). **Cubre:
  R6, R7, R5, R8.**

- [ ] T11 — Unit test del servicio con doble de repositorio que registra
  SQL: creación en estado inicial; 409 por instancia duplicada; la
  validación de R7 distingue 403 (rol) de 409 (estado/condición) sin
  revelar cuál falló; y la cascada automática ejecuta en orden y aborta con
  rollback al superar 10 (el doble registra la secuencia de llamadas).
  **Cubre: R6, R7, R8, R9.**

## Bloque 3 — Definiciones (RF-W2 base)

- [ ] T12 — `definiciones.service.ts`: `listar`, `obtener` (completa),
  `clonar` (R4: copia estados/transiciones a `origen = 'TENANT'`, 404 si
  ajena, 409 si el tenant ya tiene el tipo) y `anadirTransicion`/
  `darDeBajaTransicion` (R5: 404 si ajena, 409 si `SISTEMA`). **Cubre: R4,
  R5, R14.**

- [ ] T13 — `workflows.controller.ts` con las 9 rutas del design §8,
  guards y `@Roles` (clonar/transiciones solo `admin`; instancias y
  ejecución `admin`/`empleado`), y `@Audit` en las mutaciones. **Cubre:
  R4, R5, R6, R7, R14, R15.**

- [ ] T14 — Ampliar `RUTAS_PERMITIDAS` (+9), registrar el módulo en
  `CoreModule` y añadir el fallback de `entity_id` del interceptor para
  `idTransicion` si las rutas anidadas lo requieren (patrón de #25/#6).
  **Cubre: R17, R15.**

## Bloque 4 — Tests de integración del ciclo completo

- [ ] T15 — Test de integración «máquina de estados completa definida solo
  con datos» (Testcontainers + app real, criterio de aceptación): crear
  instancia del seed `ciclo_vida_propiedad` sobre una entidad opaca →
  estado `disponible`; recorrer la cadena humana hasta `arrendada`;
  verificar con SELECT de `estado_actual_id` y del log (R10). **Cubre:
  R6, R7, R10, R17.**

- [ ] T16 — Test de la rama condicional: desde `en_desocupacion` con
  `contexto.entrega_ok = true` → `disponible`; con `false` → `en_checkeo`
  (la MISMA transición origen, dos destinos por condición — R3). **Cubre:
  R3, R7.**

- [ ] T17 — Test de cascada automática: definición de prueba del tenant
  (clonada y editada) con `HUMANA → AUTOMATICA → AUTOMATICA → FINAL`; una
  sola petición humana recorre la cadena (SELECT del log: 3 filas,
  `automatica` en las dos últimas, `actor_id` NULL). **Cubre: R5, R8.**

- [ ] T18 — Test de rechazos: transición de otro estado → 409
  `TRANSICION_NO_DISPONIBLE` sin cambiar el estado (SELECT); condición
  falsa → 409; `INSTANCIA_YA_EXISTE`; `CICLO_AUTOMATICO` con una definición
  cíclica de prueba (la petición entera hace rollback: el estado sigue
  donde estaba). **Cubre: R6, R7, R8.**

- [ ] T19 — Test de definiciones: clonar la plantilla del sistema (201),
  añadir una transición a la copia (201) y darla de baja (200, SELECT
  `activo`); editar la del sistema → 409 `DEFINICION_SISTEMA_NO_EDITABLE`;
  clonar de otro tenant → 404; duplicar tipo → 409. **Cubre: R4, R5, R14.**

## Bloque 5 — Invariantes de seguridad (tests deterministas, obligatorios)

- [ ] T20 — `apps/api/src/database/__tests__/workflows-rls.test.ts`
  (Testcontainers, rol sin `BYPASSRLS`): `SELECT *` sin `WHERE` sobre las
  cinco tablas devuelve solo filas del tenant activo (o del sistema en
  `workflow_definicion`, verificando que el OR de PA-7-1 solo trae las del
  sistema); conexión virgen → 0 filas; pedir por id una instancia ajena →
  0 filas; el INSERT con tenant reservado es rechazado. **Cubre: R13, R14,
  R15.**

- [ ] T21 — Test HTTP de aislamiento: instancia y definición del tenant B
  accedidas por el tenant A → 404 indistinguible del inexistente (GET,
  POST transición, GET historial); la ejecución no escribe nada (SELECT).
  **Cubre: R14.**

- [ ] T22 — Test HTTP de RBAC: `propietario`/`inquilino` → 403 en las 9
  rutas; `empleado` → 403 en clonar/añadir transición y 200/201 en
  instancias/ejecución; sin token → 401. **Cubre: R14.**

- [ ] T23 — Test de auditoría (R15): crear instancia y ejecutar transición
  generan exactamente una fila en `audit_log` cada una, con `tenant_id`,
  `actor_id`, `accion`, `entity_type` y `entity_id`; el `metadata`
  serializado no contiene el `contexto` (R16). **Cubre: R15, R16.**

- [ ] T24 — Test de PII en logs: un `contexto` con valores distintivos
  (documento/celular/correo) no aparece en `audit_log` ni en los logs
  capturados; el log de dominio (`workflow_transicion_log.contexto_tras`)
  sí lo conserva como dato de dominio (SELECT). **Cubre: R16.**

## Bloque 6 — Integración y cierre

- [ ] T25 — Revisar `tests/ddl-en-tests.test.ts`: ningún test crea las
  tablas nuevas; la suite anti-DDL sigue verde. **Cubre: gobernanza (C3).**

- [ ] T26 — Escribir el mapa de trazabilidad `R1..R17 → test concreto` en
  `progress/impl_workflow_engine.md`, con las decisiones PA-7 ejecutadas y
  la frontera #10/#paquetes anotada. **Cubre: trazabilidad
  (`docs/specs.md`).**

- [ ] T27 — Ejecutar `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm run test:db` y `npm run build`; después `./init.sh` con exit code 0.
  **Verificación final y cierre.**
