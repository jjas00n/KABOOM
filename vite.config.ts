import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/KABOOM/',
  build: {
    // rapier3d-compat이 WASM을 base64로 인라인해서 약 4.3MB(gzip ~1.8MB). 번들 최적화는 Phase 8.
    chunkSizeWarningLimit: 5500,
  },
  worker: {
    format: 'es',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
