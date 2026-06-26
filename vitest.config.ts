import { mergeConfig } from 'vite';
import { defineConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      exclude: ['**/node_modules/**', '**/.git/**', 'e2e/**'],
      globals: true,
      setupFiles: './src/test/setup.ts',
    },
  }),
);
