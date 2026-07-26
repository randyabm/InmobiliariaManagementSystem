# Tasks — `ci_pipeline` (feature #23, fase 1a)

> Orden de ejecución. El `implementer` marca `[x]` al completar cada una.
> Las tasks de test son **de primera clase**, no un apéndice: los bloques B y D
> se entregan junto a su código, no al final.
>
> **Prerrequisito cumplido:** el humano cerró **DA-1..DA-6** el **2026-07-26**
> (registro en `design.md` §11). No queda ninguna decisión abierta y ninguna
> task de este documento es condicional. Las decisiones que gobiernan la
> implementación son: stack de CI en la **máquina local** (DA-1), GitHub como
> **espejo push desde Forgejo** (DA-2 = B2), instancia en **`127.0.0.1`**
> (DA-3), protección de `main` con **0 aprobaciones** y solo status checks
> (DA-4), **dind privilegiado aceptado** (DA-5) y runner con **`capacity: 3`**
> (DA-6).
>
> **Prohibido en esta feature:** tocar `apps/`, `packages/` o `docs/PRD.md`.
> Único cambio en el árbol de la app: la rama temporal de prueba de T17, que se
> revierte.

---

## Bloque A — Infraestructura de CI versionada

- [x] **T1** — Crear `ci/forgejo/.env.example` con todas las variables
      (`FORGEJO_BIND`, `FORGEJO_HTTP_PORT`, `FORGEJO_SSH_PORT`,
      `FORGEJO_ROOT_URL`, `FORGEJO_ADMIN_USUARIO`, `FORGEJO_ADMIN_PASSWORD`,
      `FORGEJO_API_TOKEN`, `RUNNER_NOMBRE`, `RUNNER_ETIQUETAS`), todas con
      valor `CHANGE_ME` o un valor no sensible. `FORGEJO_BIND` lleva el valor
      literal **`127.0.0.1`** (DA-3). Añadir `ci/forgejo/.env` a `.gitignore`.
      Cubre: R3, R8, R23.
- [x] **T2** — Crear `ci/forgejo/docker-compose.ci.yml` con `name:
      inmobiliaria-ci`, servicio `forgejo` (SQLite en volumen propio, registro
      público deshabilitado, `ports:` con interfaz por variable, `restart:
      unless-stopped`), volúmenes nombrados y healthchecks. Pensado para
      ejecutarse en la **máquina local** (DA-1) pero **sin ninguna IP, ruta ni
      nombre de host literales**: todo lo específico del emplazamiento va por
      `.env`, de modo que mover a ZimaOS sea cambiar el `.env` (`design.md`
      §2.2). Versiones **explícitas**, jamás `latest`; registrar las versiones
      fijadas en `progress/impl_ci_pipeline.md`. Cubre: R1, R2, R3, R7, R8.
- [x] **T3** — Verificar que el `docker-compose.yml` raíz **no** se modifica y
      que `tests/docker-compose.test.ts` sigue verde: los dos stacks quedan
      separados. Cubre: R1.
- [x] **T4** — Añadir al compose de CI el servicio `docker` (dind) con
      `privileged: true` (aceptado en DA-5), en una red Compose
      `internal: true`, **sin** publicar puertos y con volumen propio para
      `/var/lib/docker`. Cubre: R5, R6.
- [x] **T5** — Añadir el servicio `runner` con `DOCKER_HOST` apuntando al dind,
      datos en el volumen nombrado `runner-datos` y **ningún** bind mount de
      `/var/run/docker.sock`. Cubre: R4, R5, R6.
- [x] **T6** — Crear `ci/forgejo/config-runner.yml`: `capacity: 3` (DA-6), etiquetas,
      `container.docker_host` y `container.options` (`--add-host=docker:host-gateway`)
      según `design.md` §6, imagen base de job **sin** versión de Node en el
      nombre. Cubre: R5, R19.
- [x] **T7** — Crear `ci/forgejo/scripts/levantar.sh` (arranque idempotente del
      stack de CI, cargando `ci/forgejo/.env`) y comprobar que la instancia
      responde en la URL configurada. Cubre: R1.
- [x] **T8** — Crear `ci/forgejo/scripts/registrar-runner.sh`: genera el token
      de registro y lo consume **en la misma tubería**, sin escribirlo en
      ningún archivo; la credencial resultante queda en el volumen nombrado.
      Cubre: R3, R4, R23.

## Bloque B — Tests de la infraestructura (se entregan con el bloque A)

- [x] **T9** — **Test** `tests/ci-infraestructura.test.ts`: parsea el compose de
      CI con `js-yaml` y verifica proyecto separado, ausencia de servicios de CI
      en el compose raíz, ninguna imagen `latest` o sin etiqueta, todo
      `environment:` interpolado y cruzado con `.env.example`, datos del runner
      en volumen nombrado, servicio dind con `DOCKER_HOST`, `ports:` con
      interfaz por variable y registro público deshabilitado.
      Cubre: R1, R2, R3, R4, R5, R7, R8.
- [x] **T10** — **Test** negativo en el mismo archivo: ninguna aparición de
      `docker.sock` en el compose de CI ni en `config-runner.yml`; y barrido de
      credenciales (token hexadecimal de 40, `password =`, `token =`) sobre
      `ci/**` y `.forgejo/**`. Cubre: R6, R23.

## Bloque C — El workflow

- [x] **T11** — Crear `.forgejo/workflows/ci.yml`: disparadores `push` y
      `pull_request` sobre `main`, `concurrency` por rama, acciones
      referenciadas por URL completa del catálogo de Forgejo, y `setup-node`
      con `node-version-file: .nvmrc` (sin literal de versión). Cubre: R9, R19.
- [x] **T12** — Job `calidad`: `npm ci` → `lint` → `format:check` →
      `typecheck` → `test` → `build`, sin ningún escape de fallo.
      Cubre: R10, R11, R12, R13, R17.
- [x] **T13** — Job `base-de-datos`: `npm ci` → `test:db` con las variables de
      Testcontainers (`DOCKER_HOST`, `TESTCONTAINERS_HOST_OVERRIDE`). Ajustar
      empíricamente hasta que levante PostgreSQL real en CI; **prohibido**
      resolverlo desactivando Ryuk, saltando tests o añadiendo escapes de fallo.
      Cubre: R14, R15, R17.
- [x] **T14** — Job `arnes`: `npm ci` → `./init.sh`, con su código de salida
      gobernando el job. Cubre: R16, R17.

## Bloque D — Tests del workflow (se entregan con el bloque C)

- [x] **T15** — **Test** `tests/ci-flujo-trabajo.test.ts`: el YAML parsea; `on:`
      cubre `push` y `pull_request` sobre `main`; el conjunto de scripts npm
      invocados cubre `{lint, typecheck, test, build, test:db}` y `./init.sh`;
      todo script invocado existe en su `package.json`.
      Cubre: R9, R10, R11, R12, R13, R14, R16, R18.
- [x] **T16** — **Test** de ausencia de escapes de fallo: lista explícita de
      patrones prohibidos (`continue-on-error`, `|| true`, `; true`, `set +e`,
      `--passWithNoTests`, `if: always()` en pasos de verificación), comprobada
      sobre el texto **y** sobre el YAML parseado a nivel de job y de paso.
      Cubre: R15, R17.
- [x] **T17** — **Test** de fuente única de Node: ningún literal de versión en
      el workflow, `node-version-file: .nvmrc` presente, y la versión de
      `.nvmrc` satisface `engines.node` del `package.json` raíz. Cubre: R19.

## Bloque E — Bloqueo real de la integración

- [x] **T18** — Crear `ci/forgejo/scripts/proteger-rama.sh`: idempotente, lee
      `FORGEJO_API_TOKEN` de `ci/forgejo/.env`, aplica sobre `main`
      `enable_push: false`, `enable_status_check: true`,
      `status_check_contexts = CONTEXTOS_REQUERIDOS`,
      `block_on_outdated_branch: true` y **`required_approvals: 0`** con
      `enable_approvals_whitelist: false` (DA-4: el bloqueo se apoya solo en
      status checks). `CONTEXTOS_REQUERIDOS` declarado como constante legible
      sin ejecutar el script. Cubre: R20, R21, R22.
- [x] **T19** — **Test** de consistencia entre archivos: los ids de job de
      `.forgejo/workflows/ci.yml` igualan (como conjunto) los
      `CONTEXTOS_REQUERIDOS` de `proteger-rama.sh`. Añadir un job sin
      registrarlo como requerido DEBE romper este test. Cubre: R22.
- [x] **T20** — Crear `ci/forgejo/scripts/verificar-ci.sh` y el script npm
      `ci:verificar`: comprueba contra la instancia real la versión, el
      repositorio con Actions habilitado, al menos un runner **online**, la
      regla de protección de `main` (checks requeridos, push directo bloqueado,
      `required_approvals: 0`), que los contextos configurados coinciden con los
      realmente publicados por la última ejecución, y que existe el **espejo
      push** hacia GitHub (`push_mirrors`, DA-2 = B2). Sale distinto de cero al
      primer fallo. Cubre: R20, R21, R22, R24.
- [x] **T21** — Redactar `ci/forgejo/README.md` con la puesta en marcha y los
      **once pasos manuales literales** de `design.md` §9.3 (preparar `.env`
      con `FORGEJO_BIND=127.0.0.1`, levantar, instalador y usuario admin,
      generación del token de API con sus permisos, alta del repositorio,
      casilla *Enable Repository Actions*, registro y verificación del runner en
      *Site Administration*, reapuntar `origin` a Forgejo, alta del espejo push
      a GitHub, protección de rama y su comprobación visual, verificación
      final). Incluir la advertencia destacada de que **no se empuja a GitHub a
      mano** porque saltaría el CI (`design.md` §3.1). Cubre: R20, R21, R24.

## Bloque F — Puesta en marcha y demostración (requiere la instancia real)

- [ ] **T22** — Levantar el stack de CI (T7), ejecutar el registro del runner
      (T8) y verificar en la UI que el runner aparece **Idle/Online**.
      Cubre: R4, R5.
- [ ] **T23** — Subir el repositorio a la instancia (con el `origin` local ya
      apuntando a Forgejo), habilitar *Actions* y confirmar que el workflow se
      ejecuta en el primer `push` con los tres jobs en verde, incluido
      `base-de-datos` levantando PostgreSQL real. Anotar el **formato literal
      del contexto de status** que publica cada job y ajustar
      `CONTEXTOS_REQUERIDOS` si difiere (`design.md` §9.2).
      Cubre: R9, R14, R15, R22.
- [ ] **T24** — Ejecutar `proteger-rama.sh` y después `npm run ci:verificar`;
      dejar la salida literal en `progress/impl_ci_pipeline.md`.
      **Requiere T27 hecho** (el espejo push existe), porque `ci:verificar`
      también comprueba `push_mirrors`; si se ejecuta antes, se repite después
      de T27 y se registra la salida final.
      Cubre: R20, R21, R22, R24.
- [ ] **T25** — **Demostración de bloqueo (evidencia obligatoria,
      `design.md` §10 nivel 3):** rama `prueba/ci-rojo` con un test roto a
      propósito → PR → comprobar que el job falla y que **la fusión está
      bloqueada** (`mergeable: false`); intentar `git push origin main` directo
      y comprobar que el servidor lo **rechaza**; corregir, ver verde y que
      entonces sí se puede fusionar; eliminar la rama y revertir el test roto.
      Registrar las salidas literales. Cubre: R20, R21.
- [ ] **T26** — **Tests de mutación** en una **copia aislada** del repositorio
      (nunca en el árbol real), con la lista de `design.md` §10 nivel 1: `||
      true`, `continue-on-error`, borrar el paso de `test:db`, renombrar
      `test:db`, job sin contexto requerido, `node-version: 22`, imagen
      `latest`, montar `docker.sock`, contraseña literal. Cada mutación DEBE
      hacer fallar su test. Tabla de resultados en
      `progress/impl_ci_pipeline.md`. Cubre: R2, R6, R14, R17, R18, R19, R22, R23.

## Bloque G — Espejo push hacia GitHub (DA-2 = B2, decidida el 2026-07-26)

- [ ] **T27** — Configurar GitHub como **espejo push unidireccional** desde
      Forgejo (`design.md` §9.3 paso 9): alta del push mirror con el PAT de
      GitHub, sincronización inicial y comprobación de que `main` coincide en
      ambos lados. Dejar el `origin` del clon local apuntando a **Forgejo** y
      verificar con `git remote -v` que **no queda ningún remoto de GitHub
      escribible**. Documentar en `ci/forgejo/README.md`, de forma destacada,
      que **no se empuja a GitHub a mano** porque saltaría la puerta de calidad
      (§3.1). Añadir la comprobación de `push_mirrors` a `verificar-ci.sh`
      (T20). Cubre: R24.

## Bloque H — Cierre

- [ ] **T28** — Ejecutar `./init.sh` en local y verificar que termina en verde
      con los tests nuevos incluidos.
- [ ] **T29** — Escribir `progress/impl_ci_pipeline.md` con el mapa de
      trazabilidad `R<n> → test/evidencia`, las versiones de imagen fijadas, la
      tabla de mutaciones (T26) y las salidas de T24 y T25.

---

## Trazabilidad requirement → tasks

| Requirement | Tasks |
|---|---|
| R1 | T2, T3, T7, T9 |
| R2 | T2, T9, T26 |
| R3 | T1, T2, T8, T9 |
| R4 | T5, T8, T9, T22 |
| R5 | T4, T5, T6, T9, T22 |
| R6 | T4, T5, T10, T26 |
| R7 | T2, T9 |
| R8 | T1, T2, T9 |
| R9 | T11, T15, T23 |
| R10 | T12, T15 |
| R11 | T12, T15 |
| R12 | T12, T15 |
| R13 | T12, T15 |
| R14 | T13, T15, T23, T26 |
| R15 | T13, T16, T23 |
| R16 | T14, T15 |
| R17 | T12, T13, T14, T16, T26 |
| R18 | T15, T26 |
| R19 | T6, T11, T17, T26 |
| R20 | T18, T20, T21, T24, T25 |
| R21 | T18, T20, T21, T24, T25 |
| R22 | T18, T19, T20, T23, T24, T26 |
| R23 | T1, T8, T10, T26 |
| R24 | T20, T21, T27 |
