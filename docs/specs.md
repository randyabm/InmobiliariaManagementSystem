# Spec Driven Development (SDD)

> Flujo Kiro-style: requirements → design → tasks → code.
> El código no se escribe hasta que el spec está aprobado por un humano.

## Estructura

Cada feature con `"sdd": true` tiene una carpeta dedicada en cuanto deja
`pending`:

```
specs/<feature-name>/
├── requirements.md   # QUÉ se necesita (EARS notation)
├── design.md         # CÓMO se construirá (decisiones técnicas)
└── tasks.md          # PASOS concretos a implementar
```

El `feature-name` coincide con el campo `name` de `feature_list.json`.

## Estados de una feature

| Estado         | Significado                                                    |
|----------------|----------------------------------------------------------------|
| `pending`      | Sin spec. El `spec_author` es el primero en actuar.            |
| `spec_ready`   | Spec redactado. Esperando aprobación humana. NO se toca código.|
| `in_progress`  | Spec aprobado. `implementer` trabajando.                       |
| `done`         | Código verde, `reviewer` aprobó, sesión cerrada.               |
| `blocked`      | Atascado. Razón en `progress/current.md`.                      |

## La puerta de aprobación humana

El flujo automático se detiene **una vez**: cuando el `spec_author` termina
sus tres archivos, marca la feature como `spec_ready` y para. El humano lee
`specs/<feature>/` y dice "aprobado" (o pide cambios).

```
pending → [spec_author] → spec_ready → ⏸ HUMANO → in_progress → [implementer → reviewer] → done
```

## Anclaje al PRD (regla dura de este proyecto)

`docs/PRD.md` es la fuente de verdad del producto.

- **Cada `R<n>` DEBE citar el `RF-*` del PRD que lo origina.**
- Si un criterio de aceptación de `feature_list.json` no tiene respaldo en el
  PRD, el `spec_author` **no lo inventa**: marca la feature como `blocked` y
  pide clarificación al humano.
- Si el PRD es ambiguo, se documenta la ambigüedad en el `design.md` y se
  pregunta — no se resuelve por cuenta propia.

Formato:

```markdown
## R1 — (RF-I14)
CUANDO el empleado crea un inventario sin conexión a internet, el sistema
DEBE persistir el inventario y sus fotos en el almacenamiento local del
dispositivo.
```

## requirements.md — EARS estricto

Cada requirement es un párrafo numerado con uno de estos cinco patrones:

| Patrón         | Plantilla                                                   |
|----------------|-------------------------------------------------------------|
| **Ubicuo**     | `El sistema DEBE <acción>.`                                 |
| **Evento**     | `CUANDO <disparador>, el sistema DEBE <acción>.`            |
| **Estado**     | `MIENTRAS <estado>, el sistema DEBE <acción>.`              |
| **Opcional**   | `DONDE <feature opcional>, el sistema DEBE <acción>.`       |
| **No deseado** | `SI <evento no deseado> ENTONCES el sistema DEBE <acción>.` |

Reglas duras:

- Cada requirement tiene un id estable: `R1`, `R2`, ...
- Cada requirement cita su `RF-*` de origen.
- Cada requirement DEBE ser verificable por al menos un test concreto.
- No mezcles varios `DEBE` en un requirement. Si hay más de uno, pártelo.
- No uses verbos blandos ("podría", "puede", "soporta"). Solo `DEBE`/`NO DEBE`.

### Requirements de seguridad obligatorios

Toda feature que exponga datos o endpoints **DEBE** incluir, además de sus
requirements funcionales, al menos estos dos — no son opcionales:

```markdown
## Rn — (RF-A1) aislamiento
SI una petición autenticada en el tenant A solicita un recurso del tenant B
ENTONCES el sistema DEBE responder 404 sin revelar su existencia.

## Rn+1 — (RF-C3) autorización
SI un usuario sin el rol requerido invoca el endpoint ENTONCES el sistema
DEBE rechazar la petición en el backend con 403.
```

## design.md — decisiones técnicas

Captura **antes** de tocar código:

- Qué archivos y módulos se crean o modifican.
- Qué firmas nuevas aparecen (servicios, endpoints, tipos).
- Qué migraciones de base de datos se necesitan, y si habilitan RLS.
- Qué errores de dominio se reutilizan o se añaden.
- Qué alternativa se descartó y por qué (mínimo una).
- Qué dependencia nueva se introduce y por qué (si aplica).

NO es ingeniería desde primeros principios — apóyate en
`docs/architecture.md` y `docs/conventions.md`. El `design.md` documenta los
puntos donde la feature roza la frontera de esas reglas.

## tasks.md — checklist ejecutable

Pasos discretos en orden, cada uno con checkbox y los `R<n>` que cubre.

```markdown
- [ ] T1 — Migración `add_property_table` con RLS habilitado. Cubre: R1, R5.
- [ ] T2 — `PropertyRepository.findById` con contexto de tenant. Cubre: R1.
- [ ] T3 — Endpoint `GET /properties/:id` con guard de rol. Cubre: R2, R6.
- [ ] T4 — Test de aislamiento con Testcontainers. Cubre: R5.
- [ ] T5 — Test de rechazo por rol no autorizado. Cubre: R6.
```

El `implementer` marca `[x]` cada task al completarla. El `reviewer` rechaza
si queda alguna `[ ]` sin justificación documentada.

## Trazabilidad (regla dura)

- Cada test debe poder mapearse a un `R<n>` de su spec.
- Cada `R<n>` debe tener al menos un test concreto.
- El `reviewer` comprueba la correspondencia explícitamente y rechaza si falta.

El `implementer` documenta el mapa en `progress/impl_<name>.md`:

```markdown
## Trazabilidad
- R1 (RF-P1) → `crea propiedad con los campos de la hoja de vida`
- R5 (RF-A1) → `no devuelve propiedades de otro tenant`
- R6 (RF-C3) → `rechaza a un inquilino que consulta el panel admin`
```
