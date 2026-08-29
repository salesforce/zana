import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts']
  },
  resolve: {
    alias: {
      '@zana-ai/zcc-plugin-sdk': resolve(__dirname, '../plugin-sdk/src/index.ts'),
      '@zana-ai/zcc-plugin-templates': resolve(__dirname, '../plugin-templates/src/index.ts'),
      '@zana-ai/zcc-plugin-build': resolve(__dirname, '../plugin-build/src/index.ts')
    }
  }
});
