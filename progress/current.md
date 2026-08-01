# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** #7 `workflow_engine` — status **`spec_ready`**
- **Agente:** leader → spec_author (3 archivos listos) → ⏸ **HUMANO**
- **Estado:** ⏸ **esperando la aprobación del spec para pasar a
  `in_progress`.** NO se toca código hasta entonces.

## Espec — `specs/workflow_engine/`

Motor de workflows dirigido por datos (RF-W1..W5, RF-A4, D3). 17
requirements (R1–R17), 27 tasks (14 de test). Siembra el ciclo de vida de
la propiedad (RF-P4) como datos: es el primer consumidor real y el test de
la aceptación. `./init.sh` verde (576 + 100 tests) antes de redactar el
spec.

## Decisiones técnicas que el humano debe confirmar (design.md §13)

1. **PA-7-1 — Plantillas del sistema con `tenant_id` reservado.** Misma
   tabla con la política RLS `USING (tenant_id = contexto OR tenant_id =
   reservado)` y `WITH CHECK` de escritura propia: cualquier tenant lee la
   plantilla, nadie escribe filas del sistema (verificado por test).
2. **PA-7-2 — Condiciones JSONB whitelisted** (`igual`, `distinto`,
   `es_nulo`, `no_nulo`, `mayor_que`, `menor_que`) evaluadas sobre el
   contexto de la instancia; sin `eval` ni SQL dinámico; operador
   desconocido = falso (fail closed).
3. **PA-7-3 — Transiciones automáticas en cascada** en la misma
   transacción de la petición, máx. 10 consecutivas → 409 `CICLO_AUTOMATICO`
   y rollback total (la humana incluida).
4. **PA-7-4 — Alcance de RF-W2:** clonar la plantilla del sistema + añadir/
   dar de baja transiciones en la copia del tenant (solo `admin`). Límites
   por paquete y versionado (RF-A5) quedan para la feature de paquetes.
   RF-W3 queda como hook declarativo (`notificacion` como dato); la
   ejecución es #10.

## Pendientes de decisión del humano (previos, no bloquean la puerta del spec)

- **El push sigue sin hacerse.** Forgejo no responde en `127.0.0.1:3000`
  (feature #23, aún sin montar). El remoto `origin` → GitHub no está
  autorizado como destino. Todo el trabajo vive en un solo disco.
- **PA-14** sigue abierta: quién da de alta una inmobiliaria y asigna su
  `codigo`. El PRD menciona el Super Admin pero no define ningún `RF-*` de
  onboarding.
- **Deudas de reviews:** #25 D-1/D-2; #26 D-3/D-4; #27 D-1/D-2/D-3; #6
  D-1/D-2/D-3.

## Cola

- **#8** `property_lifecycle` — `pending` (transiciona sobre el motor #7).
- El **portal del cliente** (RF-AU2/AU4) no existe como feature y ya bloquea
  cobertura: R18 de #26 solo pudo demostrarse por vías indirectas porque no
  hay ninguna ruta de cliente en el sistema.
