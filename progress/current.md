# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** #6 `property_profile` — status **`spec_ready`**
- **Agente:** leader → spec_author (3 archivos listos) → ⏸ **HUMANO**
- **Estado:** ⏸ **esperando la aprobación del spec para pasar a
  `in_progress`.** NO se toca código hasta entonces.

## Espec — `specs/property_profile/`

Hoja de vida del inmueble (RF-P1/P2/P3). 22 requirements (R1–R22), 28 tasks
(12 de test). Cierra la dependencia explícita que #5 dejó escrita: la
columna `propiedad.cuenta_bancaria_id` (override de giro) y su test de
integración. `./init.sh` verde (524 + 88 tests) antes de redactar el spec.

## Decisiones técnicas que el humano debe confirmar (design.md §13)

1. **PA-6-1 — Almacenamiento real en MinIO dentro de #6.** Fotos y
   repositorio documental suben a object storage (nuevo módulo
   `core/almacenamiento/`, dependencias `minio` + `@testcontainers/minio`).
   Cumple la aceptación "repositorio documental" y sirve a #12 y #18.
   (Alternativa: solo metadatos y subida diferida — la aceptación quedaría
   a medias.)
2. **PA-6-2 — Propietario principal obligatorio + propietarios adicionales
   por tabla puente.** El giro se resuelve contra el principal (integración
   directa con `resolverCuentaDeGiro` de #5); la puente cubre el plural de
   RF-P2 sin ambigüedad.
3. **PA-6-3 — Estado del ciclo de vida (#8) y creación en línea (#9) fuera
   de #6.** La ficha no inventa el motor de workflows ni los escenarios de
   ingreso.

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
