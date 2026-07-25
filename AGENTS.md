# AGENTS.md — Mapa de navegación para agentes de IA

> Este archivo es el **punto de entrada** para cualquier agente que trabaje en este
> repositorio. NO es una biblia de reglas: es un **mapa**. Lee solo lo que
> necesites cuando lo necesites (divulgación progresiva).

**Proyecto:** Sistema SaaS multi-tenant de gestión inmobiliaria (Colombia).
**Fuente de verdad del producto:** `docs/PRD.md`.

---

## 1. Antes de empezar (obligatorio)

1. Ejecuta `./init.sh` y verifica que termina sin errores. Si falla, **para**
   y resuelve el entorno antes de tocar código.
2. Lee `progress/current.md` para entender en qué estado quedó la última sesión.
3. Lee `feature_list.json`. Toda feature con `"sdd": true` pasa por
   **Spec Driven Development** — ver `docs/specs.md` y §4.
4. Lee `docs/specs.md` antes de tocar cualquier spec o feature `sdd: true`.

## 2. Mapa del repositorio

| Archivo / carpeta         | Qué contiene                                                                    | Cuándo leerlo |
|---------------------------|---------------------------------------------------------------------------------|---------------|
| `docs/PRD.md`             | **Fuente de verdad del producto.** Requisitos `RF-*`, decisiones `D1..D10`      | Antes de redactar cualquier spec |
| `feature_list.json`       | Lista de features con estado (`pending` / `spec_ready` / `in_progress` / `done` / `blocked`) | Siempre, al empezar |
| `progress/current.md`     | Estado de la sesión actual                                                      | Siempre, al empezar |
| `progress/history.md`     | Bitácora append-only de sesiones anteriores                                     | Si necesitas contexto histórico |
| `specs/<feature>/`        | `requirements.md` + `design.md` + `tasks.md` (Kiro-style)                       | Antes de implementar una feature `"sdd": true` |
| `docs/architecture.md`    | Qué significa "hacer un buen trabajo" aquí: capas, módulos, fronteras           | Antes de implementar |
| `docs/conventions.md`     | Estilo, nombres, manejo de errores, migraciones                                 | Antes de escribir código |
| `docs/specs.md`           | Proceso SDD: EARS, los 3 archivos, puerta de aprobación humana                  | Antes de redactar o leer un spec |
| `docs/verification.md`    | Cómo demostrar que funciona (tests, RLS real, offline, evals)                   | Antes de declarar una feature `done` |
| `CHECKPOINTS.md`          | Criterios objetivos de "estado final correcto" — incluye invariantes de seguridad | Para auto-evaluarte |
| `.claude/agents/`         | Subagentes: `leader`, `spec_author`, `implementer`, `reviewer`                  | Si orquestas trabajo |
| `apps/`                   | Aplicaciones: `api` (NestJS), `web` (React), `pwa` (app de campo)               | Para implementar |
| `packages/`               | Código compartido entre apps (tipos, cliente API, utilidades)                   | Para implementar |

## 3. Reglas duras (no negociables)

- **Una sola feature a la vez.** No mezcles cambios de varias features.
- **No declares una feature `done` sin `./init.sh` verde.**
- **No saltes la fase de spec.** Toda feature con `"sdd": true` pasa por
  `spec_author` y aprobación humana antes de tocar código.
- **No saltes la puerta de aprobación humana.** El leader se detiene en
  `spec_ready` y espera.
- **Todo requirement se ancla al PRD.** Cada `R<n>` de un spec debe citar el
  `RF-*` del PRD que lo origina (o justificar por qué no aplica).
- **Los invariantes de seguridad se verifican en CADA feature**, no solo en la
  que los introduce. Ver `CHECKPOINTS.md` §C7.
- **Ninguna migración de base de datos se escribe sin su test.**
- **Documenta lo que haces** en `progress/current.md` mientras trabajas.
- **Si no sabes algo, búscalo en `docs/`** antes de inventarlo. Si no está en
  `docs/` ni en `docs/PRD.md`, **pregunta al humano** — no inventes producto.

## 4. Flujo de trabajo (SDD)

```
pending → [spec_author] → spec_ready → ⏸ HUMANO → in_progress → [implementer → reviewer] → done
```

1. El leader detecta la primera feature `pending` con `"sdd": true`.
2. Lanza `spec_author`, que crea `specs/<name>/{requirements,design,tasks}.md`
   y marca el status como `spec_ready`.
3. **Pausa.** El humano lee el spec y aprueba (o pide cambios).
4. Aprobado → el leader cambia a `in_progress` y lanza `implementer`.
5. El implementer ejecuta `tasks.md` una a una, marcándolas `[x]`.
6. El reviewer verifica trazabilidad `R<n>` ↔ test, tasks completas e
   invariantes de seguridad; aprueba o rechaza.
7. Si aprueba, el implementer marca `done` y mueve el resumen a
   `progress/history.md`.

## 5. Cierre de sesión (lifecycle)

1. Ejecuta `./init.sh` — todo verde.
2. Si la feature está acabada: `status: "done"` en `feature_list.json`.
3. Mueve el resumen de `progress/current.md` al final de `progress/history.md`.
4. Vacía `progress/current.md` dejando solo la plantilla.
5. No dejes archivos temporales, `console.log` de debug, ni TODOs sin contexto.

## 6. Si te bloqueas

- Relee la sección relevante de `docs/` o del `docs/PRD.md`.
- Si la herramienta no hace lo que esperas, **no inventes un workaround**:
  documenta el bloqueo en `progress/current.md`, marca la feature `blocked`
  y para la sesión.
