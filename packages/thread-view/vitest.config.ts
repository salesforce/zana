import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: [
      'test/v3-item-projection.test.ts',
      'test/delegation-item-projection.test.ts'
    ]
  }
});
