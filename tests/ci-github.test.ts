import { execSync } from 'node:child_process';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

import { leerTexto } from './support/repo';

/**
 * CI (feature #23) — GitHub Actions como único pipeline (PA-23-1).
 *
 * El repo migró a GitHub Actions y Forgejo se eliminó por completo: el
 * infraestructura, los workflows `.forgejo/`, el remote y las referencias
 * de producto. Este archivo sustituye a `ci-infraestructura.test.ts` y
 * `ci-flujo-trabajo.test.ts` (Forgejo) con el mismo espíritu: el CI es un
 * contrato verificado, no una promesa.
 */

interface WorkflowGithub {
  name?: string;
  on?: unknown;
  jobs?: Record<string, { ['runs-on']?: string; steps?: Array<{ name?: string; run?: string }> }>;
}

function leerWorkflow(): WorkflowGithub {
  return load(leerTexto('.github/workflows/ci.yml')) as WorkflowGithub;
}

describe('CI — GitHub Actions (feature #23)', () => {
  it('el workflow existe y es YAML válido con un solo job de verificación', () => {
    const workflow = leerWorkflow();
    expect(workflow.name).toBe('CI');
    expect(Object.keys(workflow.jobs ?? {})).toEqual(['verify']);
    expect(workflow.jobs?.verify?.['runs-on']).toBe('ubuntu-latest');
  });

  it('el workflow reproduce el semáforo de init.sh en orden (R1)', () => {
    const pasos = (leerWorkflow().jobs?.verify?.steps ?? [])
      .map((s) => s.name ?? s.run ?? '')
      .filter((n) => n.length > 0);
    const orden = ['npm ci', 'Lint', 'Typecheck', 'Tests deterministas', 'Tests de base de datos real (PostgreSQL via Testcontainers)', 'Build'];
    for (const paso of orden) {
      expect(pasos, `falta el paso ${paso}`).toContain(paso);
    }
    expect(pasos.indexOf('Lint')).toBeLessThan(pasos.indexOf('Build'));
  });

  it('el workflow no contiene secretos (R3)', () => {
    const texto = leerTexto('.github/workflows/ci.yml');
    expect(texto).not.toMatch(/sk-ant-|BEGIN (RSA|OPENSSH) PRIVATE KEY|password\s*=/i);
    expect(texto).toMatch(/npm ci/);
  });
});

describe('Forgejo eliminado (decisión del humano)', () => {
  it('no existen .forgejo/ ni ci/forgejo/', () => {
    for (const ruta of ['.forgejo/workflows/ci.yml', 'ci/forgejo/docker-compose.ci.yml']) {
      try {
        leerTexto(ruta);
        expect.unreachable(`todavía existe ${ruta}`);
      } catch (error) {
        expect(String(error)).toMatch(/no such file|no existe/i);
      }
    }
  });

  it('no hay remote git llamado forgejo (ni credenciales en remotes)', () => {
    const remotes = execSync('git remote -v', { encoding: 'utf8' });
    expect(remotes.toLowerCase()).not.toMatch(/forgejo/);
    // Ningún remote debe llevar credenciales en la URL (C7).
    expect(remotes).not.toMatch(/:\/\/[^@\s]+@/);
  });

  it('el PRD ya no declara Forgejo como decisión de CI', () => {
    const prd = leerTexto('docs/PRD.md');
    expect(prd.toLowerCase()).not.toMatch(/forgejo/);
    expect(prd).toMatch(/GitHub Actions/i);
  });

  it('.gitignore ya no referencia ci/forgejo', () => {
    const gitignore = leerTexto('.gitignore');
    expect(gitignore).not.toContain('ci/forgejo');
  });
});
