import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@zana-ai/zcc-host-daemon': resolve(__dirname, '../host-daemon/src/index.ts'),
      '@zana-ai/zcc-domain': resolve(__dirname, '../../packages/domain/src/index.ts'),
      '@zana-ai/zcc-domain/llm': resolve(__dirname, '../../packages/domain/src/llm.ts'),
      '@zana-ai/zcc-domain/product': resolve(__dirname, '../../packages/domain/src/product.ts'),
      '@zana-ai/zcc-domain/prompt-title': resolve(__dirname, '../../packages/domain/src/prompt-title.ts'),
      '@zana-ai/zcc-domain/thread-runtime': resolve(__dirname, '../../packages/domain/src/thread-runtime.ts'),
      '@zana-ai/zcc-domain/launch-provider': resolve(__dirname, '../../packages/domain/src/launch-provider.ts'),
      '@zana-ai/zcc-llm': resolve(__dirname, '../../packages/llm/src/index.ts'),
      '@zana-ai/zcc-plugin-sdk': resolve(__dirname, '../../packages/plugin-sdk/src/index.ts'),
      '@zana-ai/zcc-plugin-sdk/server': resolve(__dirname, '../../packages/plugin-sdk/src/server.ts'),
      '@zana-ai/zcc-plugin-templates': resolve(__dirname, '../../packages/plugin-templates/src/index.ts')
    }
  },
  test: {
    environment: 'node'
  }
});
