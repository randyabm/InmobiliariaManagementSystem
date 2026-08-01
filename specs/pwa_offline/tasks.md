# Tasks — pwa_offline

> Feature #15. Pasos discretos en orden. La task E2E (R11) es de primera
> clase: simula la pérdida de conexión y la sincronización posterior.
>
> **Prerrequisitos:** #12 y #27 `done`. **Sin migraciones** (R12).
>
> **PA-15 aprobadas en la puerta del spec:** PA-15-1 (app `apps/pwa`
> nueva), PA-15-2 (cola por operación con versión base), PA-15-3
> (conflictos resueltos manualmente), PA-15-4 (compresión canvas → WebP).
>
> Cobertura: R1–R12 en 17 tasks (T1–T17), de las cuales 11 son tasks de test.

---

## Bloque 0 — Andamiaje de la app

- [x] T1 — Crear `apps/pwa` (workspace `@inmobiliaria/pwa`, React+Vite):
  `package.json`, `vite.config.ts`, `index.html` con `manifest.webmanifest`
  instalable, `public/sw.js` (cache-first del shell) y el script
  `test`/`typecheck`/`build`/`lint`. **Cubre: R1, R12.**

- [x] T2 — El shell de la app con los tres estados explícitos
  (conventions.md): login → lista de borradores → editor de inventario;
  registro del service worker solo en producción. **Cubre: R1.**

## Bloque 1 — Almacenamiento local

- [x] T3 — `offline/almacen-local.ts` (IndexedDB vía `idb`): stores
  `inventarios`, `cola`, `caché` (propiedades, plantillas, refresh token).
  Unit test con `fake-indexeddb`. **Cubre: R2, R3, R10.**

- [x] T4 — `api/cliente-api.ts`: cliente del backend (#12, #27) con
  transporte inyectable (fetch real | mock) y manejo de 401 (refresh →
  reintento → logout). Unit test. **Cubre: R10.**

## Bloque 2 — Cola y motor de sincronización

- [x] T5 — `offline/cola-sync.ts`: encolar operaciones
  `{ tipo, entidad, datos, base_version }`, orden (padres antes que
  hijos), marcar `confirmada`/`conflicto`. Unit test del orden y la
  confirmación. **Cubre: R4, R8.**

- [x] T6 — `offline/motor-sync.ts`: procesar la cola en orden (R8), 2xx →
  confirmar + actualizar base; divergencia de `updated_at` → conflicto
  (R6); reintento de fallidas; sin superposición. Unit test del conflicto
  y la decisión local/remoto. **Cubre: R4, R6, R8.**

- [x] T7 — `estado/use-sync.ts`: indicador permanente de pendientes (R5),
  disparadores `online`/botón manual (R7) y estado por inventario.
  Unit test con jsdom (eventos simulados). **Cubre: R5, R7.**

## Bloque 3 — Fotos

- [x] T8 — `offline/compresor-fotos.ts`: canvas → WebP 0.7 (fallback JPEG),
  máx 1280 px, orientación EXIF. Unit test (canvas mock): dimensión y
  formato del blob. **Cubre: R9, PA-15-4.**

## Bloque 4 — Editor offline

- [x] T9 — Editor de inventario offline: crear inventario local (origen
  local), editar zonas/ítems/respuestas/comentarios, adjuntar fotos
  comprimidas (T8) — todo encolado (T5) y persistido (T3). Unit test de
  flujo con `fake-indexeddb`. **Cubre: R2, R9.**

- [x] T10 — Prefetch (R3): al arrancar en línea, descargar propiedades,
  borradores pendientes y plantillas a la caché. Unit test. **Cubre: R3.**

## Bloque 5 — E2E y verificación

- [x] T11 — **E2E de pérdida de conexión (R11)**: con transporte mock —
  sesión y prefetch en línea; `apagado` (transport lanza offline) → crear
  inventario completo (zonas, ítems, foto comprimida) → indicador de
  pendientes; `encendido` → sync automático → el backend mock recibe las
  operaciones en orden y confirma → indicador limpio. **Cubre: R2, R5,
  R7, R8, R11.**

- [x] T12 — E2E de conflicto (R6): mientras hay una operación local
  pendiente, el «servidor» cambia el ítem (`updated_at` nuevo) → el sync
  marca conflicto → decisión «conservar remoto» descarta la local y
  refresca; «conservar local» reintenta. **Cubre: R6.**

- [x] T13 — E2E de sesión (R10): 401 → refresh → reintento; refresh
  fallido → logout revocado. **Cubre: R10.**

- [x] T14 — Verificación del workspace: `npm run lint`, `npm run
  typecheck`, `npm run test`, `npm run build` del monorepo y la PWA;
  `./init.sh` exit 0. **Cubre: R12.**

## Bloque 6 — Integración y cierre

- [x] T15 — Revisar que `apps/web` no se toca (PA-15-1) y que ningún test
  del backend cambia. **Cubre: R12.**

- [x] T16 — Escribir el mapa de trazabilidad `R1..R12 → test concreto` en
  `progress/impl_pwa_offline.md`, con las decisiones PA-15 y las fronteras
  (#13 portal inquilino, conflictos manuales) anotadas. **Cubre:
  trazabilidad.**

- [x] T17 — `./init.sh` final con exit 0 (incluye lint, typecheck, test,
  test:db y build del monorepo con la PWA). **Verificación final.**
