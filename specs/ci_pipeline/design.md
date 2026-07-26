# Design — `ci_pipeline` (feature #23, fase 1a)

> Decisiones técnicas **previas** al código. Se apoya en `docs/architecture.md`
> y `docs/conventions.md`; aquí solo se documenta donde esta feature roza o
> extiende esas fronteras.
> Producto: `docs/PRD.md` RF-QA1 (§16.2), §11.2 (filas *CI* y *Orquestación*),
> §16.4 y **D10**.

---

## 0. Punto de partida verificado

| Hecho | Consecuencia para el diseño |
|---|---|
| Docker 29.6.2 con daemon activo en la máquina local | Se puede levantar Forgejo + runner + dind hoy, sin infraestructura nueva. |
| Git local con remoto `https://github.com/randyabm/InmobiliariaManagementSystem.git`, **privado, plan Free** | La protección de rama no existe ahí (403). GitHub Actions descartado (§9.1). GitHub queda como **espejo push de solo lectura** (DA-2 = B2, cerrada). |
| **No existe ninguna instancia de Forgejo/Gitea**: ni contenedor, ni binario, ni runner | Toda la infraestructura se crea en esta feature. Nada puede darse por existente. |
| NAS ZimaOS en `192.168.0.184`, sirve el montaje CIFS | Es lo **único** confirmado sobre ZimaOS. No hay evidencia de acceso SSH ni al daemon Docker del NAS → **DA-1 cerrada a favor de la máquina local** (§2). |
| El repo tiene `package.json` raíz con `lint`, `typecheck`, `test`, `test:db`, `build`, `format:check`; `.nvmrc`; `engines.node >= 20`; `package-lock.json` | El pipeline **invoca scripts existentes**, no reinventa comandos. |
| `vitest.config.ts` + `vitest.repo.config.ts`: la suite `repo` corre tests estructurales sin Docker | Los tests de esta feature se enchufan ahí, sin configuración nueva. `js-yaml` ya es devDependency. |
| `test:db` tiene guarda que **aborta con exit 1** si Docker no responde (review feature #1, mutación M10) | R15 se apoya en un mecanismo ya probado, no en uno nuevo. |

**Regla derivada:** esta feature no toca `apps/` ni `packages/`. Solo añade
`ci/`, `.forgejo/`, dos tests en `tests/`, entradas en `.gitignore` y un script
de conveniencia en el `package.json` raíz.

---

## 1. Archivos que se crean

```
.forgejo/workflows/ci.yml                 # el pipeline (R9..R19)
ci/forgejo/docker-compose.ci.yml          # instancia + runner + dind (R1..R8)
ci/forgejo/.env.example                   # variables, todas CHANGE_ME (R3)
ci/forgejo/config-runner.yml              # configuracion del runner (R5, R6)
ci/forgejo/README.md                      # puesta en marcha + pasos manuales (§8)
ci/forgejo/scripts/levantar.sh            # docker compose up del stack de CI
ci/forgejo/scripts/registrar-runner.sh    # registro sin filtrar el token (§5)
ci/forgejo/scripts/proteger-rama.sh       # protección de rama vía API (R20..R22)
ci/forgejo/scripts/verificar-ci.sh        # verificación contra la instancia real (§10)
tests/ci-flujo-trabajo.test.ts            # tests del workflow (R9..R19, R22)
tests/ci-infraestructura.test.ts          # tests del compose de CI (R1..R8, R23)
```

Se modifican: `.gitignore` (`ci/forgejo/.env`, `ci/forgejo/datos/`) y
`package.json` raíz (script `ci:verificar`). **Nada más.**

Idioma: identificadores, nombres de job y comentarios en **español sin tildes
ni `ñ`** (`docs/conventions.md` §Idioma). Se conservan los términos técnicos
establecidos (`runner`, `workflow`, `commit`, `token`, `job`).

---

## 2. Dónde vive Forgejo → **DA-1 cerrada: máquina local** (diseño agnóstico al host)

**Decisión del humano, 2026-07-26:** el stack de CI (Forgejo + runner + dind)
vive en la **máquina local de desarrollo**, con `restart: unless-stopped`. No
en ZimaOS.

*Motivo:* es el único host con daemon Docker verificado y es donde ocurre el
desarrollo, así que el ciclo de feedback no depende de la red del NAS ni de
accesos al NAS que **no están comprobados** (de ZimaOS solo consta que responde
en `192.168.0.184` y sirve CIFS; no consta SSH ni acceso a su daemon Docker —
suponer lo contrario ya costó un bloqueo en la feature #1).
*Coste aceptado:* si la máquina está apagada, no hay CI. Aceptable para un
desarrollador único en fase 1a.

### 2.1 Esto **no** es una desviación del PRD §11.2 — nota para el reviewer

El PRD §11.2 dice *"Docker Compose en **ZimaOS**"* en la fila **Orquestación**,
y esa fila describe dónde se despliega **la aplicación** (PostgreSQL, Redis,
MinIO, API, web). La fila **CI** dice *Gitea Actions / Forgejo (self-hosted)* y
**no especifica host alguno**. Es decir: el PRD fija ZimaOS para la
orquestación de la aplicación y deja el **alojamiento del CI sin especificar**.
Alojar el CI en la máquina local por tanto **no contradice** ninguna línea del
PRD; cubre un hueco que el PRD deja abierto. La única obligación del PRD que
esta feature debe honrar —*self-hosted*, sin dependencias externas— se cumple.

### 2.2 Propiedad que se conserva: agnosticismo al host

Aunque DA-1 esté cerrada, el diseño **sigue siendo agnóstico al emplazamiento**
a propósito: todo lo específico del host vive en variables de `.env`
(`FORGEJO_BIND`, `FORGEJO_HTTP_PORT`, `FORGEJO_SSH_PORT`, `FORGEJO_ROOT_URL`), y
`docker-compose.ci.yml` no contiene ninguna ruta, IP ni nombre de host
literales. Mover la instancia a ZimaOS más adelante debe ser **cambiar el
`.env` y volver a apuntar el `origin` del clon**, nunca rediseñar ni reescribir
el compose. Esta propiedad es exigible: el test de R3/R8 falla si aparece una
interfaz o una URL literal en el compose.

---

## 3. Relación con el remoto de GitHub → **DA-2 cerrada: opción B2** (espejo push)

**Decisión del humano, 2026-07-26: opción B2.** **Forgejo es el origen
autoritativo**; GitHub se conserva como **espejo de respaldo**, alimentado por
una réplica **push unidireccional** desde Forgejo. Se implementa en T27 y queda
exigido por R24 (requirement firme, no opcional).

Las opciones que se evaluaron y por qué B2 gana:

| Opción | Cómo queda | Ventaja | Riesgo | Resultado |
|---|---|---|---|---|
| **B1 — Forgejo único** | Se elimina el remoto de GitHub | Un solo sitio de verdad, cero ambigüedad | Se pierde la copia fuera de la LAN (respaldo) | Descartada: DA-1 pone el CI en la máquina local, así que la única copia del código quedaría en esa misma máquina. Un respaldo externo tiene valor real. |
| **B2 — Forgejo autoritativo + GitHub espejo push** | Forgejo replica a GitHub automáticamente | Respaldo externo sin agujero en la puerta de calidad | Hay que resistir la tentación de empujar a GitHub a mano | **ELEGIDA** |
| **B3 — Conviven con push manual a ambos** | Dos remotos escribibles | Ninguna | **Rompe RF-QA1** | Descartada por incumplimiento directo del requisito. |

### 3.1 Regla operativa innegociable: **nadie empuja a GitHub**

El espejo es **de solo lectura para las personas**. El flujo autoritativo es
uno solo: rama → PR en Forgejo → status checks en verde → fusión → Forgejo
replica a GitHub.

Empujar directamente a GitHub **saltaría el CI por completo**: en GitHub no hay
workflow, no hay runner y —lo decisivo— no hay protección de rama posible
(repositorio privado en plan Free, §9.1). Un cambio integrado por ahí quedaría
en `main` sin haber pasado lint, typecheck, test, build ni `test:db`, que es
literalmente lo que RF-QA1 prohíbe. Además, un `push` manual a GitHub divergiría
del espejo y la siguiente replicación desde Forgejo lo sobrescribiría o
fallaría.

Medidas concretas que adopta el diseño para que la regla no dependa de la
memoria de nadie:

- El `origin` del clon local pasa a apuntar a **Forgejo** (T27).
- El remoto de GitHub **no se conserva** como remoto escribible en el clon
  local; si se conserva por conveniencia, se declara con URL de solo lectura.
- `ci/forgejo/README.md` lo dice de forma literal y destacada (T21, T27), y un
  test determinista exige esa nota (R24).

---

## 4. Un compose aparte, no el de desarrollo (R1)

El `docker-compose.yml` raíz es el **entorno de desarrollo de la aplicación**
(PostgreSQL, Redis, MinIO). Mezclar la infraestructura de CI dentro sería un
error por cuatro razones concretas:

1. **Ciclo de vida distinto.** `docker compose down -v` en desarrollo es una
   operación rutinaria; si arrastrase el volumen de Forgejo, se llevaría por
   delante el repositorio autoritativo y las reglas de protección.
2. **Dominio de fallo distinto.** Un CI caído no debe impedir levantar el stack
   de desarrollo, ni al revés.
3. **Superficie.** El stack de CI necesita un contenedor **privilegiado**
   (dind, §6). No debe arrancar por defecto en la máquina de cualquiera que
   haga `docker compose up`.
4. **Test existente.** `tests/docker-compose.test.ts` (feature #1) verifica la
   composición del stack de desarrollo. Meter servicios ajenos lo convertiría en
   un test de dos cosas distintas.

Se usa `name: inmobiliaria-ci` (el de desarrollo usa `name: inmobiliaria`), de
modo que son proyectos Compose independientes.

**Base de datos de Forgejo: SQLite** en su propio volumen, no PostgreSQL.
Motivo: instancia de un solo desarrollador; añadir un Postgres solo para el CI
suma un servicio, un volumen y un modo de fallo sin beneficio. Y **no** se
reutiliza el Postgres de desarrollo: acoplaría el CI al stack que el CI tiene
que verificar. Si la instancia crece, migrar a Postgres es un cambio local del
compose.

**Versiones:** el `implementer` fija las **versiones estables vigentes** de
`codeberg.org/forgejo/forgejo`, `code.forgejo.org/forgejo/runner` y `docker:dind`
en el momento de implementar, las escribe explícitas en el compose y las
registra en `progress/impl_ci_pipeline.md`. Este spec **no inventa números de
versión** que podrían no existir. Lo que sí es innegociable: prohibido `latest`
(R2), y el test lo verifica.

---

## 5. El token de registro del runner (R3, R4, R23)

El token de registro es un secreto y `CHECKPOINTS.md` §C7 prohíbe secretos en el
repositorio. Manejo:

1. `ci/forgejo/scripts/registrar-runner.sh` **genera y consume el token en la
   misma tubería**, sin escribirlo en ningún archivo ni dejarlo en el historial
   del shell:

   ```
   TOKEN=$(docker compose ... exec -T forgejo forgejo forgejo-cli actions generate-runner-token)
   docker compose ... exec -T runner forgejo-runner register --no-interactive \
       --instance "$FORGEJO_ROOT_URL" --token "$TOKEN" --name "$RUNNER_NOMBRE" --labels "$RUNNER_ETIQUETAS"
   ```

   El token vive en una variable de proceso, se usa una vez y muere con el
   script. El comando exacto se valida contra la CLI de la versión que se fije
   (§4); si esa subcomanda difiere, el script se ajusta — lo que no cambia es la
   regla: **el token nunca se persiste en el repositorio**.
2. El resultado del registro (`.runner`, con la credencial de larga vida) se
   escribe en el **volumen nombrado** `runner-datos`, nunca en un bind mount al
   árbol del repositorio (R4).
3. Todo lo demás sensible (contraseña del admin, token de API para
   `proteger-rama.sh`) vive en `ci/forgejo/.env`, **ignorado por git**;
   `ci/forgejo/.env.example` se versiona con `CHANGE_ME` (mismo patrón que
   `.env.example` de la feature #1).
4. `init.sh` §4 ya barre credenciales y **corre dentro del propio pipeline**
   (R16), así que un token filtrado rompe el CI.

---

## 6. Docker dentro del runner: **DinD**, no el socket del host (R5, R6)

> **DA-5 cerrada (humano, 2026-07-26): se acepta explícitamente el contenedor
> privilegiado (dind) en la máquina local.** El análisis de riesgo de esta
> sección **se conserva íntegro a propósito**: es la justificación de por qué se
> descartó montar el socket Docker del host, y el reviewer debe poder auditarla
> sin reconstruirla. La decisión es "asumimos este riesgo, con estas
> mitigaciones", no "este riesgo no existe".

`test:db` levanta PostgreSQL real con Testcontainers, así que el job necesita un
daemon Docker. Dos caminos:

### Opción A — montar `/var/run/docker.sock` del host
- **A favor:** trivial de configurar; sin contenedor extra; comparte la caché
  de imágenes del host, así que `postgres:16.4-alpine` no se re-descarga.
- **En contra (decisivo):** acceso al socket del host es **equivalente a root
  en el host**. Un job de CI ejecuta código de una rama cualquiera; con el
  socket montado, ese código puede arrancar un contenedor privilegiado con `/`
  montado, leer y escribir cualquier archivo de la máquina de desarrollo,
  manipular los contenedores de desarrollo y sus volúmenes, y leer el `.env`
  real. Es exactamente el modelo de amenaza del CI: **ejecutar código no
  revisado**. Un PR malicioso o un paquete npm comprometido bastaría.

### Opción B — Docker-in-Docker (`docker:<version>-dind`) — **ELEGIDA**
- Servicio `docker` con `privileged: true`, en una red Compose **interna** no
  publicada, con su propio volumen para `/var/lib/docker`.
- El runner apunta ahí con `DOCKER_HOST=tcp://docker:2375`.
- **Implicaciones de seguridad, dichas sin adornos:** `privileged: true`
  también es peligroso — una fuga del contenedor dind da root en el host. La
  diferencia no es que sea inocuo, es que **eleva el listón**: con el socket
  del host, `docker run -v /:/host` desde el job es suficiente y no requiere
  ninguna vulnerabilidad; con dind hace falta una fuga real del kernel/runtime.
  Y el radio de daño ordinario queda contenido: el job no ve las imágenes,
  contenedores, redes ni volúmenes del daemon del host, incluido el stack de
  desarrollo con sus datos.
- **Mitigaciones que el diseño adopta:** el daemon dind no publica puertos al
  host; vive en una red Compose marcada `internal: true`; sin bind mounts del
  host salvo su propio volumen; TLS desactivado **solo** porque el endpoint no
  es alcanzable fuera de esa red interna (evitar el trasiego de certificados
  compartidos entre tres contenedores); volumen dedicado para la caché de
  imágenes, de modo que la penalización de re-descarga de la opción A se paga
  una sola vez.

### Cableado para Testcontainers (el punto frágil)
Los contenedores de job los crea el runner **dentro** de dind, así que no
resuelven por DNS el nombre de servicio `docker` de la red Compose. Línea base
de partida, que **T13 ajusta empíricamente** contra la versión de runner que se
fije (no es una decisión del humano, es una comprobación de ejecución):

- `config-runner.yml`: `container.docker_host: tcp://docker:2375` y
  `container.options: --add-host=docker:host-gateway`, de modo que dentro del
  contenedor de job el nombre `docker` resuelva al daemon dind (su gateway).
- Variables para Testcontainers en el job: `DOCKER_HOST=tcp://docker:2375` y
  `TESTCONTAINERS_HOST_OVERRIDE=docker`, para que las URLs de conexión que
  Testcontainers publica apunten al daemon y no a `localhost`.

**Ambigüedad honesta (técnica, no de producto):** los nombres exactos de estas
claves dependen de la versión del runner y este spec no puede garantizarlos sin
ejecutarlo. No es una decisión pendiente del humano: se resuelve ejecutando. Por
eso la task **T13** es explícitamente **empírica** (ajustar hasta que `test:db`
pase en CI) y R15 es la red de seguridad: si el cableado está mal, `test:db` **falla en
rojo**, nunca se salta en silencio. No se acepta desactivar Ryuk ni añadir
`--passWithNoTests` para "arreglarlo": ambos están prohibidos por R17.

---

## 7. Reparto en jobs (R10..R16)

Tres jobs, **en paralelo**, sin `needs:` entre ellos. Los tres son status checks
requeridos (R22).

| Job | Pasos (en orden) | Necesita Docker | Por qué separado |
|---|---|---|---|
| `calidad` | `npm ci` → `lint` → `format:check` → `typecheck` → `test` → `build` | No | Cadena barata y rápida; el orden va de lo que falla antes y más barato a lo más caro. `build` va al final porque solo tiene sentido si el código ya tipa. |
| `base-de-datos` | `npm ci` → `test:db` | **Sí** (dind) | Es el job lento y el único con dependencia de infraestructura. Aislarlo evita que su latencia retrase el feedback de lint/typecheck, y que un fallo de infraestructura se confunda con un fallo de código. |
| `arnes` | `npm ci` → `./init.sh` | No | Verifica el **contrato del arnés**, no el código: archivos base presentes, `feature_list.json` válido, specs presentes para features `sdd` no-`pending`, barrido de secretos. Es lo que el criterio de aceptación 6 exige automatizar. |

**Paralelo y no secuencial** porque son independientes: el tiempo de pared es el
del job más lento (`base-de-datos`) en vez de la suma, y el nombre del job que
falla ya dice qué se rompió.

**Duplicación aceptada y justificada:** `./init.sh` §5 vuelve a correr `lint`,
`typecheck` y `test`, que `calidad` ya ejecuta. Se acepta a conciencia:
- `calidad` da **granularidad por paso** (se ve exactamente cuál falló) y falla
  rápido;
- `arnes` verifica el script tal y como lo ejecuta el humano — que es
  literalmente el criterio de aceptación 6;
- corren en paralelo, así que **no** añaden tiempo de pared;
- el coste es CPU duplicada durante unos segundos (85 tests deterministas).
- *Alternativa descartada:* un único job que corriera solo `./init.sh`. Ahorra
  CPU pero pierde granularidad, no cubre `build` ni `test:db`, y cualquier
  cambio futuro en `init.sh` cambiaría en silencio lo que el CI verifica.

El runner se configura con **`capacity: 3`** (**DA-6 cerrada, 2026-07-26**: se
adopta la propuesta del spec) para que los tres jobs corran de verdad en
paralelo. Tres es exactamente el número de jobs: menos serializaría el pipeline
y perdería el beneficio del reparto de §7; más no aporta nada porque no hay un
cuarto job que despachar. Sobre los recursos del host: el pico real es un solo
job pesado (`base-de-datos`, un PostgreSQL efímero vía Testcontainers) más dos
jobs de Node sin infraestructura, sobre la misma máquina local donde ya corre
el stack de desarrollo; si el host se quedara corto, el ajuste es bajar
`capacity` en `config-runner.yml` — un cambio de una línea que no toca el
workflow ni los contextos requeridos.

**Otros detalles del workflow:** `concurrency` por rama con cancelación de
ejecuciones en curso (ahorra runner sin debilitar el bloqueo: el commit más
reciente siempre se verifica); `npm ci` (no `npm install`) para respetar el
lockfile; caché de `~/.npm` por hash de `package-lock.json`.

**Acciones sin dependencia de GitHub:** las acciones se referencian con URL
completa del catálogo de Forgejo (p. ej.
`https://code.forgejo.org/actions/checkout@v4`,
`https://code.forgejo.org/actions/setup-node@v4`), coherente con "sin
dependencias externas" (PRD §11.2). Si alguna no estuviese disponible ahí, la
alternativa es sustituir el paso por comandos `run:` equivalentes, **no**
apuntar a `github.com`.

---

## 8. Versión de Node: una sola fuente (R19)

`.nvmrc` es la fuente única. El workflow usa
`setup-node` con `node-version-file: .nvmrc` y **ningún literal de versión**.
La imagen base del contenedor de job es una imagen genérica (no `node:<n>`),
para no reintroducir el número por la puerta de atrás.

El test cruza además `.nvmrc` contra `engines.node` del `package.json` raíz: si
alguien baja `.nvmrc` por debajo del rango soportado, falla en el repositorio,
antes de llegar al CI.

---

## 9. Bloqueo real: qué es código y qué es acción manual del humano (R20, R21, R22)

### 9.1 Por qué no GitHub Actions (cerrado, no se reabre)
Repositorio privado en plan Free: `GET /repos/.../branches/main/protection` y
`/rulesets` devuelven `403 Upgrade to GitHub Pro or make this repository
public`. Sin protección de rama, el pipeline **avisa pero no bloquea**, que es
precisamente lo que RF-QA1 prohíbe. Registrado en PRD §11.2 (nota del
2026-07-26) y en `note` de la feature #23. Forgejo la ofrece sin coste.

### 9.2 Lo que hace el código
`ci/forgejo/scripts/proteger-rama.sh`, idempotente, con el token de API leído de
`ci/forgejo/.env`:

- `POST/PATCH /api/v1/repos/{owner}/{repo}/branch_protections` con:
  - `branch_name` / `rule_name`: `main`
  - `enable_push: false` → sin escritura directa (R21)
  - `enable_status_check: true`
  - `status_check_contexts`: `CONTEXTOS_REQUERIDOS` = ids de los jobs (R22)
  - `block_on_outdated_branch: true` → no se fusiona una rama que no ha
    verificado el estado actual de `main`
  - `required_approvals: 0` y `enable_approvals_whitelist: false` → **DA-4
    cerrada (2026-07-26)**: el bloqueo se apoya **solo en status checks**. Con
    un único desarrollador, exigir la aprobación de un revisor bloquearía todo
    el trabajo sin aportar garantía: no hay un segundo par de ojos que la dé, y
    auto-aprobarse es un ritual vacío. RF-QA1 pide que un cambio en rojo no se
    pueda integrar, y eso lo garantizan los checks. Cuando el equipo crezca,
    subir este número es un cambio de una línea en el script.
- Se ejecuta una vez por instancia; volver a ejecutarlo converge al mismo
  estado (por eso es script y no una lista de clics: reproducible y auditable).

`CONTEXTOS_REQUERIDOS` se declara en una constante del script para que el test
de consistencia de R22 pueda leerla sin ejecutar nada.

> El nombre exacto del contexto que Forgejo publica por job (`<job>` frente a
> `<workflow> / <job>`) se confirma empíricamente en T23–T24 leyendo los status del
> primer PR de prueba, y se ajusta la constante. Un contexto mal escrito
> produciría exactamente el fallo que esta feature existe para evitar: una
> protección que no espera a nadie. Por eso `verificar-ci.sh` (§10) compara los
> contextos configurados con los **realmente publicados** por la última
> ejecución.

### 9.3 Lo que hace el humano a mano (no automatizable sin credenciales previas)

Revisado el 2026-07-26 a la luz de DA-1..DA-6. Se documenta **literal** en
`ci/forgejo/README.md` (T21). El orden importa: cada paso habilita el siguiente.

1. **Preparar el `.env`.** Copiar `ci/forgejo/.env.example` a
   `ci/forgejo/.env` y rellenarlo. Valores fijados por las decisiones cerradas:
   `FORGEJO_BIND=127.0.0.1` (DA-3), `FORGEJO_ROOT_URL=http://127.0.0.1:<puerto
   http>/`. El archivo está ignorado por git; no se versiona nunca.
2. **Levantar el stack**: `bash ci/forgejo/scripts/levantar.sh` (esto ya es
   código; se ejecuta en la **máquina local**, DA-1).
3. **Instalador inicial y usuario administrador.** Abrir
   `http://127.0.0.1:<puerto http>` → completar el instalador → botón
   **Install Forgejo** → registrar el **primer usuario, que es el
   administrador** (en Forgejo el primer usuario registrado obtiene el rol de
   administrador). Anotar usuario y contraseña en `ci/forgejo/.env`
   (`FORGEJO_ADMIN_USUARIO`, `FORGEJO_ADMIN_PASSWORD`).
   *Nota:* el registro público queda deshabilitado por configuración (R7), así
   que este es el único usuario que se crea desde la web.
4. **Token de API.** Menú del avatar → **Settings** → pestaña **Applications**
   → sección *Manage Access Tokens* / *Generate New Token* → nombre
   `ci-automatizacion` → en *Select permissions* marcar **`repository: Read and
   Write`** y **`admin: Read and Write`** → botón **Generate Token** → copiar el
   valor **en ese momento** (no se vuelve a mostrar) → pegarlo en
   `ci/forgejo/.env` como `FORGEJO_API_TOKEN`.
5. **Crear el repositorio.** Botón **`+`** (arriba a la derecha) → **New
   Migration** → tarjeta **Git** para importar desde el clon/GitHub actual, o
   **New Repository** si se prefiere subirlo con `git push`. Nombre:
   `InmobiliariaManagementSystem`. Visibilidad: **Private**.
6. **Habilitar Actions en el repositorio.** En el repositorio: **Settings** →
   pestaña **Repository** (*Advanced Settings*) → marcar la casilla
   **`Enable Repository Actions`** → botón **Update Settings**.
7. **Registrar el runner**: `bash ci/forgejo/scripts/registrar-runner.sh` (ya es
   código, no se copia ningún token a mano). Después **verificar en la UI**:
   avatar → **Site Administration** → **Actions** → **Runners** → debe aparecer
   el runner con estado **Idle** y las etiquetas configuradas.
8. **Apuntar el clon local a Forgejo (DA-2 = B2).**
   `git remote set-url origin http://127.0.0.1:<puerto http>/<usuario>/InmobiliariaManagementSystem.git`
   y `git push -u origin main`. Comprobar con `git remote -v` que **no queda
   ningún remoto de GitHub escribible**.
9. **Configurar el espejo push hacia GitHub (DA-2 = B2).** En el repositorio de
   Forgejo: **Settings** → pestaña **Repository** → sección **Mirror Settings**
   → *Add Push Mirror* → campo **Git Remote Repository URL**:
   `https://github.com/randyabm/InmobiliariaManagementSystem.git` → **Authorization**:
   usuario de GitHub y un **Personal Access Token** de GitHub con permiso de
   escritura sobre ese repositorio (no la contraseña de la cuenta) → marcar
   **Sync when new commits are pushed** → intervalo de sincronización → botón
   **Add Push Mirror**. Pulsar **Synchronize Now** una vez y confirmar en
   GitHub que el `main` coincide.
   > A partir de aquí, **GitHub es solo lectura para las personas**: no se
   > empuja a GitHub a mano bajo ninguna circunstancia (§3.1).
10. **Aplicar la protección de rama**: `bash ci/forgejo/scripts/proteger-rama.sh`
    (ya es código). **Comprobación visual del resultado:** **Settings** →
    **Branches** → *Protected Branches* → la regla `main` debe mostrar
    *Enable Status Check* activo con los contextos listados, *Enable Push*
    desactivado y *Required Approvals* en **0** (DA-4).
11. **Verificar de extremo a extremo**: `npm run ci:verificar` (T24) y la
    demostración de bloqueo de T25.

Son manuales por necesidad, no por comodidad: los pasos 3–6 y 9 exigen una
sesión autenticada en la UI y **no hay token de API hasta que existe un
administrador** (paso 4), de modo que ningún script puede hacerlos antes. Los
pasos 8 y 9 requieren además una credencial personal de GitHub que no debe
vivir en el repositorio. Todo lo que sí es automatizable (levantar, registrar,
proteger, verificar) es script.

---

## 10. Cómo se verifica esta feature (la parte difícil)

"Bloquea la integración" no se demuestra con un test de Vitest. Tres niveles,
de menor a mayor fidelidad. Ninguno es del tipo "el archivo existe".

### Nivel 1 — Tests deterministas del repositorio (en `npm run test`, suite `repo`)
Sin instancia, sin Docker. Dos archivos nuevos en `tests/`, usando `js-yaml` y
los helpers de `tests/support/repo.ts` (ambos ya existentes):

- `ci-flujo-trabajo.test.ts`: el YAML parsea; `on:` incluye `push` y
  `pull_request` sobre `main` (R9); el conjunto de scripts npm invocados cubre
  `{lint, typecheck, test, build, test:db}` (R10–R14); `./init.sh` se invoca
  (R16); **ningún** patrón de escape de fallo, comprobado en el texto y en el
  YAML parseado a nivel de job y de paso (R17); todo script invocado existe en
  su `package.json` (R18); ningún literal de versión de Node y
  `node-version-file: .nvmrc`, más `.nvmrc` ⊆ `engines.node` (R19); los ids de
  job igualan `CONTEXTOS_REQUERIDOS` de `proteger-rama.sh` (R22).
- `ci-infraestructura.test.ts`: el compose de CI existe y es un proyecto
  distinto; el compose raíz no contiene servicios de CI (R1); ninguna imagen
  con `latest` ni etiqueta vacía (R2); todo `environment:` interpolado desde
  variables, cruzado con `.env.example` (R3); datos del runner en volumen
  nombrado (R4); servicio dind presente y `DOCKER_HOST` apuntándolo (R5);
  **ninguna** aparición de `docker.sock` (R6); registro deshabilitado (R7);
  `ports:` con interfaz por variable (R8); barrido de credenciales sobre
  `ci/**` y `.forgejo/**` (R23).

**Resistencia a mutación** (el reviewer de la feature #1 verifica por mutación;
estos tests están diseñados para sobrevivir a esa auditoría). Deben fallar ante:
añadir `|| true` a un paso · añadir `continue-on-error: true` a un job ·
eliminar el paso de `test:db` · renombrar `test:db` en `package.json` sin
tocar el workflow · añadir un job sin añadirlo a los contextos requeridos ·
poner `node-version: 22` · cambiar una imagen a `latest` · montar
`/var/run/docker.sock` · escribir una contraseña literal en el compose.
**T26** exige ejecutar esa lista de mutaciones **en una copia aislada** y dejar
la tabla de resultados en `progress/impl_ci_pipeline.md`.

### Nivel 2 — Verificación contra la instancia real (`npm run ci:verificar`)
`ci/forgejo/scripts/verificar-ci.sh`, **fuera** de `npm run test` porque
requiere una instancia en marcha y credenciales (`FORGEJO_ROOT_URL`,
`FORGEJO_API_TOKEN` desde `ci/forgejo/.env`). Sale con código distinto de cero
si alguna comprobación falla:

1. `GET /api/v1/version` → la instancia responde.
2. `GET /api/v1/repos/{owner}/{repo}` → el repositorio existe y tiene Actions
   habilitado.
3. `GET /api/v1/admin/runners` (o la vista equivalente) → al menos un runner
   **online** con la etiqueta que usan los jobs.
4. `GET /api/v1/repos/{owner}/{repo}/branch_protections` → `enable_status_check`
   verdadero, `status_check_contexts` no vacío e **igual** al conjunto de jobs
   del workflow, `enable_push` falso y `required_approvals` igual a 0
   (R20, R21, R22; DA-4).
5. Contextos configurados ⊆ contextos **realmente publicados** por la última
   ejecución del workflow (`GET .../commits/{sha}/statuses`) — detecta el
   contexto mal escrito, que es el modo de fallo silencioso más probable.
6. `GET /api/v1/repos/{owner}/{repo}/push_mirrors` → existe al menos un espejo
   de tipo **push** apuntando al repositorio de GitHub (R24, DA-2 = B2).

### Nivel 3 — Demostración de extremo a extremo (evidencia, no test)
Es la única prueba honesta de "bloquea de verdad". **T25** la ejecuta y registra
la salida literal en `progress/impl_ci_pipeline.md`:

1. Rama `prueba/ci-rojo` con **un test roto a propósito** (una aserción falsa en
   un test existente, revertida al terminar; no se toca `apps/` en firme).
2. `git push` → abrir PR contra `main`.
3. Observar: el workflow corre, el job falla, y el PR muestra **la fusión
   bloqueada** (botón de merge deshabilitado / *Required status checks
   failed*). Se adjunta la salida de
   `GET /api/v1/repos/{owner}/{repo}/pulls/{n}` mostrando `mergeable: false`.
4. Intentar `git push origin main` directo → el servidor lo **rechaza** (R21).
   Se adjunta la salida literal de git.
5. Corregir el test en la rama, comprobar que el pipeline pasa a verde y que
   entonces **sí** se puede fusionar. Cerrar/eliminar la rama de prueba.

Sin los pasos 3 y 4, RF-QA1 **no está demostrado** y el reviewer debe rechazar.

---

## 11. Registro de decisiones tomadas (puerta de aprobación humana)

**No queda ninguna decisión abierta.** Las seis se cerraron en la puerta de
aprobación del **2026-07-26**. Se conservan aquí como registro auditable: qué se
decidió, quién lo decidió, por qué, y dónde vive la consecuencia en el spec.

| # | Decisión tomada | Fecha / quién | Razón | Dónde vive |
|---|---|---|---|---|
| **DA-1** | El stack de CI vive en la **máquina local**, no en ZimaOS. El compose se mantiene **agnóstico al host** para que mover a ZimaOS sea cambiar el `.env`, no rediseñar. | 2026-07-26, humano | Único host con Docker verificado; de ZimaOS solo consta CIFS. Ver §2.1: el PRD §11.2 fija ZimaOS para la orquestación de la **aplicación** y **no especifica** dónde se aloja el CI → no hay desviación del PRD. | §2, T2, T7 |
| **DA-2** | **Opción B2**: Forgejo es el origen autoritativo y GitHub queda como **espejo push** de respaldo. **Nadie empuja a GitHub**: saltaría el CI. | 2026-07-26, humano | Respaldo fuera de la máquina local sin abrir un agujero en la puerta de calidad. B1 dejaría una sola copia; B3 rompe RF-QA1. | §3, §3.1, R24 (firme), T27 |
| **DA-3** | La instancia se expone en **`127.0.0.1`**; `FORGEJO_BIND` por defecto `127.0.0.1` en `.env.example`. Puertos y `FORGEJO_ROOT_URL` por variable. | 2026-07-26, humano (adopta la propuesta del spec) | El CI corre en la misma máquina que el desarrollo: no hay ningún consumidor remoto que justifique exponerlo a la LAN, y no exponerlo elimina toda la superficie de ataque de red. Si algún día hace falta acceso remoto, se cambia una variable. | R8, §2.2, T1, T2 |
| **DA-4** | La protección de `main` se apoya **solo en status checks**, con **0 aprobaciones de revisor** (`required_approvals: 0`). | 2026-07-26, humano (adopta la propuesta del spec) | Hay un único desarrollador: exigir la aprobación de un tercero bloquearía todo el trabajo y auto-aprobarse sería un ritual vacío. RF-QA1 exige que el rojo no se integre, y eso lo garantizan los checks. | §9.2, R20, T18, T24 |
| **DA-5** | Se acepta el **contenedor privilegiado (dind)**. Se descarta montar el socket Docker del host. | 2026-07-26, humano | Riesgo asumido a conciencia: el socket del host da root en el host a código no revisado **sin necesidad de ninguna vulnerabilidad**; dind exige una fuga real del runtime y contiene el radio de daño ordinario. Análisis completo conservado en §6. | §6, R5, R6, T4, T5 |
| **DA-6** | Runner con **`capacity: 3`**. | 2026-07-26, humano (adopta la propuesta del spec) | Coincide con el número de jobs: menos serializa el pipeline, más no despacha nada. Ajustable en una línea si el host se queda corto. | §7, T6 |

### 11.1 Ambigüedades que quedan (técnicas, resolubles ejecutando)

No son decisiones de producto ni requieren al humano; se resuelven durante la
implementación y su fallo es **ruidoso**, nunca silencioso:

- Nombres exactos de las claves de cableado Testcontainers ↔ dind, dependientes
  de la versión del runner (§6). Se ajustan empíricamente en **T13**; R15
  garantiza que un cableado mal hecho deja el job **en rojo**.
- Formato exacto del contexto de status que Forgejo publica por job
  (`<job>` frente a `<workflow> / <job>`, §9.2). Se confirma en **T23–T24**
  leyendo los status reales; `verificar-ci.sh` compara configurados contra
  publicados, de modo que un contexto mal escrito se detecta.
- Versiones estables vigentes de las tres imágenes (§4): las fija el
  `implementer` al implementar y las registra en `progress/impl_ci_pipeline.md`.
  Innegociable: prohibido `latest` (R2).

---

## 12. Alternativas descartadas

1. **GitHub Actions** — descartado y cerrado (§9.1). Repositorio privado en plan
   Free: sin protección de rama (403), el CI no puede bloquear. Incumple RF-QA1.
   No se reabre sin resolver ese punto.
2. **Montar `/var/run/docker.sock` en el runner** (§6, opción A) — descartado:
   da root en el host a código no revisado. Se paga a cambio un contenedor
   privilegiado y una caché de imágenes propia.
3. **Meter Forgejo en el `docker-compose.yml` raíz** (§4) — descartado: mezcla
   ciclos de vida y dominios de fallo; un `down -v` de desarrollo borraría el
   servidor de código.
4. **Un solo job que ejecute únicamente `./init.sh`** (§7) — descartado: no
   cubre `build` ni `test:db`, pierde granularidad y hace que lo verificado por
   el CI cambie en silencio cada vez que cambie `init.sh`.
5. **PostgreSQL para Forgejo, o reutilizar el Postgres de desarrollo** (§4) —
   descartado: servicios y acoplamiento innecesarios para una instancia de un
   solo desarrollador.
6. **Fijar la versión de Node en la imagen del job** (§8) — descartado:
   duplicaría el número que ya vive en `.nvmrc` y admite que diverja en
   silencio.
7. **Hacer que `test:db` se salte los tests cuando no hay Docker** — descartado
   por D10 y por la mutación M10 de la feature #1: un verde silencioso en el
   invariante de aislamiento es peor que un rojo.
8. **Alojar el stack de CI en ZimaOS** (§2, DA-1) — descartado el 2026-07-26:
   de ZimaOS solo consta CIFS; no hay evidencia de acceso SSH ni a su daemon
   Docker, y suponerlo ya costó un bloqueo. Se conserva la reversibilidad: todo
   lo específico del host vive en `.env` (§2.2).
9. **Eliminar el remoto de GitHub (B1) o mantener dos remotos escribibles
   (B3)** (§3, DA-2) — descartados el 2026-07-26: B1 dejaría la única copia del
   código en la misma máquina que aloja el CI; B3 permite integrar por GitHub
   saltándose la protección de Forgejo, lo que **incumple RF-QA1**.
10. **Exigir aprobación de revisor en la protección de `main`** (§9.2, DA-4) —
    descartado el 2026-07-26: con un solo desarrollador bloquearía todo el
    trabajo y no añade garantía. El bloqueo lo dan los status checks.

---

## 13. Dependencias nuevas

- **Ninguna dependencia npm nueva.** Los tests usan `js-yaml` y
  `@types/js-yaml`, ya presentes como devDependencies (feature #1).
- **Infraestructura nueva** (fuera del árbol npm): imágenes de
  `forgejo`, `forgejo/runner` y `docker:dind`, con versiones fijadas (§4).
- **Script nuevo en el `package.json` raíz:** `ci:verificar` →
  `bash ci/forgejo/scripts/verificar-ci.sh`. No entra en `npm run test` porque
  exige una instancia viva; su ausencia del gate por defecto es deliberada y
  está documentada.

## 14. Errores de dominio y migraciones

- **Errores de dominio:** ninguno. Esta feature no toca `apps/` ni
  `packages/`, así que no añade ni reutiliza excepciones de dominio.
- **Migraciones de base de datos: ninguna.** No se crea ni modifica ninguna
  tabla, y por tanto **no hay ninguna migración que habilite RLS** en esta
  feature. El registro de migraciones (`0000_init.sql`, solo extensiones) queda
  intacto y `migrations.test.ts` con `TABLAS_PERMITIDAS = []` sigue verde: si el
  `implementer` creara una tabla aquí, la suite fallaría. La primera migración
  con tablas y RLS corresponde a `multitenancy_rls`, que se implementa **después**
  de esta feature por decisión del humano, precisamente para que esta puerta de
  calidad ya esté bloqueando cuando entre ese código.
