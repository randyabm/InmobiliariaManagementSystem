# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** #5 `owner_tenant_profiles` — status **`spec_ready`**
- **Inicio:** 2026-07-26
- **Agente:** leader → spec_author (spec v3, partido)
- **Estado:** ⏸ **esperando aprobación humana del spec**. No se ha lanzado
  al `implementer`.

## Hecho en esta sesión

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
