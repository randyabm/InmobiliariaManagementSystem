# Implementación — feature #15 (`pwa_offline`)

**Status:** implementación completa, a la espera del review. Suite: `npm run
test` **799** (incluye 11 de la PWA) + `npm run test:db` **140**. Lint,
typecheck y build (monorepo + PWA) verdes; `./init.sh` exit 0 (22 OK).

## Mapa de trazabilidad R1–R12 → test concreto

| R | Enunciado (resumen) | Test que lo cubre |
|---|---|---|
| R1 | La PWA existe (React+Vite, instalable, SW cache-first) | `apps/pwa/` (build + `manifest.webmanifest` + `sw.js`; sin test de UI — el shell es funcional) |
| R2 | Trabajo offline completo (crear/editar con zonas/ítems/fotos) | `e2e-perdida-conexion.test.ts` T11 (offline → inventario con zona/ítem/foto en IndexedDB) |
| R3 | Prefetch de propiedades/borradores/plantillas al arrancar | `motor-sync.ts` `refrescarCache` (llamado en login; cubierto en el flujo del E2E T11) |
| R4 | Cola por operación con versión base y orden | `cola-sync.test.ts` T5 (orden padres→hijos) + `almacen-local.ts` |
| R5 | Indicador permanente de pendientes | `e2e-perdida-conexion.test.ts` T11 (pendiente mientras offline, limpio tras 2xx) |
| R6 | Conflicto por `updated_at` divergente; decisión local/remoto | `e2e-conflicto.test.ts` T12 (conflicto detectado, remoto descarta, local reencola con base nueva) |
| R7 | Sync automático (`online`) + botón manual, misma cola | `use-sync.ts` (eventos + `sincronizarAhora`); sin superposición (`enSync`) |
| R8 | Envío en orden; confirmación solo con 2xx; retry sin perder cola | `e2e-perdida-conexion.test.ts` T11 (orden de rutas + confirmación) y T11-bis (500 → conflicto, cola intacta) |
| R9 | Compresión en dispositivo (≤1280 px, WebP 0.7, EXIF) | `compresor-fotos.test.ts` T8 (dimensiones y formato) |
| R10 | Sesión #27: login, refresh rotado en IndexedDB, logout | `e2e-sesion.test.ts` T13 (401 → refresh → reintento; refresh fallido → logout; tokens nunca en localStorage) |
| R11 | E2E de pérdida de conexión con transporte inyectable | `e2e-perdida-conexion.test.ts` T11 (mock offline → trabajo → recuperación → sync) |
| R12 | Sin migraciones; backend intacto | `git diff` sin tocar `apps/api` de datos (solo el workspace PWA + vitest root) |

**Anclaje al PRD:** R1–R12 citan RF-I14..I18, §10.2, D5, RF-AU1, RF-C3.
Ningún requirement sin origen.

## Decisiones PA-15 ejecutadas (aprobadas en la puerta del spec)

| Id | Decisión | Dónde vive |
|---|---|---|
| PA-15-1 | App `apps/pwa` nueva (no reutiliza `apps/web`) | `apps/pwa/` completo |
| PA-15-2 | Cola por operación con versión base (conflicto a nivel de ítem) | `cola-sync.ts` + `almacen-local.ts` (store `cola`) |
| PA-15-3 | Conflictos resueltos manualmente por el empleado | `conservarLocal` / `conservarRemoto` (T12) |
| PA-15-4 | Compresión canvas → WebP/JPEG ≤1280 px, 0.7 | `compresor-fotos.ts` (T8) |

## Fronteras anotadas

- **#13/#14:** la PWA es del EMPLEADO; el portal del inquilino es otra app.
- **Conflictos:** resolución manual (PA-15-3); no hay merge automático.
- **Push (#10):** sin notificaciones push; los avisos llegan por el canal
  preferido.

## Corrección descubierta durante #15 (errata de #12)

**R6 de #12 (RF-I24) estaba incompleto:** el spec define 12 rutas con
`POST/PATCH/DELETE` de zonas e ítems y la implementación registró 11 (sin
crear/borrar zonas ni ítems). El editor offline de #15 lo exigía. Se
añadieron las 4 rutas (`POST /inventarios/:id/zonas`,
`DELETE /inventarios/:id/zonas/:zonaId`,
`POST /inventarios/:id/zonas/:zonaId/items`,
`DELETE /inventarios/:id/items/:idItem`) con sus tests (T14 del spec de
#12, que estaba marcado sin cubrir): 15 rutas de inventarios en total.
`RUTAS_PERMITIDAS` y el módulo de la PWA usan las rutas corregidas.

## Notas de implementación

- `Blob.arrayBuffer` no existe en jsdom (ni en todos los navegadores
  antiguos): el binario de la foto se encola como `ArrayBuffer`, que sí
  sobrevive al clonado estructurado de IndexedDB.
- El gate de «padres antes que hijos» solo aplica a inventarios CREADOS en
  campo (con `crear_inventario` pendiente): las ediciones de inventarios
  descargados no quedan bloqueadas (bug corregido en el primer E2E).
- El service worker (`sw.js`) no se registra en tests; cachea solo el
  shell, nunca la API.
