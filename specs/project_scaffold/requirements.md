# Requirements — `project_scaffold` (feature #1, fase 1a)

> **Título:** Andamiaje del monorepo y stack base
> **`prd_refs`:** `D1`, `D2`, `docs/PRD.md` §11.2
> **Notación:** EARS estricto (ver `docs/specs.md`).
> **Estado:** `spec_ready` — pendiente de aprobación humana.

## Alcance

Esta feature construye **el esqueleto ejecutable** del sistema: monorepo,
apps `api` y `web`, paquete compartido de tipos, tooling de calidad
(lint / typecheck / test), stack local declarado en `docker-compose`,
infraestructura de migraciones versionadas y un healthcheck con su test de
humo.

**No** implementa dominio, ni tenants, ni RLS, ni autenticación: esas llegan
en las features #2 (`multitenancy_rls`), #3 (`auth_rbac`) y #4 (`audit_log`).

## Trazabilidad con `feature_list.json`

| Criterio de aceptación                                                   | Requirements |
|--------------------------------------------------------------------------|--------------|
| 1. Monorepo con `apps/api` (NestJS+TS) y `apps/web` (React+TS)            | R1, R2, R3, R4, R5 |
| 2. `docker-compose` con PostgreSQL, Redis y MinIO                        | R8, R9 |
| 3. Scripts `lint`, `typecheck` y `test` definidos y verdes                | R6, R7, R19 |
| 4. Migración inicial versionada y comando para aplicarla                 | R10, R11, R12 |
| 5. Test de humo que arranca la API y responde al healthcheck             | R13, R14 |
| Invariantes de seguridad (`CHECKPOINTS.md` §C7, PRD §11.3)               | R15, R16, R17, R18 |

---

## Requirements funcionales

### R1 — (PRD §11.2 · D1)
El sistema DEBE organizarse como un único repositorio con workspaces que
contenga, como mínimo, los paquetes `apps/api`, `apps/web` y
`packages/types`.

*Verificable por:* test estructural que lee el manifiesto raíz y comprueba
que los tres workspaces están declarados y resueltos por el gestor de
paquetes.

### R2 — (PRD §11.2 · D1)
El sistema DEBE proveer en `apps/api` una aplicación NestJS escrita en
TypeScript cuyo código de dominio resida bajo `src/modules/`, con el módulo
`core/` presente desde el inicio.

*Verificable por:* test de arranque que instancia el módulo raíz de NestJS y
test estructural que comprueba la existencia de `src/modules/core/`.

### R3 — (PRD §11.2)
El sistema DEBE proveer en `apps/web` una aplicación React escrita en
TypeScript que compile a un bundle de producción mediante su script de
build.

*Verificable por:* ejecución del build de `apps/web` en CI/local con código
de salida 0 y test de componente que renderiza el shell de la aplicación.

### R4 — (`docs/architecture.md` "packages/types" · `docs/conventions.md` "TypeScript")
El sistema DEBE exponer los tipos compartidos entre backend y frontend desde
`packages/types`, importables por `apps/api` y `apps/web` mediante el alias
del workspace y no por rutas relativas que crucen paquetes.

*Verificable por:* test de tipos/typecheck que importa un tipo desde
`@inmobiliaria/types` en ambas apps y falla si el alias no resuelve; regla de
ESLint que prohíbe imports relativos fuera del propio paquete.

### R5 — (`docs/conventions.md` "TypeScript")
Todo workspace del monorepo DEBE compilar con `strict: true` en su
configuración de TypeScript.

*Verificable por:* test que lee la configuración efectiva de TypeScript de
cada workspace y asegura `strict === true`.

### R6 — (PRD §16.2 · RF-QA1)
El sistema DEBE definir en la raíz del monorepo los scripts `lint`,
`typecheck` y `test`, y los tres DEBEN terminar con código de salida 0 sobre
el proyecto recién andamiado.

*Verificable por:* `./init.sh` sección 5, que ejecuta los tres scripts y
falla si alguno devuelve código distinto de 0.

### R7 — (RF-QA1)
SI un archivo del monorepo viola una regla de ESLint configurada ENTONCES el
script `lint` DEBE terminar con un código de salida distinto de 0.

*Verificable por:* test que ejecuta ESLint programáticamente sobre un
fragmento de código que viola una regla activa y comprueba que se reporta al
menos un error de severidad 2. (Impide el falso verde de un `lint` que no
analiza nada.)

### R8 — (PRD §11.2 · D6)
El sistema DEBE versionar en el repositorio un archivo `docker-compose.yml`
que declare los servicios PostgreSQL, Redis y MinIO con etiquetas de imagen
fijadas explícitamente (nunca `latest`).

*Verificable por:* test que parsea el YAML y comprueba la presencia de los
tres servicios y que ninguna imagen usa la etiqueta `latest`.

### R9 — (PRD §11.3 · `CHECKPOINTS.md` §C7 "sin secretos")
El `docker-compose.yml` NO DEBE contener credenciales literales: todo valor
sensible DEBE tomarse de variables de entorno con un `.env.example` de
referencia sin valores reales.

*Verificable por:* test que comprueba que los campos de credenciales de los
tres servicios son interpolaciones `${VAR}` y que existe `.env.example` con
esas claves y valores placeholder; refuerzo en `./init.sh` sección 4.

### R10 — (PRD §11.2 "ORM / migraciones" · `docs/conventions.md` "Base de datos y migraciones")
El sistema DEBE incluir una migración inicial versionada en SQL, almacenada
en el repositorio, y un script `db:migrate` que la aplique contra la base de
datos indicada por la variable de entorno de conexión.

*Verificable por:* test estructural que comprueba la existencia del archivo
de migración y del script; test de aplicación real contra PostgreSQL
(Testcontainers) que pertenece a la suite `test:db` y se ejercita de forma
obligatoria en la feature #2 (ver R19 y `design.md` §9).

### R11 — (`docs/conventions.md` "Toda tabla de negocio nueva debe habilitar RLS en la misma migración que la crea" · D2)
La migración inicial NO DEBE crear ninguna tabla de negocio; DEBE limitarse a
preparar el esquema base (extensiones y metadatos de migración).

*Verificable por:* test que lee el SQL de la migración inicial y falla si
contiene una sentencia `CREATE TABLE` fuera de la lista permitida. (Evita
introducir tablas sin RLS antes de la feature #2, que es la que habilita RLS.)

### R12 — (`docs/conventions.md` "migraciones hacia adelante; nunca se edita una migración aplicada")
El registro de migraciones DEBE estar versionado y ordenado sin huecos ni
duplicados, y cada entrada del registro DEBE corresponder a un archivo SQL
existente en el repositorio.

*Verificable por:* test que compara el journal de migraciones con el
contenido del directorio y falla ante entradas huérfanas, archivos no
registrados o índices repetidos.

### R13 — (PRD §7 "Disponibilidad" · §16.2 RF-QA1)
CUANDO un cliente hace `GET /health`, el sistema DEBE responder `200` con un
cuerpo JSON que incluya `status: "ok"` y la versión de la aplicación.

*Verificable por:* test de humo con Supertest que arranca la aplicación
NestJS real y comprueba código y forma de la respuesta.

### R14 — (PRD §7 "Disponibilidad")
SI PostgreSQL, Redis o MinIO no están disponibles ENTONCES `GET /health` DEBE
responder `200` sin intentar conectarse a ellos.

*Verificable por:* test de humo ejecutado en un entorno sin esos servicios
levantados (el caso real de esta máquina), que comprueba que la respuesta
sigue siendo `200` y que no se abre ninguna conexión externa. La sonda de
dependencias (`/health/ready`) se difiere a la feature #2.

---

## Requirements de seguridad obligatorios

> `docs/specs.md` exige los patrones de aislamiento por tenant y autorización
> por rol en toda feature que exponga endpoints. En este andamiaje **todavía
> no existen tenants, roles ni recursos de negocio**, por lo que los dos
> requirements obligatorios se expresan en su forma verificable hoy: la
> superficie expuesta no puede filtrar nada ni admitir accesos no previstos.
> La forma canónica (`tenant A pide recurso de tenant B → 404` y
> `rol insuficiente → 403`) es **requisito de las features #2 y #3**, y así
> queda registrado en `design.md` §11.

### R15 — (RF-A1 · PRD §11.3 "aislamiento") aislamiento
SI un cliente invoca `GET /health` ENTONCES el sistema DEBE responder
únicamente con campos de estado (`status`, `version`, `uptime`) y NO DEBE
incluir datos de negocio, identificadores de tenant, variables de entorno,
cadenas de conexión ni versiones de dependencias de infraestructura.

*Verificable por:* test que compara el conjunto de claves de la respuesta
contra una lista blanca exacta y falla ante cualquier clave adicional.

### R16 — (RF-A1 · RF-C3 · PRD §11.3 "RBAC en backend") superficie autorizada
El sistema NO DEBE exponer ninguna ruta HTTP fuera de la lista blanca pública
(`GET /health`), y SI un cliente solicita una ruta no registrada ENTONCES el
sistema DEBE responder `404` con un cuerpo de error en español y sin traza de
pila.

*Verificable por:* test que enumera las rutas registradas en el router de
NestJS y las compara con la lista blanca; test con Supertest sobre una ruta
inexistente que comprueba `404`, mensaje en español y ausencia de `stack` en
el cuerpo.

### R17 — (PRD §11.3 · `CHECKPOINTS.md` §C7 "sin secretos en el repositorio")
SI falta una variable de entorno requerida ENTONCES la aplicación DEBE
abortar el arranque con un error de dominio explícito que nombre la variable
ausente y NO DEBE arrancar con un valor por defecto inseguro.

*Verificable por:* test que instancia la validación de configuración sin la
variable requerida y espera la excepción de configuración con el nombre de la
variable en el mensaje.

### R18 — (D7 · RF-INT4 · `docs/architecture.md` "CORS por dominio de tenant")
El sistema NO DEBE habilitar CORS con origen comodín (`*`); los orígenes
permitidos DEBEN leerse de configuración como lista explícita.

*Verificable por:* test que inspecciona la configuración de CORS aplicada a
la app y falla si el origen es `*` o si la lista se resuelve a "cualquier
origen".

---

## Requirements de proceso de verificación

### R19 — (D10 · PRD §16.2 · `docs/verification.md` Nivel 2)
SI Docker no está disponible en la máquina ENTONCES la suite de tests que
requiere PostgreSQL real DEBE omitirse informando explícitamente el motivo,
mientras la suite sin dependencias DEBE ejecutarse y reportar su resultado.

*Verificable por:* test/ejecución de `npm run test` en esta máquina (sin
Docker) que termina en 0 y muestra la suite de base de datos como omitida con
motivo; y `npm run test:db` que falla de forma explícita si se invoca sin
Docker, en vez de reportar verde. (Impide que la ausencia de Docker se
confunda con "no hay nada que probar".)

---

## Fuera de alcance (registrado para no inventarlo aquí)

- Entidad `Tenant`, `tenant_id`, políticas RLS y test de aislamiento real →
  feature #2 `multitenancy_rls`.
- JWT, roles, guards y respuestas `403`/`404` por tenant → feature #3
  `auth_rbac`.
- Tabla de auditoría append-only → feature #4 `audit_log`.
- Pipeline de CI en Gitea Actions/Forgejo (RF-QA1): no figura en los
  criterios de aceptación de esta feature; ver decisión abierta en
  `design.md` §11.
