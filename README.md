# Sistema de Gestión Inmobiliaria

Plataforma SaaS multi-tenant para inmobiliarias: propiedades, propietarios,
arrendatarios, inventarios, contratos y workflows configurables.
Mercado inicial: **Colombia**.

> **Fuente de verdad del producto:** [`docs/PRD.md`](docs/PRD.md).
> **Cómo se trabaja aquí:** [`AGENTS.md`](AGENTS.md).

## Cómo está organizado el arnés

Este repositorio aplica **Harness Engineering**: está estructurado para que
un agente de IA trabaje de forma autónoma y verificable.

| Pilar | Manifestación |
|---|---|
| **El repositorio ES el sistema** | `AGENTS.md`, `init.sh`, `feature_list.json`, `specs/`, `progress/`, `docs/` |
| **Orquestación multi-agente** | `.claude/agents/`: `leader`, `spec_author`, `implementer`, `reviewer` |
| **Spec Driven Development** | `docs/specs.md` — EARS, anclaje al PRD, aprobación humana en `spec_ready` |
| **Supervisión y mejora** | `CHECKPOINTS.md` (incluye invariantes de seguridad), `init.sh` |

## Para empezar

```bash
./init.sh
```

En fase 0 (sin código todavía) debe terminar verde omitiendo build y tests.
Si está verde, abre `AGENTS.md` y sigue desde ahí.

## Flujo de trabajo

```
pending → [spec_author] → spec_ready → ⏸ HUMANO → in_progress → [implementer → reviewer] → done
```

1. Abre Claude Code en la raíz del repo — `CLAUDE.md` te pone en rol `leader`.
2. Pide: **«implementa la siguiente feature pendiente»**.
3. El `spec_author` escribe `specs/<feature>/{requirements,design,tasks}.md`
   y **para**.
4. Lees el spec en tu editor y dices **«aprobado»** (o pides cambios).
5. El `implementer` ejecuta las tasks; el `reviewer` valida trazabilidad,
   tasks e **invariantes de seguridad**.

Todo el trabajo de los subagentes queda **en disco** (`specs/`, `progress/`),
no en el chat.

## Stack

| Capa | Tecnología |
|---|---|
| Backend | NestJS + TypeScript (monolito modular) |
| Base de datos | PostgreSQL + Row-Level Security por `tenant_id` |
| Frontend | React + TypeScript |
| App de campo | PWA offline (Service Worker + IndexedDB) |
| Object storage | MinIO (S3-compatible) |
| Colas | BullMQ (Redis) |
| PDF | Puppeteer |
| Pruebas | Vitest, Supertest, Testcontainers, Playwright |
| Evals de IA | Promptfoo, Langfuse |
| Orquestación | Docker Compose (self-hosted) |

Justificación de cada decisión: `docs/PRD.md` §11 (`D1`..`D10`).

## Invariantes de seguridad (no negociables)

Se verifican en **cada** feature, no solo en la que los introduce
(`CHECKPOINTS.md` §C7):

- Aislamiento por `tenant_id` forzado por PostgreSQL (RLS), verificado con
  tests contra una base de datos real.
- RBAC validado en el backend, nunca solo ocultado en el frontend.
- Auditoría inmutable de acciones críticas.
- Integridad de documentos firmados (hash SHA-256).
- Sin secretos en el repositorio.

## Estructura

```
.
├── AGENTS.md              # Mapa para agentes (divulgación progresiva)
├── CLAUDE.md              # Rol obligatorio: leader
├── CHECKPOINTS.md         # Criterios de "estado final correcto"
├── feature_list.json      # Alcance: una feature a la vez
├── init.sh                # Verificación e inicialización
├── docs/
│   ├── PRD.md             # Fuente de verdad del producto
│   ├── architecture.md    # Fronteras: módulos, capas, multi-tenancy
│   ├── conventions.md     # Estilo, nombres, errores, migraciones
│   ├── specs.md           # Proceso SDD + anclaje al PRD
│   └── verification.md    # Cómo demostrar que funciona
├── specs/<feature>/       # requirements.md + design.md + tasks.md
├── progress/              # current.md (sesión viva) + history.md
├── .claude/agents/        # leader, spec_author, implementer, reviewer
├── apps/                  # api (NestJS), web (React), pwa (campo)
└── packages/              # código compartido
```
