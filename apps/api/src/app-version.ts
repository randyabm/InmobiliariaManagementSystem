/**
 * Versión de la aplicación expuesta por `GET /health` (R13).
 *
 * Es una constante, no una lectura de `package.json` en tiempo de ejecución:
 * leer el manifiesto obliga a resolver rutas distintas en `src/` y en `dist/`,
 * y una sonda de liveness no debe tocar el sistema de archivos.
 *
 * La sincronización con `apps/api/package.json` la garantiza el test
 * `app-version.test.ts`, que falla si ambos valores divergen.
 */
export const APP_VERSION = '0.1.0';
