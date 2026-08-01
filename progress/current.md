# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** #11 `inventory_templates` — status **`spec_ready`**
- **Agente:** leader → spec_author (3 archivos listos) → ⏸ **HUMANO**
- **Estado:** ⏸ **esperando la aprobación del spec.** Meta de la sesión:
  **completar la fase 1** (1b + 1c + #23).

## Espec — `specs/inventory_templates/`

Plantillas de inmuebles (§8.8, RF-I2/I22/I23). 15 requirements (R1–R15),
22 tasks (11 de test). Reutiliza el patrón de plantillas del sistema de #7
(tenant reservado + RLS OR/WITH CHECK). `./init.sh` verde (706 + 116 tests)
antes de redactar el spec.

## Decisiones técnicas que el humano debe confirmar (design.md §10)

1. **PA-11-1 — Plantillas del sistema con `tenant_id` reservado** (mismo
   patrón que #7): una sola tabla, la escritura de filas del sistema
   bloqueada por el motor.
2. **PA-11-2 — Seed:** APARTAMENTO con el ejemplo completo del PRD §8.8.5;
   las otras cinco (CASA/LOCAL/OFICINA/BODEGA/PARQUEADERO) como plantillas
   **sin zonas** — el PRD no las enumera y no se inventa producto.
3. **PA-11-3 — La materialización (snapshot + libertad ad-hoc) es #12**
   (RF-I24): #11 entrega el molde y su gestión.
4. **PA-11-4 — Gestión solo `admin`** (clonar/zonas/ítems); lectura
   admin/empleado. `opciones_json` solo con `field_type = 'seleccion'`.

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
