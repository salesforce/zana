import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: [
      'src/testing/parity.test.ts',
      'test/provider-recordings-redact.test.ts'
    ]
  }
});
