# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** #6 `property_profile` — status **`in_progress`**
- **Agente:** leader → spec_author → implementer → **reviewer (APROBADO)**
- **Estado:** ⏸ **esperando que el humano autorice marcarla `done`.**

## Estado de la verificación

`./init.sh` exit 0 — `npm run test` **576** (56 archivos) y `npm run test:db`
**100** (3 archivos). Lint, typecheck y build verdes.

28/28 tasks. Veredicto en `progress/review_property_profile.md`:
**APROBADO, sin bloqueantes**. El reviewer reprodujo cuatro mutaciones del
implementer (3/11, 3/17, 1/18, 1/18), añadió una propia de RLS (4/10) y un
test que hace carga real la guarda del propietario principal (R10).

## Espec

`specs/property_profile/` — aprobado por el humano con las tres decisiones
PA-6 (MinIO en #6; principal + puente; estado/#8 y creación en línea/#9
fuera). Cierra la dependencia #5: `propiedad.cuenta_bancaria_id` con
validación vía `resolverCuentaDeGiro`.

## Pendientes de decisión del humano (previos, no bloquean la puerta del spec)

- **El push sigue sin hacerse.** Forgejo no responde en `127.0.0.1:3000`
  (feature #23, aún sin montar). El remoto `origin` → GitHub no está
  autorizado como destino. Todo el trabajo vive en un solo disco.
- **PA-14** sigue abierta: quién da de alta una inmobiliaria y asigna su
  `codigo`. El PRD menciona el Super Admin pero no define ningún `RF-*` de
  onboarding.
- **Deudas de reviews:** #25 D-1/D-2 (tarifa); #26 D-3/D-4 (portal, token de
  login); #27 D-1/D-2/D-3 (header refresh/logout, arnés `ver: 0`, ip).

## Cola

- **#8** `property_lifecycle` — `pending` (sigue al #6 en el orden original).
- El **portal del cliente** (RF-AU2/AU4) no existe como feature y ya bloquea
  cobertura: R18 de #26 solo pudo demostrarse por vías indirectas porque no
  hay ninguna ruta de cliente en el sistema.
