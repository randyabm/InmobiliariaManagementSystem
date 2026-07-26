import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raíz del monorepo, resuelta desde la ubicación de este archivo. */
export const RAIZ = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

export function rutaRepo(...segmentos: string[]): string {
  return join(RAIZ, ...segmentos);
}

export function leerTexto(...segmentos: string[]): string {
  return readFileSync(rutaRepo(...segmentos), 'utf8');
}

export function leerJson<T>(...segmentos: string[]): T {
  return JSON.parse(leerTexto(...segmentos)) as T;
}

/** Ejecuta un comando en la raíz del monorepo y devuelve su salida. */
export function ejecutar(comando: string, args: string[]): string {
  return execFileSync(comando, args, { cwd: RAIZ, encoding: 'utf8' });
}
