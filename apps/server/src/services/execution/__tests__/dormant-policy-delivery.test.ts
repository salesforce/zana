import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('dormant policy and delivery removal', () => {
  it('removes unused stores and their engine projections', () => {
    expect(existsSync(fileURLToPath(new URL('../policy-result.ts', import.meta.url)))).toBe(false);
    expect(existsSync(fileURLToPath(new URL('../../delivery/store.ts', import.meta.url)))).toBe(false);
    for (const file of ['store.ts', 'service.ts', 'contracts.ts', 'execution-mcp-tool.ts']) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replace(/^.*delete .*policyResult.*$/gm, '');
      expect(source).not.toMatch(/policyResult|setPolicyResult|recordPolicyResult|WorkflowPolicyResult/);
    }
  });
});
