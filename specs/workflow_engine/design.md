# Design — workflow_engine

> Feature #7. Motor de workflows dirigido por datos (D3).
> Este documento asume `docs/architecture.md` y `docs/conventions.md`; solo
> documenta los puntos donde la feature roza sus fronteras.

---

## 1. Origen y por qué dirigido por datos

RF-A4 lo exige: el motor es **genérico y reutilizable** entre módulos
(inventarios, contratos, cobranza, mantenimiento — §5 del PRD). El primer
consumidor real es el ciclo de vida de la propiedad (RF-P4), que #8 usará;
por eso la migración siembra su definición como **datos** (R17): es la
demostración de que una máquina completa vive en filas, no en código, y el
test que la ejercita es el criterio de aceptación.

```
definición (datos)            instancia (estado vivo)        log (append-only)
workflow_definicion 1──n  workflow_estado             workflow_instancia ──n workflow_transicion_log
                └──────n  workflow_transicion               (contexto jsonb)
```

## 2. La plantilla del sistema: `tenant_id` reservado (PA-7-1)

Las plantillas base (`origen = 'SISTEMA'`) viven en la MISMA tabla con el
tenant reservado `00000000-0000-0000-0000-000000000000`. La política RLS:

```sql
CREATE POLICY workflow_definicion_tenant_isolation ON workflow_definicion
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid
         OR tenant_id = '00000000-0000-0000-0000-000000000000'::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
```

- **USING con OR:** cualquier tenant lee las plantillas del sistema.
- **WITH CHECK propio:** nadie puede INSERTAR filas del sistema desde un
  contexto de tenant (la lección de `0003`: una política `FOR ALL` sin
  `WITH CHECK` permitía escrituras indeseadas).
- La aplicación nunca escribe filas del sistema; un test verifica que el
  rol de aplicación no puede (INSERT con tenant reservado → rechazado).

Alternativa descartada: tabla global `workflow_plantilla_sistema` sin RLS.
Rompe la convención «toda tabla de negocio lleva `tenant_id`» y crea un
régimen de seguridad distinto para una sola tabla.

## 3. El evaluador de condiciones (PA-7-2)

`condicion` es un array de cláusulas:

```jsonc
[
  { "campo": "candidato_aprobado", "operador": "igual", "valor": true },
  { "campo": "puntaje", "operador": "mayor_que", "valor": 60 }
]
```

- `campo` es una ruta de puntos sobre `instancia.contexto` (p. ej.
  `"candidato.puntaje"`).
- Operadores whitelisted: `igual`, `distinto`, `es_nulo`, `no_nulo`,
  `mayor_que`, `menor_que` (los dos últimos solo sobre números; error de
  forma de la condición → 409 `TRANSICION_NO_DISPONIBLE`, sin filtrar por
  qué).
- **Nunca** `eval` de JavaScript ni SQL derivado de la condición: un
  operador fuera de la lista convierte la condición en **falsa** (fail
  closed), nunca en ejecutable.

El evaluador vive en `evaluador-condiciones.ts`, puro y con su propio unit
test (todas las operaciones + fail closed). La `condicion` vacía (`{}` o
`[]`) se cumple siempre.

## 4. Responsables (R7)

`roles_requeridos` es un array de roles. La comprobación NO usa los claims
del token: consulta `user_role` con `activo = true` en la base, dentro del
contexto de tenant de la petición (la lección de #26/#27: el token es un
dato viejo; el rol revocado debe dejar de surtir efecto). Vacío = cualquier
usuario autenticado del tenant.

## 5. Ejecución de una transición humana (R7) y cascada automática (R8)

```
POST .../instancias/:id/transiciones/:idTransicion   (en la transacción de la petición)
 1. instancia exigida (404 si ajena/inexistente)
 2. transición exigida: misma definición, origen = estado actual,
    activo, condición cumplida, rol del actor (403 si rol; 409 si el resto)
 3. log de la transición (actor, contexto_tras = contexto actualizado)
 4. actualiza estado_actual
 5. CASCADA: mientras haya transiciones AUTOMATICAS del estado nuevo
    con condición cumplida:
      - se ejecutan en orden (sin rol: no hay actor humano)
      - cada una escribe su log (automatica = true, actor_id = NULL)
      - contador: si > 10 → 409 CICLO_AUTOMATICO y la petición entera
        hace rollback (la humana incluida)
```

La cascada ocurre en la transacción de la petición (la abre el
`TenantContextInterceptor`): no hay procesos en segundo plano ni colas
inventadas (RF-W5 sin infraestructura nueva). Un `contexto` opcional por
petición (`{ contexto: {...} }`) se fusiona sobre el de la instancia antes
de evaluar y de registrar.

## 6. Instancia y entidad (R12)

`entidad_tipo` + `entidad_id` son opacos para el motor (la validación de
existencia es del módulo de negocio, #8). La UNIQUE
`(tenant_id, definicion_id, entidad_tipo, entidad_id)` garantiza una sola
máquina por entidad. `contexto` inicial viene en el alta.

## 7. Log append-only (R10)

`workflow_transicion_log` se protege con los mismos triggers de
`audit_log` (`0006`): `trg_wf_log_no_update` / `trg_wf_log_no_delete` con
la función `workflow_log_prevent_mutation`. Es el registro de auditoría del
dominio (RF-W4); `audit_log` recibe además la entrada de acción crítica
(R15) con `metadata` vacío (R16: el contexto NO va al `metadata`; vive en
`contexto_tras` de la tabla de dominio).

## 8. Superficie HTTP (9 rutas)

| Método y ruta | Rol | R | Auditoría |
|---|---|---|---|
| `GET /workflows` | admin/empleado | R14 (lista) | — |
| `GET /workflows/:id` | admin/empleado | definición completa | — |
| `POST /workflows/:id/clonar` | **admin** | R4 | `@Audit('crear','workflow_definicion')` |
| `POST /workflows/:id/transiciones` | **admin** | R5 | `@Audit('crear','workflow_transicion')` |
| `DELETE /workflows/:idDefinicion/transiciones/:idTransicion` | **admin** | R5 | `@Audit('baja','workflow_transicion')` |
| `POST /workflows/:id/instancias` | admin/empleado | R6 | `@Audit('crear','workflow_instancia')` |
| `GET /workflows/instancias/:idInstancia` | admin/empleado | R9 | — |
| `POST /workflows/instancias/:idInstancia/transiciones/:idTransicion` | admin/empleado | R7, R8 | `@Audit('actualizar','workflow_instancia')` |
| `GET /workflows/instancias/:idInstancia/historial` | admin/empleado | R11 | — |

Firmas nuevas relevantes:

```ts
// workflow.service.ts
crearInstancia(definicionId, { entidadTipo, entidadId, contexto }, ctx): Promise<WorkflowInstancia>;
consultarInstancia(idInstancia, actorId, ctx): Promise<{ instancia; disponibles: WorkflowTransicion[] }>;
ejecutarTransicion(idInstancia, idTransicion, contexto, actorId, ctx): Promise<WorkflowInstancia>;
historial(idInstancia, ctx): Promise<WorkflowTransicionLog[]>;

// definiciones.service.ts
listar(ctx): Promise<WorkflowDefinicion[]>;
obtener(id, ctx): Promise<DefinicionCompleta>;
clonar(id, ctx): Promise<WorkflowDefinicion>;
anadirTransicion(id, dto, ctx): Promise<WorkflowTransicion>;
darDeBajaTransicion(idDefinicion, idTransicion, ctx): Promise<void>;

// evaluador-condiciones.ts (puro)
cumple(condicion: unknown, contexto: Record<string, unknown>): boolean;
```

## 9. La definición sembrada: `ciclo_vida_propiedad` (R17, RF-P4)

La migración siembra (idempotente) la definición del RF-P4 como datos:

- Estados: `disponible` (inicial), `en_checkeo`, `con_aseguradora`,
  `arrendada` (final), `en_desocupacion`, `inactiva` (final).
- Transiciones humanas: disponible→en_checkeo, en_checkeo→con_aseguradora,
  con_aseguradora→arrendada, arrendada→en_desocupacion,
  en_desocupacion→en_checkeo, en_desocupacion→disponible,
  con_aseguradora→disponible, disponible→inactiva.
- Rama condicional (demuestra condiciones como datos, §12.2 «vuelve a
  checkeo»):
  - `en_desocupacion→disponible` con `condicion: [{campo:
    "entrega_ok", operador: "igual", valor: true}]`
  - `en_desocupacion→en_checkeo` con `condicion: [{campo: "entrega_ok",
    operador: "distinto", valor: true}]`
- `roles_requeridos: ['admin','empleado']` en todas.

El test de aceptación ejercita esta definición: crear instancia sobre una
entidad, recorrer la cadena, probar la rama condicional y el rechazo de una
transición inválida — todo contra filas, sin código de estados.

## 10. Errores de dominio

| Error | `code` | HTTP | Cuándo |
|---|---|---|---|
| `InstanciaYaExisteError` (nuevo) | `INSTANCIA_YA_EXISTE` | 409 | R6 |
| `TransicionNoDisponibleError` (nuevo) | `TRANSICION_NO_DISPONIBLE` | 409 | R7 (estado, activo, condición — sin distinguir) |
| `DefinicionSistemaNoEditableError` (nuevo) | `DEFINICION_SISTEMA_NO_EDITABLE` | 409 | R5 |
| `CicloAutomaticoError` (nuevo) | `CICLO_AUTOMATICO` | 409 | R8 |
| `ResourceNotFoundError` (reutilizado) | `RESOURCE_NOT_FOUND` | 404 | R4, R5, R6, R9, R11, R14 |
| `SinContextoDeTenantError` (reutilizado) | `SIN_CONTEXTO_DE_TENANT` | 500 | R15 |
| 403 por rol | (ForbiddenException) | 403 | R7, R14 |

## 11. Archivos

### Se crean

```
apps/api/drizzle/0013_workflow_engine.sql        (esquema + seed + triggers + RLS)
apps/api/src/database/schema/{workflow-definicion,workflow-estado,workflow-transicion,workflow-instancia,workflow-transicion-log}.ts
apps/api/src/modules/core/workflows/
├── workflows.module.ts
├── evaluador-condiciones.ts
├── workflow.{repository,service}.ts
├── definiciones.{repository,service}.ts
├── workflows.controller.ts
├── dto/ (crear-instancia, ejecutar-transicion, anadir-transicion, clonar)
├── errors/ (instancia-ya-existe, transicion-no-disponible,
│            definicion-sistema-no-editable, ciclo-automatico)
└── __tests__/
apps/api/src/database/__tests__/workflows-rls.test.ts
packages/types/src/workflows.ts
```

### Se modifican

```
apps/api/src/database/schema/index.ts
apps/api/drizzle/meta/_journal.json
tests/migrations.test.ts                     (TABLAS_PERMITIDAS +5)
apps/api/src/modules/core/__tests__/routes-surface.test.ts  (RUTAS_PERMITIDAS +9)
apps/api/test/db/migrations.db.test.ts       (tablas, RLS, seed, triggers)
packages/types/src/index.ts
feature_list.json                            (#7 → spec_ready)
```

## 12. Alternativas descartadas

1. **Tabla global para plantillas del sistema.** Descartada: rompe la
   convención de tenant y crea un segundo régimen de seguridad (PA-7-1).
2. **Condiciones con `eval` / SQL dinámico.** Descartada: inyección de
   código y comportamiento no determinista; el evaluador whitelisted es
   fail-closed (PA-7-2).
3. **Transiciones automáticas vía cola/background.** Descartada: añade
   infraestructura (Redis) para un caso que en el MVP es determinista y
   rápido; la cascada en la misma transacción es atómica y testeable
   (PA-7-3).
4. **Un campo `estado text` con CHECK por dominio.** Descartada: es
   exactamente el «workflow hardcodeado» que RF-A4 prohíbe.
5. **Máquina por `switch` en el service.** Descartada: R2 + R17.

## 13. Estado de las ambigüedades

Las cuatro decisiones de la puerta (PA-7-1…PA-7-4) quedan explícitas. RF-W3
(notificaciones) se resuelve como hook declarativo con frontera en #10;
RF-W2 completo y RF-A5 (límites por paquete, versionado) quedan anotados
para la feature de paquetes del tenant. No hay más ambigüedades de
producto.
