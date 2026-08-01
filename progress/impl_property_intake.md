# Implementación — feature #9 (`property_intake`)

**Status:** implementación completa, a la espera del review. Suite: `npm run
test` **674** (70 archivos) + `npm run test:db` **108** (3 archivos). Lint,
typecheck y build verdes. **Sin migración** (R13).

## Mapa de trazabilidad R1–R14 → test concreto

| R | Enunciado (resumen) | Test que lo cubre |
|---|---|---|
| R1 | Escenario A: propietario en línea + ficha + `disponible` | `ingreso.api.test.ts` T8 (201 + SELECTs) |
| R2 | Escenario B: + inquilino + ocupación + `arrendada` | `ingreso.api.test.ts` T10 (SELECT de perfil, ocupación, log de 3) |
| R3 | Propietario: reutilizar por documento o crear; 409 por nombre | `ingreso.api.test.ts` T9/T11 + `ingreso.service.test.ts` T19 |
| R4 | Inquilino: mismo criterio | `ingreso.api.test.ts` T10 (reutilización) |
| R5 | Escenario B sin inquilino → 400 | `ingreso.api.test.ts` T12 |
| R6 | Ingreso atómico | `ingreso.api.test.ts` T13 (cadena bloqueada → rollback total con SELECTs) + unit T19 |
| R7 | Estado final correcto | `ingreso.api.test.ts` T8/T10 (SELECT de la instancia) |
| R8 | Auditoría explícita del servicio | `ingreso-seguridad.api.test.ts` T16 (entradas por mutación) + unit T19 |
| R9 | Cadena en el log del motor | `ingreso.api.test.ts` T10 (3 filas) |
| R10 | 404 cross-tenant, 403/401 | `ingreso-seguridad.api.test.ts` T14/T15 |
| R11 | Sin contexto falla | heredado (#7 R15, `workflows-rls.test.ts`) |
| R12 | PII fuera de audit_log y logs | `ingreso-seguridad.api.test.ts` T17 |
| R13 | Sin esquema nuevo; RUTAS_PERMITIDAS +1 | `routes-surface.test.ts` + guard DDL |
| R14 | Sin templates ni contratos | `ingreso-seguridad.api.test.ts` T18 (sin tablas `contract%`) |

**Anclaje al PRD:** R1–R14 citan RF-PI1..PI3, RF-PI2/RF-C6, RF-P4, RF-W4,
RF-C3, D2, §11.3. Ningún requirement sin origen.

## Decisiones PA-9 ejecutadas (aprobadas en la puerta del spec)

- **PA-9-1/PA-9-2 — Fronteras #16/#18 respetadas:** el ingreso no exige ni
  crea templates ni contratos (T18: ni existen las tablas); cuando #16/#18
  existan, extenderán el flujo (R14).
- **PA-9-3 — Reutilización con comparación de nombre:** `ResolverPerfilService`
  usa `nombresCoinciden` de #26; divergente → 409 `NOMBRE_NO_COINCIDE_CON_IDENTIDAD`
  sin escribir nada (T11).
- **PA-9-4 — Atomicidad:** todo en la transacción de la petición; la cadena
  del escenario B por claves (camino de #8) y, si la copia del tenant la
  bloquea, 409 `TRANSICION_NO_DISPONIBLE` con rollback total (T13).

## Desviaciones anotadas (todas en el spec o menores)

1. **Sin `@Audit` en el controller del ingreso**: las mutaciones ocurren
   dentro del servicio y se auditan explícitamente (R8); un decorador habría
   duplicado la entrada de la propiedad. Documentado en el controller.
2. **La cadena del escenario B se resuelve por claves con
   `TransicionNoDisponibleError`** (409) cuando la personalización del
   tenant la bloquea: la excepción de dominio del motor, reutilizada.
3. **`ResolverPerfilService`** es un servicio aparte (no un helper suelto)
   para poder inyectarlo y testearlo con dobles.

## Candidatas a mutación (para el reviewer)

1. Quitar la comparación de nombre en `resolver-perfil` (reutilizar siempre)
   → rompe T11 (409) y el unit T19.
2. `porDatos` creando SIEMPRE (sin buscar primero) → rompe T9/T10
   (reutilización: 2 perfiles).
3. Quitar la auditoría de una creación (R8) → rompe T16 (conteo) y el unit.
4. La cadena del escenario B sin el 409 (Error genérico 500) → rompe T13
   (espera 409).
5. Quitar `propietario_principal_id` del DTO construido (usar el id sin
   resolver) → rompe T8 (ficha sin principal → 400/404).
6. Escenario B saltándose la asignación del inquilino actual → rompe T10
   (ocupación).
