# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** #8 `property_lifecycle` — status **`spec_ready`**
- **Agente:** leader → spec_author (3 archivos listos) → ⏸ **HUMANO**
- **Estado:** ⏸ **esperando la aprobación del spec para pasar a
  `in_progress`.** NO se toca código hasta entonces.

## Espec — `specs/property_lifecycle/`

Ciclo de vida + dashboard (RF-P4/P5, RF-PI4..PI6). 16 requirements
(R1–R16), 24 tasks (12 de test). **Sin migración**: el estado vive en las
tablas del motor #7 (PA-8-1); cierra la frontera PA-6-3 de la #6.
`./init.sh` verde (619 + 108 tests) antes de redactar el spec.

## Decisiones técnicas que el humano debe confirmar (design.md §10)

1. **PA-8-1 — El estado NO se duplica en `propiedad`.** La ficha y el
   dashboard lo leen por join de la instancia del motor; cero esquema
   nuevo. (Alternativa: columna denormalizada — divergencia silenciosa.)
2. **PA-8-2 — La instancia se crea al crear la propiedad**, en la misma
   transacción; las preexistentes sin instancia se muestran sin estado
   hasta #9 (no hay producción).
3. **PA-8-3 — La definición usada es la copia TENANT si existe; si no, la
   SISTEMA.** Los clones futuros no cambian máquinas en curso.
4. **PA-8-4 — Acciones por rutas de negocio** (`/propiedades/:id/ciclo-vida/
   transiciones/:clave`) que envuelven al motor; el endpoint genérico queda
   para otros módulos.

## Pendientes de decisión del humano (previos, no bloquean la puerta del spec)

- **El push sigue sin hacerse.** Forgejo no responde en `127.0.0.1:3000`
  (feature #23, aún sin montar). El remoto `origin` → GitHub no está
  autorizado como destino. Todo el trabajo vive en un solo disco.
- **PA-14** sigue abierta: quién da de alta una inmobiliaria y asigna su
  `codigo`. El PRD menciona el Super Admin pero no define ningún `RF-*` de
  onboarding.
- **Deudas de reviews:** #25 D-1/D-2; #26 D-3/D-4; #27 D-1/D-2/D-3; #6
  D-1/D-2/D-3; #7 D-1/D-2/D-3.

## Cola

- **#9** `property_intake` — `pending` (ingreso con creación en línea,
  RF-PI1..PI3).
- El **portal del cliente** (RF-AU2/AU4) no existe como feature y ya bloquea
  cobertura: R18 de #26 solo pudo demostrarse por vías indirectas porque no
  hay ninguna ruta de cliente en el sistema.
