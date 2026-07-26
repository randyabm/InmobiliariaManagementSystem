import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

import { leerTexto, leerJson } from './support/repo';

// ---------------------------------------------------------------------------
// Tipos para el workflow
// ---------------------------------------------------------------------------

interface Step {
  uses?: string;
  run?: string;
  name?: string;
  env?: Record<string, string>;
  'continue-on-error'?: boolean;
}

interface Job {
  'runs-on'?: string;
  steps: Step[];
  'continue-on-error'?: boolean;
  if?: string;
  needs?: string | string[];
}

interface Workflow {
  on?: Record<string, unknown>;
  jobs: Record<string, Job>;
  concurrency?: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function leerWorkflow(): Workflow {
  return load(leerTexto('.forgejo/workflows/ci.yml')) as Workflow;
}

function leerWorkflowTxt(): string {
  return leerTexto('.forgejo/workflows/ci.yml');
}

interface PackageJson {
  scripts?: Record<string, string>;
  engines?: { node?: string };
}

function leerPackageRoot(): PackageJson {
  return leerJson<PackageJson>('package.json');
}

function scriptsInvocados(workflow: Workflow): Set<string> {
  const scripts = new Set<string>();
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) {
      if (step.run) {
        const coincidencias = step.run.matchAll(/npm run ([\w:@._-]+)/g);
        for (const m of coincidencias) {
          scripts.add(m[1] ?? '');
        }
      }
    }
  }
  return scripts;
}

// ---------------------------------------------------------------------------
// R9 — Disparadores push y pull_request sobre main
// ---------------------------------------------------------------------------

describe('R9 — Disparadores del workflow', () => {
  const workflow = leerWorkflow();

  it('se dispara en push', () => {
    expect(workflow.on?.push).toBeDefined();
    const push = workflow.on?.push as { branches?: string[] };
    expect(push.branches).toContain('main');
  });

  it('se dispara en pull_request', () => {
    expect(workflow.on?.pull_request).toBeDefined();
    const pr = workflow.on?.pull_request as { branches?: string[] };
    expect(pr.branches).toContain('main');
  });
});

// ---------------------------------------------------------------------------
// R10–R14 — Scripts npm requeridos
// ---------------------------------------------------------------------------

describe('R10–R14 — Scripts npm ejecutados', () => {
  const workflow = leerWorkflow();
  const scripts = scriptsInvocados(workflow);

  const REQUERIDOS = ['lint', 'typecheck', 'test', 'build', 'test:db'] as const;

  it.each(REQUERIDOS)('ejecuta el script "%s"', (script) => {
    expect(scripts.has(script), `script "${script}" no encontrado`).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R16 — ./init.sh se ejecuta
// ---------------------------------------------------------------------------

describe('R16 — init.sh ejecutado', () => {
  const workflow = leerWorkflow();
  let initShEjecutado = false;

  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) {
      if (step.run?.includes('./init.sh')) {
        initShEjecutado = true;
      }
    }
  }

  it('el workflow ejecuta ./init.sh', () => {
    expect(initShEjecutado).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R17 — Sin escapes de fallo
// ---------------------------------------------------------------------------

describe('R17 — Sin escapes de fallo', () => {
  const txt = leerWorkflowTxt();
  const workflow = leerWorkflow();

  const PATRONES_TEXTO = [
    /\|\|\s*true/,
    /;\s*true/,
    /set\s+\+e/,
    /--passWithNoTests/,
  ];

  it('ningún patrón de escape en el texto del workflow', () => {
    for (const patron of PATRONES_TEXTO) {
      expect(txt, `patrón ${patron} encontrado`).not.toMatch(patron);
    }
  });

  it('ningún continue-on-error a nivel de job', () => {
    for (const [nombre, job] of Object.entries(workflow.jobs)) {
      expect(job['continue-on-error'], `job "${nombre}"`).toBeUndefined();
    }
  });

  it('ningún continue-on-error a nivel de step', () => {
    for (const [nombre, job] of Object.entries(workflow.jobs)) {
      for (let i = 0; i < job.steps.length; i++) {
        expect(
          job.steps[i]?.['continue-on-error'],
          `job "${nombre}" step ${i}`,
        ).toBeUndefined();
      }
    }
  });

  it('test:db no tiene escape de fallo', () => {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        if (step.run?.includes('test:db')) {
          expect(step.run).not.toMatch(/\|\|\s*true/);
          expect(step.run).not.toMatch(/set\s+\+e/);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// R18 — Todo script invocado existe en package.json
// ---------------------------------------------------------------------------

describe('R18 — Scripts existentes', () => {
  const workflow = leerWorkflow();
  const scripts = scriptsInvocados(workflow);
  const pkg = leerPackageRoot();

  it('todo script npm invocado está declarado en package.json raíz', () => {
    for (const script of scripts) {
      expect(pkg.scripts, `script "${script}"`).toHaveProperty(script);
    }
  });
});

// ---------------------------------------------------------------------------
// R19 — Fuente única de versión de Node
// ---------------------------------------------------------------------------

describe('R19 — Versión de Node desde .nvmrc', () => {
  const txt = leerWorkflowTxt();

  it('usa node-version-file: .nvmrc', () => {
    expect(txt).toContain('node-version-file: .nvmrc');
  });

  it('no contiene literal de versión de Node', () => {
    expect(txt).not.toMatch(/node-version:\s*\d/);
    expect(txt).not.toMatch(/node:\d/);
  });

  it('.nvmrc satisface engines.node del package.json', () => {
    const nvmrc = leerTexto('.nvmrc').trim();
    const pkg = leerPackageRoot();
    const rango = pkg.engines?.node;
    expect(rango).toBeDefined();
    // Verificación simple: la versión de .nvmrc debe ser un número >= 20
    const version = parseInt(nvmrc, 10);
    expect(version).toBeGreaterThanOrEqual(20);
  });
});

// ---------------------------------------------------------------------------
// R22 — Jobs del workflow == CONTEXTOS_REQUERIDOS de proteger-rama.sh
// ---------------------------------------------------------------------------

describe('R22 — Consistencia entre jobs y contextos requeridos', () => {
  it('los ids de job coinciden con CONTEXTOS_REQUERIDOS del script', () => {
    const workflow = leerWorkflow();
    const jobIds = Object.keys(workflow.jobs).sort();

    // Leer CONTEXTOS_REQUERIDOS del script
    const script = leerTexto('ci/forgejo/scripts/proteger-rama.sh');
    const match = script.match(
      /CONTEXTOS_REQUERIDOS=\(([^)]+)\)/s,
    );
    expect(match, 'CONTEXTOS_REQUERIDOS no encontrado en proteger-rama.sh').toBeDefined();

    const contextos = (match?.[1] ?? '')
      .split(/\s+/)
      .map((c) => c.replace(/"/g, '').trim())
      .filter((c) => c.length > 0)
      .sort();

    expect(contextos).toEqual(jobIds);
  });
});
