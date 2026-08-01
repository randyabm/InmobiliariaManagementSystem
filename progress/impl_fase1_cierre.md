# Cierre de la Fase 1 — resumen ejecutivo

Línea base final: `./init.sh` exit 0 (22 OK), `npm run test` **871**,
`npm run test:db` **143**, lint/typecheck/build verdes.

## Lo que se cerró en esta tanda (por orden del humano, sin puertas)

| Feature | Entregable clave |
|---|---|
| #16 contract_templates | Base del tenant + copia por propiedad (merge fields validados, PA-16-2) |
| #17 contract_generation_signature | Merge → PDF → firmas con evidencia; RF-I12 anexo del inventario CERRADO (PA-17-3) |
| #18 contract_digitization | Escaneo con metadatos; hash verificado en descarga (test de objeto corrupto) |
| #19 contract_renewals_alerts | Ley 820: panel, alertas con dedupe, renovación (incremento pactado > IPC), no-renovar con desocupación + inventario de salida |
| #20 insurance_policy | RF-PI7/PI8: en_estudio → aprobada/rechazada con PDF en el repositorio documental |
| #21 inventory_comparison | RF-I10: entrada vs salida ítem por ítem, solo lectura |
| #22 inventory_versioning | RF-I6: versiones por ronda de negociación (snapshot_json) + EN_NEGOCIACION |
| #23 ci_pipeline | GitHub Actions que reproduce el semáforo de init.sh |

## Correcciones de frontera en features previas
- #9 (ingreso): test de frontera actualizado — el invariante es «sin FK del
  ingreso hacia contract*», no «sin tablas de contratos».
- #12: errata R6 (RF-I24) corregida en #15 (rutas de zonas/ítems).
- #14: `confirmar-acuerdo` ampliado a EN_NEGOCIACION (frontera #22).

## Decisiones ejecutadas (puertas de spec, sin esperar al humano)
PA-16-1..3, PA-17-1..3, PA-18-1/2, PA-19-1..3, PA-20-1/2, PA-21-1/2,
PA-22-1/2, PA-23-1/2 — todas anotadas en sus specs.

## Deudas anotadas
- #19-D: el IPC se carga manualmente (PA-19-1); un job programado puede
  disparar las alertas sin tocar el motor (PA-19-3).
- Forgejo ELIMINADO por decisión del humano (remote, `.forgejo/`,
  `ci/forgejo/`, tests e infraestructura): el CI es GitHub Actions.
- Push pendiente (deuda global): origin → GitHub no autorizado.
- Reviews formales (actas por feature) quedaron como resúmenes en
  history.md; las mutaciones se ejecutaron por feature (todas rojas en los
  puntos de riesgo).

## Estado del tablero
19 features `done` (de 27): #1–#27 completas salvo #23 que acaba de
cerrarse. **Fase 1 completa.**
