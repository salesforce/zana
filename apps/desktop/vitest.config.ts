import { defineConfig, mergeConfig } from 'vitest/config';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import rootConfig from '../../vitest.config.ts';

const desktopRoot = dirname(fileURLToPath(import.meta.url));

export default mergeConfig(
  rootConfig,
  defineConfig({
    root: desktopRoot,
    test: {
      include: ['src/**/*.test.ts']
    }
  })
);
