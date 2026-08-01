# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** #26 `identidad_multirol_cliente` — status
  **`in_progress`**
- **Agente:** leader → spec_author → implementer → **reviewer (APROBADO)**
- **Estado:** ⏸ **esperando que el humano autorice marcarla `done`.**

## Estado de la verificación

`./init.sh` exit 0 — `npm run test` **452** (42 archivos) y `npm run test:db`
**71** (3 archivos). Verificado por el leader, no solo reportado.

31/31 tasks. Veredicto en `progress/review_identidad_multirol_cliente.md`:
**APROBADO, sin bloqueantes**. El reviewer reprodujo por su cuenta cuatro
mutaciones del implementer con números idénticos —(b) 1/452, (b+d) 2/19,
(d) 37/452, (f) 9/452— y añadió una propia, (g) revertir el arreglo del JWT,
que da 4/452.

## Lo que trajo esta feature

- La identidad se deduplica por **documento dentro de la inmobiliaria**: quien
  sea propietario e inquilino de la misma agencia es ahora una sola identidad
  con dos roles, no dos filas de `user`.
- El token declara **con qué rol se actúa**, y el rol activo restringe, nunca
  amplía (R29: un `rol_activo` incoherente con el token se rechaza con 403).
- Nombre divergente al deduplicar → **409** sin escribir nada, con cuerpo
  accionable y sin exponer el documento.
- Deuda del review de #5 cerrada: `init.sh` ahora **falla** (no advierte) si
  `DATABASE_URL` y `DATABASE_MIGRATION_URL` coinciden.

## Defecto latente corregido, perteneciente a la feature #3

`AuthModule` congelaba `JWT_SECRET` al importar el módulo, con `?? 'dev-secret'`
de reserva: la API **firmaba con un secreto y verificaba con otro**, rechazando
sus propios tokens. Invisible porque ningún test reutilizaba el token de
`POST /auth/login`. Corregido y cubierto; queda constancia en `history.md`.

## Pendiente de decisión del humano

1. **Autorizar cerrar la #26** (`done`). El leader no marca features como
   `done` por su cuenta.
2. **El push sigue sin hacerse.** Forgejo no responde en `127.0.0.1:3000` (es
   la infraestructura de la feature #23, aún sin montar). Existe un segundo
   remoto, `origin` → GitHub, que el humano **no ha autorizado** como destino.
   Todo el trabajo vive en un solo disco.
3. **PA-14** sigue abierta: quién da de alta una inmobiliaria y asigna su
   `codigo`. El PRD menciona el Super Admin pero no define ningún `RF-*` de
   onboarding.

## Cola

- **#25** `retencion_codeudor_referencias` — `spec_ready`, 27 tasks, sin
  decisiones pendientes.
- **#27** `sesion_y_revocacion` — `pending`, sin spec todavía.
- **#6** `property_profile` — `pending`, siguiente del orden original.
- El **portal del cliente** (RF-AU2/AU4) no existe como feature y ya bloquea
  cobertura: R18 de #26 solo pudo demostrarse por vías indirectas porque no
  hay ninguna ruta de cliente en el sistema.
