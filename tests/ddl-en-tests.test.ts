import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { leerTexto, rutaRepo } from './support/repo';

/**
 * Guard de R57: **ningún test fabrica el objeto de esquema que verifica**.
 *
 * Origen (hallazgo B2 de `progress/review_owner_tenant_profiles.md`): el test
 * de inmutabilidad de `audit_log` creaba en su `beforeAll` la función y los dos
 * triggers append-only, y acto seguido afirmaba que `audit_log` era inmutable.
 * Era verde por construcción: ninguna migración los creaba y en producción la
 * tabla se podía actualizar y borrar. El defecto es de forma, no de criterio,
 * así que se detecta con un test y no con la atención del revisor de turno.
 *
 * Qué se prohíbe: `CREATE TRIGGER`, `CREATE POLICY`, `CREATE FUNCTION` (con o
 * sin `OR REPLACE`), `CREATE ROLE` y `GRANT` dentro de los archivos de test de
 * `apps/api/**`. Los invariantes se verifican contra el esquema que dejan las
 * migraciones y contra el rol que crea el procedimiento de provisión (R46).
 *
 * Qué NO se prohíbe: la **inyección de fallos**, donde el objeto creado es el
 * estímulo del test y no el sujeto de su afirmación (p. ej. un trigger que
 * revienta a propósito para probar que una transacción es atómica, R22). La
 * frontera se declara en `EXCEPCIONES_JUSTIFICADAS`, con archivo, objetos
 * concretos y motivo — igual que `TABLAS_PERMITIDAS` en `migrations.test.ts` —,
 * de modo que ampliarla exige escribir la justificación.
 */

interface ExcepcionJustificada {
  /** Ruta relativa a la raíz del monorepo. */
  archivo: string;
  /**
   * Nombres de los objetos que ese archivo puede crear. Se comprueba el nombre
   * concreto, no el archivo entero: un archivo exento para un trigger de
   * inyección de fallos no queda exento para crear una política.
   */
  objetos: readonly string[];
  motivo: string;
}

const EXCEPCIONES_JUSTIFICADAS: readonly ExcepcionJustificada[] = [
  {
    archivo:
      'apps/api/src/modules/core/clientes/__tests__/propietarios.api.test.ts',
    objetos: ['fallar_insert_perfil', 'trg_fallar_insert_perfil'],
    motivo:
      'Inyección de fallos del test de atomicidad de R22: el trigger provoca ' +
      'el error que se quiere observar (es el estímulo), no el objeto sobre ' +
      'el que se afirma nada. Permitido por la nota de R57. Es permanente.',
  },
];

// ─── Deuda saldada en T63 ───────────────────────────────────────────────────
//
// Aquí había CUATRO entradas más —`tenant-rls`, `auth-rbac`, `clientes-rls` y
// `audit-log`, todas por el mismo motivo: cada una creaba a mano un rol
// `app_test_user` y después afirmaba sobre el aislamiento que ese rol veía.
// Llevaban escrita su fecha de caducidad ("la retira T63") desde que se creó
// este guard.
//
// **T63 la retiró.** Los cuatro archivos usan ahora `asegurarRolDeAplicacion`,
// el mismo procedimiento de provisión que ejecuta `npm run db:migrate` en
// producción (R46, R48, R57). Eso cambia lo que los tests significan: antes
// medían un rol inventado para la ocasión, con los GRANT que el propio test
// consideraba oportunos; ahora miden **el rol con el que corre la aplicación**,
// con sus privilegios reales. Si mañana alguien le concediera `DELETE` a ese
// rol, `rol-aplicacion.test.ts` se pondría rojo.
//
// La lista se deja vacía a propósito, no se borra: que exista y esté vacía es
// la afirmación de que hoy **ningún** test de `apps/api` fabrica el objeto que
// verifica, salvo la inyección de fallos de arriba, que no es el sujeto de
// ninguna aserción.

/** Directorios de `apps/api` donde viven tests o sus ayudantes. */
const RAICES_ESCANEADAS: readonly string[] = [
  'apps/api/src',
  'apps/api/test',
];

function esArchivoDeTest(ruta: string): boolean {
  // Los ayudantes de test cuentan: si no, bastaría con mover el DDL a
  // `test/support/` para esquivar el guard.
  return ruta.endsWith('.test.ts') || ruta.includes('/test/support/');
}

function listarArchivos(directorio: string): string[] {
  const encontrados: string[] = [];
  for (const entrada of readdirSync(directorio)) {
    if (entrada === 'node_modules' || entrada === 'dist') continue;
    const completa = join(directorio, entrada);
    if (statSync(completa).isDirectory()) {
      encontrados.push(...listarArchivos(completa));
    } else if (entrada.endsWith('.ts')) {
      encontrados.push(completa);
    }
  }
  return encontrados;
}

const ARCHIVOS_DE_TEST: readonly string[] = RAICES_ESCANEADAS.flatMap((raiz) =>
  listarArchivos(rutaRepo(raiz)),
)
  .map((absoluta) => relative(rutaRepo(), absoluta).split('\\').join('/'))
  .filter(esArchivoDeTest)
  .sort();

/**
 * Elimina los comentarios de TypeScript antes de buscar DDL.
 *
 * Sin esto, un comentario que explica *por qué* un test ya NO crea un trigger
 * dispararía el guard: exactamente lo contrario de lo que se busca.
 */
function sinComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[\s;{(])\/\/[^\n]*/g, '$1');
}

interface Hallazgo {
  archivo: string;
  sentencia: string;
  objeto: string;
}

const CREACIONES =
  /create\s+(?:or\s+replace\s+)?(trigger|function|policy|role)\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
/** `GRANT ... TO <rol>`: el objeto relevante es el beneficiario. */
const CONCESIONES = /\bgrant\s+[^;'"`]*?\bto\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;

function buscarDdl(archivo: string): Hallazgo[] {
  const codigo = sinComentarios(leerTexto(archivo));
  const hallazgos: Hallazgo[] = [];

  for (const coincidencia of codigo.matchAll(CREACIONES)) {
    hallazgos.push({
      archivo,
      sentencia: `CREATE ${(coincidencia[1] ?? '').toUpperCase()}`,
      objeto: coincidencia[2] ?? '',
    });
  }
  for (const coincidencia of codigo.matchAll(CONCESIONES)) {
    hallazgos.push({
      archivo,
      sentencia: 'GRANT',
      objeto: coincidencia[1] ?? '',
    });
  }

  return hallazgos;
}

const TODOS_LOS_HALLAZGOS: readonly Hallazgo[] =
  ARCHIVOS_DE_TEST.flatMap(buscarDdl);

function estaJustificado(hallazgo: Hallazgo): boolean {
  return EXCEPCIONES_JUSTIFICADAS.some(
    (excepcion) =>
      excepcion.archivo === hallazgo.archivo &&
      excepcion.objetos.includes(hallazgo.objeto),
  );
}

describe('Ningún test fabrica el objeto de esquema que verifica (R57)', () => {
  it('encuentra archivos de test que escanear', () => {
    // Si el escáner deja de ver archivos (una ruta que cambia, un glob roto),
    // el guard pasaría en verde sin haber mirado nada.
    expect(ARCHIVOS_DE_TEST.length).toBeGreaterThan(10);
    expect(ARCHIVOS_DE_TEST).toContain(
      'apps/api/src/database/__tests__/audit-log.test.ts',
    );
  });

  it('ningún test de apps/api crea triggers, funciones, políticas o roles', () => {
    const noJustificados = TODOS_LOS_HALLAZGOS.filter(
      (hallazgo) => !estaJustificado(hallazgo),
    );

    expect(
      noJustificados.map((h) => `${h.archivo}: ${h.sentencia} ${h.objeto}`),
      'Un test no puede crear el objeto de esquema sobre el que afirma (R57): ' +
        'sería verde por construcción. Muévelo a una migración o al ' +
        'procedimiento de provisión del rol. Si de verdad es inyección de ' +
        'fallos, añádelo a EXCEPCIONES_JUSTIFICADAS con su motivo.',
    ).toEqual([]);
  });

  it('audit-log.test.ts ya no crea la función ni los triggers append-only (R40)', () => {
    const hallazgos = buscarDdl(
      'apps/api/src/database/__tests__/audit-log.test.ts',
    ).map((h) => h.objeto);

    expect(hallazgos).not.toContain('audit_log_prevent_mutation');
    expect(hallazgos).not.toContain('trg_audit_log_no_update');
    expect(hallazgos).not.toContain('trg_audit_log_no_delete');
  });

  it('los triggers append-only los crea una migración versionada (R40)', () => {
    const migracion = leerTexto(
      'apps/api/drizzle/0006_auditoria_append_only.sql',
    ).replace(/--.*$/gm, '');

    expect(migracion).toMatch(
      /create\s+or\s+replace\s+function\s+audit_log_prevent_mutation/i,
    );
    expect(migracion).toMatch(
      /create\s+trigger\s+trg_audit_log_no_update[\s\S]*?before\s+update\s+on\s+"?audit_log"?/i,
    );
    expect(migracion).toMatch(
      /create\s+trigger\s+trg_audit_log_no_delete[\s\S]*?before\s+delete\s+on\s+"?audit_log"?/i,
    );
  });

  it('la migración 0004 no se edita: la corrección va en la nueva (R42)', () => {
    // R42 y `design.md` §17: Drizzle identifica cada migración por el hash del
    // archivo, así que retocar el comentario falso de 0004 la convertiría en
    // otra migración para el runner.
    expect(leerTexto('apps/api/drizzle/0006_auditoria_append_only.sql')).toMatch(
      /0004_auditoria\.sql/,
    );
  });

  it('cada excepción sigue siendo necesaria (no hay entradas caducas)', () => {
    for (const excepcion of EXCEPCIONES_JUSTIFICADAS) {
      const objetosCreados = buscarDdl(excepcion.archivo).map((h) => h.objeto);
      const usados = excepcion.objetos.filter((objeto) =>
        objetosCreados.includes(objeto),
      );

      expect(
        usados,
        `${excepcion.archivo} ya no crea ${excepcion.objetos.join(', ')}: ` +
          'retira su entrada de EXCEPCIONES_JUSTIFICADAS en vez de dejar un ' +
          'permiso abierto para el futuro.',
      ).not.toEqual([]);
      expect(excepcion.motivo.length).toBeGreaterThan(40);
    }
  });
});
