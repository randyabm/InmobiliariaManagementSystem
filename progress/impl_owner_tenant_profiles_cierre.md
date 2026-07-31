# Implementación — cierre de #5 `owner_tenant_profiles` (T50–T73)

> Segunda pasada de la feature #5. La primera (T1–T47) fue **rechazada** por el
> reviewer con cuatro hallazgos críticos
> (`progress/review_owner_tenant_profiles.md`). B2 y la puerta ya estaban
> cerrados (T48, T49, T53). Este documento cubre las **23 tasks** restantes.

## Línea base (antes de tocar nada)

`./init.sh` → **exit 0**. `npm run test`: 28 archivos, **269 tests**.
`npm run test:db`: 1 archivo, **26 tests**.

## Orden de ejecución (design.md §20.5)

| Paso | Tasks | Qué cierra |
|---|---|---|
| 1 | T50 T51 T52 | B1: escritura sobre `user` acotada al tenant |
| 2 | T54 T73 T55 T56 | D-8/D-12 esquema |
| 3 | T57 T58 T59 | D-8 aplicación: login por (codigo, email) |
| 4 | T69 T70 T71 T72 | D-9: el contacto se muda al perfil |
| 5 | T60 … T64 | B3/D-10: rol sin BYPASSRLS — **el conmutador** |
| 6 | T65 … T68 | re-verificación de §C7 con el rol real |

---

## Bitácora

_(se va rellenando a medida que avanza cada bloque)_

### Paso 1 — B1: escritura sobre `user` acotada al tenant (T50, T51, T52) ✅

- **T50** — `predicado-identidad.ts` (nuevo): `predicadoDePertenenciaAlTenant(n)`
  genera el `EXISTS`/`NOT EXISTS` sobre `user_role`, válido antes y después de
  la migración de D-8. Lo usan `actualizarContacto` de `propietarios.repository`
  y de `inquilinos.repository`, que pasan a devolver `number | null`
  (`null` = no había contacto que escribir; `0` = identidad ajena).
- **T51** — `exigirIdentidadDelTenant(filas)` en `propietarios.service.ts`,
  reutilizada por `inquilinos.service.ts`: `0` → `ResourceNotFoundError` (404).
  **No** se creó `IdentidadCompartidaNoEditableError` (R39 eliminado por D-8).
- **T52** — `clientes/__tests__/escritura-identidad.api.test.ts`, 4 casos.

**Prueba por mutación (exigida).** Sustituyendo el predicado por
`($n::uuid IS NOT NULL)` —siempre cierto— el test se pone **rojo** con
`expected 'Nombre Robado' to be 'Marta Homonima'`: el PATCH del tenant A
responde 200 y **reescribe de verdad** la fila de `user` del tenant B. Es
literalmente el defecto B1. Restaurado el predicado, verde.

Suite tras el paso 1: `test` 29 archivos / **273 tests**, lint y typecheck en verde.
