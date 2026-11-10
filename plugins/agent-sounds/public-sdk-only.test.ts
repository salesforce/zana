import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { experimental_scanPublicSdkOnly } from '@zana-ai/zcc-plugin-sdk/testing';
it('can be copied or forked without core imports', () => {
  const result = experimental_scanPublicSdkOnly(dirname(fileURLToPath(import.meta.url)), { allow: [/^react$/u, /^@testing-library\/react$/u] });
  expect(result.violations).toEqual([]); expect(result.privateDependencies).toEqual([]);
});
