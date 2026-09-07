import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: [
      'src/integration*.test.ts',
      'src/test/integration*.ts',
      'src/permission-matrix.test.ts',
      'src/runtime.acp-topology.test.ts',
      'src/runtime.codex-topology.test.ts',
      'src/runtime.fake-approvals.test.ts',
      'src/runtime.recovery.test.ts',
      'src/runtime.skill-roots-capability.test.ts',
      'dist/**',
      'node_modules/**'
    ]
  }
});
