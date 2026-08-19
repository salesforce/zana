import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@zana-ai/zcc-host-daemon': resolve(__dirname, '../host-daemon/src/index.ts')
    }
  },
  test: {
    environment: 'node'
  }
});
