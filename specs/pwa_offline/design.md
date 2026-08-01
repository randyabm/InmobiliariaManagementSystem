# Design — pwa_offline

> Feature #15. PWA de campo con soporte offline (RF-I14..I18, §10.2, D5).
> Primera aplicación de FRONTEND real del repositorio.

---

## 1. La app: `apps/pwa`

Nueva workspace `@inmobiliaria/pwa` (PA-15-1), React + Vite, instalable:

```
apps/pwa/
├── index.html + manifest.webmanifest (instalable, theme del tenant después)
├── public/sw.js                  (cache-first del shell; skip en tests)
├── src/
│   ├── main.tsx / App.tsx        (login → lista de borradores → editor)
│   ├── api/cliente-api.ts        (transport inyectable: fetch | mock)
│   ├── offline/
│   │   ├── almacen-local.ts      (IndexedDB vía idb: inventarios, cola, caché)
│   │   ├── cola-sync.ts          (encolar, ordenar, marcar confirmado/conflicto)
│   │   ├── motor-sync.ts         (push en orden, retry, conflictos)
│   │   └── compresor-fotos.ts    (canvas → WebP/JPEG, R9)
│   ├── estado/use-sync.ts        (indicador permanente, R5)
│   └── __tests__/                (unit + E2E de pérdida de conexión, R11)
```

## 2. Almacenamiento local (R2, R3)

IndexedDB (wrapper `idb`) con tres stores:

- `inventarios`: los borradores descargados (`updated_at` como versión
  base) y los creados en campo (`origen: 'local'` hasta el primer sync).
  Contiene zonas/ítems embebidos (snapshot local).
- `cola`: operaciones pendientes `{ id, tipo, entidad, datos, base_version,
  estado: 'pendiente'|'confirmada'|'conflicto', orden }`.
- `caché`: propiedades, plantillas por tipo (R3), y el refresh token
  (R10).

## 3. El motor de sincronización (R4, R6, R7, R8)

```
sync() [disparado por: online, botón manual, apertura]
  si !navigator.onLine → marcar y esperar
  por operación en orden:
    1. si la entidad padre no está confirmada → esperar (orden R8)
    2. enviar por el transporte (crear/editar zona/ítem/respuesta/foto)
    3. 2xx → confirmada + actualizar base_version del servidor
    4. 4xx/5xx persistente → conflicto o error visible (sin borrar la cola)
    5. si el servidor devuelve updated_at != base_version → conflicto (R6)
  al final: refrescar la caché (R3) y actualizar el indicador (R5)
```

- El conflicto (R6) marca el ítem `conflicto` y la UI pide «conservar
  local» (reintenta con la versión local como base) o «conservar remoto»
  (descarta la operación y refresca desde el servidor).
- Sin superposición: flag `enSync`; el botón manual (R7) está activo
  siempre que haya pendientes o conflictos.
- El transporte es inyectable (`cliente-api.ts`): el E2E (R11) usa un
  mock que «pierde la conexión» (lanza red offline) y la recupera.

## 4. Compresión de fotos (R9, PA-15-4)

`compresor-fotos.ts`: `<img>` → canvas (max 1280 px, mantiene
proporción, respeta EXIF de orientación vía `createImageBitmap`
{imageOrientation: 'from-image'} cuando está disponible) →
`canvas.toBlob('image/webp', 0.7)` con fallback JPEG. El blob comprimido
es lo que entra a la cola; el original nunca se sube (R9).

## 5. Sesión (R10)

- Login estándar #27 (`POST /auth/login`); el refresh token se guarda en
  IndexedDB (`caché`), se rota en cada `POST /auth/refresh` (401 → rotar
  → reintentar la operación; 401 de nuevo → logout).
- Logout revoca en el servidor (#27). Nada de tokens en `localStorage`.

## 6. Service worker y tests

- `sw.js` cache-first del shell (index, js/css): permite abrir la app
  sin conexión. En `NODE_ENV === 'test'` no se registra.
- **E2E (R11)** — jsdom + `fake-indexeddb` + transporte mock:
  1. sesión y prefetch en línea;
  2. `apagado` (el transporte lanza `offline`) → crear inventario con
     zonas/ítems/foto comprimida → todo en IndexedDB, indicador pendiente;
  3. `encendido` (transporte responde) → sync automático (o botón) →
     el «backend» mock recibe las operaciones en orden y las confirma →
     indicador limpio.
- Unit: `cola-sync` (orden y confirmación), `compresor-fotos` (dimensión y
  formato), `motor-sync` (conflicto por updated_at divergente → estado
  conflicto y decisión local/remoto).

## 7. Fronteras

- El portal del inquilino (#13) es otra app; esta PWA es del empleado.
- La resolución de conflictos es manual (PA-15-3); no hay merge automático.
- No hay migraciones (R12).

## 8. Dependencias nuevas (dev y runtime de la app)

`react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `vitest`,
`@testing-library/react`, `idb`, `fake-indexeddb` (dev). Nada nuevo en
el backend.

## 9. Estado de las ambigüedades

Las cuatro decisiones de la puerta (PA-15-1…PA-15-4) quedan explícitas.
El detalle de UI (pantallas concretas) se resuelve en la implementación
siguiendo `docs/conventions.md` (tres estados explícitos en cada vista).
No quedan ambigüedades de producto.
