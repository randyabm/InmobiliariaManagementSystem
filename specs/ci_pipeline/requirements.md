# Requirements — `ci_pipeline` (feature #23, fase 1a)

> Notación **EARS estricta** (`docs/specs.md`). Un solo `DEBE` por requirement.
> Cada `R<n>` cita su origen en `docs/PRD.md` y es verificable por al menos un
> control concreto y ejecutable.
>
> **Fuente de producto:** `docs/PRD.md` RF-QA1 (§16.2, línea 985), §11.2 (fila
> **CI**: *Gitea Actions / Forgejo (self-hosted)*; fila **Orquestación**:
> *Docker Compose en ZimaOS*), §16.4 (tabla resumen, fila CI) y **D10**
> (§11.1, línea 627).
>
> **Decisión cerrada (humano, 2026-07-26):** el CI es **Forgejo self-hosted con
> su runner**. GitHub Actions quedó descartado y no se reabre: el repositorio es
> privado en plan Free, donde la protección de rama devuelve `403 Upgrade to
> GitHub Pro`, de modo que el pipeline podría avisar pero **no bloquear la
> integración** — que es justo lo que RF-QA1 exige. Ver `docs/PRD.md` §11.2
> (nota del 2026-07-26) y el campo `note` de la feature #23.
>
> **Decisiones DA-1..DA-6 cerradas por el humano el 2026-07-26** en la puerta de
> aprobación. Quedan registradas en `design.md` §11 (*Registro de decisiones
> tomadas*). **No queda ninguna decisión abierta**: ningún requirement de este
> documento es condicional a una elección futura. En particular:
> el stack de CI vive en la **máquina local** (DA-1), GitHub queda como
> **espejo push desde Forgejo** (DA-2, opción B2 → R24 es firme), la instancia
> escucha en **`127.0.0.1`** (DA-3), la protección de `main` se apoya **solo en
> status checks, con 0 aprobaciones de revisor** (DA-4), se acepta el
> contenedor **privilegiado dind** (DA-5) y el runner corre con
> **`capacity: 3`** (DA-6).

---

## Glosario de esta feature

| Término | Significado aquí |
|---|---|
| **Instancia** | El servidor Forgejo self-hosted que aloja el repositorio y ejecuta Actions. |
| **Runner** | El proceso `forgejo-runner` que toma los jobs y los ejecuta en contenedores. |
| **Workflow** | `.forgejo/workflows/ci.yml`, el pipeline versionado en el repositorio. |
| **Job** | Unidad de ejecución del workflow (`calidad`, `base-de-datos`, `arnes`). |
| **Status check requerido** | Job cuyo éxito la protección de rama exige antes de permitir la fusión. |
| **Escape de fallo** | Construcción que impide que un comando en rojo tumbe el job (`continue-on-error`, `\|\| true`, `set +e`, `if: always()` sobre un paso de verificación). |

---

## Bloque A — Infraestructura de CI reproducible

## R1 — (RF-QA1; PRD §11.2 filas *CI* y *Orquestación*)
El sistema DEBE declarar la instancia de Forgejo y su runner como servicios de
un archivo Docker Compose versionado en `ci/forgejo/`, distinto del
`docker-compose.yml` de desarrollo de la aplicación.

*Verificable por:* test que parsea ambos YAML y exige que los servicios de CI
existan en `ci/forgejo/docker-compose.ci.yml`, que ese archivo declare un
`name:` de proyecto propio, y que el `docker-compose.yml` raíz **no** contenga
ningún servicio de CI (falla si alguien los mezcla).

## R2 — (PRD §11.2; precedente R8 de `project_scaffold`)
El sistema NO DEBE usar la etiqueta `latest` ni ninguna etiqueta móvil en las
imágenes de la infraestructura de CI: toda imagen DEBE llevar una versión
explícita.

*Verificable por:* test que extrae toda clave `image:` del compose de CI y exige
que la parte de etiqueta exista, no sea `latest`, no sea vacía y contenga al
menos un dígito de versión (o un digest `@sha256:`).

## R3 — (CHECKPOINTS.md §C7 *sin secretos en el repositorio*)
SI un valor de configuración de la infraestructura de CI es un secreto
(contraseña del administrador, token de registro del runner, token de API)
ENTONCES el sistema DEBE obtenerlo de una variable de entorno no versionada.

*Verificable por:* test que exige que **todo** valor de `environment:` del
compose de CI case con `/^\$\{[A-Z0-9_]+\}$/` o sea un valor no sensible de la
lista blanca declarada en el test, que `ci/forgejo/.env` esté en `.gitignore` y
que `ci/forgejo/.env.example` solo contenga `CHANGE_ME`.

## R4 — (CHECKPOINTS.md §C7)
CUANDO el runner se registra contra la instancia, el sistema DEBE persistir la
credencial resultante en un volumen Docker nombrado, fuera del árbol del
repositorio.

*Verificable por:* test que exige que el directorio de datos del runner sea un
volumen nombrado declarado en `volumes:` (no un bind mount a una ruta del
repositorio) y que ninguna ruta bajo `ci/` sea el destino de esa credencial.

## R5 — (RF-QA1, *precisión del 2026-07-26*; criterio de aceptación 4; decisión DA-5, cerrada 2026-07-26)
El runner DEBE ejecutar los jobs contra un daemon Docker propio (Docker-in-
Docker) alcanzable por `DOCKER_HOST`, y NO DEBE montar el socket Docker del
host.

> Se parte en dos porque son dos obligaciones distintas; la negativa es la que
> tiene valor de seguridad. Ver R6.

*Verificable por:* test que exige un servicio `docker` (dind) en el compose de
CI y que el runner reciba `DOCKER_HOST` apuntando a él.

## R6 — (CHECKPOINTS.md §C7; `docs/architecture.md` *Qué NO se hace*)
SI algún servicio del compose de CI declara un bind mount de
`/var/run/docker.sock` ENTONCES la verificación del repositorio DEBE fallar.

*Verificable por:* test que recorre `volumes:` de todos los servicios de CI y de
la configuración del runner buscando `docker.sock`; cualquier aparición falla.
Es un test negativo y resistente a mutación: añadir el montaje lo rompe.

## R7 — (CHECKPOINTS.md §C7; PRD §11.2 *self-host sin dependencias externas*)
La instancia de Forgejo DEBE tener el registro público de usuarios
deshabilitado por configuración versionada.

*Verificable por:* test que exige
`FORGEJO__service__DISABLE_REGISTRATION` (o su equivalente en el archivo de
configuración versionado) con valor `true` en el compose de CI.

## R8 — (CHECKPOINTS.md §C7; decisión DA-3, cerrada 2026-07-26)
La instancia de Forgejo NO DEBE publicar sus puertos en `0.0.0.0` de forma
literal: la interfaz de escucha DEBE venir de una variable de entorno cuyo valor
por defecto documentado sea `127.0.0.1`.

*Verificable por:* test que exige que toda entrada de `ports:` del compose de CI
tenga la forma `${VAR}:<puerto>` o `${VAR}` completa, y que `.env.example`
declare esa variable con el valor literal `127.0.0.1`. Falla si alguien la
documenta como `0.0.0.0`.

---

## Bloque B — El pipeline: qué corre y cuándo

## R9 — (RF-QA1 *"que se ejecute en cada cambio"*; criterio de aceptación 2)
El workflow DEBE dispararse en los eventos `push` y `pull_request` sobre la
rama `main`.

*Verificable por:* test que parsea `.forgejo/workflows/ci.yml` con `js-yaml` y
comprueba las claves de `on:` y sus filtros de rama.

## R10 — (RF-QA1; criterio de aceptación 3)
El workflow DEBE ejecutar el script `lint` del `package.json` raíz.

## R11 — (RF-QA1; criterio de aceptación 3)
El workflow DEBE ejecutar el script `typecheck` del `package.json` raíz.

## R12 — (RF-QA1; criterio de aceptación 3)
El workflow DEBE ejecutar el script `test` del `package.json` raíz.

## R13 — (RF-QA1; criterio de aceptación 3)
El workflow DEBE ejecutar el script `build` del `package.json` raíz.

## R14 — (RF-QA1 + RF-QA2 vía D10; criterio de aceptación 3 y 4)
El workflow DEBE ejecutar el script `test:db` del `package.json` raíz en un job
con acceso al daemon Docker del runner.

*Verificable por (R10–R14):* test que recorre todos los pasos `run:` del
workflow, extrae los scripts npm invocados y exige que el conjunto
`{lint, typecheck, test, build, test:db}` esté íntegramente cubierto, indicando
en qué job. Falla si alguno se elimina o se renombra.

## R15 — (D10, PRD §16.2 *"Testcontainers levanta un Postgres real"*; `docs/verification.md` Nivel 2)
SI el runner no puede levantar contenedores ENTONCES el job de base de datos
DEBE terminar en fallo, y NO DEBE reportarse verde por haber omitido los tests.

*Verificable por:* la guarda de `test:db` ya existente (feature #1, mutación M10
del review: `vitest.db.config.ts` aborta con exit 1 si Docker no responde) más
un test que exige que el paso de `test:db` no lleve ningún escape de fallo
(ver R17) ni una condición que lo haga saltable.

## R16 — (RF-QA1; criterio de aceptación 6 *"no requiere que un humano recuerde ejecutar ./init.sh"*)
El workflow DEBE ejecutar `./init.sh` y DEBE fallar el job si su código de
salida es distinto de cero.

*Verificable por:* test que localiza el paso que invoca `./init.sh` y comprueba
que no está envuelto en ningún escape de fallo.

## R17 — (RF-QA1 *"y que bloquee la integración si falla"*)
El workflow NO DEBE contener escapes de fallo: `continue-on-error`, `|| true`,
`; true`, `set +e`, `--passWithNoTests`, ni `if: always()` sobre un paso de
verificación.

*Verificable por:* test que aplica una lista explícita de patrones prohibidos
sobre el texto del workflow y sobre el YAML parseado (`continue-on-error` puede
declararse a nivel de job o de paso; se comprueban ambos niveles). Resistente a
mutación por construcción: añadir `|| true` a cualquier paso lo rompe.

## R18 — (RF-QA1; `docs/verification.md` *anti-patrones*)
CUANDO el workflow invoca un script npm, ese script DEBE existir en el
`package.json` del workspace correspondiente.

*Verificable por:* test que cruza los scripts invocados por el workflow con los
declarados en `package.json` (raíz y workspaces). Detecta erratas y scripts
eliminados, que de otro modo producirían un fallo tardío o —peor— un job que no
verifica nada.

## R19 — (PRD §11.2 *Node/TypeScript de punta a punta*; `package.json` `engines`)
El workflow NO DEBE declarar literalmente un número de versión de Node: DEBE
tomarlo de `.nvmrc` como única fuente.

*Verificable por:* test que (a) exige `node-version-file: .nvmrc` en el paso de
preparación de Node, (b) falla si aparece cualquier literal de versión de Node
en el workflow (`node-version:` con valor, imagen `node:<n>`), y (c) comprueba
que la versión de `.nvmrc` satisface el rango `engines.node` del `package.json`
raíz.

---

## Bloque C — El bloqueo real de la integración

> Este es el corazón de RF-QA1. Un pipeline que corre pero no impide fusionar
> **no cumple** el requerimiento.

## R20 — (RF-QA1; criterio de aceptación 5)
MIENTRAS algún status check requerido de la rama `main` no haya terminado con
éxito, la instancia DEBE impedir la fusión del pull request.

> **Decisión DA-4, cerrada 2026-07-26:** el bloqueo se apoya **solo** en los
> status checks. La protección de `main` se configura con **0 aprobaciones de
> revisor requeridas** (`required_approvals: 0`), porque hay un único
> desarrollador y exigir una aprobación de tercero bloquearía todo el trabajo
> sin añadir garantía alguna. Lo que RF-QA1 exige es que un cambio en rojo no
> se pueda integrar, y eso lo garantizan los checks, no una firma humana.

*Verificable por:* `ci/forgejo/scripts/verificar-ci.sh` consulta
`GET /api/v1/repos/{owner}/{repo}/branch_protections` de la instancia real y
exige `enable_status_check: true` con `status_check_contexts` no vacío y
`required_approvals: 0`; y por la **demostración de extremo a extremo**
registrada como evidencia (rama con un test roto → PR → fusión bloqueada →
captura de la respuesta de la API y del estado del PR). Ver `design.md` §10.

## R21 — (RF-QA1; criterio de aceptación 5)
La rama `main` NO DEBE aceptar `push` directo: toda integración DEBE entrar por
pull request.

*Verificable por:* `verificar-ci.sh` exige que la regla de protección de `main`
tenga la escritura directa bloqueada (`enable_push: false`), y por la
demostración de que un `git push` a `main` es rechazado por el servidor.

## R22 — (RF-QA1; RF-QA2..RF-QA5 como alcance futuro)
Todo job declarado en el workflow DEBE figurar en la lista de status checks
requeridos que aplica el script de protección de rama.

> Sin esto, añadir un job (p. ej. el de RLS de RF-QA2, o el E2E offline de
> RF-QA4) daría una falsa sensación de cobertura: correría y su fallo no
> bloquearía nada.

*Verificable por:* test de consistencia entre archivos — extrae los ids de job
de `.forgejo/workflows/ci.yml` y la lista `CONTEXTOS_REQUERIDOS` de
`ci/forgejo/scripts/proteger-rama.sh`, y exige igualdad de conjuntos. Falla al
añadir un job sin registrarlo como requerido.

## R23 — (CHECKPOINTS.md §C7)
El repositorio NO DEBE contener el token de registro del runner ni ninguna otra
credencial de la instancia en texto plano.

*Verificable por:* test que barre `ci/**` y `.forgejo/**` con los patrones de
credencial de `init.sh` §4 más los patrones propios de Forgejo (token
hexadecimal de 40 caracteres, `token = `, `password = `), y por `./init.sh` §4,
que ya corre en el propio pipeline (R16).

## R24 — (PRD §11.2 *self-host, sin dependencias externas*; decisión DA-2 = opción B2, cerrada 2026-07-26)
El sistema DEBE configurar el repositorio de GitHub como **espejo push
unidireccional desde Forgejo**, de modo que Forgejo sea el único origen
autoritativo y GitHub quede exclusivamente como respaldo de solo lectura.

> Requirement **firme**, no opcional: el humano cerró DA-2 el 2026-07-26 con la
> opción **B2** (`design.md` §3 y §11). Se implementa en T27.
>
> **Consecuencia operativa que hay que respetar:** nadie —ni humano ni agente—
> empuja directamente a GitHub. Un `push` a GitHub **saltaría la puerta de
> calidad**, porque ahí no hay ni workflow ni protección de rama que valga
> (§9.1); el cambio quedaría integrado sin haber pasado el CI, que es
> exactamente lo que RF-QA1 prohíbe. El `origin` del clon local apunta a
> Forgejo, y el remoto de GitHub no se conserva como destino escribible.

*Verificable por:* `verificar-ci.sh` consulta la configuración de espejo
(`GET /api/v1/repos/{owner}/{repo}/push_mirrors`) de la instancia y exige que
exista al menos un espejo de tipo push apuntando al repositorio de GitHub; más
un test determinista que exige que `ci/forgejo/README.md` documente que el
`origin` autoritativo es Forgejo y que GitHub no se empuja a mano.

---

## Requirements de seguridad obligatorios (`docs/specs.md`)

`docs/specs.md` exige los dos requirements canónicos de seguridad **"toda
feature que exponga datos o endpoints"**. Esta feature **no expone endpoints de
la aplicación ni datos de tenants**: no toca `apps/`, `packages/`, ni el
esquema de base de datos. Por tanto:

- **Aislamiento por tenant (RF-A1):** **no aplica** — esta feature no crea
  tablas, endpoints ni consultas. La frontera se mantiene sellada por los
  controles ya vigentes de la feature #1 (`routes-surface.test.ts`,
  `migrations.test.ts` con `TABLAS_PERMITIDAS = []`), que el propio pipeline
  ejecuta en cada cambio (R12, R16).
- **RBAC en backend (RF-C3):** **no aplica** al producto por la misma razón. El
  control de acceso relevante aquí es el de la instancia de CI, cubierto por R7
  (sin registro público) y R21 (sin push directo a `main`).

En su lugar, los invariantes de C7 que **sí** aplican quedan cubiertos por R3,
R4, R6, R7, R8, R23 (secretos y superficie de la infraestructura) y, sobre
todo, por R15: el valor de seguridad de esta feature es que los tests
deterministas de aislamiento y RBAC de las features siguientes **corran de
verdad contra PostgreSQL real en cada cambio**, y no en verde silencioso.

---

## Fuera de alcance (declarado, no olvidado)

- **RF-QA2 (RLS), RF-QA3 (RBAC), RF-QA4 (offline/Playwright), RF-QA5
  (trazabilidad):** describen suites que **todavía no existen**. No se
  implementan aquí. El diseño debe poder acogerlas añadiendo un job y su
  contexto requerido, sin rediseñarse (R22 lo fuerza).
- **RF-QA6..RF-QA11 (evals de IA, Promptfoo, Langfuse):** fase 4+.
- **Despliegue continuo:** el PRD no lo pide. Este pipeline **verifica**, no
  despliega.
- **Caché de dependencias y optimización de tiempos:** deseable, no requerido
  por el PRD; se trata en `design.md` §6 como detalle de implementación, sin
  requirement propio.
