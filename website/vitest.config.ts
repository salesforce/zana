import { defineConfig } from 'vitest/config';

// Website-local unit tests (Phases 1-4 add lib/**/*.test.ts: signing, auth,
// publish validation, feed projection). The root vitest.config.ts explicitly
// excludes e2e/** but doesn't know about website/ — this config scopes runs
// to `website/` when invoked via `npm test` from this package.
export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
    // Phase 0 wires the `test` script and CI step before any `*.test.ts`
    // files exist (those land in Phases 1-4). Without this, `vitest run`
    // exits 1 on an empty suite and breaks `npm test` / CI for every commit
    // until Phase 1 lands its first test.
    passWithNoTests: true
  }
});
