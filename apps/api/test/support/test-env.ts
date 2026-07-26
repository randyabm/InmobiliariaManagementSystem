/**
 * Entorno mínimo válido para arrancar la aplicación en tests.
 *
 * Son valores INERTES, no credenciales: la contraseña es literalmente
 * `test-password` y apunta a un host que no existe. Ningún test de esta suite
 * abre la conexión (R14), así que la cadena solo tiene que ser sintácticamente
 * válida (CHECKPOINTS.md §C7: sin secretos, ni siquiera en tests).
 */
export const ENTORNO_DE_PRUEBA: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL:
    'postgres://test-user:test-password@127.0.0.1:5432/inmobiliaria_test',
  CORS_ORIGINS: 'http://localhost:5173,https://panel.example.com',
};

/**
 * Aplica el entorno de prueba y devuelve una función para restaurarlo.
 * Evita que un test contamine a otro a través de `process.env`.
 */
export function usarEntornoDePrueba(
  extra: Record<string, string> = {},
): () => void {
  const original = { ...process.env };
  Object.assign(process.env, ENTORNO_DE_PRUEBA, extra);
  return () => {
    for (const clave of Object.keys(process.env)) {
      if (!(clave in original)) delete process.env[clave];
    }
    Object.assign(process.env, original);
  };
}
