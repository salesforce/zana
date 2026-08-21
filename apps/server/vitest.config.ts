import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@zana-ai/zcc-host-daemon': resolve(__dirname, '../host-daemon/src/index.ts'),
      '@zana-ai/zcc-domain': resolve(__dirname, '../../packages/domain/src/index.ts'),
      '@zana-ai/zcc-plugin-sdk': resolve(__dirname, '../../packages/plugin-sdk/src/index.ts'),
      '@zana-ai/zcc-plugin-sdk/server': resolve(__dirname, '../../packages/plugin-sdk/src/server.ts')
    }
  },
  test: {
    environment: 'node'
  }
});
