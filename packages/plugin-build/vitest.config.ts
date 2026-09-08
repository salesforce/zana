import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: [
      'src/toolchain.test.ts',
      'src/build-plugin-app.test.ts',
      'src/runtime-export-manifest.test.ts',
      'src/builtin-server-artifacts.test.ts',
      'src/svg-asset.test.ts',
      'src/build-plugin-server.test.ts'
    ]
  }
});
