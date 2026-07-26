# CI con Forgejo — Puesta en marcha

> **IMPORTANTE:** Forgejo es el **origen autoritativo** del código. GitHub se
> usa exclusivamente como **espejo push de respaldo**. **Nunca se empuja a
> GitHub a mano** porque saltaría la puerta de calidad (no hay workflow,
> runner ni protección de rama en GitHub). `design.md` §3.1.

## Requisitos

- Docker 29+ con daemon activo
- Git

## Once pasos para levantar el CI

### 1. Preparar el `.env`

```bash
cp ci/forgejo/.env.example ci/forgejo/.env
# Editar y rellenar los valores (FORGEJO_BIND ya está en 127.0.0.1, no cambiarlo)
```

### 2. Levantar el stack

```bash
bash ci/forgejo/scripts/levantar.sh
```

Forgejo queda disponible en `http://127.0.0.1:<FORGEJO_HTTP_PORT>`.

### 3. Instalador inicial y usuario administrador

1. Abrir `http://127.0.0.1:<FORGEJO_HTTP_PORT>` en el navegador.
2. Completar el instalador web y pulsar **Install Forgejo**.
3. Registrar el **primer usuario** — será el administrador automáticamente.
4. Anotar usuario y contraseña en `ci/forgejo/.env`
   (`FORGEJO_ADMIN_USUARIO`, `FORGEJO_ADMIN_PASSWORD`).

> El registro público queda deshabilitado (R7). Este es el único usuario
> que se crea desde la web.

### 4. Token de API

1. Avatar → **Settings** → pestaña **Applications** → *Manage Access Tokens*.
2. **Generate New Token**: nombre `ci-automatizacion`.
3. Permisos: **repository: Read and Write** y **admin: Read and Write**.
4. **Generate Token** → copiar el valor **ahí mismo** (no se vuelve a mostrar).
5. Pegarlo en `ci/forgejo/.env` como `FORGEJO_API_TOKEN`.

### 5. Crear el repositorio

Botón **+** → **New Repository** → nombre `InmobiliariaManagementSystem` →
visibilidad **Private**.

### 6. Habilitar Actions

En el repositorio: **Settings** → pestaña **Repository** (*Advanced Settings*)
→ marcar **Enable Repository Actions** → **Update Settings**.

### 7. Registrar el runner

```bash
bash ci/forgejo/scripts/registrar-runner.sh
```

Verificar en la UI: avatar → **Site Administration** → **Actions** → **Runners**
→ el runner debe aparecer con estado **Idle** y las etiquetas configuradas.

### 8. Apuntar el clon local a Forgejo

```bash
git remote set-url origin http://127.0.0.1:<puerto-http>/<usuario>/InmobiliariaManagementSystem.git
git push -u origin main
git remote -v  # Debe mostrar solo Forgejo, sin GitHub escribible
```

### 9. Configurar espejo push hacia GitHub

En el repositorio de Forgejo: **Settings** → **Repository** → **Mirror Settings**
→ *Add Push Mirror*:

- **Git Remote Repository URL:**
  `https://github.com/randyabm/InmobiliariaManagementSystem.git`
- **Authorization:** usuario de GitHub y un **Personal Access Token** con
  permiso de escritura sobre ese repositorio.
- Marcar **Sync when new commits are pushed**.
- Pulsar **Synchronize Now** una vez y confirmar en GitHub que `main` coincide.

> **A partir de aquí, GitHub es solo lectura para las personas.**

### 10. Proteger la rama

```bash
bash ci/forgejo/scripts/proteger-rama.sh
```

Verificar en la UI: **Settings** → **Branches** → *Protected Branches* → la
regla `main` debe mostrar:

- *Enable Status Check:* activo con los contextos listados
- *Enable Push:* desactivado
- *Required Approvals:* **0**

### 11. Verificar de extremo a extremo

```bash
npm run ci:verificar
```

Debe imprimir `TODAS LAS VERIFICACIONES PASARON`.

## Arquitectura del CI

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Forgejo     │────▶│  forgejo-runner│────▶│  docker:dind │
│  (instancia) │     │  (capacity: 3)│     │  (privilegiado)│
└─────────────┘     └──────────────┘     └──────────────┘
       │
       │ push mirror
       ▼
┌─────────────┐
│   GitHub     │
│  (espejo)    │
└─────────────┘
```

El workflow `.forgejo/workflows/ci.yml` ejecuta 3 jobs en paralelo:

| Job | Qué verifica | Necesita Docker |
|-----|-------------|-----------------|
| `calidad` | lint → format:check → typecheck → test → build | No |
| `base-de-datos` | test:db (PostgreSQL real via Testcontainers) | Sí |
| `arnes` | ./init.sh (contrato del arnés) | No |

## Troubleshooting

- **Forgejo no arranca:** revisar `docker compose -f ci/forgejo/docker-compose.ci.yml logs forgejo`.
- **Runner no aparece:** verificar que el token de registro se generó correctamente
  y que el runner está registrado (`Site Administration > Actions > Runners`).
- **Jobs no se disparan:** comprobar que Actions está habilitado en el repositorio
  (paso 6).
- **Push directo a main funciona:** la protección de rama no está activa.
  Ejecutar `proteger-rama.sh` de nuevo (paso 10).
