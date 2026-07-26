# Review — feature #5 `owner_tenant_profiles`

- **Agente:** reviewer
- **Fecha:** 2026-07-27
- **Spec:** `specs/owner_tenant_profiles/{requirements,design,tasks}.md` (v3, 37 requirements / 47 tasks)
- **Informe revisado:** `progress/impl_owner_tenant_profiles.md`
- **Alcance:** trazabilidad real R1–R37, invariantes §C7 de forma determinista,
  bloque 2 (deuda de #2/#3), migración D-5, fronteras con #6/#25, y verificación
  de los tres hallazgos autoreportados por el implementer.

---

## VEREDICTO: **RECHAZADO**

No por la calidad del trabajo de #5 —que es alta y en su mayor parte
verificada de verdad— sino por **cuatro defectos de seguridad vivos**, dos de
ellos introducidos o alcanzables por esta feature y dos heredados que #5 dejó
documentados pero sin resolver. Dos de los cuatro rompen invariantes de §C7
(**aislamiento por tenant** y **auditoría inmutable**), y las reglas del
revisor no permiten aprobar con un invariante de C7 en rojo, aunque la feature
"no fuera de eso".

`./init.sh` está verde (exit 0, 257 tests) — verificado por el humano, no
repetido aquí. **Un verde no cierra esta feature**: los hallazgos B1 y B2 de
abajo son precisamente defectos que la suite verde no puede ver.

---

## 1. Hallazgos BLOQUEANTES

### B1 — [CRÍTICO] Escritura entre tenants sobre la identidad compartida `user`

**Invariante roto:** §C7 *Aislamiento por tenant*. **Sin test que lo cubra.**

`PATCH /propietarios/:id` y `PATCH /inquilinos/:id` aceptan `nombre`, `email` y
`telefono`, que no viven en el perfil sino en `user` (R1, "los datos de
contacto no se duplican"). La actualización se ejecuta **sin ninguna
condición de tenant**:

- `apps/api/src/modules/core/clientes/propietarios.repository.ts:167`
  `UPDATE "user" SET ... WHERE id = $N`
- `apps/api/src/modules/core/clientes/inquilinos.repository.ts:144` — idéntico.
- Alcanzado desde `propietarios.service.ts:131` (`actualizarContacto(ctx, perfil.user_id, ...)`).
- DTO que lo permite: `dto/propietario.dto.ts:41-46` (`nombre`, `email`, `telefono` editables).

El guardado `exigirPerfil()` valida que el **perfil** es del tenant de la
petición, pero el `user_id` que sale de ahí puede ser una identidad
**compartida entre inmobiliarias**, que es justo el caso que R25 obliga a
crear (`identidad.service.ts:60-73`, `vincularPorEmail` busca
`SELECT id FROM "user" WHERE email = $1` **sin filtro de tenant**, a propósito).

Cadena de ataque completa, toda dentro de las 13 rutas de esta feature:

1. Un `admin` del tenant A hace `POST /propietarios` con
   `email: "admin-b@example.com"` (el correo de un administrador real del
   tenant B). Por R25 el sistema **reutiliza ese `user`** y le inserta un
   `user_role (propietario, tenant A)` no solicitado.
2. El mismo admin de A hace `PATCH /propietarios/:idDeSuPerfil` con
   `{"email": "atacante@evil.com"}`.
3. `UPDATE "user" SET email = 'atacante@evil.com' WHERE id = <user del admin B>`.
   El administrador del tenant B **pierde su credencial de acceso** (el login
   es por email, `auth.service.ts:44`) y su nombre/teléfono quedan bajo
   control del tenant A.

Esto es una escritura cruzada entre tenants sobre datos de otra inmobiliaria y
un vector de bloqueo/suplantación de cuenta. No lo detecta ningún test:

- Los 9 accesos cruzados de `seguridad.api.test.ts:96-160` solo tocan filas de
  `perfil_propietario`, `perfil_inquilino` y `cuenta_bancaria`; ninguna toca `user`.
- `propietarios.api.test.ts:400-447` **construye exactamente el escenario de
  identidad compartida** (Irene en A y en B) y verifica la lectura… pero nunca
  hace `PATCH` sobre ella.

**Para cerrarlo hace falta:** decidir con el humano el modelo de propiedad de
los datos de contacto de una identidad compartida (¿se copian al perfil?
¿solo los edita el tenant que la creó? ¿`email` deja de ser editable por el
PATCH del perfil?), implementarlo, y **añadir un test HTTP** que demuestre que
el tenant A no puede alterar `user.nombre`, `user.email` ni `user.telefono` de
una identidad que comparte con el tenant B.

---

### B2 — [CRÍTICO] La auditoría **no es inmutable** en el producto; el test que lo "prueba" se fabrica el trigger

**Invariante roto:** §C7 *Auditoría*. **Test verde por construcción.**

`apps/api/drizzle/0004_auditoria.sql:4` afirma en su cabecera:

> `-- Append-only: trigger previene UPDATE y DELETE; RLS solo permite INSERT y SELECT.`

**Ese trigger no existe en ninguna migración.** `0004_auditoria.sql` crea la
tabla, `ENABLE`+`FORCE ROW LEVEL SECURITY` y dos políticas (`FOR INSERT` y
`FOR SELECT`), y nada más. El trigger `trg_audit_log_no_update` /
`trg_audit_log_no_delete` lo crea **el propio test** en su `beforeAll`:

- `apps/api/src/database/__tests__/audit-log.test.ts:30-52` — `CREATE FUNCTION
  audit_log_prevent_mutation()` + los dos `CREATE TRIGGER`.
- `audit-log.test.ts:130` *«UPDATE sobre audit_log lanza error — append-only»*
  y `:139` *«DELETE …»* afirman `rejects.toThrow(/append-only/i)` contra un
  trigger que el test acaba de instalar.

Es el caso puro de test que pasa por construcción: **borra el `CREATE TRIGGER`
de la migración y el test sigue verde, porque la migración nunca lo tuvo.**
En un despliegue real `audit_log` es plenamente actualizable y borrable —y
además la conexión de la app es superusuario (B3), así que ni siquiera el
"deny por ausencia de política RLS" para UPDATE/DELETE la protege.

#5 no creó el defecto, pero **sí lo hereda de lleno**: enganchó el
`AuditInterceptor` (`audit.interceptor.ts`), reescribió `AuditService.log`
(`audit.service.ts:36-68`) y apoya R35 sobre esa tabla. §C7 se comprueba en
cada feature.

**Para cerrarlo hace falta:** una migración `0006` que cree la función y los
dos triggers `BEFORE UPDATE/DELETE ON audit_log`, y mover la aserción de
inmutabilidad a un test que **no** cree el trigger (que corra contra el
esquema que dejan las migraciones).

---

### B3 — [CRÍTICO] La aplicación se conecta a PostgreSQL como **superusuario**: el RLS es inerte en ejecución

**Hallazgo 5.2 del implementer: CONFIRMADO.**

- `.env.example:21` → `DATABASE_URL=postgres://CHANGE_ME:CHANGE_ME@localhost:5432/inmobiliaria`,
  con el mismo `POSTGRES_USER` que `docker-compose.yml:18` pasa a la imagen
  `postgres:16.4-alpine`. Ese usuario **es superusuario** por definición de la
  imagen.
- `FORCE ROW LEVEL SECURITY` alcanza al **dueño** de la tabla, no a un
  superusuario ni a un rol con `BYPASSRLS`.
- No existe ninguna migración que cree un rol de aplicación sin `BYPASSRLS` ni
  sus `GRANT`s (revisado `apps/api/drizzle/000{0..5}*.sql`: cero `CREATE ROLE`,
  cero `GRANT`).

Consecuencia medida, no teórica: **en los tests HTTP la app también corre como
superusuario** (`apps/api/test/support/entorno-clientes.ts:74` y `:134` usan la
cadena por defecto del contenedor). Por tanto los 9 accesos cruzados que
devuelven 404 (`seguridad.api.test.ts:129`) demuestran la barrera
`WHERE tenant_id = $n` de los repositorios, **no** el RLS: seguirían en verde
si se borraran las tres políticas de `0005`.

Lo que sí es válido: `clientes-rls.test.ts` hace `SET ROLE app_test_user`
(rol `NOLOGIN`, no superusuario, no dueño — `clientes-rls.test.ts:41-47,
66-73`) y sus aserciones son significativas y cubren las tres tablas nuevas:
`SELECT` sin `WHERE` (`:245`), lectura por id ajeno (`:265`), `UPDATE` dirigido
(`:277`) e `INSERT` con `tenant_id` ajeno (`:295`, `rejects.toThrow(/row-level
security/i)`). Eso prueba **el motor**, no el despliegue.

Hoy el aislamiento real lo sostiene un `WHERE` escrito a mano en cada consulta.
Los repositorios de #5 lo llevan sin excepción (revisado uno a uno en
`propietarios.repository.ts`, `inquilinos.repository.ts`,
`cuentas-bancarias.repository.ts`) — pero es una barrera que la siguiente
feature puede olvidar en silencio, y B1 es justo la consulta que ya se olvidó.

**Para cerrarlo hace falta:** o una migración que cree el rol de aplicación sin
`BYPASSRLS` con sus `GRANT`s y el cambio de `DATABASE_URL`, o —si el humano
prefiere diferirlo— una **feature explícita en `feature_list.json`** que lo
recoja, con constancia escrita de que hasta entonces el RLS es defensa en
papel. Diferirlo en un `progress/*.md` no basta.

---

### B4 — [CRÍTICO] La política RLS de `user` (#3) contradice R22/R25/R6/R8 de #5

**Hallazgo 5.3 del implementer: CONFIRMADO, y con un tercer efecto que no
menciona.**

`apps/api/drizzle/0003_auth_rbac.sql:48-54`:

```sql
CREATE POLICY "user_tenant_isolation" ON "user" FOR ALL
  USING ("id" IN (SELECT "user_id" FROM "user_role"
                  WHERE "tenant_id" = current_setting('app.current_tenant', true)::uuid
                    AND "activo" = true));
```

`FOR ALL` sin `WITH CHECK` → PostgreSQL reutiliza el `USING` como `WITH CHECK`.
En cuanto el rol de la app deje de ser superusuario (o sea: en cuanto se
arregle B3), esto rompe **tres** cosas:

1. **Bloqueo circular al crear identidades (R22).** `identidad.service.ts:75-84`
   inserta en `"user"`; el `WITH CHECK` exige que la fila ya esté en `user_role`
   del tenant… y `user_role.user_id` es FK al `user` que se está creando.
   Imposible. **Confirmado.**
2. **R25 imposible.** `identidad.service.ts:65-68` necesita ver el `user` de
   otra inmobiliaria por email; la política lo oculta, el `SELECT` no lo
   encuentra, se intenta crear uno nuevo y choca con `UNIQUE(email)`.
   **Confirmado.**
3. **El login deja de funcionar (R6/R8, no reportado por el implementer).**
   `auth.service.ts:44` consulta `"user"` desde `pool.query` directo, **fuera
   de toda transacción con `app.current_tenant`** (el login es previo al
   tenant). Con la política activa, `current_setting(...)` es NULL, el `USING`
   nunca es cierto y `POST /auth/login` devolvería 401 **a todo el mundo**.

O sea: R6, R8, R22 y R25 —cuatro requirements de #5— están implementados de una
forma que **solo funciona porque el RLS está desactivado de facto (B3)**. Eso
no es deuda de otra feature: es una contradicción entre el esquema y los
requirements que #5 acaba de entregar, y hay que resolverla antes de darla por
buena. Es decisión de producto (¿qué ve un tenant de una identidad global?) y
corresponde al humano, pero el cierre de #5 depende de ella.

---

## 2. Verificación de los tres hallazgos autoreportados (§5 del informe)

| Hallazgo | Veredicto | Evidencia |
|---|---|---|
| **a)** `pg_policies.polname` no existe (es `policyname`); las políticas RLS de #2/#3/#4 nunca se verificaron | **CONFIRMADO. Bien corregido.** | `git diff` de `apps/api/test/db/migrations.db.test.ts` muestra 5 sustituciones `polname` → `policyname AS polname` (líneas 93, 129, 137, 159, 209). No queda ninguna ocurrencia de `SELECT polname`. |
| **b)** La app se conecta como superusuario y se salta el RLS | **CONFIRMADO.** | Ver **B3**. |
| **c)** La política `FOR ALL` sin `WITH CHECK` de `user` bloquea R22/R25 | **CONFIRMADO, y además rompe el login.** | Ver **B4**. |

**¿Hay más tests con el mismo defecto de "verde por error silencioso"?** Sí, y
uno peor: **B2**. El de `polname` al menos fallaba en rojo (nadie lo miraba);
el de `audit_log` **pasa en verde probando un artefacto que el propio test
fabrica**, que es la categoría más peligrosa. Además:

- La causa de fondo de (a) **sigue abierta**: `init.sh` ejecuta `lint`,
  `typecheck` y `test`, pero **no `test:db`** (`init.sh`, bloque `run_script`).
  Todas las aserciones de `ENABLE`/`FORCE ROW LEVEL SECURITY` y de la forma de
  la migración `0005` (R5, R37) viven en `apps/api/test/db/migrations.db.test.ts`,
  **fuera de la puerta verde**. La recomendación del implementer es correcta y
  debe ejecutarse.
- `seguridad.api.test.ts:129` (`expect(resultados).toEqual(resultados.map(([n]) => [n, 404]))`)
  **no** es tautológico —construye el esperado solo con los nombres— pero es una
  forma innecesariamente frágil de escribirlo. Observación, no defecto.

---

## 3. Trazabilidad requirements ↔ tests

Revisados los 37 uno a uno contra el test citado, leyendo el test, no el mapa.
**Ninguno queda sin cobertura y no encontré ningún requirement sostenido solo
por un test vacío, un mock o una aserción de forma.** Los tests van contra
PostgreSQL real y la app NestJS real, y las aserciones de efecto se hacen con
`SELECT` independientes, no con el código de respuesta.

- R1–R5, R7 (esquema, RLS, índice parcial, unicidad de email): `clientes-rls.test.ts`
  y `migrations.db.test.ts:187-215`. **[x]** — con la salvedad de que la parte
  de `FORCE` vive en la suite que `init.sh` no corre.
- R6, R8 (login tras D-5): `login-tras-d5.test.ts`. **[x]** — sólido: el 401 se
  comprueba con `password_hash` NULL real y con identidades `email IS NULL`
  sembradas; `auth.service.ts:45-49` corta antes de `bcrypt.compare` y la
  consulta lleva `AND email IS NOT NULL`. **No hay bypass por email nulo.**
- R9–R17 (CRUD propietario, hoja de vida, cuenta predeterminada):
  `propietarios.api.test.ts`. **[x]**
- R18–R21 (CRUD inquilino, 400 por campo faltante ×6 + enum inválido):
  `inquilinos.api.test.ts:81-156`. **[x]**
- R22 (atomicidad): `propietarios.api.test.ts:346-394` — fuerza el fallo con un
  trigger real y cuenta filas de `user` y `user_role` antes/después. **[x]**
- R23–R26 (crear si no existe, identidad): `propietarios.api.test.ts:267-474`. **[x]**
- R27–R30 (`resolverCuentaDeGiro`): `cuentas-de-giro.test.ts` — los cinco casos
  contra base real, con `rejects.toBeInstanceOf(CuentaDeGiroInvalidaError)` y un
  caso explícito de que nunca devuelve `null`. **[x]**
- R31: **[x] con reserva** — `clientes-rls.test.ts` lo prueba con rol sin
  `BYPASSRLS` (válido); `seguridad.api.test.ts` lo prueba sobre HTTP pero, por
  B3, mide el `WHERE` y no el RLS. **Y no cubre la escritura sobre `user` (B1).**
- R32: **[x]** — 403 en las 13 rutas para `propietario` e `inquilino`, 401 sin
  token, por código de estado (`seguridad.api.test.ts:196-247`), más
  `@Roles('admin','empleado')` a nivel de clase en los tres controllers. El
  rechazo es del backend, no del frontend.
- R33: **[x]** — `resolver-tenant.test.ts` (función pura) + los tres casos HTTP
  de `seguridad.api.test.ts:265-308`, incluida la identidad multi-tenant sin
  header que recibe 403 y **no persiste nada** (verificado con `SELECT`).
- R34: **[x]** — `clientes-rls.test.ts:310-360` distingue GUC nunca fijado
  (0 filas) de GUC vacío (aborta con `22P02`), y `construirContextoPeticion`
  lanza `SinContextoDeTenantError`.
- R35: **[x]** — las 9 entradas esperadas se cuentan con `SELECT count(*)` y se
  verifica `tenant_id` y `actor_id` (`seguridad.api.test.ts:311-419`).
- R36: **[x] con reserva** — ver O3 abajo.
- R37: **[x]** — `TABLAS_PERMITIDAS` +3 (`tests/migrations.test.ts:40-48`),
  `RUTAS_PERMITIDAS` +13 exactas (`routes-surface.test.ts:18-40`), journal con
  6 entradas.

---

## 4. Bloque 2 (T11–T14) — deuda de #2/#3

**Cerrado correctamente.** Verificado punto por punto:

- `TenantContextInterceptor` **sí** está registrado como `APP_INTERCEPTOR`:
  `apps/api/src/app.module.ts:24`.
- El tenant sale del header validado contra los roles del JWT:
  `resolver-tenant.ts:70-88` (`resolverTenantDePeticion`), usado por
  `roles.guard.ts:55-59`, que además fija `request.tenantResuelto`. Los guards
  corren antes que los interceptores, así que el 403 ocurre sin tocar la base.
- **No queda ningún camino que use `roles[0].tenant_id`.** `grep` sobre
  `apps/` y `packages/` de `roles[0]`: solo aparece en comentarios y en nombres
  de tests. El `AuditInterceptor` también migró a `request.tenantResuelto`
  (`audit.interceptor.ts:64`).
- El `SET LOCAL` se hace con `set_config($1,$2,true)` parametrizado, no
  interpolando el header (`tenant-context.interceptor.ts:76-79`). Correcto.
- El cambio de `tap` a `concatMap` (`:96-118`) es acertado: el `COMMIT` termina
  antes de serializar la respuesta.

Única observación: `audit.interceptor.ts:65` conserva un *fallback* al header
crudo `x-tenant-id` cuando no hay `tenantResuelto`. Hoy es inalcanzable (todas
las rutas auditadas pasan por `RolesGuard`), pero es entrada no validada
llegando a una escritura. Ver O2.

---

## 5. Migración de `user.email` a NULL-able (D-5)

**Correcta.**

- `0005_owner_tenant_profiles.sql:14,22` hace solo `DROP NOT NULL` sobre
  `password_hash` y `email`; **la `UNIQUE` no se toca**, y en PostgreSQL cada
  NULL es distinto → conviven N identidades sin correo y dos correos iguales no
  nulos siguen colisionando. Probado de verdad en `clientes-rls.test.ts:122-166`
  (dos NULL insertan; el duplicado no nulo da `23505`).
- El login sigue funcionando y **no hay bypass**: `auth.service.ts:38-41`
  devuelve 401 antes de consultar si el email es nulo/ausente/vacío;
  `:44` añade `AND email IS NOT NULL`; `:47-49` rechaza `password_hash` NULL
  **antes** de `bcrypt.compare`. Los tres se prueban contra base real.
- Se enmendó el spec cerrado de #3 (`specs/auth_rbac/requirements.md`) con la
  sección ENMIENDA, con motivo y fecha. Rigor correcto.
- Consecuencia menor: `AuthService.getProfile` sigue declarando `email: string`
  pudiendo ser `null` (hallazgo 5.4 del implementer). **Confirmado, no
  bloqueante.**

---

## 6. Fronteras de alcance

**Limpias.** Nada de #25 se coló:

- Sin columna ni campo de tarifa/porcentaje de retención en migración, esquema
  Drizzle, DTOs ni tipos. `sujeto_retencion` sí se captura y se devuelve.
- `PropietariosService` no calcula, resuelve ni aplica retención (R17), y hay
  test de contrato: `propietarios.api.test.ts:190-202` afirma que la única
  clave que casa `/porcentaje|tarifa|retencion/i` es `sujeto_retencion`.
- Sin tablas ni rutas de codeudor, coarrendatario ni referencias (D-6).
- `GET /propietarios/:id` no expone `propiedades` (ni array vacío) ni
  certificados: `propietarios.api.test.ts:176-188`, D-1/D-3 respetados.
- Exactamente 13 rutas, ni una más: `routes-surface.test.ts:92` compara la
  superficie real del contenedor Nest con la lista blanca.

---

## 7. Tasks

**47/47 marcadas `[x]`** en `specs/owner_tenant_profiles/tasks.md`; verificado
que cada bloque tiene artefacto real. La única desviación de orden (T20/T21
escritas después de T25) está justificada en el informe §2 y no deja ninguna
task sin test. **Sin objeción.**

---

## 8. Observaciones NO bloqueantes (deuda a registrar)

- **O1 — `init.sh` no ejecuta `test:db`.** El verde de la puerta no cubre
  `migrations.db.test.ts`, donde viven las aserciones de `ENABLE`/`FORCE` y de
  la forma de la migración de #5. Es la causa de fondo del hallazgo (a) y
  volverá a morder. Añadir `test:db` a `init.sh` o garantizar el job
  `base-de-datos` de `ci/forgejo/README.md:132`.
- **O2 — Fallback al header crudo en `audit.interceptor.ts:64-65`.** Quitarlo:
  si no hay `tenantResuelto`, no debería auditarse.
- **O3 — `audit_log.actor_email` guarda un email en cada acción auditada**
  (`audit.service.ts:52`). R36 acota literalmente la prohibición al campo
  `metadata`, así que **no es una violación**, pero el test de T42
  (`seguridad.api.test.ts:508-517`) solo busca los valores PII que él mismo
  sembró y el actor es `adminA`: **nunca podría detectarlo**. La afirmación del
  informe §8 «ni `audit_log` … contiene datos personales» está sobredimensionada.
- **O4 — `AuditService.log` se traga los errores** (`audit.service.ts:60-66`):
  una auditoría fallida no hace fallar la mutación. Consciente y heredado de #4,
  pero contradice el espíritu de §C7 («las acciones críticas quedan
  registradas», no «se intenta registrarlas»). Decisión del humano.
- **O5 — `npm run test` abre contenedores Docker**, contra el invariante R19 de
  `specs/project_scaffold/requirements.md:206-215` y contra lo que declaran
  `vitest.config.ts:6-11` y `apps/api/vitest.config.ts:5-7`. Verificado que el
  precedente es de #2/#4 (`tenant-rls`, `auth-rbac`, `audit-log` ya estaban en
  `src/**` antes de #5), así que **#5 no lo introdujo**, pero lo amplió a 5
  archivos más. Hay que decidir: o se actualizan los comentarios y R19, o se
  mueven los tests a `test/db/` **y** se añade `test:db` a `init.sh` (O1).
  Dejarlo como está mantiene una mentira en la documentación.
- **O6 — `AuthService.getProfile` tipa `email: string`** pudiendo ser `null`
  (5.4 del implementer). Confirmado.

---

## 9. CHECKPOINTS

| | Estado | Nota |
|---|---|---|
| **C1** Arnés completo | **[x]** | `./init.sh` exit 0. |
| **C2** Estado coherente | **[x]** | Solo #5 en `in_progress`; `feature_list.json` no se marcó `done`. |
| **C3** Arquitectura | **[x]** | Monolito modular respetado; todo el SQL en repositorios; sin `console.log`, TODOs ni código muerto; sin dependencias nuevas. |
| **C4** Verificación real | **[x] con reserva** | Testcontainers + PostgreSQL real en todo lo que toca datos. Reserva: **B2** (un test se fabrica el artefacto que prueba) y **O1**. |
| **C5** Sesión cerrada | **[x]** | Sin artefactos fuera de `.gitignore` (`packages/types/dist/` ignorado). |
| **C6** SDD | **[x]** | 3 archivos de spec, EARS estricto, cada `R<n>` cita su `RF-*`, 47/47 tasks `[x]`, cada `R<n>` con test concreto. |
| **C7 — Aislamiento por tenant** | **[ ]** | **B1** (escritura cruzada sobre `user`, sin test) y **B3** (RLS inerte en ejecución). |
| **C7 — RBAC en backend** | **[x]** | 403 en las 13 rutas para `propietario` e `inquilino`, 401 sin token, validado en `RolesGuard` contra el tenant resuelto. |
| **C7 — Auditoría** | **[ ]** | **B2**: `audit_log` es mutable y borrable en el producto; el trigger que la protege lo crea el test. |
| **C7 — Integridad documental** | **n/a** | Esta feature no maneja documentos firmados. |
| **C7 — Datos personales** | **[x] con reserva** | Sin PII en `metadata` ni en la salida del proceso (verificado espiando `stdout`/`stderr`); 400/409/404 no devuelven el valor rechazado. Reserva: **O3**. |
| **C7 — Sin secretos** | **[x]** | Ningún secreto nuevo; `JWT_SECRET` de test inerte, `.env.example` con placeholders, `docker-compose.yml` sin literales. |
| **C8** IA | **n/a** | La feature no toca funciones de IA. |

---

## 10. Cambios requeridos para aprobar

**Bloquean el cierre de #5:**

1. **B1** — Impedir que un tenant modifique `user.nombre` / `user.email` /
   `user.telefono` de una identidad compartida con otro tenant
   (`propietarios.repository.ts:167`, `inquilinos.repository.ts:144`), con la
   decisión de producto previa del humano, y **añadir el test HTTP que lo
   demuestra** sobre el escenario que ya existe en
   `propietarios.api.test.ts:400`.
2. **B2** — Migración nueva que cree la función y los triggers
   `BEFORE UPDATE/DELETE ON audit_log`, y mover la aserción de inmutabilidad a
   un test que **no** los cree (`audit-log.test.ts:30-52` debe desaparecer del
   `beforeAll`). Corregir la cabecera mentirosa de `0004_auditoria.sql:4`.
3. **B4** — Resolver la contradicción de `user_tenant_isolation`
   (`0003_auth_rbac.sql:48-54`) con R22/R25 **y con el login** (efecto no
   reportado). Decisión del humano sobre el modelo de visibilidad de
   identidades entre tenants; después, migración correctiva y un test que
   ejercite creación de identidad, vinculación por email y login **con un rol
   sujeto a RLS**.

**Bloquea salvo aceptación explícita y escrita del humano:**

4. **B3** — Rol de aplicación sin `BYPASSRLS` + `GRANT`s + `DATABASE_URL`.
   Si se difiere, debe quedar como **feature propia en `feature_list.json`**,
   no como nota en un `progress/*.md`, y con constancia de que hasta entonces
   el aislamiento depende únicamente de los `WHERE tenant_id` del código.

**Deuda a registrar, no bloquea:** O1, O2, O3, O4, O5, O6.

---

## 11. Nota para el humano

El trabajo de #5 es bueno: la trazabilidad es honesta, los tests van contra
PostgreSQL real, el bloque 2 cierra de verdad la deuda de #2/#3, la migración
de D-5 está bien razonada y las fronteras con #6 y #25 se respetan al detalle.
El implementer además destapó por su cuenta tres defectos heredados y los
reportó en vez de esconderlos, lo cual es exactamente lo que se le pide.

El rechazo se debe a que **tres de los cuatro bloqueantes son defectos de
seguridad que la suite verde no puede ver** —uno nuevo y alcanzable desde las
rutas de esta feature (B1), uno que hace que un test de §C7 no pruebe nada
(B2), y dos que dejan el modelo de seguridad documentado sin efecto real
(B3, B4)—. B3 y B4 no se pueden arreglar sin una decisión tuya sobre el modelo
de roles de base de datos y sobre qué ve un tenant de una identidad global.
