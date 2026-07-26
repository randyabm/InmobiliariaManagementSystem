import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

import { leerTexto } from './support/repo';

// ---------------------------------------------------------------------------
// Tipos para parseo del compose de CI
// ---------------------------------------------------------------------------

interface ServicioCI {
  image?: string;
  container_name?: string;
  restart?: string;
  environment?: Record<string, string> | string[];
  ports?: string[];
  volumes?: (string | { [key: string]: unknown })[];
  privileged?: boolean;
  command?: string[];
  healthcheck?: unknown;
  depends_on?: unknown;
  networks?: string[];
}

interface ComposeCI {
  name?: string;
  services: Record<string, ServicioCI>;
  volumes?: Record<string, unknown>;
  networks?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function leerComposeCI(): ComposeCI {
  return load(leerTexto('ci/forgejo/docker-compose.ci.yml')) as ComposeCI;
}

function leerComposeRoot(): string {
  return leerTexto('docker-compose.yml');
}

function leerEnvExample(): string {
  return leerTexto('ci/forgejo/.env.example');
}

function variablesCompose(compose: string): string[] {
  return [...new Set([...compose.matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((m) => m[1] ?? ''))];
}

function clavesEnvExample(texto: string): Set<string> {
  return new Set(
    texto
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'))
      .map((l) => l.split('=')[0]?.trim() ?? ''),
  );
}

// ---------------------------------------------------------------------------
// R1 — Proyecto separado, compose de CI no mezclado con el de desarrollo
// ---------------------------------------------------------------------------

describe('R1 — Compose de CI separado', () => {
  const compose = leerComposeCI();

  it('declara un nombre de proyecto propio', () => {
    expect(compose.name).toBe('inmobiliaria-ci');
  });

  it('el compose raíz no contiene servicios de CI', () => {
    const rootParsed = load(leerComposeRoot()) as { services?: Record<string, unknown> };
    const serviciosRoot = Object.keys(rootParsed.services ?? {});
    const nombresCI = Object.keys(compose.services);
    for (const nombre of nombresCI) {
      expect(serviciosRoot, `servicio CI "${nombre}" no debe existir en compose raíz`).not.toContain(nombre);
    }
  });
});

// ---------------------------------------------------------------------------
// R2 — Sin latest ni etiquetas móviles
// ---------------------------------------------------------------------------

describe('R2 — Imágenes con versiones fijas', () => {
  const compose = leerComposeCI();

  it('ninguna imagen usa latest ni omite la etiqueta', () => {
    for (const [nombre, servicio] of Object.entries(compose.services)) {
      const imagen = servicio.image ?? '';
      expect(imagen, `${nombre}.image`).not.toBe('');
      expect(imagen, `${nombre}.image debe tener :`).toContain(':');
      const tag = imagen.split(':').pop() ?? '';
      expect(tag, `${nombre}.image tag`).not.toBe('latest');
      expect(tag, `${nombre}.image tag debe tener un dígito`).toMatch(/\d/);
    }
  });
});

// ---------------------------------------------------------------------------
// R3 — Variables de entorno interpoladas, sin secretos literales
// ---------------------------------------------------------------------------

describe('R3 — Sin credenciales literales en el compose de CI', () => {
  const compose = leerComposeCI();
  const envTxt = leerEnvExample();
  const declaradas = clavesEnvExample(envTxt);

  it('todo valor de environment es interpolación ${VAR}', () => {
    // Valores que no son sensibles: configuración de la app, no credenciales
    const NO_SENSIBLES = [
      'USER_UID', 'USER_GID', 'DOCKER_TLS_CERTDIR',
      'FORGEJO__database__DB_TYPE', 'FORGEJO__service__DISABLE_REGISTRATION',
      'FORGEJO__server__HTTP_PORT', 'FORGEJO__server__DOMAIN',
      'DOCKER_HOST', 'TESTCONTAINERS_HOST_OVERRIDE',
    ];
    for (const [nombre, servicio] of Object.entries(compose.services)) {
      const env = servicio.environment ?? {};
      if (Array.isArray(env)) {
        for (const linea of env) {
          const clave = linea.split('=')[0]?.trim();
          const valor = linea.split('=').slice(1).join('=');
          if (clave && !NO_SENSIBLES.includes(clave)) {
            expect(valor, `${nombre}.${clave}`).toMatch(/^\$\{[A-Z0-9_]+\}$/);
          }
        }
      } else {
        for (const [clave, valor] of Object.entries(env)) {
          if (!NO_SENSIBLES.includes(clave)) {
            expect(valor, `${nombre}.${clave}`).toMatch(/^\$\{[A-Z0-9_]+\}$/);
          }
        }
      }
    }
  });

  it('ci/forgejo/.env está en .gitignore', () => {
    const gitignore = leerTexto('.gitignore');
    expect(gitignore).toContain('ci/forgejo/.env');
  });

  it('.env.example solo contiene CHANGE_ME en valores sensibles', () => {
    const sensibles = [
      'FORGEJO_ADMIN_USUARIO',
      'FORGEJO_ADMIN_PASSWORD',
      'FORGEJO_API_TOKEN',
    ];
    const lineas = envTxt.split('\n').filter((l) => sensibles.some((s) => l.startsWith(`${s}=`)));
    expect(lineas.length).toBe(sensibles.length);
    for (const linea of lineas) {
      expect(linea.split('=').slice(1).join('=').trim()).toBe('CHANGE_ME');
    }
  });

  it('todas las variables interpoladas existen en .env.example', () => {
    const compose = leerComposeCI();
    const txt = JSON.stringify(compose);
    const usadas = variablesCompose(txt);
    for (const variable of new Set(usadas)) {
      expect(declaradas, `variable ${variable}`).toContain(variable);
    }
  });
});

// ---------------------------------------------------------------------------
// R4 — Datos del runner en volumen nombrado
// ---------------------------------------------------------------------------

describe('R4 — Runner con datos en volumen nombrado', () => {
  const compose = leerComposeCI();

  it('el servicio runner monta un volumen nombrado', () => {
    const runner = compose.services['runner'];
    expect(runner).toBeDefined();
    if (!runner) return;
    const volumes = runner.volumes ?? [];
    const tieneVolumenNombrado = volumes.some((v) => {
      if (typeof v === 'string') return /^[a-z][a-z0-9_-]*:/.test(v);
      return false;
    });
    expect(tieneVolumenNombrado, 'runner debe tener un volumen nombrado').toBe(true);
  });

  it('no hay bind mount del repositorio en el runner', () => {
    const runner = compose.services['runner'];
    if (!runner) return;
    const volumes = runner.volumes ?? [];
    for (const v of volumes) {
      if (typeof v === 'string') {
        expect(v, `runner volume ${v}`).not.toContain('./');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// R5 — Servicio dind y DOCKER_HOST
// ---------------------------------------------------------------------------

describe('R5 — Docker-in-Docker', () => {
  const compose = leerComposeCI();

  it('existe el servicio docker (dind)', () => {
    expect(compose.services['docker']).toBeDefined();
  });

  it('el servicio docker está privilegiado', () => {
    const docker = compose.services['docker'];
    expect(docker).toBeDefined();
    expect(docker?.privileged).toBe(true);
  });

  it('el runner recibe DOCKER_HOST apuntando al dind', () => {
    const runner = compose.services['runner'];
    if (!runner) return;
    const env = runner.environment ?? {};
    let dockerHost = '';
    if (Array.isArray(env)) {
      const linea = env.find((l) => l.startsWith('DOCKER_HOST='));
      dockerHost = linea?.split('=').slice(1).join('=') ?? '';
    } else {
      dockerHost = env['DOCKER_HOST'] ?? '';
    }
    expect(dockerHost).toContain('docker');
    expect(dockerHost).toContain('2375');
  });
});

// ---------------------------------------------------------------------------
// R6 — Ninguna aparición de docker.sock (test negativo)
// ---------------------------------------------------------------------------

describe('R6 — Sin docker.sock montado', () => {
  it('docker.sock no aparece en el compose de CI', () => {
    const compose = leerTexto('ci/forgejo/docker-compose.ci.yml');
    expect(compose).not.toMatch(/docker\.sock/);
  });

  it('docker.sock no aparece en config-runner.yml', () => {
    const config = leerTexto('ci/forgejo/config-runner.yml');
    expect(config).not.toMatch(/docker\.sock/);
  });
});

// ---------------------------------------------------------------------------
// R7 — Registro público deshabilitado
// ---------------------------------------------------------------------------

describe('R7 — Registro público deshabilitado', () => {
  const compose = leerComposeCI();

  it('FORGEJO__service__DISABLE_REGISTRATION está en true', () => {
    const forgejo = compose.services['forgejo'];
    if (!forgejo) { expect(forgejo).toBeDefined(); return; }
    const env = forgejo.environment ?? [];
    let deshabilitado = false;
    if (Array.isArray(env)) {
      deshabilitado = env.some(
        (l) =>
          l.includes('DISABLE_REGISTRATION') && l.includes('true'),
      );
    } else {
      deshabilitado =
        env['FORGEJO__service__DISABLE_REGISTRATION'] === 'true';
    }
    expect(deshabilitado).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R8 — Puertos con interfaz por variable
// ---------------------------------------------------------------------------

describe('R8 — Puertos con interfaz por variable', () => {
  const compose = leerComposeCI();
  const envTxt = leerEnvExample();
  const declaradas = clavesEnvExample(envTxt);

  it('todo puerto tiene la forma ${VAR}:<puerto>', () => {
    const forgejo = compose.services['forgejo'];
    if (!forgejo) { expect(forgejo).toBeDefined(); return; }
    for (const port of forgejo.ports ?? []) {
      const puerto = String(port);
      expect(puerto, `puerto ${puerto}`).toMatch(/^\$\{[A-Z_0-9]+\}:/);
    }
  });

  it('.env.example declara FORGEJO_BIND con valor 127.0.0.1', () => {
    expect(declaradas).toContain('FORGEJO_BIND');
    const lineas = envTxt.split('\n').filter((l) => l.startsWith('FORGEJO_BIND='));
    expect(lineas.length).toBe(1);
    expect(lineas[0]).toContain('127.0.0.1');
  });
});

// ---------------------------------------------------------------------------
// R23 — Barrido de credenciales en ci/ y .forgejo/
// ---------------------------------------------------------------------------

describe('R23 — Sin credenciales en archivos de CI', () => {
  const patrones = [
    /token\s*=\s*["']?[a-f0-9]{40}["']?/i,
    /password\s*=\s*["']?(?!\$\{)(?!CHANGE_ME)[A-Za-z0-9@!._-]{8,}["']?/i,
  ];

  it('no hay tokens de Forgejo en ci/', () => {
    const archivos = [
      'ci/forgejo/docker-compose.ci.yml',
      'ci/forgejo/config-runner.yml',
      'ci/forgejo/.env.example',
      'ci/forgejo/scripts/levantar.sh',
      'ci/forgejo/scripts/registrar-runner.sh',
    ];
    for (const archivo of archivos) {
      const contenido = leerTexto(archivo);
      for (const patron of patrones) {
        expect(contenido, `${archivo} contiene posible credencial`).not.toMatch(patron);
      }
    }
  });
});
