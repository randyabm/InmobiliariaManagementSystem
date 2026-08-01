# Requirements — inventory_tenant_review

> Feature #13. Revisión del inventario por el inquilino.
> Anclaje al PRD: **RF-I4** (link único seguro con expiración), **RF-I5**
> (aceptación/objeción por ítem con comentario y foto), **RF-AU2
> (actualizado)** (cuenta persistente del inquilino: registro con
> email/teléfono + verificación), **RF-AU5** (el link lleva a crear cuenta,
> no a acceso anónimo), **RF-AU3** (OTP antes de la firma — infraestructura
> entregada aquí, consumida por #14), **RF-C3** (scoping por rol), **D2**.

Notación EARS estricta (`docs/specs.md`). Un solo `DEBE` por requirement.

## Dependencias

- **#12 `inventory_creation` (done):** el inventario en `BORRADOR` que esta
  feature envía a `ENVIADO` y revisa.
- **#10 `notifications` (done):** el OTP y los avisos se entregan por el
  motor (canal del perfil, RF-C4).
- **#5/#26 (done):** el perfil del inquilino y la deduplicación de
  identidad para crear la cuenta persistente.

## Fronteras explícitas (qué NO es de #13)

- **Firma y PDF (RF-I8/I9/I12):** feature **#14**. #13 entrega el OTP
  (solicitar/verificar) como mecanismo; #14 lo exige en la firma.
- **Versionado de la negociación (RF-I6):** #22. La revisión aquí es una
  sola ronda (aceptar/objetar).
- **Comparación entrada/salida (RF-I10):** #21.

---

## Grupo A — Invitación y cuenta persistente (RF-I4, RF-AU2, RF-AU5)

### R1 — (RF-I4) Generar la invitación

CUANDO un usuario con rol `admin` o `empleado` envía
`POST /inventarios/:id/invitaciones`, el sistema DEBE generar un token
único (48 bytes de entropía), guardar SOLO su hash SHA-256 con
`inventario_id`, `perfil_inquilino_id`, `expira_en` (72 h) y `usada_en`
NULL, y responder 201 con la URL de invitación. El token en claro solo
existe en la respuesta.

### R2 — (RF-I5, RF-I7) El envío pone el inventario en revisión

CUANDO la invitación se genera, el sistema DEBE transicionar el inventario
de `BORRADOR` a `ENVIADO` (misma transacción) y registrar la transición en
`audit_log`. SI el inventario no está en `BORRADOR` ENTONCES el sistema
DEBE responder 409 sin cambiar nada.

### R3 — (RF-AU2, RF-AU5) La invitación lleva a crear cuenta, no a acceso anónimo

CUANDO se consume la invitación por primera vez, el sistema DEBE presentar
el flujo de **creación de cuenta persistente** del inquilino (nombre,
documento, email o celular, contraseña) con verificación por OTP
(R4/R5), y NO DEBE otorgar acceso anónimo de una sola vez. SI el
inquilino ya tiene cuenta, el flujo DEBE pedir el login y vincular la
invitación.

### R4 — (RF-AU2) Solicitar el OTP

CUANDO el registro (o el login) lo solicita, el sistema DEBE generar un
código OTP de 6 dígitos, guardar su hash con `expira_en` (10 min) y
entregarlo por el motor de notificaciones (#10) al canal preferido del
perfil (RF-C4). El código en claro DEBE ir solo en la notificación.

### R5 — (RF-AU2) Verificar el OTP

CUANDO se envía `POST /auth/otp/verificar` con el código, el sistema DEBE
verificar el hash y la expiración (401 uniforme si falla, sin distinguir
motivo) y marcar la verificación como usada; SI es la verificación del
registro, DEBE crear la cuenta persistente del inquilino y emitir su
sesión (flujo #27).

### R6 — (RF-I5) Revisar cada ítem

CUANDO un usuario con rol `inquilino` autenticado invoca
`POST /inquilino/inventarios/:id/items/:idItem/revision` con
`{ respuesta: 'ACEPTADO' | 'OBJETADO', comentario?, foto? }`, el sistema
DEBE registrar la respuesta en `inventario_item_revision` con actor,
timestamp y (si objeta) comentario **obligatorio**; la foto del inquilino
(opcional) se sube a object storage con `autor = 'INQUILINO'` (#12 R3).
SI la revisión se envía sin comentario al objetar ENTONCES el sistema DEBE
responder 400 sin escribir nada.

### R7 — (RF-I5) El inventario se revisa completo

CUANDO todos los ítems del inventario tienen revisión, el sistema DEBE
transicionar a `EN_REVISION_COMPLETA`?? — NO: el estado del §8.7 es
`EN_REVISION` desde el envío; CUANDO el inquilino ha respondido todos los
ítems ENTONCES el sistema DEBE marcar `revision_completada_en` en el
inventario y notificar al empleado (#10, hook declarativo). La negociación
(EN_NEGOCIACION) y el acuerdo son de #14/#22.

### R8 — (RF-AU3) OTP antes de la firma (infraestructura)

CUANDO #14 lo solicite, el sistema DEBE poder exigir un OTP recién
verificado (marca `otp_firma_verificado` o un OTP con propósito
`FIRMA`); #13 entrega los endpoints (R4/R5 con propósito `FIRMA`) y la
frontera queda anclada para #14.

---

## Grupo B — Invariantes de seguridad (obligatorios, `docs/specs.md`)

### R9 — (RF-C3) Un inquilino solo ve su inventario

CUANDO una petición con rol `inquilino` consulta o revisa un inventario,
el sistema DEBE limitarla a los inventarios cuyo `perfil_inquilino_id`
coincide con el perfil del usuario autenticado (404 si no). SI una
petición de otro tenant intenta cualquier operación ENTONCES 404 sin
revelar existencia. Las rutas de invitación (R1) y de gestión son
solo `admin`/`empleado`.

### R10 — (RF-C3, `docs/architecture.md`) Sin contexto de tenant, falla

SI un repositorio de esta feature se ejecuta sin contexto de tenant
establecido ENTONCES el sistema DEBE fallar con `SinContextoDeTenantError`.

### R11 — (RF-W4, §11.3, Ley 1581) Auditoría y PII

CUANDO se genera una invitación, se verifica un OTP o se registra una
revisión, el sistema DEBE registrar la entrada en `audit_log` con
`tenant_id`, `actor_id`, `accion`, `entity_type` y `entity_id`, con
`metadata` vacío; los códigos OTP, los tokens y los comentarios NO DEBEN
aparecer en logs ni en `audit_log.metadata`.

### R12 — (RF-I4, RF-I5) Token y código OTP solo como hash

EL sistema NO DEBE almacenar en la base, ni escribir en logs, el token de
invitación ni el código OTP en claro: solo sus hashes SHA-256.

---

## Grupo C — Gobernanza del cambio

### R13 — (D2, `docs/conventions.md`, C4/C6) Migración versionada y listas al día

EL sistema DEBE aplicar los cambios de esquema en una única migración
versionada, forward-only e idempotente (previsiblemente
`0017_inventory_tenant_review.sql`), y `TABLAS_PERMITIDAS` (+3:
`invitacion_inventario`, `codigo_otp`, `inventario_item_revision`),
`RUTAS_PERMITIDAS` (+7) y el inventario de funciones SECURITY DEFINER
(+1: `invitacion_por_token`, patrón R52) DEBEN actualizarse en el mismo
cambio.

---

## CRITERIOS DE ACEPTACIÓN del humano (feature_list.json #13)

| Criterio | R que lo satisface |
|---|---|
| Se genera un link de invitación seguro con expiración que lleva a crear cuenta persistente, no a acceso anónimo | R1, R3 |
| El inquilino acepta u objeta cada ítem individualmente; al objetar el comentario es obligatorio | R6 |
| El inquilino puede adjuntar su propia foto al objetar | R6 |
| Verificación de identidad mínima (OTP) antes de firmar | R4, R5, R8 |
| Un inquilino no puede acceder al inventario de otro | R9 |

## DECISIONES que el humano confirma en la puerta del spec

| Id | Pregunta | Decisión propuesta | Motivo |
|---|---|---|---|
| **PA-13-1** | ¿El flujo de la invitación crea cuenta con contraseña o sin ella? | **Con contraseña + OTP** (R3-R5): la cuenta persistente de RF-AU2 se crea con email/celular verificado por OTP y contraseña; el login posterior es el estándar #27 | RF-AU2 actualizado exige cuenta persistente |
| **PA-13-2** | ¿La revisión es una sola ronda? | **Sí** (R7): aceptar/objetar por ítem; la negociación multironda (RF-I6) es #22 | La aceptación de #13 no menciona rondas |
| **PA-13-3** | ¿El OTP se entrega por #10? | **Sí** (R4): el código se encola por el motor de notificaciones al canal preferido | Reutiliza lo construido; sin SMTP real el ProveedorRegistro persiste la entrega |
| **PA-13-4** | ¿La búsqueda de la invitación por token? | Función `SECURITY DEFINER` `invitacion_por_token(hash)` (4ª vía, patrón R52/R18) que devuelve solo el bootstrap; el resto se revalida dentro del RLS | El token se consume sin sesión y sin tenant conocido; es el patrón ya consolidado |

**No quedan preguntas de producto abiertas** (las cuatro decisiones quedan
explícitas para la puerta del spec).
