# Implementación — #26 `identidad_multirol_cliente`

> Informe escrito **conforme avanza** la implementación, no al final.
> Spec: `specs/identidad_multirol_cliente/{requirements,design,tasks}.md`.
> 29 requirements (R1–R29), 31 tasks (T1–T31), una migración
> (`0009_identidad_por_documento.sql`).

**Línea base verificada antes de empezar** (por el humano):
`./init.sh` exit 0 · `npm run test` **372** · `npm run test:db` **56**.

---

## Bitácora por bloques

### Bloque 0 — Deuda del arnés (T1–T4) — hecho

- **T1 (R25)** — `init.sh`: el chequeo `DATABASE_URL == DATABASE_MIGRATION_URL`
  pasa de `warn` a `fail` con `EXIT_CODE=1`, y añade un `ok` explícito cuando
  difieren. Los tres `warn` por variables ausentes **se dejan intactos**: ahí el
  aviso es la elección correcta y el review lo confirmó.
- **T2 (R25)** — `tests/init-sh-roles-db.test.ts`, 4 tests. Ejecuta `init.sh`
  en un **directorio de arena** (archivos base mínimos, `feature_list.json`
  vacío, `.env` con credenciales inertes y **sin `package.json`**) para que el
  código de salida dependa solo del chequeo bajo prueba: URLs iguales → exit ≠ 0
  con `[FAIL]`; URLs distintas → exit 0 y `[OK]`. Ejecutarlo sobre el repo real
  recursaría lint+typecheck+ambas suites por caso.
- **T3 (R26)** — Texto corregido: titular de **R62** en
  `specs/owner_tenant_profiles/requirements.md` y enunciado de **T58** en su
  `tasks.md` → "nunca heredada de otra inmobiliaria". También las tres
  tablas-resumen que repetían la frase (`tasks.md` ×2, `design.md` ×1): dejarlas
  reintroducía la contradicción por la puerta de atrás. **No** se tocó código,
  estado ni marcas `[x]` de la #5.
- **T4 (R26)** — `tests/spec-identidad-siempre-nueva.test.ts`, 5 tests: el
  titular de R62 y el enunciado de T58 no dicen "siempre nueva", el titular sí
  acota a "otra inmobiliaria", T58 sigue `[x]` (se corrige texto, no se reabre) y
  ningún resumen repite la afirmación sin acotar.

### Bloque A — Identidad única por inmobiliaria (T5–T18, T29–T31) — hecho

- **T5 (R5, R6)** — `apps/api/drizzle/0009_identidad_por_documento.sql`.
  Columnas `tipo_documento`/`documento` NULL-ables en `user`, `CHECK` de dominio
  (mismo que los perfiles) y de coherencia (`(tipo IS NULL) = (doc IS NULL)`),
  backfill propietario→inquilino, aviso de colisiones y el índice único
  **parcial** `(tenant_id, tipo_documento, documento) WHERE documento IS NOT
  NULL`. **No crea tablas**, luego no hay política nueva: se apoya en
  `user_tenant_isolation` de `0007`, y eso se verifica (T7), no se asume.
  Registrada en `meta/_journal.json` (idx 9) y reflejada en el esquema Drizzle.
- **T6 (R5, R6)** — `apps/api/test/db/backfill-documento.db.test.ts`, 15 tests.
  Aplica migraciones **hasta 0008**, siembra el estado real —incluida la misma
  persona como **dos** identidades, que es el defecto que la feature cierra— y
  solo entonces aplica `0009`. Cubre columnas, los dos `CHECK`, el backfill
  desde ambos perfiles, el NULL de los empleados, la identidad duplicada (queda
  sin documento, **no** se fusiona, la migración **no** aborta), la forma del
  índice y la idempotencia.
- **T7 (R14, R22, R24)** —
  `apps/api/src/database/__tests__/identidad-por-documento-rls.test.ts`, 9 tests,
  con el rol de aplicación **sin `BYPASSRLS`** provisionado por
  `asegurarRolDeAplicacion`. Consultas **crudas** por documento (sin `WHERE
  tenant_id`): desde A solo se ve A, desde B solo B, ni un `count(*)` revela la
  otra, y el `WITH CHECK` impide colar una identidad en el tenant vecino.
- **T8, T9, T29 (R1–R5, R9, R10, R11, R27, R28)** — `identidad.service.ts`:
  `crearIdentidad` → **`resolverIdentidad`**, `buscarEnEsteTenant` por email
  **eliminada** (cierra la deuda D5: era código inalcanzable) y sustituida por
  `buscarPorDocumentoEnEsteTenant` con `tenant_id` explícito. Nueva función pura
  `nombresCoinciden` y `NombreNoCoincideConIdentidadError` (409). El rechazo
  ocurre **antes** de insertar el `user_role`.
- **T10, T11 (R1, R2, R7, R13)** — `propietarios.service.ts` e
  `inquilinos.service.ts` pasan documento y reciben `reutilizada`; el 409 de R7
  se comprueba **antes**, intacto. La auditoría vive en
  `auditoria-identidad.ts` (una sola regla, no dos copias) y se registra
  **después** del INSERT del perfil, para no auditar un alta que acabe deshecha.
- **T12, T30** — `clientes/__tests__/identidad.service.test.ts`, 14 tests:
  tabla de casos de `nombresCoinciden` (incluidos los dos que **no** coinciden y
  fijan la frontera de PA-5) y doble de `PoolClient` que registra el SQL:
  ninguna consulta filtra `user` por email, todas las de búsqueda llevan
  `tenant_id`, nada se concatena.
- **T13, T14, T15, T17, T18, T31** —
  `clientes/__tests__/identidad-multirol.api.test.ts`, 19 tests contra
  PostgreSQL real: una identidad con dos roles y **un solo** `password_hash`,
  contactos independientes por perfil, el 409 de nombre discrepante con su
  cuerpo accionable y **sin** escribir nada (verificado con `SELECT`), el camino
  feliz tras el `PATCH`, el 409 `PERFIL_YA_EXISTE`, la frontera D-8 y la
  auditoría `identidad.rol_anadido` sin documento en `metadata`.
- **T16 (R12)** — añadido a `propietarios.api.test.ts`, que es el archivo ya
  exento en `EXCEPCIONES_JUSTIFICADAS` para inyección de fallos: **la lista
  blanca no se amplió**. Identidad reutilizada + fallo del perfil → el
  `user_role` nuevo se deshace y la persona queda con los roles previos.

**Un test preexistente se reescribió, no se borró.** En
`inquilinos.api.test.ts`, el caso "el modelo admite los dos roles… aunque el
alta ya no deduplique (§7.4, D-9)" afirmaba **el defecto**: dos filas de `user`
para la misma persona. Es exactamente la deuda D5 que esta feature cierra, así
que pasa a afirmar el comportamiento correcto (una identidad, dos roles
activos), con la explicación de por qué cambió.

**Un cambio en el borde HTTP.** `AllExceptionsFilter` aprende a volcar los
`detalles` que un error de dominio (<500) declare a propósito: es lo que hace
posible el cuerpo accionable de R28 sin romper la forma única de
`ApiErrorResponse`. Los detalles **no** se registran en el log.

---

## Consulta de diagnóstico de identidades duplicadas (design.md §3)

La migración `0009` avisa con `RAISE WARNING` y el conteo, pero no deja ningún
objeto de esquema que nadie mantendría. Para ver **quiénes** son:

```sql
SELECT u.tenant_id, u.tipo_documento, u.documento, count(*) AS identidades,
       array_agg(u.id ORDER BY u.created_at) AS user_ids,
       array_agg(u.nombre ORDER BY u.created_at) AS nombres
  FROM "user" u
 WHERE u.documento IS NOT NULL
 GROUP BY u.tenant_id, u.tipo_documento, u.documento
HAVING count(*) > 1;
```

Tras aplicar `0009` esta consulta devuelve **cero filas** por construcción (el
índice único lo impide). Para encontrar las que la migración dejó **sin**
documento —las que se recrean, PA-2—:

```sql
SELECT u.id, u.tenant_id, u.nombre
  FROM "user" u
 WHERE u.documento IS NULL
   AND EXISTS (SELECT 1 FROM perfil_propietario p WHERE p.user_id = u.id
                UNION ALL
               SELECT 1 FROM perfil_inquilino  p WHERE p.user_id = u.id);
```

Un cliente **con perfil** y **sin** documento en su identidad solo puede venir
de una colisión limpiada por `0009`.

## Verificación por mutación (T27)

Pendiente: bloque C.

## Trazabilidad R → test (T28)

Pendiente: bloque C.
