# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** #5 `owner_tenant_profiles` — status **`in_progress`**
- **Inicio:** 2026-07-26 (spec) / 2026-07-27 (implementación)
- **Agente:** leader → spec_author (spec v3, partido) → **implementer**
- **Estado:** spec aprobado por el humano. Implementación en curso.
- **Línea base antes de tocar código:** `./init.sh` verde, **142 tests**.

## Plan de implementación (T1–T47, en orden)

| Bloque | Tasks | Contenido | Estado |
|---|---|---|---|
| 1 | T1–T10 | Esquema Drizzle, migración `0005`, RLS, índices, tests | ✅ |
| 2 | T11–T14 | Contexto de tenant: helper, interceptor registrado, `RolesGuard` | ✅ |
| 3 | T15–T21 | `identidad.service`, login tras D-5, enmienda a `auth_rbac` | ✅ |
| 4 | T22–T27 | CRUD de propietario + hoja de vida | ✅ |
| 5 | T28–T32 | Cuentas bancarias y `resolverCuentaDeGiro` | ✅ |
| 6 | T33–T36 | CRUD de inquilino | ✅ |
| 7 | T37–T42 | Invariantes de seguridad (deterministas, Postgres real) | ✅ |
| 8 | T43–T47 | Integración, trazabilidad, verificación | ✅ |

**47/47 tasks completadas.** `./init.sh` verde (exit 0). Tests **142 → 257**;
`npm run test:db` 20 (con 4 rojos preexistentes) → **24 verdes**.

**Informe completo: `progress/impl_owner_tenant_profiles.md`** — incluye el
mapa de trazabilidad R1–R37 → test y las contradicciones detectadas.

### Pendiente de decisión del humano (detectado al implementar)

1. La aplicación se conecta a PostgreSQL como **superusuario**, que se salta el
   RLS por completo. Hace falta un rol de aplicación sin `BYPASSRLS`. (§5.2)
2. La política RLS de `user` de la feature #3 impide crear identidades y
   vincular por email entre tenants en cuanto el rol deje de ser superusuario.
   Choca con R22/R25 de #5. (§5.3)
3. `init.sh` no ejecuta `npm run test:db`: 4 tests de políticas RLS llevaban
   rotos desde #2/#3 sin que nadie lo viera. Corregidos. (§5.1)

**La feature NO se ha marcado `done`**: espera al reviewer.

## Sesión 2026-07-27 (b) — implementer, alcance acotado: T48, T49, T53

El reviewer rechazó #5 con 4 hallazgos. El humano encargó **solo** la puerta
de verificación (T48, T49) y la migración de triggers append-only (T53).
**T50–T52 y T54–T68 quedan sin tocar a propósito**: dependen de PA-8…PA-11,
decisiones de producto que el humano todavía no ha tomado.

- Línea base antes de tocar nada: `npm run test` **257** verdes (27 archivos),
  `npm run test:db` **24** verdes (1 archivo), `./init.sh` exit 0.
- Plan: (1) T53 migración `0006_auditoria_append_only.sql` + journal + ajuste
  del conteo de migraciones; (2) T49 guard `tests/ddl-en-tests.test.ts`;
  (3) T48 `run_script test:db` en `init.sh`; (4) verificación.
- Informe: `progress/impl_owner_tenant_profiles_puerta.md`.

**Resultado: T48, T49 y T53 hechas y marcadas `[x]`.** Hallazgo **B2 cerrado**
(el trigger append-only lo crea ahora `0006`, no el test). B1, B3 y B4 siguen
abiertos: dependen de PA-8…PA-11.

- `npm run test` **269** verdes (28 archivos) · `npm run test:db` **26** verdes.
- Verificado a mano que, neutralizando `0006`, `audit-log.test.ts` se pone en
  **3 rojos** y `test:db` falla. El test ya no es verde por construcción.
- **`./init.sh` sigue en ROJO por una sola causa, ajena a estas tasks:**
  `[FAIL] Hay 4 features en in_progress (máximo 1)`. Viene de la reversión de
  #2/#3/#4 a `in_progress` que hizo el humano (`design.md` §17) y ya estaba así
  en `HEAD`; no he tocado `feature_list.json`. Todo lo demás del semáforo pasa,
  `test:db` incluido. **Decisión pendiente del humano/leader.**
- Ninguna feature marcada `done`: espera al reviewer.

## Hecho en la sesión de spec (2026-07-26)

1. **Higiene de git.** El trabajo de las features #24, #2, #3 y #4 estaba
   implementado y verificado pero **sin commitear**; vivía solo en el working
   tree. Commiteado en `2e54df7`. El working tree queda limpio.
2. **Spec de la feature #5** redactado, revisado con el humano y partido en
   dos (`47c43f3`, `162714b`, `9e0355d`).

## Decisiones del humano sobre el spec de #5 (D-1…D-7)

| Id | Decisión |
|----|----------|
| D-1 | Lista de propiedades del propietario → **diferida a #6** (la entidad `Propiedad` depende de #5, no al revés). RF-C5 queda parcialmente cubierto. |
| D-2 | Tarifa de retención → **configuración del tenant por año**, no columna del propietario (la fija la ley y cambia anualmente). |
| D-3 | Certificados fiscales → **diferidos al módulo contable**: el PRD no los define y sus cifras las produce el módulo de giros, que no existe. |
| D-4 | Crear en línea → GET por documento + POST con **409**, sin upsert (PRD §12.1). |
| D-5 | Email del propietario **opcional** → `user.email` nullable, con migración, revisión del login de #3 y enmienda a su spec. |
| D-6 | Codeudor y referencias → **entran** como captura de datos; el amarre a la firma es de #14/#17. |
| D-7 | `documento_identidad` en el perfil, **único por tenant**. Desviación consciente del PRD §8.7, aprobada por el humano, por el aislamiento del §11.3. |

## Corte de la feature #5

55 tasks en una sola corrida daban un diff inrevisable, así que se partió:

- **#5 `owner_tenant_profiles`** — 37 requirements / 47 tasks, 3 tablas,
  13 rutas. Núcleo: resolución de tenant, `user.email` nullable, CRUD de
  propietario e inquilino, cuenta bancaria y precedencia, creación en línea.
- **#25 `retencion_codeudor_referencias`** (nueva) — 25 requirements /
  27 tasks, 3 tablas, 10 rutas. Dependencia dura de #5.

Los 4 criterios de aceptación originales quedaron mapeados sin pérdidas.

## Deuda detectada por el spec, que #5 debe cerrar

El `TenantContextInterceptor` de la feature #2 **existe pero no estaba
registrado en la app**, y el tenant se deducía de `roles[0].tenant_id`. Con
una identidad con roles en varias inmobiliarias (RF-AU6) eso puede escribir
en el tenant equivocado. Las features #2 y #3 están marcadas `done` con ese
agujero abierto. Se arregla dentro de #5 (R33, R34, T11–T14) por decisión del
humano.

## Contradicciones registradas (no resueltas, anotadas a propósito)

1. Con el email opcional, una persona sin correo registrada en dos tenants
   produce **dos filas de `user`**: no hay clave de deduplicación global y
   buscar por documento entre tenants viola §11.3. Salida futura: fusión de
   identidades auditada. (`specs/owner_tenant_profiles/design.md` §7.3)
2. El spec cerrado de #3 exige `email NOT NULL UNIQUE`: queda **enmendado**
   por T17 de #5.
3. El payload del JWT incluye `email`. Hoy no rompe nada (#5 no emite tokens
   de clientes), pero la feature del portal (RF-AU2/AU4) tendrá que decidir
   el identificador de un cliente sin correo.
4. La tarifa de retención hereda el pendiente técnico del PRD §13.5 sobre la
   fuente del IPC (carga manual vs. integración): se sigue la recomendación
   que el propio PRD ya hace, carga manual por el admin.

## Próximo paso

El humano lee `specs/owner_tenant_profiles/` y dice **"aprobado"** → la #5
pasa a `in_progress` y se lanza el `implementer`. Sin esa aprobación no se
escribe código.

## Pendiente de fondo

- Feature #23 `ci_pipeline` sigue pendiente (requiere infraestructura manual).
- Nada se ha pusheado al remoto Forgejo en esta sesión.

---

## Sesión — cierre de #5 `owner_tenant_profiles` (T50–T73)

Las **23 tasks pendientes** quedan hechas. Informe completo:
`progress/impl_owner_tenant_profiles_cierre.md`.

- B1, B3 y B4 cerrados (B2 ya lo estaba). Migraciones nuevas `0007` (identidad
  por tenant + código de inmobiliaria) y `0008` (contacto en el perfil).
- La aplicación corre con un rol **sin `BYPASSRLS`**; los invariantes de §C7 se
  prueban con ese rol y se han verificado **por mutación** (conceder `BYPASSRLS`
  pone 19 tests en rojo; comentar los triggers de auditoría, 6).
- La lista blanca del guard anti-DDL queda **vacía**.
- `./init.sh` en verde: 372 tests + 56 de `test:db`.

**Estado:** #5 sigue en `in_progress`, a la espera del reviewer. Quedan cuatro
decisiones abiertas para el humano, listadas al final del informe (la más
relevante: D-9 deja el alta sin deduplicar identidad dentro del tenant).
