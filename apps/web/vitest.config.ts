import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@inmobiliaria/types': path.resolve(
        __dirname,
        '../../packages/types/src/index.ts',
      ),
    },
  },
  test: {
    name: 'web',
    root: __dirname,
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['**/node_modules/**', 'dist/**'],
  },
});
