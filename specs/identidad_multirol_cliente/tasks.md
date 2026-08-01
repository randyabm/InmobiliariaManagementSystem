# Tasks — #26 `identidad_multirol_cliente`

> Orden de ejecución. Cada task cita los `R<n>` que cubre.
> Los tests son tasks de primera clase, no un apéndice.
> **Precondición dura:** la feature #5 `owner_tenant_profiles` en estado `done`.
>
> **Regla de verificación (estándar impuesto en la #5):** toda task de test de
> invariante se declara completa únicamente si su **mutación** correspondiente
> pone tests en rojo, y el informe
> `progress/impl_identidad_multirol_cliente.md` cita cuáles y cuántos.
> Ningún test crea roles, políticas, funciones ni triggers: se usa
> `asegurarRolDeAplicacion`. **La lista blanca de `tests/ddl-en-tests.test.ts`
> no se amplía.**

---

## Bloque 0 — Deuda del arnés (primero: es independiente y desbloquea el resto)

- [x] **T1** — `init.sh`: convertir el chequeo `DATABASE_URL == DATABASE_MIGRATION_URL`
      (`init.sh:180-186`) de `warn` a `fail` con salida distinta de cero. Los
      tres `warn` por variables ausentes **se dejan como están**. **Cubre: R25.**
- [x] **T2** — Test de repositorio (`tests/init-sh-roles-db.test.ts`) que ejecuta
      `init.sh` con un `.env` de prueba donde ambas URLs coinciden y afirma exit
      code ≠ 0; y un segundo caso donde difieren y no falla por este motivo.
      **Cubre: R25.**
- [x] **T3** — Corregir el **texto** del titular de R62 en
      `specs/owner_tenant_profiles/requirements.md` y el enunciado de T58 en su
      `tasks.md` para que digan "nunca heredada de otra inmobiliaria" en vez de
      "siempre nueva". **No** se tocan su código, su estado ni sus `[x]`.
      **Cubre: R26.**
- [x] **T4** — Test de repositorio que afirma que ni el titular de R62 ni el
      enunciado de T58 contienen la afirmación sin acotar. **Cubre: R26.**

## Bloque A — Identidad única por inmobiliaria

- [ ] **T5** — Migración `0009_identidad_por_documento.sql`: columnas
      `tipo_documento`/`documento` en `user`, `CHECK` de dominio y de coherencia,
      backfill desde los perfiles e índice único parcial
      `(tenant_id, tipo_documento, documento) WHERE documento IS NOT NULL`.
      Idempotente y hacia adelante. **Cubre: R5, R6.**
- [ ] **T6** — Test de migración (Testcontainers) que la ejercita: columnas y
      `CHECK` presentes, backfill correcto sobre datos sembrados, e índice único
      creado. Incluye el caso de identidades ya duplicadas (§3 del design):
      la segunda queda con `documento` NULL y la migración **no** aborta.
      **Cubre: R5, R6.**
- [ ] **T7** — Test de que la política `user_tenant_isolation` preexistente
      cubre las columnas nuevas: con el rol de aplicación, una identidad de otra
      inmobiliaria no es visible ni siquiera filtrando por su `documento`.
      **Cubre: R14, R22, R24.**
- [ ] **T8** — `identidad.service.ts`: `crearIdentidad` → `resolverIdentidad`
      con la firma de `design.md` §5. Elimina `buscarEnEsteTenant` por email y
      añade `buscarPorDocumentoEnEsteTenant` con predicado explícito de
      `tenant_id`. El `INSERT` persiste documento. **Cubre: R1, R2, R5, R10, R11.**
- [ ] **T9** — `resolverIdentidad`: reutilizar identidad no toca `email`,
      `password_hash` ni `nombre`; devuelve `reutilizada: true` y llama a
      `asegurarRol`. **Cubre: R3, R4.**
- [ ] **T29** — Función pura exportada `nombresCoinciden(a, b)` con el criterio
      de **R27** (podar, colapsar espacios internos, minúsculas; **sin** plegar
      diacríticos ni reordenar apellidos) y
      `NombreNoCoincideConIdentidadError` (409) con el cuerpo accionable de
      `design.md` §7. `resolverIdentidad` rechaza **antes** de insertar el
      `user_role`, así que no hay nada que deshacer.
      **Cubre: R9, R27, R28.**
- [ ] **T30** — Test unitario de `nombresCoinciden`, tabla de casos:
      `"  maría   PÉREZ "` ≡ `"María Pérez"` → coincide; `"Maria Perez"` vs
      `"María Pérez"` → **no** coincide; `"Pérez María"` vs `"María Pérez"` →
      **no** coincide. Los dos últimos fijan por escrito lo que R27
      deliberadamente **no** resuelve (PA-5 de `design.md` §10.2): son
      documentación ejecutable de la frontera, no un descuido.
      **Cubre: R27.**
- [ ] **T10** — Adaptar `propietarios.service.ts` e `inquilinos.service.ts` a la
      firma nueva (pasan `tipo_documento`/`documento`), conservando intacta la
      comprobación previa que produce el 409. **Cubre: R1, R2, R7.**
- [ ] **T11** — Auditoría `identidad.rol_anadido` en ambos servicios cuando
      `reutilizada === true`, sin registrar el documento. **Cubre: R13.**
- [ ] **T12** — Test unitario de `IdentidadService` con un `PoolClient` doble que
      registra las consultas: afirma que **ninguna** consulta filtra `user` por
      `email` y que todas las de búsqueda llevan `tenant_id`. **Cubre: R10, R11.**
- [ ] **T13** — Test API (rol de aplicación real): se crea propietario con
      documento X y después inquilino con el mismo documento en la **misma**
      inmobiliaria → un solo `user`, dos `user_role` activos, dos perfiles, un
      solo `password_hash`. **Cubre: R1, R2, R3, R4.**
- [ ] **T14** — Test API: los dos perfiles conservan sus datos de contacto
      distintos (correo y teléfono propios de cada rol) y el `nombre` de la
      identidad no se sobrescribe. **Cubre: R8.**
- [ ] **T31** — Test API determinista del 409 de nombre discrepante y de su
      camino feliz, en un solo escenario: (a) alta de inquilino con el documento
      de un propietario existente y nombre distinto → **409**
      `NOMBRE_NO_COINCIDE_CON_IDENTIDAD`, cuerpo con `user_id`,
      `nombre_registrado` y `nombre_recibido`, y **ninguna** fila nueva de
      `user`, `user_role` ni perfil (verificado con `SELECT`, no con el cuerpo);
      (b) se corrige la ficha existente con el `PATCH` de la #5 y se reintenta el
      alta → **201** y la deduplicación ocurre. **Cubre: R9, R28.**
- [ ] **T15** — Test API: crear dos veces el **mismo rol** con el mismo documento
      → 409 `PERFIL_YA_EXISTE` y ninguna fila nueva (verificado con `SELECT`, no
      con el cuerpo de la respuesta). **Cubre: R7.**
- [ ] **T16** — Test de atomicidad: fallo al insertar el perfil tras haber
      añadido el `user_role` → la identidad queda con exactamente los roles
      previos. Reutiliza el mecanismo de inyección de fallos ya exento en
      `ddl-en-tests` (no se añade ninguna excepción nueva). **Cubre: R12.**
- [ ] **T17** — Test de la frontera D-8: la misma persona (mismo documento) dada
      de alta en la inmobiliaria A y en la B produce **dos** identidades
      distintas, con `tenant_id` distinto, y la respuesta de B no contiene ningún
      dato de A. **Cubre: R14, R22.**
- [ ] **T18** — Test de auditoría de R13 contra la tabla real: la entrada existe,
      es del tenant correcto y su `metadata` **no** contiene el documento.
      **Cubre: R13.**

## Bloque B — Vista como propietario o como inquilino

- [ ] **T19** — `POST /auth/rol-activo`: `AuthService.elegirRolActivo` valida el
      rol contra `user_role` activo **en base de datos** dentro del contexto de
      tenant, y emite el token con el claim `rol_activo`. **Cubre: R16, R17, R19.**
      *No implementa revocación: eso es la feature #27 (ver R19).*
- [ ] **T20** — `RolNoDisponibleError` (403) con mensaje genérico + registro en
      el controlador y en el mapa de errores del borde HTTP. **Cubre: R17, R29.**
- [ ] **T21** — `jwt.strategy.ts` propaga `rol_activo`; `roles.guard.ts` aplica
      el algoritmo de `design.md` §6 (`rolesEfectivos ⊆ rolesDelTenant`), con la
      comprobación de coherencia interna del token.
      **Cubre: R18, R20, R29.**
- [ ] **T22** — Auditoría `auth.rol_activo_elegido` en la emisión. **Cubre: R21.**
- [ ] **T23** — Tests funcionales de `GET /auth/me` (hoy sin ninguno — deuda D3):
      200 con perfil y roles del tenant del token; no incluye roles de otra
      inmobiliaria; 401 sin token. **Cubre: R15, R22.**
- [ ] **T24** — Test API del selector: identidad propietario+inquilino elige
      `propietario` → los endpoints de propietario responden 200 y los que exigen
      rol `inquilino` responden **403** con el mismo token; y a la inversa.
      **Cubre: R18, R23.**
- [ ] **T25** — Test API: elegir un rol no poseído → 403 y **ningún** token
      emitido, con la comprobación hecha contra `user_role` en base de datos
      (se revoca el rol en la base y la emisión pasa a fallar, aunque el token
      del solicitante siga listándolo); token cuyo `rol_activo` no figura entre
      los roles del propio token → 403. **Cubre: R17, R19, R23, R29.**
- [ ] **T26** — Test de regresión de compatibilidad: token **sin** `rol_activo`
      autoriza exactamente igual que antes de esta feature (empleado y admin
      sobre las rutas existentes). **Cubre: R20.**

## Bloque C — Cierre y verificación por mutación

- [ ] **T27** — Verificación por mutación documentada en
      `progress/impl_identidad_multirol_cliente.md`, con el conteo de rojos de
      cada una: (a) quitar el índice único parcial de T5 → R6; (b) quitar el
      predicado `tenant_id` de `buscarPorDocumentoEnEsteTenant` → R10/R14;
      (c) sustituir `rolesEfectivos = {rol_activo}` por `rolesDelTenant` en el
      guard → R18; (d) conceder `BYPASSRLS` al rol de aplicación → R22/R24;
      (e) comentar la llamada de auditoría de R13 → R13; (f) hacer que
      `nombresCoinciden` devuelva siempre `true` → R9/R27.
      **Cubre: R6, R9, R10, R13, R14, R18, R22, R24, R27.**
- [ ] **T28** — Mapa de trazabilidad `R<n>` → test concreto en
      `progress/impl_identidad_multirol_cliente.md`, y `./init.sh` en verde.
      **Cubre: todos.**

---

## Resumen

**29 requirements (R1–R29) · 31 tasks (T1–T31) · 1 migración (sin tablas
nuevas, sin política nueva).**

Los ids **R27–R29** y **T29–T31** están fuera de secuencia por ser adiciones
posteriores al primer borrador (delta del 2026-08-01 que resuelve PA-1/PA-2/PA-3).
Los ids son estables y no se renumeran; el orden de ejecución es el de este
documento, no el numérico. Ver `design.md` §12 sobre el dimensionamiento y el corte de reserva
(B → feature aparte) si el bloque B se desborda.
