# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** #27 `sesion_y_revocacion` — status **`spec_ready`**
- **Agente:** leader → spec_author (3 archivos listos) → ⏸ **HUMANO**
- **Estado:** ⏸ **esperando la aprobación del spec para pasar a
  `in_progress`.** NO se toca código hasta entonces.

## Espec — `specs/sesion_y_revocacion/`

Cierra **PA-3** (el rol se validaba solo en la emisión del token). 20
requirements (R1–R20), 28 tasks, de las cuales 12 de test. `./init.sh` verde
(495 + 82 tests) antes de redactar el spec.

## Decisiones técnicas que el humano debe confirmar (design.md §12)

1. **PA-27-1 — Tokens sin `jti`/`ver` → 401.** Se invalidan los tokens
   fabricados o emitidos antes de esta feature. No hay producción; un token
   sin sesión es un token no revocable. (Alternativa rechazada: dejarlos
   pasar.)
2. **PA-27-2 — La revocación de rol queda como mecanismo probado por test
   con mutación directa a la base**, sin endpoint y sin auditoría de actor
   hasta que exista la feature de administración de roles (el PRD no tiene
   RF-* de administración de usuarios).
3. **PA-27-3 — Refresh de 30 días por defecto** (env configurable); access
   sigue en 1 hora.
4. **PA-27-4 — Reuso de un refresh rotado → se revoca la sesión completa**
   (estándar contra fugas, RFC 6749 §10.4).

## Pendientes de decisión del humano (previos, no bloquean la puerta del spec)

- **El push sigue sin hacerse.** Forgejo no responde en `127.0.0.1:3000`
  (feature #23, aún sin montar). El remoto `origin` → GitHub no está
  autorizado como destino. Todo el trabajo vive en un solo disco.
- **PA-14** sigue abierta: quién da de alta una inmobiliaria y asigna su
  `codigo`. El PRD menciona el Super Admin pero no define ningún `RF-*` de
  onboarding.
- **Deuda del review de #25 (D-1, D-2):** cuando exista el consumidor de la
  tarifa (módulo de pagos), reescribir el unit test con repositorio real y
  añadir el test de forma SQL para `sujetoDeRetencion`.

## Cola

- **#6** `property_profile` — `pending`, siguiente del orden original.
- El **portal del cliente** (RF-AU2/AU4) no existe como feature y ya bloquea
  cobertura: R18 de #26 solo pudo demostrarse por vías indirectas porque no
  hay ninguna ruta de cliente en el sistema.
