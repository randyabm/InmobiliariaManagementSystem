# Review — feature #11 (`inventory_templates`)

**Veredicto:** APPROVED

Revisor: agente `reviewer`. Fecha: 2026-08-01. HEAD revisado: `3337685`
(+1 commit del reviewer con un test propio). Árbol de trabajo limpio antes
y después de la revisión.

Línea base ejecutada por el leader: `./init.sh` exit 0, `test` **732** (80
archivos), `test:db` **122** (3 archivos), lint, typecheck y build verdes.
Además ejecuté la línea base de los 4 archivos nuevos de la feature:
**26/26 verdes**.

---

## 1. Verificación por mutación

Ejecuté **tres** mutaciones, correspondientes a los puntos de riesgo del
informe del implementer.

| # | Mutación | Suite | Rojos | ¿Coincide con el informe? |
|---|---|---|---|---|
| 1 | `copiarPlantilla` sin el filtro `activo = true` | `plantillas.api.test.ts` | **1 / 10** (tras el test añadido) | ✅ — ver §3 |
| 2 | `exigirEditable` sin el 409 del SISTEMA | API + unit | **2 / 15** | ✅ (R6: «409 PLANTILLA_SISTEMA_NO_EDITABLE» en ambos niveles) |
| 3 | política de `plantilla_inmueble` sin el OR del sistema | RLS + API | **5+ rojos** | ✅ (el catálogo entero desaparece: T10, T11, RLS) |

Rojos concretos:

- **(1)** → «clonar la plantilla del sistema crea la copia TENANT con
  zonas e ítems ACTIVOS»: la fila inactiva se propaga a la copia (conteo
  crudo 5 en vez de 4) aunque la API la oculte. #12 clonaría basura.
- **(2)** → el 409 del sistema es carga real en el service y en la API.
- **(3)** → sin el OR, el catálogo base es invisible para los tenants: el
  seed, el clonado y la lectura dependen de la política de PA-11-1.

## 2. La mutación 1 y el test añadido por el reviewer

Sin el filtro, la fila inactiva se copia con `activo = false` y la API la
sigue ocultando (0 rojos en la primera pasada): el filtro era semántico pero
no observable. El reviewer añadió un test que siembra una zona inactiva en
la plantilla del SISTEMA directamente (estado que la API no puede producir
pero la semilla futura sí), clona y verifica el **conteo crudo** de la
copia (4, no 5). Con él, la mutación da **1/10**: si la fila muerta se
propaga, #12 podría materializarla por error. La frontera queda cargada.

## 3. Trazabilidad requirements ↔ tests (15/15)

Verificada archivo por archivo; la tabla del implementer
(`progress/impl_inventory_templates.md`) es fiel. R1–R15 [x], con mutación
que los sostiene en los puntos de riesgo (R5 → mut. 1, R6 → mut. 2, R1/R4 →
mut. 3).

**Anclaje al PRD:** los 15 citan RF-I2, RF-I22, RF-I23, RF-I24 (frontera),
§8.8, D2, RF-C3. Ningún requirement sin origen.

**Ningún test fabrica el objeto que dice verificar.** El catálogo lo siembra
la migración; el clon y la gestión pasan por la API real; las aserciones de
estado usan `SELECT` independientes (zonas, ítems, `activo`, conteos crudos,
`audit_log`); el doble del unit solo registra llamadas.

## 4. Puntos críticos revisados

1. **El patrón de #7 se reutilizó, no se reinventó (PA-11-1).** La política
   de `plantilla_inmueble` es idéntica en forma a la de `workflow_definicion`
   (OR del sistema con contexto presente + `WITH CHECK` propio) y las de
   zona/ítem por subconsulta con `WITH CHECK` propio — la lección de `0003`
   aplicada. Sin vías nuevas fuera del RLS (el inventario SECURITY DEFINER
   no cambió).
2. **El seed respeta el PRD (PA-11-2).** APARTAMENTO con el ejemplo §8.8.5
   literal (5 zonas, field_types y banderas verificados); las otras cinco
   sin zonas — no se inventó producto.
3. **R9 en tres capas.** zod en el borde (`superRefine`), `validarOpciones`
   en el servicio (400) y el CHECK del motor (`opciones ↔ seleccion`):
   verificadas las tres en T13/migrations.
4. **Baja lógica con herencia.** La zona inactiva no se lista ni sus ítems;
   el clon solo copia activos (mut. 1 lo sostiene).

## 5. Tasks completas

**22 / 22 `[x]`** en `specs/inventory_templates/tasks.md`.

## 6. Invariantes de seguridad (C7)

- **Aislamiento por tenant:** [x] — RLS real (T15: lectura del sistema,
  INSERT rechazado en los tres niveles, virgen → 0 filas) + HTTP T16.
- **RBAC en backend con test de rechazo:** [x] — T17: 403 en las 9 rutas
  para `propietario`/`inquilino`, 403 del `empleado` en la gestión (PA-11-4),
  401 sin token.
- **Auditoría de acciones críticas:** [x] — T18 (una fila exacta por
  mutación con `entity_id` correcto y `metadata` vacío).
- **Sin secretos hardcodeados:** [x] — sin secretos nuevos.
- **Datos personales en logs:** [x] — no hay PII en plantillas; el patrón
  de `metadata` vacío se mantiene (T18).
- **Integridad documental (SHA-256):** n/a — no toca documentos.

## 7. Checkpoints

C1 [x] · C2 [x] · C3 [x] · C4 [x] · C5 [x] · C6 [x] · C7 [x] · C8 n/a

---

## Bloqueantes

**Ninguno.**

## Deuda anotada (no bloqueante)

- **D-1 —** El seed de las cinco plantillas sin zonas (PA-11-2) deja el
  catálogo incompleto hasta que el humano defina sus zonas; el tenant las
  completa al clonar. Anotado en el spec (R4).
- **D-2 —** `copiarPlantilla` filtra zonas activas en la zona y en el join
  de ítems; el ítem inactivo de una zona ACTIVA no se copia (el join exige
  `i.activo = true`) — correcto, pero el test solo cubre el caso de zona;
  un caso de ítem inactivo en zona activa quedaría por añadir cuando #12
  materialice.
- **D-3 —** La versión de plantilla (`version`) existe pero no se
  incrementa al editar: #12 materializa el estado vigente, así que la
  versión no es funcional aún; si el historial de versiones se pide, es
  feature aparte (no inventar).

## Recomendación

**Cerrar #11 como `done`.** El molde del inventario queda listo con el
patrón consolidado de la sesión: catálogo del sistema con régimen especial
de RLS reutilizado de #7 (mut. 3: sin el OR no hay catálogo), gestión
solo-admin con la frontera del sistema cargada (mut. 2), y el clon que solo
propaga lo vivo — ahora con test que lo sostiene (mut. 1). Las tres
mutaciones se reproducen al test exacto, y #12 tiene un contrato claro para
materializar.
