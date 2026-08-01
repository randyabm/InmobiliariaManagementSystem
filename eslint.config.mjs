// Configuración ESLint 9 (flat config) compartida por todo el monorepo.
// Ancla: docs/conventions.md. Las reglas de frontera entre paquetes
// (docs/architecture.md) se expresan aquí como reglas ejecutables, no como
// recomendaciones en prosa.

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * R4 / docs/architecture.md: un paquete NUNCA importa a otro por una ruta
 * relativa que cruce su frontera. Los tipos compartidos se importan siempre
 * por el alias del workspace (`@inmobiliaria/types`).
 *
 * Los patrones se evalúan sobre el literal del `import`: cualquier ruta
 * relativa que atraviese un segmento `apps/` o `packages/` está saliendo de su
 * paquete. Las rutas relativas *dentro* del mismo paquete siguen permitidas,
 * por profundas que sean (un test en `src/modules/core/health/__tests__/` no
 * está cruzando ninguna frontera al importar de `src/`).
 */
export const CROSS_PACKAGE_IMPORT_RULE = [
  'error',
  {
    patterns: [
      {
        group: ['**/packages/**', '**/apps/**'],
        message:
          'No importes otro paquete por ruta relativa: usa el alias del workspace (p. ej. "@inmobiliaria/types").',
      },
    ],
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.vite/**',
      'apps/api/drizzle/**',
      // El service worker corre en el ámbito del worker, no del navegador:
      // `self`, `caches` y los eventos de instalación son globales de ese
      // contexto (feature #15).
      'apps/pwa/public/sw.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,cts,js,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
    },
    rules: {
      'no-restricted-imports': CROSS_PACKAGE_IMPORT_RULE,
      // docs/conventions.md: nada de `console.log` de debug.
      'no-console': ['error', { allow: ['info', 'warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // El código de navegador vive solo en apps/web.
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  prettier,
);
