import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/KABOOM/',
  worker: {
    format: 'es',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
