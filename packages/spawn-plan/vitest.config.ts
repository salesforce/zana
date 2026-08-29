import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts']
  },
  resolve: {
    alias: {
      '@zana-ai/zcc-domain/product': resolve(__dirname, '../domain/src/product.ts'),
      '@zana-ai/zcc-domain': resolve(__dirname, '../domain/src/index.ts')
    }
  }
});
