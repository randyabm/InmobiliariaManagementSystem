# CHECKPOINTS — Evaluación del estado final

> En sistemas multi-agente no se evalúa el camino, se evalúa el destino.
> Estos son los checkpoints objetivos que un juez (humano o IA) puede usar
> para decidir si el proyecto está sano.

## C1 — El arnés está completo

- [ ] Existen los archivos base: `AGENTS.md`, `CLAUDE.md`, `init.sh`,
      `feature_list.json`, `progress/current.md`.
- [ ] Existen los docs: `docs/PRD.md`, `docs/architecture.md`,
      `docs/conventions.md`, `docs/specs.md`, `docs/verification.md`.
- [ ] `./init.sh` termina con exit code 0.

## C2 — El estado es coherente

- [ ] Como mucho **una** feature en `in_progress` en `feature_list.json`.
- [ ] Toda feature `done` tiene tests asociados que pasan.
- [ ] `progress/current.md` está vacío o describe la sesión activa
      (no contiene basura de sesiones anteriores).

## C3 — El código respeta la arquitectura

- [ ] Los módulos creados respetan las fronteras de `docs/architecture.md`
      (monolito modular; ningún módulo importa internals de otro).
- [ ] Ningún acceso a datos evade la capa de repositorio/ORM.
- [ ] No hay `console.log` de debug, ni TODOs sin contexto, ni código muerto.
- [ ] Toda dependencia nueva está justificada en el `design.md` de su feature.

## C4 — La verificación es real

- [ ] Cada módulo con lógica tiene al menos un test.
- [ ] Los tests que tocan la base de datos usan **PostgreSQL real vía
      Testcontainers**, no mocks ni SQLite (ver `docs/verification.md`).
- [ ] La suite completa corre y pasa al 100%.
- [ ] Toda migración de base de datos tiene un test que la ejercita.

## C5 — La sesión se cerró bien

- [ ] No hay archivos temporales ni artefactos fuera del `.gitignore`.
- [ ] `progress/history.md` tiene una entrada por la última sesión.
- [ ] La última feature trabajada está en su estado correcto.

## C6 — Spec Driven Development

- [ ] Toda feature con `"sdd": true` en estado `spec_ready`, `in_progress`
      o `done` tiene su carpeta `specs/<name>/` con los 3 archivos.
- [ ] `requirements.md` usa EARS estricto (ver `docs/specs.md`).
- [ ] Cada `R<n>` cita el `RF-*` del `docs/PRD.md` que lo origina.
- [ ] Toda feature `done` tiene todas sus tasks marcadas `[x]` en `tasks.md`.
- [ ] Cada `R<n>` está cubierto por al menos un test concreto.

## C7 — Invariantes de seguridad (se verifican en CADA feature)

> Estos no son features: son propiedades que deben seguir siendo ciertas
> después de **cualquier** cambio. El reviewer los comprueba siempre, aunque
> la feature en curso no los mencione. Origen: `docs/PRD.md` §11.3.

- [ ] **Aislamiento por tenant:** ningún endpoint nuevo o modificado puede
      devolver datos de otro `tenant_id`. Existe un test que lo demuestra
      contra una BD real con RLS activo.
- [ ] **RBAC en backend:** todo endpoint nuevo valida el rol en el servidor.
      No basta con ocultar la opción en el frontend.
- [ ] **Auditoría:** las acciones críticas (firmas, cambios de estado de
      workflow, accesos a documentos legales) quedan registradas.
- [ ] **Integridad documental:** los documentos firmados registran su hash
      SHA-256 y quedan inmutables.
- [ ] **Datos personales:** no se registran datos personales innecesarios en
      logs ni trazas (Ley 1581 de 2012).
- [ ] **Sin secretos en el repositorio:** ninguna credencial, API key ni
      token está hardcodeado ni commiteado.

## C8 — Calidad de las funciones de IA (solo si la feature las toca)

> Aplica a features relacionadas con el chatbot (PRD §14) o la
> interpretación de archivos de pago (PRD §15). Ver `docs/verification.md`.

- [ ] Las evaluaciones automáticas (Promptfoo) pasan.
- [ ] Existen casos que verifican las **negativas correctas** (que el modelo
      se niegue a revelar datos fuera del scope o a ejecutar acciones
      irreversibles).
- [ ] Las pruebas de *prompt injection* pasan.
- [ ] Ningún valor monetario ni dato crítico es transcrito por el modelo:
      la IA identifica estructura, el código extrae los valores.

---

**Cómo usar este archivo:** el agente revisor (`.claude/agents/reviewer.md`)
recorre cada checkbox, marca `[x]` o `[ ]`, y rechaza el cierre si quedan
boxes vacíos en C1–C7 (C8 solo cuando aplica).
