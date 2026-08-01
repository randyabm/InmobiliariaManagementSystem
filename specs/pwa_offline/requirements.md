# Requirements — pwa_offline

> Feature #15. PWA de campo con soporte offline.
> Anclaje al PRD: **RF-I14** (crear inventario sin conexión), **RF-I15**
> (sync automático con conflictos), **RF-I16** (indicador permanente de
> pendientes), **RF-I17** (compresión de fotos en el dispositivo),
> **RF-I18** (sync manual), **§10.2** (detalle: iOS/Safari, IndexedDB,
> salvaguardas), **D5** (PWA), **RF-AU1** (login del empleado).

Notación EARS estricta (`docs/specs.md`). Un solo `DEBE` por requirement.

## Dependencias

- **#12 `inventory_creation` (done):** los endpoints que la PWA consume
  (crear/editar inventario, zonas, ítems, fotos).
- **#27 `sesion_y_revocacion` (done):** login del empleado y tokens con
  sesión; la PWA guarda el refresh token y rota.
- **#11 (done):** las plantillas (prefetch para crear inventarios en
  campo).

## Fronteras explícitas (qué NO es de #15)

- **Revisión del inquilino (#13) y firma (#14):** la PWA de campo es del
  EMPLEADO; el portal del inquilino es otra app (futura).
- **Notificaciones push (RF-N1 push):** no se pide; los avisos de estado
  llegan por el canal preferido vía #10.
- **El backend de conflictos:** la detección la hace la PWA comparando
  versiones; el backend solo expone `updated_at` (ya lo hace #12).

---

## Grupo A — La app (D5, RF-I14)

### R1 — (D5) La PWA de campo existe

EL sistema DEBE incluir la aplicación `apps/pwa` (React + Vite, instalable:
manifest + service worker que cachea el shell) como el cliente de campo
del empleado, que consume la API de #12 con la sesión de #27.

### R2 — (RF-I14) Trabajo offline completo

CUANDO la PWA está sin conexión, el sistema DEBE permitir crear y editar
un inventario completo (zonas, ítems, respuestas, comentarios y fotos)
persistiendo en IndexedDB, de modo que ningún dato se pierda y todo quede
marcado como pendiente de sincronizar (R5).

### R3 — (RF-I14) Prefetch para campo

CUANDO la PWA está en línea, el sistema DEBE descargar y cachear (en
IndexedDB) los datos mínimos para trabajar sin señal: la lista de
propiedades, los borradores de inventario pendientes y la plantilla por
tipo de propiedad (de #11/#12). La caché DEBE refrescarse en cada
sincronización exitosa.

---

## Grupo B — Sincronización (RF-I15, RF-I16, RF-I18)

### R4 — (RF-I15) Cola de sincronización

EL sistema DEBE mantener una cola local de operaciones pendientes
(crear/editar zona/ítem, respuesta, foto) con su orden; cada operación
DEBE registrar la versión base (`updated_at` del servidor en el último
sync) para detectar conflictos (R6).

### R5 — (RF-I16) Indicador permanente

CUANDO existe cualquier operación pendiente, la PWA DEBE mostrar un
indicador permanente («pendiente de sincronizar») que NO desaparece hasta
que el backend confirme cada operación (nunca antes).

### R6 — (RF-I15) Conflictos

SI al sincronizar una operación el `updated_at` del servidor difiere de la
versión base local ENTONCES la PWA DEBE marcar el ítem como en conflicto,
NO sobrescribirlo en silencio, y DEBE ofrecer al empleado la decisión
explícita (conservar local o conservar remoto) antes de continuar.

### R7 — (RF-I18) Sincronización manual y automática

CUANDO la conexión se recupera, la PWA DEBE disparar la sincronización
automáticamente (evento `online`); ADEMÁS DEBE ofrecer el botón
«Sincronizar ahora» siempre visible mientras haya pendientes (flujo
primario en iOS/Safari, §10.2). El sync manual y el automático DEBEN
usar la misma cola (sin duplicar).

### R8 — (RF-I15) Orden y confirmación

CUANDO la sincronización corre, la PWA DEBE enviar las operaciones en
orden (padres antes que hijos: inventario → zonas → ítems → fotos), DEBE
marcar cada una como confirmada SOLO con la respuesta 2xx del backend, y
DEBE reintentar las fallidas en la siguiente corrida (sin perder la cola).

---

## Grupo C — Fotos (RF-I17)

### R9 — (RF-I17) Compresión en el dispositivo

CUANDO el empleado adjunta una foto, la PWA DEBE comprimirla antes de
encolarla: máxima dimensión 1280 px y calidad ~0.7 en formato WebP (o
JPEG si el dispositivo no soporta WebP), conservando el EXIF de
orientación. El binario original NO se sube.

---

## Grupo D — Invariantes y gobernanza

### R10 — (RF-AU1, #27) Sesión y tokens

CUANDO la PWA se abre, DEBE autenticar al empleado por el login estándar
(#27), guardar el refresh token (IndexedDB), rotarlo en cada refresh y
cerrar sesión revocando en el servidor. Los tokens NO se guardan en
`localStorage` ni en logs.

### R11 — (docs/verification.md) Test E2E de pérdida de conexión

EL sistema DEBE incluir un test que simule: pérdida de conexión → trabajo
offline completo (crear inventario con zonas/ítems/fotos en IndexedDB) →
indicador de pendientes → recuperación → sincronización → confirmación en
el «backend» (cliente API con transporte inyectable).

### R12 — (C4/C6) Sin migraciones de base de datos

EL sistema NO DEBE requerir migraciones nuevas para esta feature (todo es
cliente); `TABLAS_PERMITIDAS` no cambia. El código de la PWA DEBE pasar
lint, typecheck, build y tests en `./init.sh`.

---

## CRITERIOS DE ACEPTACIÓN del humano (feature_list.json #15)

| Criterio | R que lo satisface |
|---|---|
| El empleado crea un inventario completo sin conexión; los datos y fotos persisten en IndexedDB | R2, R3 |
| Las fotos se comprimen en el dispositivo antes de subir | R9 |
| Indicador permanente de pendientes de sincronizar hasta que el backend confirme | R5 |
| Botón de sincronización manual siempre disponible, además del sync automático al reconectar | R7 |
| Manejo de conflictos si el mismo inventario se editó desde otro dispositivo | R6 |
| Existe un test E2E que simula pérdida de conexión, trabajo offline y sincronización posterior | R11 |

## DECISIONES que el humano confirma en la puerta del spec

| Id | Pregunta | Decisión propuesta | Motivo |
|---|---|---|---|
| **PA-15-1** | ¿Dónde vive la app? | Nueva app `apps/pwa` (React+Vite, installable) — NO reutiliza `apps/web` (que será el panel interno/portales) | PWA de campo con service worker propio; `web` queda para la fase de paneles |
| **PA-15-2** | ¿El sync usa una cola por operación o un push por inventario? | **Cola por operación** con versión base (R4/R6): el conflicto se detecta a nivel de ítem | El §10.2 exige manejo de conflictos; por inventario entero no se puede resolver ítem a ítem |
| **PA-15-3** | ¿Resolución de conflictos? | Manual del empleado (conservar local / conservar remoto) por ítem en conflicto (R6) | No se inventa un merge automático |
| **PA-15-4** | ¿Compresión? | Canvas → WebP/JPEG ≤1280 px, calidad 0.7 (R9) | Equilibrio calidad/datos para zonas de baja conectividad (§10.2) |

**No quedan preguntas de producto abiertas** (las cuatro decisiones quedan
explícitas para la puerta del spec).
