# Review — feature #15 (`pwa_offline`)

**Veredicto:** APPROVED

Revisor: agente `reviewer`. Fecha: 2026-08-01. HEAD revisado: `5080c23`
(+1 commit del reviewer con 1 test propio y 1 fix del motor). Árbol de
trabajo limpio después de la revisión.

Línea base ejecutada por el leader: `./init.sh` exit 0, `test` **799**,
`test:db` **140**, lint, typecheck y build (monorepo + PWA) verdes. Línea
base de la PWA: **11/11 verdes**.

---

## 1. Verificación por mutación

| # | Mutación | Rojos | ¿Coincide con el informe? |
|---|---|---|---|
| 1 | Sin la detección de conflicto (`updated_at` divergente) | **1 / 11** | ✅ (R6: «NO sobrescribir en silencio») |
| 2 | Confirmar sin exigir 2xx (cualquier status) | **1 / 11** | ✅ (R8: «confirmada SOLO con 2xx») |
| 3 | Sin el gate de espera del padre | **1 / 12** | ✅ (R8: «padres antes que hijos») — con el test del reviewer, ver §2 |

Rojos concretos:

- **(1)** → «divergencia de updated_at → conflicto»: la operación se
  confirmaba con la versión nueva del servidor sin avisar al empleado.
- **(2)** → «un fallo persistente marca conflicto y NO pierde la cola»: el
  500 confirmaba la operación como si el backend la hubiera aceptado.
- **(3)** → «un hijo encolado ANTES que su padre espera»: la foto se
  enviaba antes que la creación del inventario (orden roto).

## 2. Hallazgo del reviewer y fix

**El motor de sync era de UNA pasada:** un hijo encolado antes que su padre
se saltaba y nunca se enviaba en la misma corrida (el primer E2E lo
encubría porque encolaba en orden). El reviewer añadió el test «hijo antes
que padre» y el motor pasó a **pasadas iterativas** (hasta no-progreso,
tope 100) — la mutación 3 lo sostiene: sin el gate, el orden se rompe.

## 3. Trazabilidad requirements ↔ tests (12/12)

Verificada archivo por archivo; la tabla del implementer
(`progress/impl_pwa_offline.md`) es fiel. R1–R12 [x], con mutación que los
sostiene en los puntos de riesgo (R6 → mut. 1, R8 → mut. 2 y 3).

**Anclaje al PRD:** los 12 citan RF-I14..I18, §10.2, D5, RF-AU1, RF-C3.
Ningún requirement sin origen.

**Ningún test fabrica el objeto que dice verificar.** El almacenamiento es
IndexedDB real (`fake-indexeddb`), el transporte es inyectable por diseño
(R11) y el «backend» del E2E registra las operaciones recibidas en orden.

## 4. Puntos críticos revisados

1. **R9 (compresión).** El test verifica dimensiones y formato con la
   cadena canvas doblada (jsdom no la implementa); el flujo real pasa por
   `createImageBitmap` con `imageOrientation: 'from-image'` cuando existe.
   El original nunca entra a la cola: solo el blob comprimido (o su
   `ArrayBuffer`).
2. **R10 (sesión).** El cliente API rota el refresh en IndexedDB, reintenta
   la operación y hace logout si el refresh falla; los tokens nunca van a
   `localStorage` (test dedicado).
3. **R5 (indicador).** El indicador cuenta SOLO operaciones no confirmadas;
   se limpia con la confirmación del backend, nunca antes.
4. **Errata de #12 corregida en esta feature.** R6 de #12 (RF-I24) estaba
   incompleto: faltaban `POST/DELETE` de zonas e ítems. Las 4 rutas se
   añadieron con tests (15 rutas de inventarios) y el motor de la PWA usa
   las rutas corregidas.

## 5. Tasks completas

**17 / 17 `[x]`** en `specs/pwa_offline/tasks.md`.

## 6. Invariantes de seguridad (C7)

- **Aislamiento por tenant:** n/a en la PWA (cliente; el tenant viaja en
  cabecera y el backend lo valida).
- **RBAC:** n/a (la sesión de #27 autoriza; el backend decide los roles).
- **Auditoría:** n/a (las operaciones de la PWA se auditan en el backend
  por las rutas de #12).
- **Sin secretos hardcodeados:** [x] — sin secretos; los tokens viven en
  IndexedDB.
- **Datos personales en logs:** [x] — la PWA no registra tokens ni PII.
- **Integridad documental (SHA-256):** la verifica el backend (#12) al
  recibir la foto; la PWA no descarta el hash.

## 7. Checkpoints

C1 [x] · C2 [x] · C3 [x] · C4 [x] · C5 [x] · C6 [x] · C7 [x] · C8 n/a

---

## Bloqueantes

**Ninguno.**

## Deuda anotada (no bloqueante)

- **D-1 —** `refrescarCache` guarda los borradores del servidor SIN zonas
  (solo la cabecera del inventario): el editor las cargaría vacías hasta el
  próximo sync. Suficiente para el indicador y la lista; la ficha completa
  por `GET /inventarios/:id` se descarga al abrir (pendiente para la fase
  de pulido de la PWA).
- **D-2 —** La UI del editor es mínima (tres estados del conventions, sin
  estilos ni pantallas finales): el detalle visual se resuelve en la fase
  de paneles; el motor offline es lo que esta feature entrega.
- **D-3 —** El tope de pasadas (100) es defensivo; un ciclo de conflicto
  infinito no es posible porque cada conflicto marca la operación (estado
  final), pero el tope evita un bucle si el backend confirmara con
  `updated_at` cambiante cada vez.

## Recomendación

**Cerrar #15 como `done`.** La PWA de campo queda con el motor offline
sostenido por tres mutaciones (conflicto, confirmación solo-2xx, orden
padres→hijos ahora iterativo), el E2E de pérdida de conexión (R11) y la
sesión de #27 integrada. La errata de #12 (R6 incompleto) quedó corregida
con tests.
