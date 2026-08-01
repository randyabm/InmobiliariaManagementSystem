# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** #11 `inventory_templates` — status **`in_progress`**
- **Agente:** leader → spec_author → implementer → **reviewer (APROBADO)**
- **Estado:** ⏸ **esperando que el humano autorice marcarla `done`.**
  Meta de la sesión: **completar la fase 1** (1b + 1c + #23).

## Estado de la verificación

`./init.sh` exit 0 — `npm run test` **732** (80 archivos) y `npm run test:db`
**122** (3 archivos). Lint, typecheck y build verdes.

22/22 tasks. Veredicto en `progress/review_inventory_templates.md`:
**APROBADO, sin bloqueantes**. El reviewer reprodujo tres mutaciones del
implementer (1/10 filtro del clon — tras añadir un test que siembra una
zona inactiva y verifica el conteo crudo —, 2/15 409 del sistema, 5+ rojos
sin el OR de la política) y confirmó que el catálogo base depende de la
política de PA-11-1.

## Espec

`specs/inventory_templates/` — aprobado por el humano con las cuatro
decisiones PA-11 (tenant reservado; seed parcial; materialización en #12;
gestión solo admin). El molde del inventario queda listo para #12.

## Pendientes de decisión del humano

1. **El push sigue sin hacerse.** Forgejo no responde en `127.0.0.1:3000`
   (feature #23, aún sin montar). El remoto `origin` → GitHub no está
   autorizado como destino. Todo el trabajo vive en un solo disco.
2. **PA-14** sigue abierta: quién da de alta una inmobiliaria y asigna su
   `codigo`. El PRD menciona el Super Admin pero no define ningún `RF-*` de
   onboarding.
3. **Deudas de reviews:** #25 D-1/D-2; #26 D-3/D-4; #27 D-1/D-2/D-3; #6
   D-1/D-2/D-3; #7 D-1/D-2/D-3; #8 D-1/D-2/D-3; #9 D-1/D-2/D-3; #10
   D-1/D-2/D-3.

## Cola (meta de la sesión: completar la fase 1)

- **#11** `inventory_templates` — `pending`, siguiente (plantillas de zonas
  e ítems, RF-I2/I22/I23, §8.8).
- **#12** `inventory_creation`, **#13** `inventory_tenant_review`, **#14**
  `inventory_signature_pdf`, **#15** `pwa_offline` — inventarios (1b).
- **#16–#20** — contratos y póliza (1c).
- **#23** `ci_pipeline` — `pending` (Forgejo sin montar; bloquea el push).
- El **portal del cliente** (RF-AU2/AU4) no existe como feature y ya bloquea
  cobertura: R18 de #26 solo pudo demostrarse por vías indirectas porque no
  hay ninguna ruta de cliente en el sistema.
