# Review — feature #6 (`property_profile`)

**Veredicto:** APPROVED

Revisor: agente `reviewer`. Fecha: 2026-08-01. HEAD revisado: `5d31ac1` (+1
commit del reviewer con un test propio). Árbol de trabajo limpio antes y
después de la revisión (`git status --short` final vacío tras el commit del
test).

Línea base ejecutada por el leader: `./init.sh` exit 0, `test` **575** (56
archivos), `test:db` **100** (3 archivos), lint, typecheck y build verdes.
Además ejecuté la línea base de los 6 archivos nuevos de la feature
(propiedades API, anexos, seguridad, service, almacenamiento y RLS):
**51/51 verdes**.

---

## 1. Verificación por mutación

Ejecuté **cinco** mutaciones: cuatro de los candidatos del informe del
implementer y una propia (RLS).

| # | Mutación | Suite | Rojos | ¿Coincide con el informe? |
|---|---|---|---|---|
| 1 | quitar la validación del override en `crear` (`propiedades.service.ts`) | `propiedades.api.test.ts` + `propiedades.service.test.ts` | **3 / 11** | ✅ (T12 ajeno→400 + 2 unit de R8) |
| 2 | `asignarInquilinoActual` sin cerrar la ocupación vigente | `propiedades-anexos.api.test.ts` | **3 / 17** | ✅ (reasignación, `null`, historial) |
| 3 | quitar la guarda del principal en `remover` | `propiedades-anexos.api.test.ts` | **1 / 18** | ⚠️ ver §3 — el reviewer añadió el test que la sostiene |
| 4 | `FotosService.quitar` sin verificar pertenencia | `propiedades-anexos.api.test.ts` | **1 / 18** | ✅ (clave ajena → 400) |
| 5 | *(propia)* eliminar las políticas RLS de la migración `0012` | `propiedades-rls.test.ts` | **4 / 10** | — (los cuatro `SELECT *` por tenant) |

Rojos concretos:

- **(1)** → «override de OTRO propietario → 400 sin persistir» (SELECT:
  ninguna fila) + los dos unit de delegación/`CuentaDeGiroInvalidaError`. La
  dependencia #5 (design.md §6) queda demostrada en ambas direcciones: la
  validación existe y su ausencia se detecta.
- **(2)** → «reasignar cierra la línea anterior» y «asignar null libera»:
  el historial escribe de verdad y en la misma transacción.
- **(3)** → el test que el reviewer añadió (§3). **1 rojo de 18** tras el
  añadido; antes de él, 0 rojos (la guarda era inalcanzable por API).
- **(4)** → «quitar una clave ajena es 400 y no toca el array»: la
  pertenencia se verifica contra el array real.
- **(5)** → los cuatro «SELECT * SIN WHERE devuelve solo filas del tenant
  activo»: el RLS de `0012` se prueba contra PostgreSQL real.

## 2. Trazabilidad requirements ↔ tests (22/22)

Verificada archivo por archivo; la tabla del implementer
(`progress/impl_property_profile.md`) es fiel. R1–R22 [x], con mutación que
los sostiene en los puntos de riesgo (R8 → mut. 1, R11/R12 → mut. 2, R10 →
mut. 3, R17 → mut. 4, R14/R19 → mut. 5).

**Anclaje al PRD:** los 22 citan RF-P1/P2/P3, RF-C5, RF-C6 (frontera),
RF-W4, §11.3, D2, §8.7 y §12.1/§13.4 (fronteras). Ningún requirement sin
origen.

**Ningún test fabrica el objeto que dice verificar.** MinIO y PostgreSQL son
contenedores reales (Testcontainers); las aserciones de estado usan `SELECT`
independientes (incluido el hash del binario leído del objeto — R21); el rol
de aplicación lo provisiona `asegurarRolDeAplicacion`; el único mock (unit
de `PropiedadesService`) solo registra llamadas y la integración real está
en T12.

## 3. La mutación 3 (0 rojos antes del test del reviewer): defensa en profundidad, ahora con carga

La guarda de `remover` contra una fila que apunte al principal era
**inalcanzable por API**: `anadir` bloquea duplicar el principal con 409, así
que ninguna fila de la puente puede referenciarlo por el camino legítimo. La
mutación daba 0 rojos — el mismo patrón que en #27 (mut. 6), donde se aceptó
como defensa en profundidad documentada.

Aquí no lo dejé en deuda: añadí el test que la hace carga real —sembrar la
fila corrupta directamente con `poolAdmin` y verificar que la baja es 409 y
no toca la fila (SELECT `activo`). Con el test, la mutación da **1/18**.
El invariante R10 resiste ahora también un estado corrupto en la base, que
es exactamente el caso que la guarda existe para cubrir.

## 4. Puntos críticos revisados

1. **El override (R8, dependencia #5).** La regla de precedencia NO se
   duplicó: `crear`/`actualizar` validan invocando
   `resolverCuentaDeGiro` (el 400 de #5 viaja tal cual), y la lectura
   nullable de la ficha reutiliza la MISMA llamada traduciendo el error a
   `null`. Un solo punto de verdad, como exigía el design.md de #5.
2. **Fronteras PA-6-3.** Sin `estado` (será #8), sin creación en línea
   (será #9): el principal inexistente/ajeno es 404 indistinguible (R14),
   verificado contra el perfil del tenant B.
3. **Almacenamiento.** Claves `uuid + extensión derivada del mime` (el
   nombre del cliente nunca es clave — mutación de path traversal probada
   en `almacenamiento.test.ts`); el hash se verifica leyendo el objeto de
   MinIO (R21); el bucket se asegura en el arranque y su ausencia no tumba
   la API.
4. **Ocupación atómica.** El cierre/apertura de líneas y la actualización de
   la ficha corren en la transacción de la petición (no hay BEGIN anidado);
   el índice único parcial del motor es la garantía final (verificado en
   `migrations.db.test.ts`).
5. **PII (R15).** Dirección, matrícula y contactos de administración fuera
   de auditoría (serializada completa) y de logs capturados; el binario solo
   existe como hash en la base.

## 5. Tasks completas

**28 / 28 `[x]`** en `specs/property_profile/tasks.md` (+1 test del
reviewer, fuera de spec, que refuerza R10).

## 6. Invariantes de seguridad (C7)

- **Aislamiento por tenant:** [x] — `0012` ENABLE+FORCE+política en la
  misma migración (mut. 5: 4 rojos); RLS real con rol sin BYPASSRLS;
  aislamiento HTTP T20 (404 con SELECT «nada se escribió»).
- **RBAC en backend con test de rechazo:** [x] — T21: 403 en las 14 rutas
  para `propietario`/`inquilino`, 401 sin token.
- **Auditoría de acciones críticas:** [x] — T22: una fila exacta por
  mutación (`crear/actualizar/baja` de propiedad, asociación, inquilino
  actual, documento) con `tenant_id`, `actor_id`, `entity_type`,
  `entity_id` (incluido el fallback `idPropietario`/`idDocumento` del
  interceptor).
- **Sin secretos hardcodeados:** [x] — credenciales MinIO desde el entorno;
  los valores del test son inerte de contenedor.
- **Datos personales en logs:** [x] — T23 (auditoría + stdout/stderr con
  valores PII distintivos y binarios).
- **Integridad documental (SHA-256):** [x] — R21: el hash del objeto leído
  de MinIO coincide con el de la fila (T18) y con el de la ficha del
  almacenamiento (T6).

## 7. Checkpoints

C1 [x] · C2 [x] · C3 [x] · C4 [x] · C5 [x] · C6 [x] · C7 [x] · C8 n/a

---

## Bloqueantes

**Ninguno.**

## Deuda anotada (no bloqueante)

- **D-1 —** La sonda de ruta inexistente del `routes-surface.test.ts` tuvo
  que moverse a `/no-existe/secretas` porque `/propiedades/secretas` es
  ahora un `GET /propiedades/:id` legítimo. Es el síntoma de que la lista
  blanca y la realidad conviven bien; cuando #8 añada rutas nuevas, revisar
  que la sonda siga sin colisionar.
- **D-2 —** `AlmacenamientoService` usa `minioadmin` como default de
  desarrollo: docker-compose lo sobreescribe con `.env`. Antes de cualquier
  despliegue real hay que exigir `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` sin
  default (mismo criterio que `JWT_SECRET`).
- **D-3 —** `#8 property_lifecycle` deberá reutilizar la ficha (R6) para el
  dashboard (RF-P5) y añadir `estado`; la frontera está documentada en el
  spec de #6 (§Fronteras) y en `propiedades.service.ts`.

## Recomendación

**Cerrar #6 como `done`.** Es la feature más amplia en superficie de la fase
1a (4 tablas, 14 rutas, un módulo nuevo de almacenamiento) y la que cierra
la deuda de diseño más antigua del tablero —el override de cuenta que #5
dejó especificado pero sin entidad—. Las cinco mutaciones confirman que los
invariantes son carga real (R8: 3 rojos; RLS: 4 rojos; ocupación: 3 rojos),
y el test que añadí convierte la única guarda inalcanzable en verificable.
Las desviaciones anotadas por el implementer (parámetro `:idPropiedad`,
interceptor ampliado, sonda de rutas) son todas legítimas y verificadas.
