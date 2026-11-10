import { defineConfig, mergeConfig } from 'vitest/config';
import root from '../../vitest.config';
import { scaleTimeout } from '../../scripts/test-timeout-scale.mjs';
export default mergeConfig(root, defineConfig({
  root: __dirname,
  resolve: { extensions: ['.ts', '.tsx', '.mjs', '.js', '.json'], alias: { 'tippy.js': 'tippy.js/dist/tippy.esm.js' } },
  test: { include: ['**/*.test.{ts,tsx}'], exclude: ['node_modules/**'], setupFiles: ['./vitest.setup.ts'],
    // Radix accessibility queries are CPU-heavy under jsdom and coverage.
    server: { deps: { inline: ['@tiptap/extension-bubble-menu'] } }, maxWorkers: 2, testTimeout: scaleTimeout(60_000, process.env.ZANA_TEST_TIMEOUT_SCALE) },
}));
