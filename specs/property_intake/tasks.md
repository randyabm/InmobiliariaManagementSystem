# Tasks — property_intake

> Feature #9. Pasos discretos en orden. Las tasks de test son de primera
> clase: los invariantes de seguridad (bloque 4) se verifican con asserts
> deterministas contra PostgreSQL real (Testcontainers).
>
> **Prerrequisitos:** #5, #6, #7, #8 y #26 `done`. Todo se reutiliza: el
> ingreso orquesta perfiles, ficha, instancia y transiciones sin duplicar
> lógica. **Sin migración** (R13).
>
> **PA-9 aprobadas en la puerta del spec:** PA-9-1 (RF-PI3 fuera, es #16),
> PA-9-2 (contrato físico fuera, es #18), PA-9-3 (reutilización de perfiles
> por documento con comparación de nombre), PA-9-4 (ingreso atómico).
>
> Cobertura: R1–R14 en 22 tasks (T1–T22), de las cuales 11 son tasks de test.

---

## Bloque 0 — DTO y tipos

- [x] T1 — Crear `dto/ingreso.dto.ts`: `esquemaIngresoPropiedad` como
  unión discriminada por `escenario` (`VACANTE` | `ARRENDADA`), con
  `propietario` (id o datos en línea) y `propiedad` (los campos de #6 sin
  `propietario_principal_id`, que lo resuelve el servicio) y, en B,
  `inquilino` (id o datos en línea). Los datos en línea reutilizan los
  esquemas de #5. **Cubre: R1, R2, R5.**

- [x] T2 — Añadir a `packages/types/src/propiedades.ts` los tipos del
  ingreso (`IngresoPropiedadDto` shapes si hacen falta para el cliente);
  exportar desde el index si aplica. **Cubre: R1.**

## Bloque 1 — Servicio de ingreso

- [x] T3 — Crear `resolver-perfil.ts` (helper del módulo): `resolverPropietario`
  y `resolverInquilino` — por id (404 si inexistente/ajeno, vía `obtener`
  de #5) o por datos en línea (buscar por documento en el tenant; si existe
  y `nombresCoinciden` → reutilizar; si existe con otro nombre → 409
  `NOMBRE_NO_COINCIDE_CON_IDENTIDAD`; si no existe → crear). **Cubre: R3,
  R4, R10.**

- [x] T4 — Crear `ingreso.service.ts`: `ingresar(dto, ctx)` que orquesta —
  resolver propietario (T3) → `PropiedadesService.crear` con el id resuelto
  → si `ARRENDADA`: resolver inquilino, `OcupacionService.asignarInquilinoActual`,
  cadena `iniciar_checkeo` → `enviar_aseguradora` → `arrendar` por claves
  (el camino de #8) → ficha final. **Cubre: R1, R2, R6, R7.**

- [x] T5 — Auditoría explícita del servicio (R8): cada propietario/inquilino
  creado, la propiedad creada y cada transición registran su entrada en
  `audit_log` con `AuditService.log` (el `AuditInterceptor` no ve llamadas
  internas), `metadata` vacío. **Cubre: R8.**

## Bloque 2 — Controller y ruta

- [x] T6 — Crear `ingreso.controller.ts`: `POST /propiedades/ingreso` con
  guards, `@Roles('admin','empleado')` y el DTO de T1. **Cubre: R1, R2,
  R10.**

- [x] T7 — Registrar controller y servicio en `propiedades.module.ts` y
  ampliar `RUTAS_PERMITIDAS` (+1) en `routes-surface.test.ts`. **Cubre:
  R13.**

## Bloque 3 — Tests de integración del flujo

- [x] T8 — Escenario A: ingreso con propietario en línea → 201, ficha con
  `estado_ciclo_vida.clave = 'disponible'` (SELECT de la instancia),
  propietario creado (SELECT del perfil). **Cubre: R1, R7.**

- [x] T9 — Escenario A con propietario existente: mismo documento y nombre
  → reutiliza (SELECT: un solo perfil), 201. **Cubre: R3.**

- [x] T10 — Escenario B: ingreso con propietario e inquilino en línea →
  201, estado `arrendada` (SELECT), `inquilino_actual_id` asignado, una
  línea de ocupación abierta y el log del motor con 3 transiciones (R9).
  **Cubre: R2, R7, R9.**

- [x] T11 — Reutilización del inquilino existente y 409 por nombre
  divergente (R3, R4): el 409 no escribe nada (SELECT: sin perfiles ni
  propiedad). **Cubre: R3, R4, R6.**

- [x] T12 — Errores de forma: escenario B sin inquilino → 400 sin escribir
  nada; perfil por id inexistente → 404. **Cubre: R5, R10.**

- [x] T13 — Atomicidad (R6): un ingreso B cuya cadena no puede completarse
  (se desactiva `arrendar` en la copia del tenant antes del ingreso) →
  409 y rollback total (SELECT: sin propietario, sin propiedad, sin
  instancia, sin log). **Cubre: R6.**

## Bloque 4 — Invariantes de seguridad (tests deterministas, obligatorios)

- [x] T14 — Test HTTP de aislamiento (R10): el ingreso con un
  `perfil_propietario_id` del tenant B → 404 sin escribir nada; el ingreso
  con datos en línea de un documento que solo existe en B crea el perfil en
  A (no reutiliza el de B — SELECT de tenants). **Cubre: R10.**

- [x] T15 — Test HTTP de RBAC (R10): `propietario`/`inquilino` → 403;
  sin token → 401; `empleado` → 201. **Cubre: R10.**

- [x] T16 — Test de auditoría (R8): un ingreso B completo genera las
  entradas esperadas (propietario creado, inquilino creado, propiedad,
  transiciones) con `tenant_id`, `actor_id` y `entity_id` correctos; el
  `metadata` serializado no contiene PII. **Cubre: R8, R12.**

- [x] T17 — Test de PII (R12): un documento/celular/correo distintivo del
  ingreso no aparece en `audit_log` (serializado completo) ni en los logs
  capturados. **Cubre: R12.**

- [x] T18 — Test de la frontera R14: el ingreso NO crea ni exige ninguna
  tabla de contratos o templates (SELECT de `information_schema`: no
  existen tablas `contract*`), y responde 201 sin ellos. **Cubre: R14.**

## Bloque 5 — Integración y cierre

- [x] T19 — Unit test de `ingreso.service.ts` con dobles que registran
  llamadas: la orquestación en orden (resolver propietario → crear ficha →
  resolver inquilino → asignar → cadena), el 409 del nombre divergente sin
  llamar a crear, y el 404 del id ajeno. **Cubre: R3, R4, R6.**

- [x] T20 — Revisar `tests/ddl-en-tests.test.ts`: ningún test crea tablas
  ni columnas nuevas; la suite anti-DDL sigue verde. **Cubre: R13 (C3).**

- [x] T21 — Escribir el mapa de trazabilidad `R1..R14 → test concreto` en
  `progress/impl_property_intake.md`, con las decisiones PA-9 ejecutadas y
  las dependencias registradas para #16/#18/#20. **Cubre: trazabilidad
  (`docs/specs.md`).**

- [x] T22 — Ejecutar `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm run test:db` y `npm run build`; después `./init.sh` con exit code 0.
  **Verificación final y cierre.**
