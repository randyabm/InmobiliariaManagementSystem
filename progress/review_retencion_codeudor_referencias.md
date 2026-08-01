# Review — feature #25 (`retencion_codeudor_referencias`)

**Veredicto:** APPROVED

Revisor: agente `reviewer`. Fecha: 2026-08-01. HEAD revisado: `2ca7c02`.
Árbol de trabajo limpio antes y después de la revisión (las mutaciones se
aplicaron y revirtieron con `git checkout`; `git status --short` final vacío).

Línea base ejecutada por el leader: `./init.sh` exit 0, `test` **495** (47
archivos), `test:db` **82** (3 archivos), lint, typecheck y build verdes.
Además ejecuté la línea base de los 6 archivos nuevos: 43/43 verdes.

---

## 1. Verificación por mutación

Ejecuté **siete** mutaciones. Seis corresponden a los candidatos del informe
del implementer; la séptima (la de RLS en la migración) es propia.

| # | Mutación | Suite | Rojos | ¿Coincide con el informe? |
|---|---|---|---|---|
| 1 | quitar `ON CONFLICT (tenant_id, anio)` del upsert (`retencion.repository.ts`) | `retencion.test.ts` | **1 / 8** | ✅ («PUT crea la tarifa y, repetido… UNA sola fila», R6) |
| 2 | `darDeBaja` de codeudores → `DELETE` físico en vez de `activo = false` | `codeudores.test.ts` + `referencias.test.ts` | **1 / 14** | ✅ («DELETE es baja lógica…`, R13) |
| 3 | `resolverPorcentaje` → `?? '0.00'` en vez de lanzar | `retencion.test.ts` | **1 / 8** | ✅ (R9, «año sin configurar lanza…») |
| 4 | `resolverRetencionDePropietario` consulta la tarifa aunque `sujeto=false` | `retencion.test.ts` | **1 / 8** | ✅ (R10, espía «buscarPorAnio no llamado») |
| 5 | revertir `AuditInterceptor` a `params.idCuenta ?? params.id` | `retencion-codeudor-seguridad.api.test.ts` | **1 / 11** | ✅ (T25, auditoría de las 7 mutaciones) |
| 6 | quitar `AND tenant_id = $2` de `sujetoDeRetencion` | `retencion.test.ts` + RLS | **0** | ⚠️ ver §3 |
| 7 | *(mutación mía)* eliminar los tres bloques `CREATE POLICY` de `0010` | `retencion-codeudor-rls.test.ts` | **3 / 10** | — (los tres `SELECT * SIN WHERE` por tenant, R4) |

Rojos concretos, no meros conteos:

- **(1)** → `retencion.test.ts` «PUT crea la tarifa y, repetido para el mismo
  año, la reemplaza dejando UNA sola fila»: el upsert es la garantía de R6,
  y el test la comprueba con `count(*) = 1` y el `porcentaje` final.
- **(2)** → `codeudores.test.ts` «DELETE es baja lógica: la fila queda con
  `activo = false` y desaparece del listado»: se verifica con `SELECT
  activo` sobre la fila — el código de estado no basta.
- **(3)** → «resolverPorcentaje de un año sin configurar lanza…»: el default
  silencioso queda detectado.
- **(4)** → «un propietario con `sujeto_retencion = false` obtiene `{
  aplica: false }` SIN consultar tarifa_retencion»: el espía no se conforma
  con el resultado, exige que `buscarPorAnio` **no se haya llamado**.
- **(5)** → «cada una de las 7 mutaciones genera exactamente una fila de
  auditoría…»: sin `idCodeudor`/`idReferencia` en el fallback, la baja de un
  codeudor audita `entity_id` = **el inquilino**, y el test lo ve porque
  compara contra el id real del codeudor. La mutación 5 demuestra que la
  ampliación del interceptor no es decorativa.
- **(7)** → los tres «SELECT * SIN WHERE sobre X devuelve solo filas del
  tenant activo»: sin política, el rol de aplicación (no dueño de la tabla)
  no ve **ninguna** fila. El RLS de `0010` se prueba contra PostgreSQL real,
  no se asume.

## 2. Trazabilidad requirements ↔ tests (25/25)

Verificada archivo por archivo; la tabla del implementer
(`progress/impl_retencion_codeudor_referencias.md`) es fiel. R1–R25 [x], con
mutación que los sostiene en los puntos de riesgo (R4 → mut. 7, R6 → mut. 1,
R9 → mut. 3, R10 → mut. 4, R13 → mut. 2, R23 → mut. 5).

**Anclaje al PRD:** los 25 citan RF-* (RF-C4, RF-C5, RF-P1, RF-A1, RF-C3,
RF-W4, §11.3, D2, D7, Ley 1581). Ningún requirement sin origen. La frontera
D-6 está probada en los dos niveles que exige: comportamiento (T20: ni
siquiera existen las tablas de contrato/firma/inventario) y estructura (T21 +
`migrations.db.test.ts`: consulta a `information_schema` sobre FKs).

**Ningún test fabrica el objeto que dice verificar.** El rol de aplicación lo
provisiona `asegurarRolDeAplicacion`; las aserciones de estado persistido
usan `poolAdmin` con `SELECT` independientes; el espía de T13 solo registra
llamadas, y el SQL lo emite el repositorio real.

## 3. La mutación 6 (0 rojos): defensa en profundidad, no hueco

Confirmo el razonamiento: `sujetoDeRetencion` sin el `AND tenant_id = $2`
sigue devolviendo `null` para un perfil de otro tenant, porque el RLS
`FORCE` de `perfil_propietario` (migración `0005`, verificado en
`clientes-rls.test.ts` de la #5 con el rol sin BYPASSRLS) filtra la fila
ajena en el motor. El predicado explícito es la segunda barrera que
sobrevive a un despliegue mal configurado — el mismo patrón que la #26
validó en su mutación (b).

**Diferencia con la #26:** allí el predicado tenía un test de **forma** que
lo sostenía (R10, `identidad.service.test.ts:125-126`); aquí ninguna aserción
mira la forma del SQL de `sujetoDeRetencion`. La propiedad **de seguridad**
(R19: 404 indistinguible) está cubierta por el motor y por el unit test con
mock, pero si mañana alguien borra el predicado, nada se pondrá rojo. Es
**deuda, no bloqueante** (D-2 abajo).

## 4. Los seis puntos del informe del implementer

1. **Nombre de parámetro normalizado (`:idInquilino`)** — correcto y
   verificable: `git show 4e772f6` no muestra ruta duplicada, y
   `routes-surface.test.ts` enumera la forma registrada real (el test no
   podría estar verde si la lista no coincidiera con el registro). El
   design.md mezclaba `:id` y `:idInquilino` para el mismo segmento; la
   normalización es cosmética para Express.
2. **`AuditInterceptor` ampliado** — archivo de la #5, ampliación legítima y
   verificada por la mutación 5: sin ella, T25 falla. El fallback añadido
   (`idCodeudor`/`idReferencia`) no puede capturar el id del inquilino por
   accidente porque la ruta anidada no lleva `params.id`; el orden de
   precedencia es seguro.
3. **Código inalcanzable / huérfanos** — `grep` sobre `apps/api/src`:
   `TarifaRetencionNoConfiguradaError` y `CodeudorYaExisteError` se usan;
   `esquemaAnio` y `AnioRuta` se usan; ningún archivo de la feature quedó
   sin referencia. Sin `console.log`.
4. **Listas blancas** — `TABLAS_PERMITIDAS` +3 y `RUTAS_PERMITIDAS` +10 en
   el mismo cambio que la migración y los controllers (R25). `git diff
   ef464f3..HEAD -- tests/ddl-en-tests.test.ts` vacío: el guard anti-DDL no
   se tocó.
5. **`R5` (sin columna de tarifa en el perfil)** — verificado contra
   `information_schema.columns` en la migración de la feature (además del
   test preexistente de #5 que sigue verde).
6. **Sin secretos ni PII** — barrido sobre archivos tocados: `metadata` de
   auditoría vacío (el interceptor no rellena `metadata`); T25 serializa
   `to_jsonb(audit_log)` completo y captura stdout/stderr.

## 5. Decisiones del humano — ninguna reinterpretada

| Decisión | Estado | Evidencia |
|---|---|---|
| **D-2** tarifa por tenant y año, no por propietario | ✅ | R5 en `migrations.db.test.ts` (sin columna en `perfil_propietario`) + upsert por `(tenant_id, anio)` (mut. 1) |
| **D-6** codeudor y referencia como captura de datos | ✅ | R17 (T20: ni las tablas existen) y R18 (T21 + `migrations.db.test.ts`) |
| **D-7** unicidad del documento dentro del tenant | ✅ | `codeudores.test.ts` «permite el MISMO documento en otro inquilino del mismo tenant» |
| **D-8/D-9** terceros sin identidad, sin credenciales | ✅ | No hay `user` para codeudores (schema: FK solo a `perfil_inquilino`); T25 verifica que sus datos no entran en logs |
| Sin default de tarifa (pendiente IPC, §13.5) | ✅ | Mut. 3: el default se detecta |

## 6. Tasks completas

**27 / 27 `[x]`**, cero `[ ]` en `specs/retencion_codeudor_referencias/tasks.md`.

## 7. Invariantes de seguridad (C7)

- **Aislamiento por tenant:** [x] — `0010` habilita ENABLE+FORCE+política en
  las tres tablas **en la misma migración** (R4), y se verifica contra
  PostgreSQL real con el rol sin BYPASSRLS (mut. 7: quitarlas pone 3 tests en
  rojo). Aislamiento HTTP: T23, 404 con cuerpo indistinguible.
- **RBAC en backend con test de rechazo:** [x] — T24: 403 por rol
  (`propietario`/`inquilino` en las 10 rutas, `empleado` en las 2 de
  retención), 401 sin token. El 403 lo decide `RolesGuard` antes de tocar
  negocio.
- **Auditoría de acciones críticas:** [x] — las 7 mutaciones, una fila exacta
  cada una, con `tenant_id`, `actor_id`, `accion`, `entity_type`,
  `entity_id` (T25 + mut. 5).
- **Sin secretos hardcodeados:** [x] — `JWT_SECRET` de test es inerte; la
  feature no añade secretos.
- **Datos personales en logs:** [x] — T25 (auditoría serializada + logs
  capturados, con valores PII distintivos).
- **Integridad documental (SHA-256):** n/a — esta feature no toca
  documentos firmados.

## 8. Checkpoints

C1 [x] · C2 [x] · C3 [x] · C4 [x] · C5 [x] · C6 [x] · C7 [x] · C8 n/a

---

## Bloqueantes

**Ninguno.**

## Deuda anotada (no bloqueante)

- **D-1 —** La resolución `resolverRetencionDePropietario` no tiene ruta HTTP
  todavía: solo se ejercita vía unit test con mock (correcto, el consumidor
  será el módulo de pagos). Cuando exista, reescribir su unit test con el
  repositorio real.
- **D-2 —** El predicado `AND tenant_id` de `sujetoDeRetencion` no tiene test
  de forma (mut. 6, 0 rojos). Igual que la #26 documentó para su mutación
  (b), añadir una aserción de forma SQL (o un test HTTP cuando exista el
  consumidor) cerraría el hueco.
- **D-3 —** El `metadata` de auditoría queda vacío (R24): es deliberado y
  seguro, pero si en el futuro se quiere auditar "qué campos cambiaron" hay
  que definir un esquema whitelisted campo por campo; el test T25 se
  mantiene válido porque serializa la fila completa.

## Recomendación

**Cerrar #25 como `done`.** La mutación 7 confirma que el RLS de la feature
no es decorativo (3 rojos contra PostgreSQL real), la mutación 5 que la
ampliación del interceptor de auditoría estaba justificada y no era
cosmética, y las mutaciones 1–4 que las reglas de negocio de D-2 y D-6
(R6/R9/R10/R13) tienen tests que las sostienen de verdad. El informe del
implementer anotó por adelantado las dos desviaciones (parámetro
normalizado e interceptor ampliado), ambas legítimas y verificables.
