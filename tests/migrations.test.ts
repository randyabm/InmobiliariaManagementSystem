import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { leerJson, leerTexto, rutaRepo } from './support/repo';

interface EntradaJournal {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: EntradaJournal[];
}

const CARPETA = 'apps/api/drizzle';
const journal = leerJson<Journal>(CARPETA, 'meta', '_journal.json');

const archivosSql = readdirSync(rutaRepo(CARPETA))
  .filter((nombre) => nombre.endsWith('.sql'))
  .sort();

/**
 * Tablas cuya creación se permite en las migraciones.
 *
 * La primera tabla de negocio (`tenant`) se creó en la feature #2
 * `multitenancy_rls` con su RLS (docs/conventions.md).
 * Las tablas `user` y `user_role` se crearon en la feature #3
 * `auth_rbac` (specs/auth_rbac/).
 * La tabla `audit_log` se creó en la feature #4 `auditoria`.
 * Las tablas `perfil_propietario`, `perfil_inquilino` y `cuenta_bancaria` se
 * crearon en la feature #5 `owner_tenant_profiles`
 * (specs/owner_tenant_profiles/, R37), todas con RLS habilitado y forzado en
 * la misma migración que las crea.
 * Las tablas `tarifa_retencion`, `codeudor_inquilino` y `referencia_inquilino`
 * se crearon en la feature #25 `retencion_codeudor_referencias` (R4, R25),
 * también con RLS habilitado y forzado en la misma migración.
 * La tabla `sesion` se creó en la feature #27 `sesion_y_revocacion` (R1,
 * R20), con RLS habilitado y forzado en la misma migración.
 * Las tablas `propiedad`, `propiedad_propietario`, `historial_ocupacion` y
 * `propiedad_documento` se crearon en la feature #6 `property_profile`
 * (R1-R4, R22), con RLS habilitado y forzado en la misma migración.
 * Las cinco tablas `workflow_*` se crearon en la feature #7
 * `workflow_engine` (R1, R2, R6, R12), con RLS habilitado y forzado en la
 * misma migración.
 * Las tres tablas `notificacion_*` se crearon en la feature #10
 * `notifications` (R1, R6, R10), con RLS habilitado y forzado en la misma
 * migración.
 * Las tres tablas `plantilla_*` se crearon en la feature #11
 * `inventory_templates` (R1, R2, R3), con RLS habilitado y forzado en la
 * misma migración.
 * Las cuatro tablas `inventario*` se crearon en la feature #12
 * `inventory_creation` (R1, R2, R3), con RLS habilitado y forzado en la
 * misma migración.
 * Las tres tablas de la revisión (`invitacion_inventario`, `codigo_otp`,
 * `inventario_item_revision`) se crearon en la feature #13
 * `inventory_tenant_review` (R1, R4, R6), con RLS habilitado y forzado en
 * la misma migración.
 * La tabla `inventario_firma` (evidencia de la firma, append-only) se
 * creó en la feature #14 `inventory_signature_pdf` (R3), con RLS
 * habilitado y forzado en la misma migración.
 * La tabla `contract_template` se creó en la feature #16
 * `contract_templates` (R6), con RLS habilitado y forzado en la misma
 * migración.
 * Las tablas `contract` y `contrato_firma` (evidencia append-only) se
 * crearon en la feature #17 `contract_generation_signature` (R7), con
 * RLS habilitado y forzado en la misma migración.
 * La tabla `contract_document` se creó en la feature #18
 * `contract_digitization` (R4), con RLS habilitado y forzado en la misma
 * migración.
 * Las tablas `config_renovacion` y `alerta_vencimiento` se crearon en la
 * feature #19 `contract_renewals_alerts` (R6), con RLS habilitado y
 * forzado en la misma migración.
 * La tabla `insurance_policy` se creó en la feature #20 `insurance_policy`
 * (R4), con RLS habilitado y forzado en la misma migración.
 * La tabla `inventario_version` se creó en la feature #22
 * `inventory_versioning` (R5), con RLS habilitado y forzado en la misma
 * migración.
 * Las tablas `payment_import`, `payment_import_fila`, `payment_record` y
 * `payment_mapping_profile` se crearon en la feature #30
 * `payment_reconciliation` (R7), con RLS habilitado y forzado en la misma
 * migración.
 */
const TABLAS_PERMITIDAS: readonly string[] = [
  'tenant',
  'user',
  'user_role',
  'audit_log',
  'sesion',
  'perfil_propietario',
  'perfil_inquilino',
  'cuenta_bancaria',
  'tarifa_retencion',
  'codeudor_inquilino',
  'referencia_inquilino',
  'propiedad',
  'propiedad_propietario',
  'historial_ocupacion',
  'propiedad_documento',
  'workflow_definicion',
  'workflow_estado',
  'workflow_transicion',
  'workflow_instancia',
  'workflow_transicion_log',
  'notificacion_pendiente',
  'notificacion_enviada',
  'notificacion_programada',
  'plantilla_inmueble',
  'plantilla_zona',
  'plantilla_item',
  'inventario',
  'inventario_zona',
  'inventario_item',
  'inventario_item_foto',
  'invitacion_inventario',
  'codigo_otp',
  'inventario_item_revision',
  'inventario_firma',
  'contract_template',
  'contract',
  'contrato_firma',
  'contract_document',
  'config_renovacion',
  'alerta_vencimiento',
  'insurance_policy',
  'inventario_version',
  'payment_import',
  'payment_import_fila',
  'payment_record',
  'payment_mapping_profile',
];

describe('Migración inicial (R10)', () => {
  it('existe el archivo de migración inicial', () => {
    expect(archivosSql).toContain('0000_init.sql');
  });

  it('el script db:migrate está definido en la raíz y en apps/api', () => {
    const raiz = leerJson<{ scripts: Record<string, string> }>('package.json');
    const api = leerJson<{ scripts: Record<string, string> }>(
      'apps/api',
      'package.json',
    );

    expect(raiz.scripts['db:migrate']).toBeDefined();
    expect(api.scripts['db:migrate']).toBeDefined();
  });

  it('ninguna migración de esta feature crea tablas de negocio', () => {
    for (const archivo of archivosSql) {
      const sql = leerTexto(CARPETA, archivo)
        // Se descartan los comentarios: la migración explica en prosa por qué
        // NO crea tablas, y esa explicación no debe disparar el test.
        .replace(/--.*$/gm, '')
        .toLowerCase();

      const creaciones = [
        ...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/g),
      ].map((coincidencia) => coincidencia[1] ?? '');

      for (const tabla of creaciones) {
        expect(
          TABLAS_PERMITIDAS,
          `${archivo} crea la tabla "${tabla}" fuera de la lista permitida: ` +
            'las tablas de negocio y su RLS son de la feature #2',
        ).toContain(tabla);
      }
    }
  });

  it('la migración inicial se limita a preparar el esquema base', () => {
    const sql = leerTexto(CARPETA, '0000_init.sql')
      .replace(/--.*$/gm, '')
      .toLowerCase();

    expect(sql).toContain('create extension');
    expect(sql).not.toContain('row level security');
    expect(sql).not.toContain('create policy');
  });
});

describe('Registro de migraciones (R12)', () => {
  it('el journal está ordenado, sin huecos ni duplicados', () => {
    const indices = journal.entries.map((entrada) => entrada.idx);

    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(new Set(indices).size).toBe(indices.length);
    indices.forEach((idx, posicion) => {
      expect(idx).toBe(posicion);
    });
  });

  it('cada entrada del journal corresponde a un archivo .sql existente', () => {
    for (const entrada of journal.entries) {
      expect(archivosSql, `entrada ${entrada.tag}`).toContain(
        `${entrada.tag}.sql`,
      );
    }
  });

  it('ningún archivo .sql queda sin registrar en el journal', () => {
    const registrados = new Set(
      journal.entries.map((entrada) => `${entrada.tag}.sql`),
    );

    for (const archivo of archivosSql) {
      expect(registrados, `archivo ${archivo}`).toContain(archivo);
    }
  });

  it('los tags no se repiten y el dialecto es postgresql', () => {
    const tags = journal.entries.map((entrada) => entrada.tag);
    expect(new Set(tags).size).toBe(tags.length);
    expect(journal.dialect).toBe('postgresql');
  });
});
